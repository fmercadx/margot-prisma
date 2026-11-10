/* The privacy page makes claims about what this code does. This asserts the
 * claims are still there, so that removing the behaviour without updating the
 * page fails loudly instead of quietly turning the policy into a lie.
 *
 *     npm run test:privacy        (build first)
 *
 * Brittleness is the point. If the deploy-log fallback goes away, or analytics
 * get added, or the fonts stop coming from Google, a check here should break
 * and send someone to re-read the page.
 */

import { createReadStream, promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChromium } from './browser.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, 'dist')
const T = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml' }

/* Mirrors server.mjs: extension-less paths fall back to the app shell. */
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://l')
  let f = path.join(DIST, pathname === '/' ? 'index.html' : pathname)
  try { await fs.stat(f) } catch {
    if (path.extname(pathname)) { res.writeHead(404).end(); return }
    f = path.join(DIST, 'index.html')
  }
  res.writeHead(200, { 'Content-Type': T[path.extname(f)] ?? 'application/octet-stream' })
  createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(4174, r))

const fails = []
const ok = (n, v, d='') => { console.log(`${v?'  ok  ':' FAIL '} ${n}${d?` — ${d}`:''}`); if(!v) fails.push(n) }
const b = await launchChromium()

// --- direct hit on /privacy (what a store listing or email link does) ----
const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
const offsite = []
p.on('request', r => { const u=r.url(); if (!u.startsWith('data:') && !u.includes('127.0.0.1')) offsite.push(u) })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto('http://127.0.0.1:4174/privacy', { waitUntil: 'networkidle' })

ok('no page errors', errs.length === 0, errs.join(' | '))
ok('/privacy renders the policy', (await p.locator('h1').innerText()) === 'Privacy')
const text = await p.locator('main').innerText()
ok('names the real entity', text.includes("The Shepherd's Whisper AFH LLC"))
ok('names the real address', text.includes('285 NW 334th Ave'))
ok('discloses Google Fonts', /fonts\.googleapis\.com/.test(text))
ok('discloses Resend', /Resend/.test(text))
ok('discloses the IP window', /one hour/.test(text))
ok('discloses the deploy-log fallback', /hosting provider/.test(text) && /logs/.test(text))
ok('names the care-needs list', /memory care/.test(text) && /incontinence care/.test(text))
ok('flags it is not in effect', /not yet in effect/i.test(text))
ok('marks the unset fields', (await p.locator('main').innerText()).includes('[not yet set]'))
const ext = offsite.filter(u => !u.includes('fonts.g'))
ok('page itself requests nothing off-site but fonts', ext.length === 0, ext.slice(0,2).join(' | '))

// --- footer link from the home page --------------------------------------
const h = await b.newPage({ viewport: { width: 1280, height: 900 } })
await h.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
const link = h.locator('footer a[href="/privacy"]')
ok('footer links to it', await link.count() === 1)
await link.click(); await h.waitForTimeout(400)
ok('clicking navigates in-page', (await h.locator('h1').innerText()) === 'Privacy')
ok('URL updates', new URL(h.url()).pathname === '/privacy')
await h.goBack(); await h.waitForTimeout(400)
ok('back returns to the site', (await h.locator('h1').innerText()).includes('Care that feels like'))

// --- phone width ----------------------------------------------------------
const m = await b.newPage({ viewport: { width: 390, height: 844 } })
await m.goto('http://127.0.0.1:4174/privacy', { waitUntil: 'networkidle' })
const [sw, cw] = await m.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
ok('no sideways scroll at 390px', sw <= cw + 1, `${sw} vs ${cw}`)

await b.close(); server.close()
console.log()
if (fails.length) { console.error(`${fails.length} failed`); process.exit(1) }
console.log('all privacy checks passed')
