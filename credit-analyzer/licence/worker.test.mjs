/* Tests for the licence service.
 *
*   node --test credit-analyzer/licence/
 *
 * KV and Stripe are stubbed. The weight is on the ways this fails badly:
 * an unsigned webhook minting a licence, a cancelled subscription still
 * verifying, and an error message that tells an attacker which half of the
 * credentials was wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handle, newLicenceKey, normaliseEmail, recordFromEvent, verifyStripeSignature,
} from './worker.js';

const SECRET = 'whsec_test_secret';

function kv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
  };
}

function env(overrides = {}) {
  return { LICENCES: kv(), STRIPE_WEBHOOK_SECRET: SECRET, ...overrides };
}

async function sign(body, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const { createHmac } = await import('node:crypto');
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function post(path, body, headers = {}) {
  return new Request(`https://licence.example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const CHECKOUT = {
  type: 'checkout.session.completed',
  data: {
    object: {
      customer: 'cus_1',
      subscription: 'sub_1',
      customer_details: { email: 'LO@Brokerage.com' },
      custom_fields: [{ key: 'company', text: { value: 'Access Capital Group' } }],
    },
  },
};

async function issueKey(e) {
  const body = JSON.stringify(CHECKOUT);
  const res = await handle(post('/stripe/webhook', body, { 'Stripe-Signature': await sign(body) }), e);
  return (await res.json()).key;
}

/* ------------------------------------------------------------- signatures */

test('a webhook with no signature is rejected', async () => {
  const res = await handle(post('/stripe/webhook', CHECKOUT), env());
  assert.equal(res.status, 400);
});

test('a webhook signed with the wrong secret is rejected', async () => {
  const body = JSON.stringify(CHECKOUT);
  const sig = await sign(body, 'whsec_attacker');
  const res = await handle(post('/stripe/webhook', body, { 'Stripe-Signature': sig }), env());
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /mismatch/);
});

test('a replayed webhook outside the tolerance window is rejected', async () => {
  const body = JSON.stringify(CHECKOUT);
  const old = Math.floor(Date.now() / 1000) - 3600;
  const sig = await sign(body, SECRET, old);
  const res = await handle(post('/stripe/webhook', body, { 'Stripe-Signature': sig }), env());
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /tolerance/);
});

test('an unsigned webhook cannot mint a licence', async () => {
  const e = env();
  await handle(post('/stripe/webhook', CHECKOUT), e);
  assert.equal(e.LICENCES.store.size, 0, 'nothing should have been written');
});

test('verifyStripeSignature accepts a correct signature', async () => {
  const body = '{"hello":"world"}';
  assert.deepEqual(await verifyStripeSignature(await sign(body), body, SECRET), { ok: true });
});

/* ----------------------------------------------------------------- issue */

test('a completed checkout issues a key and records the subscription', async () => {
  const e = env();
  const key = await issueKey(e);
  assert.match(key, /^CA-/);
  const rec = JSON.parse(e.LICENCES.store.get(`key:${key}`));
  assert.equal(rec.email, 'lo@brokerage.com', 'email is normalised');
  assert.equal(rec.company, 'Access Capital Group');
  assert.equal(rec.status, 'active');
  assert.equal(e.LICENCES.store.get('sub:sub_1'), key);
  assert.equal(e.LICENCES.store.get('email:lo@brokerage.com'), key);
});

test('a second checkout for the same address reuses the existing key', async () => {
  const e = env();
  const first = await issueKey(e);
  const second = await issueKey(e);
  assert.equal(second, first, 'a renewal must not invalidate the key they already have');
});

/* ---------------------------------------------------------------- verify */

test('a live subscription verifies', async () => {
  const e = env();
  const key = await issueKey(e);
  const res = await handle(post('/licence/verify', { email: 'lo@brokerage.com', key }), e);
  const out = await res.json();
  assert.equal(out.active, true);
  assert.equal(out.company, 'Access Capital Group');
});

test('email and key are matched case-insensitively', async () => {
  const e = env();
  const key = await issueKey(e);
  const res = await handle(
    post('/licence/verify', { email: '  LO@BROKERAGE.com ', key: key.toLowerCase() }), e);
  assert.equal((await res.json()).active, true);
});

test('a cancelled subscription stops verifying', async () => {
  const e = env();
  const key = await issueKey(e);
  const body = JSON.stringify({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
  });
  await handle(post('/stripe/webhook', body, { 'Stripe-Signature': await sign(body) }), e);

  const res = await handle(post('/licence/verify', { email: 'lo@brokerage.com', key }), e);
  const out = await res.json();
  assert.equal(out.active, false);
  assert.match(out.reason, /not active/);
});

