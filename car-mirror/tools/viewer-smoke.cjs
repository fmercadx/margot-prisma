#!/usr/bin/env node
// Drives the viewer page in Chromium against the demo server (a stand-in for the phone)
// and checks what the car's browser would see.
//
//   ./gradlew -PcoreOnly :core:demoServer --args="8090" &   # wait for READY
//   node tools/viewer-smoke.cjs http://127.0.0.1:8090/ [screenshot-dir]
//
// Uses Playwright's Chromium. Set CHROMIUM_PATH to use a different browser binary.

'use strict';

const { chromium } = require('playwright');
const path = require('path');

const base = process.argv[2] || 'http://127.0.0.1:8090/';
const shots = process.argv[3] || null;
const origin = new URL(base).origin;
const failures = [];

function check(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Canvas pixel at (x, y) in CSS pixels, as [r, g, b].
function pixel(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById('screen');
    const ratio = c.width / c.clientWidth;
    return Array.from(c.getContext('2d').getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data.slice(0, 3));
  }, [x, y]);
}

const isBlack = ([r, g, b]) => r + g + b < 30;

async function main() {
  const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launch);

  // Model 3 / Model Y centre screen: 1920 x 1200.
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  const offOrigin = [];
  const errors = [];
  page.on('request', (req) => { if (!req.url().startsWith(origin)) offOrigin.push(req.url()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(base);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('msg')).display === 'none', null, { timeout: 10000 });
  check(true, 'first frame drawn and the status message hidden');

  const snapshot = () => page.evaluate(() => document.getElementById('screen').toDataURL('image/png'));
  const centre = await pixel(page, 960, 600);
  check(!isBlack(centre), `centre of the screen shows the phone (rgb ${centre})`);
  const before = await snapshot();
  await sleep(1000);
  check(before !== (await snapshot()), 'picture keeps updating');

  // A portrait phone on a landscape car screen is letterboxed, not stretched.
  check(isBlack(await pixel(page, 20, 600)) && isBlack(await pixel(page, 1900, 600)), 'portrait phone is pillarboxed with black bars');

  // Frame rate, read from the stats overlay a tap brings up.
  await page.mouse.click(960, 600);
  await sleep(2500);
  const infoText = await page.locator('#info').innerText();
  const fps = Number((infoText.match(/(\d+) fps/) || [])[1] || 0);
  check(fps >= 15, `frame rate ${fps} fps (demo sends 24)  [${infoText}]`);
  if (shots) await page.screenshot({ path: path.join(shots, 'viewer-1920x1200.png') });
  await page.mouse.click(960, 600); // hide the overlay again

  // Phone unreachable for a while: the page says so, then recovers by itself.
  await page.route('**/frame*', (route) => route.abort('connectionrefused'));
  await page.waitForFunction(() => /Lost the connection/.test(document.getElementById('msg').textContent), null, { timeout: 10000 });
  check(true, 'shows "Lost the connection" when the phone stops answering');
  if (shots) await page.screenshot({ path: path.join(shots, 'viewer-lost-connection.png') });
  await page.unroute('**/frame*');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('msg')).display === 'none', null, { timeout: 10000 });
  check(true, 'recovers on its own when the phone is back');

  // Fallback for browsers without fetch/createImageBitmap.
  const mjpeg = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  mjpeg.on('request', (req) => { if (!req.url().startsWith(origin)) offOrigin.push(req.url()); });
  await mjpeg.goto(base + '?mode=mjpeg');
  await mjpeg.waitForFunction(() => document.getElementById('mjpeg').naturalWidth > 0, null, { timeout: 10000 });
  check(true, 'MJPEG fallback shows the stream');
  await mjpeg.close();

  check(offOrigin.length === 0, `no requests leave the phone (${offOrigin.length} off-origin: ${offOrigin.slice(0, 3).join(', ')})`);
  const unexpected = errors.filter((e) => !/net::ERR_|Failed to load resource|Failed to fetch/.test(e));
  check(unexpected.length === 0, `no script errors ${unexpected.length ? JSON.stringify(unexpected) : ''}`);

  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nviewer smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
