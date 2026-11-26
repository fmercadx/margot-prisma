/* The GitHub Pages copy of the site, served the way Pages serves it.
 *
 *     npm run build:whisper && cd shepherds-whisper && npm run test:pages
 *
 * Pages differs from Railway in two ways that can only break here: the site
 * sits under a subpath, and there is no server, so no SPA fallback and no
 * /api/tour-request. This serves dist/ exactly like Pages — files only, 404.html
 * for a miss — and checks the site survives both.
 */

import { createReadStream, promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChromium } from './browser.mjs'

/* Serves dist/ the way GitHub Pages does: files only, 404.html for a miss,
   and NO SPA fallback. */
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const T = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml' }
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://l')
  /* Pages mounts the repo's dist/ at /<repo>/, so strip that prefix. */
  const rel = pathname.startsWith('/margot-prisma') ? pathname.slice('/margot-prisma'.length) : pathname
  let f = path.join(DIST, rel)
  try { if ((await fs.stat(f)).isDirectory()) f = path.join(f, 'index.html'); await fs.stat(f) }
  catch {
    const nf = path.join(DIST, 'shepherds-whisper', '404.html')
    try { await fs.stat(nf) } catch { res.writeHead(404).end('not found'); return }
    res.writeHead(404, { 'Content-Type': 'text/html' }); createReadStream(nf).pipe(res); return
  }
  res.writeHead(200, { 'Content-Type': T[path.extname(f)] ?? 'application/octet-stream' })
  createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(4172, r))
const SITE = 'http://127.0.0.1:4172/margot-prisma/shepherds-whisper/'

const fails = []
const ok = (n,v,d='') => { console.log(`${v?'  ok  ':' FAIL '} ${n}${d?` — ${d}`:''}`); if(!v) fails.push(n) }
const b = await launchChromium()

const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
const bad = []; p.on('response', r => { if (r.status() >= 400 && !r.url().includes('fonts.g')) bad.push(`${r.status()} ${r.url()}`) })
const errs = []; p.on('pageerror', e => errs.push(e.message))

await p.goto(SITE, { waitUntil: 'networkidle' })
ok('home renders at the subpath', (await p.locator('h1').innerText()).includes('Care that feels like'))
ok('no page errors', errs.length === 0, errs.join(' | '))
ok('no 404s for assets', bad.length === 0, bad.slice(0,3).join(' | '))
/* The gallery images are loading="lazy", so a page that has not been scrolled
   reports them incomplete. Scroll before judging. */
await p.evaluate(async () => {
  document.documentElement.style.scrollBehavior = 'auto'
  for (let y = 0; y < document.body.scrollHeight; y += 600) {
    window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60))
  }
  window.scrollTo(0, 0)
})
await p.waitForTimeout(1200)
const broken = await p.evaluate(() =>
  [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.alt))
ok('illustrations load', broken.length === 0, broken.join(' | '))

// direct hit on /privacy — the email/listing link, with no SPA fallback
const d = await b.newPage({ viewport: { width: 1280, height: 900 } })
const res = await d.goto(`${SITE}privacy`, { waitUntil: 'networkidle' })
ok('direct /privacy returns 200', res.status() === 200, String(res.status()))
ok('direct /privacy renders the policy', (await d.locator('h1').innerText()) === 'Privacy')

// footer link navigation keeps the subpath
const n = await b.newPage({ viewport: { width: 1280, height: 900 } })
await n.goto(SITE, { waitUntil: 'networkidle' })
const link = n.locator('footer a[href*="privacy"]')
ok('footer href carries the subpath',
   (await link.getAttribute('href')) === '/margot-prisma/shepherds-whisper/privacy',
   await link.getAttribute('href'))
await link.click(); await n.waitForTimeout(400)
ok('click navigates', (await n.locator('h1').innerText()) === 'Privacy')
await n.goBack(); await n.waitForTimeout(400)
ok('back returns home', (await n.locator('h1').innerText()).includes('Care that feels like'))

// the real behavioural difference: no server, so the form must fall back
const f = await b.newPage({ viewport: { width: 1280, height: 900 } })
await f.goto(SITE, { waitUntil: 'networkidle' })
await f.locator('#tour').scrollIntoViewIfNeeded()
await f.getByLabel('Your name').fill('Jordan Alvarez')
await f.getByLabel('Phone', { exact: false }).first().fill('(503) 555-0142')
await f.getByRole('button', { name: 'Continue' }).click(); await f.waitForTimeout(300)
await f.getByRole('button', { name: 'Continue' }).click(); await f.waitForTimeout(300)
await f.getByRole('button', { name: 'Request my tour' }).click(); await f.waitForTimeout(900)
const after = await f.locator('#tour').innerText()
ok('form falls back, no error shown', !/went wrong/i.test(after), after.slice(0,60).replace(/\n/g,' '))
ok('does not falsely claim delivery', !/Your request is with us/.test(after))
ok('still thanks the visitor', /Thank you/.test(after))

const m = await b.newPage({ viewport: { width: 390, height: 844 } })
await m.goto(SITE, { waitUntil: 'networkidle' })
const [sw, cw] = await m.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
ok('no sideways scroll at 390px', sw <= cw + 1, `${sw} vs ${cw}`)

await b.close(); server.close()
console.log()
if (fails.length) { console.error(`${fails.length} failed`); process.exit(1) }
console.log('all Pages checks passed')
