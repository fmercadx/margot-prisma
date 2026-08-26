import { createReadStream, promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'

const DIST = '/home/user/margot-prisma/shepherds-whisper/dist'
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

/** Serves dist/ and answers /api/tour-request with `apiStatus`. */
function serve(port, apiStatus, seen) {
  const s = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://l')
    if (pathname === '/api/tour-request') {
      let body = ''
      for await (const c of req) body += c
      seen.push({ method: req.method, body })
      res.writeHead(apiStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(apiStatus === 200 ? { ok: true } : { error: 'not-configured' }))
      return
    }
    const f = path.join(DIST, pathname === '/' ? 'index.html' : pathname)
    try { await fs.stat(f) } catch { res.writeHead(404).end(); return }
    res.writeHead(200, { 'Content-Type': T[path.extname(f)] ?? 'application/octet-stream' })
    createReadStream(f).pipe(res)
  })
  return new Promise((r) => s.listen(port, () => r(s)))
}

const failures = []
const ok = (n, v, d = '') => { console.log(`${v ? '  ok  ' : ' FAIL '} ${n}${d ? ` — ${d}` : ''}`); if (!v) failures.push(n) }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })

async function submit(port) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' })
  await p.locator('#tour').scrollIntoViewIfNeeded()
  await p.getByLabel('Your name').fill('Jordan Alvarez')
  await p.getByLabel('Phone', { exact: false }).first().fill('(503) 555-0142')
  await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(300)
  await p.getByRole('button', { name: 'Memory care' }).click()
  await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(300)
  await p.getByLabel('Preferred date').fill('2026-09-04')
  await p.getByRole('button', { name: 'Request my tour' }).click()
  await p.waitForTimeout(900)
  return p
}

// --- server accepts the enquiry ------------------------------------------
{
  const seen = []
  const server = await serve(4181, 200, seen)
  const p = await submit(4181)
  ok('posts to /api/tour-request', seen.length === 1 && seen[0].method === 'POST')
  const sent = seen[0] ? JSON.parse(seen[0].body) : {}
  ok('payload carries the answers', sent.name === 'Jordan Alvarez' && sent.needs?.includes('Memory care') && sent.date === '2026-09-04',
     JSON.stringify({ name: sent.name, needs: sent.needs, date: sent.date }))
  const text = await p.locator('#tour').innerText()
  ok('confirms it reached the home', /Your request is with us/.test(text))
  ok('names the callback number', text.includes('(503) 555-0142'))
  await p.close(); server.close()
}

// --- server up, email not configured -> must not claim delivery ----------
{
  const seen = []
  const server = await serve(4182, 503, seen)
  const p = await submit(4182)
  const text = await p.locator('#tour').innerText()
  ok('503 falls back instead of erroring', !/went wrong/i.test(text), text.slice(0, 70).replace(/\n/g, ' '))
  ok('does not falsely claim it was delivered', !/Your request is with us/.test(text))
  ok('still thanks the visitor', /Thank you/.test(text))
  await p.close(); server.close()
}

await browser.close()
console.log()
if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1) }
console.log('all form checks passed')