test('a cancellation does not lose the email on the record', async () => {
  const e = env();
  const key = await issueKey(e);
  const body = JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active' } },
  });
  await handle(post('/stripe/webhook', body, { 'Stripe-Signature': await sign(body) }), e);
  const rec = JSON.parse(e.LICENCES.store.get(`key:${key}`));
  assert.equal(rec.email, 'lo@brokerage.com',
               'a subscription event must not blank the address the key belongs to');
});

test('an unknown key and a wrong email give the same answer', async () => {
  const e = env();
  const key = await issueKey(e);
  const wrongKey = await handle(
    post('/licence/verify', { email: 'lo@brokerage.com', key: 'CA-ZZZZZ-ZZZZZ' }), e);
  const wrongEmail = await handle(
    post('/licence/verify', { email: 'someone@else.com', key }), e);
  assert.equal((await wrongKey.json()).reason, (await wrongEmail.json()).reason,
               'differing messages let an attacker enumerate valid keys');
});

test('a missing field is refused', async () => {
  const res = await handle(post('/licence/verify', { email: 'a@b.com' }), env());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).active, false);
});

test('past_due still verifies', async () => {
  const e = env();
  const key = await issueKey(e);
  const rec = JSON.parse(e.LICENCES.store.get(`key:${key}`));
  await e.LICENCES.put(`key:${key}`, JSON.stringify({ ...rec, status: 'past_due' }));
  const res = await handle(post('/licence/verify', { email: 'lo@brokerage.com', key }), e);
  assert.equal((await res.json()).active, true,
               'a failed card should not lock someone out mid-file');
});

/* ------------------------------------------------------------- staleness */

test('a stale record is re-checked against Stripe', async () => {
  const e = env({ STRIPE_SECRET_KEY: 'sk_test' });
  const key = await issueKey(e);
  const rec = JSON.parse(e.LICENCES.store.get(`key:${key}`));
  await e.LICENCES.put(`key:${key}`,
                       JSON.stringify({ ...rec, checkedAt: Date.now() - 30 * 864e5 }));

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'canceled' }), { status: 200 });
  try {
    const res = await handle(post('/licence/verify', { email: 'lo@brokerage.com', key }), e);
    assert.equal((await res.json()).active, false, 'a missed webhook must not grant forever');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Stripe being down falls back to the cached status', async () => {
  const e = env({ STRIPE_SECRET_KEY: 'sk_test' });
  const key = await issueKey(e);
  const rec = JSON.parse(e.LICENCES.store.get(`key:${key}`));
  await e.LICENCES.put(`key:${key}`,
                       JSON.stringify({ ...rec, checkedAt: Date.now() - 30 * 864e5 }));

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const res = await handle(post('/licence/verify', { email: 'lo@brokerage.com', key }), e);
    assert.equal((await res.json()).active, true,
                 'someone else\'s outage must not lock out a paying customer');
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ------------------------------------------------------------------ CORS */

test('the app origin is allowed and a random site is not', async () => {
  const e = env();
  const key = await issueKey(e);
  const allowed = await handle(
    post('/licence/verify', { email: 'lo@brokerage.com', key }, { Origin: 'https://localhost' }), e);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://localhost');

  const denied = await handle(
    post('/licence/verify', { email: 'lo@brokerage.com', key },
         { Origin: 'https://evil.example' }), e);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});

/* ------------------------------------------------------------------ keys */

test('keys omit the characters people mistype', () => {
  const key = newLicenceKey(new Uint8Array(20).fill(0));
  assert.equal(key, 'CA-00000-00000-00000-00000');
  // Crockford base32 drops I, L, O and U, so 1/I and 0/O cannot be confused
  // when a key is copied off a receipt or read down a phone line.
  for (let i = 0; i < 200; i++) {
    assert.doesNotMatch(newLicenceKey(), /[ILOU]/);
  }
});

test('keys are not guessable', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(newLicenceKey());
  assert.equal(seen.size, 500);
});

test('normaliseEmail handles junk', () => {
  assert.equal(normaliseEmail('  A@B.COM '), 'a@b.com');
  assert.equal(normaliseEmail(null), '');
});

test('an unrelated event is ignored rather than clobbering a record', () => {
  assert.equal(recordFromEvent({ type: 'invoice.paid', data: { object: {} } }, null), null);
});
