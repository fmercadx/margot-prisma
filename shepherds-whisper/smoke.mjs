#!/usr/bin/env node
/* Drive the built site in a real browser and assert the things that have
 * actually broken on sites in this repository before.
 *
 *     node smoke.mjs                       # builds must already exist in dist/
 *     node smoke.mjs --browser <path>      # if Chromium is not on the default path
 *     node smoke.mjs --port 4173
 *
 * Four checks earn their place:
 *
 *   · the page must not scroll sideways at 390px. The salon site shipped a
 *     single `white-space: nowrap` that broke this once, so it is asserted at
 *     phone width and the offending element is named.
 *   · the tour wizard must advance through all three steps and refuse to leave
 *     step one without a name and a phone number. It is the only conversion
 *     path on the page.
 *   · the FAQ accordion must actually open, since it is `hidden` until then and
 *     a broken toggle hides half the copy on the page.
 *   · nothing may 404. A missing asset on a care home's site reads as neglect.
 */

import { createReadStream, promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChromium } from './browser.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, 'dist')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
}

function serve(port) {
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    let file = path.join(DIST, pathname === '/' ? 'index.html' : pathname)
    try {
      const stats = await fs.stat(file)
      if (stats.isDirectory()) file = path.join(file, 'index.html')
    } catch {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const port = Number(arg('port', 4173))
const server = await serve(port)
const base = `http://127.0.0.1:${port}`

const browser = await launchChromium()

try {
  /* ---- phone width -------------------------------------------------- */
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })

  const notFound = []
  phone.on('response', (r) => {
    if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`)
  })
  const pageErrors = []
  phone.on('pageerror', (e) => pageErrors.push(e.message))

  await phone.goto(base, { waitUntil: 'networkidle' })

  check('page renders a heading', (await phone.locator('h1').count()) > 0)
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  /* Ignore the Google Fonts request: this container's proxy blocks it, but the
     visitor's browser will not, and the CSS declares a full fallback stack. */
  const realFailures = notFound.filter((u) => !u.includes('fonts.g'))
  check('nothing 404s', realFailures.length === 0, realFailures.join(' | '))

  const overflow = await phone.evaluate(() => {
    const doc = document.documentElement
    if (doc.scrollWidth <= doc.clientWidth) return null

    /* Decorative blurs are deliberately wider than the viewport and are clipped
       by an `overflow-hidden` ancestor, so they are not the culprit even though
       their rect sticks out. Only report elements nothing is clipping. */
    const isClipped = (el) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a)
        if (s.overflow !== 'visible' || s.overflowX !== 'visible') return true
      }
      return false
    }

    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.right <= doc.clientWidth + 1 && r.left >= -1) continue
      const style = getComputedStyle(el)
      if (style.position === 'fixed' || style.visibility === 'hidden') continue
      if (isClipped(el)) continue
      const cls = String(el.className).split(' ').slice(0, 3).join('.')
      return `${el.tagName.toLowerCase()}.${cls} → right ${Math.round(r.right)}px, width ${Math.round(r.width)}px`
    }
    return `document scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}, offender not isolated`
  })
  check('no horizontal scroll at 390px', overflow === null, overflow ?? '')

  /* ---- the header fits on one row ------------------------------------ */
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await desk.goto(base, { waitUntil: 'domcontentloaded' })

  /* Two ways this breaks, and the height of the header shows neither: the row
     is `h-20`, a fixed height, so it stays 80px tall whatever happens inside.
     Adding the phone number once pushed six links, a number and the CTA past
     the row's max width; the items broke onto two lines at every desktop width
     and nothing here caught it. They carry `whitespace-nowrap` now, which
     removes wrapping as a failure mode but replaces it with overflow — so
     measure the content against the box, which catches both. */
  const header = await desk.evaluate(() => {
    const row = document.querySelector('header > div')
    if (!row) return { error: 'header row not found' }

    /* Count the line boxes the text actually occupies, rather than reasoning
       from height: the brand block is deliberately two lines (name over
       tagline), and padding plus an inline icon make any height arithmetic
       either miss real wrapping or flag that block forever. */
    const lineCount = (el) => {
      const range = document.createRange()
      let lines = 0
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue
        range.selectNodeContents(node)
        lines = Math.max(lines, [...range.getClientRects()].filter((r) => r.height > 0).length)
      }
      return lines
    }

    const items = [...row.querySelectorAll('nav a, a[href^="tel:"], a[href="#tour"], a[href="#top"] span.block')]
    const label = (el) => el.textContent.trim().replace(/\s+/g, ' ').slice(0, 22)

    const wrapped = items.filter((el) => lineCount(el) > 1).map((el) => `wrapped: ${label(el)}`)
    /* With `whitespace-nowrap` an item cannot wrap, so it overflows instead —
       the perpendicular failure, invisible to the line count above. */
    const squeezed = items
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `squeezed: ${label(el)} (${el.scrollWidth}>${el.clientWidth})`)

    return { squeezed: [...wrapped, ...squeezed], overflow: row.scrollWidth - row.clientWidth }
  })
  check(
    'header fits on one row at 1280px',
    !header.error && header.squeezed.length === 0 && header.overflow <= 1,
    header.error ?? `${header.squeezed.join('; ')}${header.overflow > 1 ? ` overflow ${header.overflow}px` : ''}`,
  )

  /* ---- the tour wizard ---------------------------------------------- */

  await desk.locator('#tour').scrollIntoViewIfNeeded()
  const cont = desk.getByRole('button', { name: 'Continue' })

  await cont.click()
  const blocked = await desk.getByText('Please tell us your name').isVisible()
  check('wizard refuses to advance without a name', blocked)

  await desk.getByLabel('Your name').fill('Jordan Alvarez')
  await desk.getByLabel('Phone', { exact: false }).first().fill('360 555 0100')
  await cont.click()

  const onStepTwo = await desk.getByRole('button', { name: 'Memory care' }).isVisible()
  check('wizard reaches step two', onStepTwo)

  await desk.getByRole('button', { name: 'Memory care' }).click()
  const chipPressed =
    (await desk.getByRole('button', { name: 'Memory care' }).getAttribute('aria-pressed')) === 'true'
  check('care-need chips toggle', chipPressed)

  await cont.click()
  const onStepThree = await desk.getByLabel('Preferred date').isVisible()
  check('wizard reaches step three', onStepThree)

  /* ---- the FAQ accordion -------------------------------------------- */
  const trigger = desk.locator('#faq-trigger-2')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const panelOpen = await desk.locator('#faq-panel-2').isVisible()
  check('FAQ accordion opens', panelOpen)

  /* ---- contrast on the primary CTA ---------------------------------- */
  const cta = desk.locator('a[href="#tour"]').first()
  const colours = await cta.evaluate((el) => {
    const s = getComputedStyle(el)
    return { fg: s.color, bg: s.backgroundColor }
  })
  check(
    'primary CTA is navy on cream',
    colours.bg.includes('31, 53, 87'),
    `${colours.fg} on ${colours.bg}`,
  )
} finally {
  await browser.close()
  server.close()
}

console.log()
if (failures.length) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
