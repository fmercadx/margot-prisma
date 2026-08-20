/* Licence verification for the mobile app.
 *
 * The app is a login, not a store. Subscriptions are sold on the web through
 * Stripe, and this service answers one question the app asks at launch: is
 * this key still paying? Both stores allow that shape for business apps whose
 * accounts are sold to organizations, and it keeps the store's 15–30% off a
 * subscription that is not a consumer sale in the first place.
 *
 * Runs on Cloudflare Workers. No framework, no build step, no server.
 *
 *   POST /licence/verify   {email, key, app, v} -> {active, reason?, ...}
 *   POST /stripe/webhook   Stripe events, signature-verified
 *   GET  /health
 *
 * Stripe webhooks are the source of truth and keep KV current. Verify reads
 * KV, so a launch costs one KV read rather than a round trip to Stripe. A
 * record that has not been confirmed for STALE_AFTER_MS is re-checked against
 * the Stripe API — webhooks do get missed, and a subscription that quietly
 * lapsed should not keep working forever.
 */

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const WEBHOOK_TOLERANCE_S = 300;

// Capacitor serves the app from these origins. Nothing else needs access:
// the web page has no gate and never calls this.
const ALLOWED_ORIGINS = new Set([
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
]);

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/* ------------------------------------------------------------------ utils */

function cors(origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function json(body, { status = 200, origin } = {}) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent equality. Comparing signatures with === leaks how much
 *  of a guess was right, one character at a time. */
function timingSafeEqual(a, b) {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

// Crockford base32: I, L, O and U are omitted, so nobody types 1 for I or 0
// for O off a receipt, and the key survives being read down a phone line.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newLicenceKey(randomBytes = crypto.getRandomValues(new Uint8Array(20))) {
  let out = '';
  for (const b of randomBytes) out += ALPHABET[b % 32];
  return 'CA-' + out.match(/.{1,5}/g).join('-');
}

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/* --------------------------------------------------------------- webhook */

/** Verify a Stripe signature header: `t=<unix>,v1=<hmac>`.
 *
 *  Skipping this would let anyone POST a fabricated "subscription created"
 *  event and mint themselves a licence, so it is not optional.
 */
export async function verifyStripeSignature(header, body, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!header) return { ok: false, reason: 'missing signature' };
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=').map((s) => s.trim())).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!t || !parts.v1) return { ok: false, reason: 'malformed signature' };
  if (Math.abs(nowS - t) > WEBHOOK_TOLERANCE_S) {
    return { ok: false, reason: 'timestamp outside tolerance' };
  }
  const expected = await hmacHex(secret, `${t}.${body}`);
  if (!timingSafeEqual(expected, parts.v1)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}

/** Turn a Stripe event into the record we keep, or null if we ignore it. */
export function recordFromEvent(event, existing) {
  const o = event?.data?.object || {};
  switch (event?.type) {
    case 'checkout.session.completed':
      return {
        email: normaliseEmail(o.customer_details?.email || o.customer_email),
        company: o.custom_fields?.find?.((f) => f.key === 'company')?.text?.value
                 || existing?.company || null,
        customerId: o.customer || existing?.customerId || null,
        subscriptionId: o.subscription || existing?.subscriptionId || null,
        status: 'active',
      };
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return {
        email: existing?.email || null,
        company: existing?.company || null,
        customerId: o.customer || existing?.customerId || null,
        subscriptionId: o.id || existing?.subscriptionId || null,
        status: event.type.endsWith('deleted') ? 'canceled' : o.status,
      };
    default:
      return null;
  }
}

async function handleWebhook(request, env) {
  const body = await request.text();
  const check = await verifyStripeSignature(
    request.headers.get('Stripe-Signature'), body, env.STRIPE_WEBHOOK_SECRET);
  if (!check.ok) return json({ error: check.reason }, { status: 400 });

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  const o = event?.data?.object || {};
  const subId = o.id || o.subscription;
  const indexKey = subId ? `sub:${subId}` : null;
  const existingKeyId = indexKey ? await env.LICENCES.get(indexKey) : null;

  let keyId = existingKeyId;
  const existing = keyId ? JSON.parse((await env.LICENCES.get(`key:${keyId}`)) || 'null') : null;

  const record = recordFromEvent(event, existing);
  if (!record) return json({ ignored: event?.type || 'unknown' });

  // A checkout for an address we have already issued to reuses that key, so a
  // renewal or a plan change never silently invalidates the one they have.
  if (!keyId && record.email) {
    keyId = await env.LICENCES.get(`email:${record.email}`);
  }
  if (!keyId) keyId = newLicenceKey();

  const merged = { ...(existing || {}), ...record, keyId, checkedAt: Date.now() };
  await env.LICENCES.put(`key:${keyId}`, JSON.stringify(merged));
  if (merged.email) await env.LICENCES.put(`email:${merged.email}`, keyId);
  if (merged.subscriptionId) await env.LICENCES.put(`sub:${merged.subscriptionId}`, keyId);

  return json({ ok: true, key: keyId, status: merged.status });
}

/* ---------------------------------------------------------------- verify */

/** Ask Stripe directly. Used only when the cached record has gone stale. */
async function refreshFromStripe(record, env) {
  if (!env.STRIPE_SECRET_KEY || !record.subscriptionId) return record;
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/subscriptions/${record.subscriptionId}`,
      { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    if (!res.ok) return record;
    const sub = await res.json();
    return { ...record, status: sub.status, checkedAt: Date.now() };
  } catch {
    // Stripe unreachable. Fall back to what we already knew rather than
    // locking out a paying customer because of someone else's outage.
    return record;
  }
}

async function handleVerify(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ active: false, reason: 'Malformed request.' }, { status: 400, origin });
  }

  const email = normaliseEmail(body.email);
  const key = String(body.key || '').trim().toUpperCase();
  if (!email || !key) {
    return json({ active: false, reason: 'Enter both your email and licence key.' },
                { status: 400, origin });
  }

  const raw = await env.LICENCES.get(`key:${key}`);
  if (!raw) {
    // Deliberately the same message as an email mismatch. Telling the caller
    // which half was wrong turns this into an oracle for enumerating keys.
    return json({ active: false, reason: 'That email and licence key do not match.' },
                { status: 200, origin });
  }

  let record = JSON.parse(raw);
  if (normaliseEmail(record.email) !== email) {
    return json({ active: false, reason: 'That email and licence key do not match.' },
                { status: 200, origin });
  }

  if (Date.now() - (record.checkedAt || 0) > STALE_AFTER_MS) {
    const fresh = await refreshFromStripe(record, env);
    if (fresh !== record) {
      record = fresh;
      await env.LICENCES.put(`key:${key}`, JSON.stringify(record));
    }
  }

  if (!ACTIVE_STATUSES.has(record.status)) {
    return json({ active: false, reason: 'That subscription is not active.' },
                { status: 200, origin });
  }

  return json({
    active: true,
    seat: record.email,
    company: record.company || null,
  }, { origin });
}

/* ----------------------------------------------------------------- entry */

export async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (url.pathname === '/health') {
    return json({ ok: true }, { origin });
  }
  if (url.pathname === '/licence/verify' && request.method === 'POST') {
    return handleVerify(request, env, origin);
  }
  if (url.pathname === '/stripe/webhook' && request.method === 'POST') {
    return handleWebhook(request, env);
  }
  return json({ error: 'Not found' }, { status: 404, origin });
}

export default {
  fetch: (request, env) => handle(request, env),
};
