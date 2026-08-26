/* Delivers a tour request to the home's inbox.
 *
 * Self-hosted on purpose. The wizard collects care needs — memory care,
 * incontinence, hospice — which is health-adjacent information about a named
 * person, and the page promises the visitor that we do not hand enquiries to
 * third parties. Posting them through a form-processing service would put that
 * data in someone else's database and quietly make the promise untrue. This
 * server already exists, so the enquiry goes straight from it to the provider.
 *
 * No dependency: Resend's HTTP API over Node's built-in fetch. Configure with
 *
 *   RESEND_API_KEY   re_...            from resend.com
 *   TOUR_EMAIL_TO    you@example.com   where enquiries land; comma-separated for several
 *   TOUR_EMAIL_FROM  tours@yourdomain  must be a domain verified with Resend
 *
 * With those unset the endpoint reports 503 and the browser falls back to
 * opening a prefilled email, so an enquiry is never silently swallowed.
 */

const MAX_BODY_BYTES = 32 * 1024

/* One IP may send a handful of enquiries an hour. A family filling this in
   twice is normal; a script filling it in two hundred times is not. Counts live
   in process memory, which is fine because this runs as a single process — if
   it is ever scaled out, move this to shared storage or the limit multiplies by
   the worker count. */
const RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 }
const hits = new Map()

export function isConfigured(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.TOUR_EMAIL_TO && env.TOUR_EMAIL_FROM)
}

export function rateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs)
  if (recent.length >= RATE_LIMIT.max) {
    hits.set(ip, recent)
    return true
  }
  recent.push(now)
  hits.set(ip, recent)

  /* Keep the map from growing without bound on a long-lived process. */
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_LIMIT.windowMs)) hits.delete(key)
    }
  }
  return false
}

export function resetRateLimit() {
  hits.clear()
}

/** Reads a capped JSON body. Returns {ok:false, reason} rather than throwing. */
export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve({ ok: false, reason: 'too-large' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        resolve({ ok: false, reason: 'not-json' })
      }
    })
    req.on('error', () => resolve({ ok: false, reason: 'aborted' }))
  })
}

const str = (value, max) => (typeof value === 'string' ? value.slice(0, max).trim() : '')

/** Mirrors the wizard's own validation: a name and a usable phone number. */
export function validate(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Malformed request.' }

  const form = {
    name: str(payload.name, 120),
    relationship: str(payload.relationship, 120),
    phone: str(payload.phone, 40),
    email: str(payload.email, 200),
    needs: Array.isArray(payload.needs) ? payload.needs.slice(0, 20).map((n) => str(n, 60)) : [],
    moveIn: str(payload.moveIn, 60),
    date: str(payload.date, 20),
    window: str(payload.window, 20),
    notes: str(payload.notes, 4000),
  }

  if (!form.name) return { ok: false, error: 'A name is required.' }
  if (form.phone.replace(/\D/g, '').length < 10) return { ok: false, error: 'A phone number is required.' }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    return { ok: false, error: 'That email address does not look right.' }
  }
  return { ok: true, form }
}

/* Plain text, because this is read on a phone between other things and the
   provider needs the phone number in the first three lines. */
export function composeEmail(form) {
  const lines = [
    `${form.name} has asked to tour the home.`,
    '',
    `Phone:        ${form.phone}`,
    form.email && `Email:        ${form.email}`,
    form.relationship && `Relationship: ${form.relationship}`,
    '',
    `Care needed:  ${form.needs.length ? form.needs.join(', ') : 'not specified'}`,
    form.moveIn && `Timing:       ${form.moveIn}`,
    '',
    `Preferred day:  ${form.date || 'flexible'}`,
    `Preferred time: ${form.window || 'flexible'}`,
    form.notes && `\nTheir notes:\n${form.notes}`,
    '',
    '---',
    'Sent from the tour form on your website.',
  ]
  return {
    subject: `Tour request — ${form.name}`,
    text: lines.filter((line) => line !== false && line !== undefined && line !== null).join('\n'),
  }
}

/** Sends via Resend. Returns {ok} or {ok:false, status, detail}. */
export async function sendEmail(form, env = process.env, fetchImpl = fetch) {
  const { subject, text } = composeEmail(form)

  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.TOUR_EMAIL_FROM,
      to: env.TOUR_EMAIL_TO.split(',').map((address) => address.trim()).filter(Boolean),
      /* So the provider can hit reply and reach the family directly. */
      ...(form.email ? { reply_to: form.email } : {}),
      subject,
      text,
    }),
  })

  if (response.ok) return { ok: true }
  return { ok: false, status: response.status, detail: await response.text().catch(() => '') }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Handles POST /api/tour-request. */
export async function handleTourRequest(req, res, env = process.env, deps = {}) {
  const send = deps.sendEmail ?? sendEmail

  if (!isConfigured(env)) {
    /* Explicitly "not set up here" rather than a generic failure, so the
       browser can fall back to a prefilled email instead of losing the
       enquiry. */
    json(res, 503, { error: 'not-configured' })
    return
  }

  const ip =
    (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'

  if (rateLimited(ip)) {
    json(res, 429, { error: 'Too many requests. Please call us instead.' })
    return
  }

  const body = await readJsonBody(req)
  if (!body.ok) {
    json(res, 400, { error: 'Could not read that request.' })
    return
  }

  const checked = validate(body.value)
  if (!checked.ok) {
    json(res, 400, { error: checked.error })
    return
  }

  try {
    const result = await send(checked.form, env)
    if (result.ok) {
      json(res, 200, { ok: true })
      return
    }
    /* Log enough to reconstruct the enquiry from the deploy logs if the mail
       provider is down — losing a family's request is the worst outcome here. */
    console.error('tour-request: send failed', result.status, result.detail)
    console.error('tour-request: unsent enquiry', JSON.stringify(checked.form))
    json(res, 502, { error: 'Could not send that just now.' })
  } catch (error) {
    console.error('tour-request: send threw', error?.message)
    console.error('tour-request: unsent enquiry', JSON.stringify(checked.form))
    json(res, 502, { error: 'Could not send that just now.' })
  }
}
