#!/usr/bin/env node
/* Fold the built site into ONE self-contained HTML file, then prove it works.
 *
 *     npm run build && npm run standalone     -> dist/standalone.html
 *     npm run standalone -- --skip-checks     -> build only, no browser
 *
 * Why this exists: the Railway deploy serves dist/ over HTTP, but a single file
 * can be opened from disk, emailed, or published somewhere with a strict
 * content-security policy that blocks every off-origin request. That is how
 * this site gets previewed before a domain exists.
 *
 * The whole trick is that nothing may be fetched at runtime. CSS and JS are
 * inlined, and every asset URL Vite emitted becomes a data: URI — assets under
 * Vite's 4kB inline limit are already data: URIs in the bundle, so only the
 * larger ones need rewriting here. Google Fonts stays a <link>: it is the one
 * external host the target CSPs allow, and index.css declares a full fallback
 * stack for when it does not load.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, 'dist')
const OUT = path.join(DIST, 'standalone.html')

const FONTS =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK' +
  '@9..144,400..700,0..100,0..1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap'

/** encodeURIComponent leaves the characters an SVG data: URI may keep literal. */
const svgDataUri = (source) =>
  `data:image/svg+xml,${encodeURIComponent(source).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`

async function onlyFile(pattern) {
  const names = (await fs.readdir(path.join(DIST, 'assets'))).filter((n) => n.endsWith(pattern))
  if (names.length !== 1) throw new Error(`expected exactly one ${pattern} in dist/assets, found ${names.length}`)
  return path.join(DIST, 'assets', names[0])
}

async function bundle() {
  const css = await fs.readFile(await onlyFile('.css'), 'utf8')
  let js = await fs.readFile(await onlyFile('.js'), 'utf8')

  const svgs = (await fs.readdir(path.join(DIST, 'assets'))).filter((n) => n.endsWith('.svg'))
  let inlined = 0
  for (const name of svgs) {
    const url = `/assets/${name}`
    if (!js.includes(url)) continue
    js = js.replaceAll(url, svgDataUri(await fs.readFile(path.join(DIST, 'assets', name), 'utf8')))
    inlined++
  }

  if (js.includes('/assets/')) throw new Error('an asset URL survived inlining — it would 404 at runtime')

  /* A literal </script> inside the module source would close the tag early. */
  js = js.replaceAll('</script', '<\\/script')

  const html = `<title>The Shepherd's Whisper</title>
<meta name="description" content="A small licensed adult foster home in Oregon providing 24-hour personal care, home-cooked meals, medication management and memory care." />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${FONTS}" rel="stylesheet" />

<style>
${css}
</style>

<div id="root"></div>

<script type="module">
${js}
</script>
`

  await fs.writeFile(OUT, html)
  console.log(`inlined ${inlined} svg asset(s)`)
  console.log(`wrote ${path.relative(HERE, OUT)} (${Math.round(html.length / 1024)} KB)`)
  return html
}

/* The file has no <html>/<head>/<body> of its own, because the places it gets
   published wrap it. Reproduce that wrapper so the checks test what ships. */
const wrap = (body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">${body}</head><body></body></html>`

async function check(html) {
  const { launchChromium } = await import('./browser.mjs')

  const failures = []
  const ok = (name, pass, detail = '') => {
    console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
    if (!pass) failures.push(name)
  }

  const browser = await launchChromium()

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

    const external = []
    const errors = []
    page.on('request', (r) => {
      const url = r.url()
      if (!url.startsWith('data:') && !url.startsWith('about:')) external.push(url)
    })
    page.on('pageerror', (e) => errors.push(e.message))

    await page.setContent(wrap(html), { waitUntil: 'load' })
    await page.waitForTimeout(2500)

    ok('no uncaught page errors', errors.length === 0, errors.join(' | '))
    ok('heading renders', (await page.locator('h1').count()) > 0)

    /* Gallery images are loading="lazy" and are not fetched until they near the
       viewport, so a page that has not been scrolled reports them as broken. */
    await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto'
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(1200)

    const images = await page.locator('img').count()
    ok('every illustration is present', images === 9, `${images} of 9`)

    const broken = await page.evaluate(() =>
      [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.alt),
    )
    ok('no broken images', broken.length === 0, broken.join(' | '))

    /* The whole point of the file: it must run with the network taken away. */
    const offOrigin = external.filter((u) => !u.includes('fonts.g'))
    ok('nothing off-origin but fonts', offOrigin.length === 0, offOrigin.slice(0, 3).join(' | '))

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    ok('body paints its own background', bg === 'rgb(251, 247, 242)', bg)

    await page.locator('#tour').scrollIntoViewIfNeeded()
    await page.getByLabel('Your name').fill('Test Family')
    await page.getByLabel('Phone', { exact: false }).first().fill('5035550142')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForTimeout(400)
    ok('wizard reaches step two', await page.getByRole('button', { name: 'Memory care' }).isVisible())
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForTimeout(400)
    ok('wizard reaches step three', await page.getByLabel('Preferred date').isVisible())

    await page.locator('#faq-trigger-3').scrollIntoViewIfNeeded()
    await page.locator('#faq-trigger-3').click()
    ok('FAQ accordion opens', await page.locator('#faq-panel-3').isVisible())

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await phone.setContent(wrap(html), { waitUntil: 'load' })
    await phone.waitForTimeout(2000)
    const [scrollWidth, clientWidth] = await phone.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ])
    ok('no horizontal scroll at 390px', scrollWidth <= clientWidth + 1, `${scrollWidth} vs ${clientWidth}`)
  } finally {
    await browser.close()
  }

  console.log()
  if (failures.length) {
    console.error(`${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('all checks passed')
}

const html = await bundle()
if (!process.argv.includes('--skip-checks')) await check(html)
