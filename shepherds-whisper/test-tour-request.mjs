#!/usr/bin/env node
/* Tests the tour-request endpoint end to end over real HTTP, with the mail
 * provider stubbed. Real delivery cannot be tested here, so everything around
 * it is: what gets accepted, what gets rejected, what the provider receives,
 * and — the one that matters most — that an enquiry is never silently lost.
 *
 *     node test-tour-request.mjs
 */

import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { handleTourRequest, composeEmail, validate, resetRateLimit } from './tour-request.mjs'

const CONFIGURED = {
  RESEND_API_KEY: 're_test',
  TOUR_EMAIL_TO: 'provider@example.com',
  TOUR_EMAIL_FROM: 'tours@example.com',
}

const GOOD = {
  name: 'Jordan Alvarez',
  relationship: 'Daughter',
  phone: '(503) 555-0142',
  email: 'jordan@example.com',
  needs: ['Memory care', 'Medication management'],
  moveIn: 'Within a month',
  date: '2026-09-04',
  window: 'Afternoon',
  notes: 'Mum has vascular dementia.',
}

/** Spins up the endpoint with a stub mailer and posts `payload` to it. */
async function post(payload, { env = CONFIGURED, sendResult = { ok: true } } = {}) {
  const sent = []
  const server = http.createServer((req, res) =>
    handleTourRequest(req, res, env, {
      sendEmail: async (form) => {
        sent.push(form)
        if (sendResult instanceof Error) throw sendResult
        return sendResult
      },
    }),
  )
  await new Promise((r) => server.listen(0, r))
  const { port } = server.address()

  const res = await fetch(`http://127.0.0.1:${port}/api/tour-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  server.close()
  return { status: res.status, body, sent }
}

test('a complete request is accepted and handed to the mailer', async () => {
  resetRateLimit()
  const { status, body, sent } = await post(GOOD)
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].name, 'Jordan Alvarez')
  assert.deepEqual(sent[0].needs, ['Memory care', 'Medication management'])
})

test('the email leads with the phone number and carries every answer', () => {
  const { subject, text } = composeEmail(validate(GOOD).form)
  assert.equal(subject, 'Tour request — Jordan Alvarez')
  /* The provider reads this on a phone; the callback number must be near the top. */
  assert.ok(text.split('\n').slice(0, 4).join('\n').includes('(503) 555-0142'))
  for (const expected of ['Daughter', 'Memory care', 'Within a month', '2026-09-04', 'Afternoon', 'vascular dementia']) {
    assert.ok(text.includes(expected), `email is missing ${expected}`)
  }
})

test('a name and a real phone number are required', async () => {
  resetRateLimit()
  const noName = await post({ ...GOOD, name: '' })
  assert.equal(noName.status, 400)
  assert.equal(noName.sent.length, 0)

  resetRateLimit()
  const shortPhone = await post({ ...GOOD, phone: '555' })
  assert.equal(shortPhone.status, 400)
  assert.equal(shortPhone.sent.length, 0)
})

test('a malformed body is rejected, not crashed on', async () => {
  resetRateLimit()
  const { status, sent } = await post('{not json')
  assert.equal(status, 400)
  assert.equal(sent.length, 0)
})

test('unset email config reports 503 so the browser can fall back', async () => {
  resetRateLimit()
  const { status, body, sent } = await post(GOOD, { env: {} })
  assert.equal(status, 503)
  assert.equal(body.error, 'not-configured')
  assert.equal(sent.length, 0, 'must not pretend to send when unconfigured')
})

test('a provider outage returns 502 rather than a false confirmation', async () => {
  resetRateLimit()
  const failed = await post(GOOD, { sendResult: { ok: false, status: 422, detail: 'domain not verified' } })
  assert.equal(failed.status, 502)
  assert.notEqual(failed.body.ok, true, 'a failed send must never report success')

  resetRateLimit()
  const threw = await post(GOOD, { sendResult: new Error('network down') })
  assert.equal(threw.status, 502)
})

test('repeated submissions are rate limited', async () => {
  resetRateLimit()
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await post(GOOD)).status)
  assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200])
  assert.deepEqual(codes.slice(5), [429, 429])
})

test('oversized fields are truncated rather than relayed whole', () => {
  const { ok, form } = validate({ ...GOOD, notes: 'x'.repeat(50_000), needs: Array(500).fill('a') })
  assert.equal(ok, true)
  assert.ok(form.notes.length <= 4000)
  assert.ok(form.needs.length <= 20)
})
