#!/usr/bin/env node
// Video mode in a real browser: the demo phone streams H.264 (jcodec) packed as fragmented
// MP4 over the encrypted session, and the page plays it through Media Source Extensions.
//
//   ./gradlew -PcoreOnly :core:demoServer --args="8091 --control /tmp/cmv --video" &   # wait for READY
//   node tools/video-smoke.cjs http://127.0.0.1:8091/ --control /tmp/cmv
//
// Needs a browser that plays H.264 through MSE. If Playwright's Chromium can't, it tries
// Google Chrome (npx playwright install chrome). Set CHROMIUM_PATH to use another binary.

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const base = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--control') || 'http://127.0.0.1:8091/';
const control = flag('--control');
if (!control) {
  console.error('usage: node tools/video-smoke.cjs <base> --control <dir>');
  process.exit(2);
}
const origin = new URL(base).origin;
const {
  failures, check, sleep, pixel, isBlack, until, messageHidden, messageIncludes, gestures, nextGesture,
  setPhonePause, near, litAt, detailsText, rates: measureRates,
} = require('./smoke-lib.cjs')(control);

const H264 = 'video/mp4; codecs="avc1.42e01f"';

async function launch() {
  const own = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  for (const options of [own, { channel: 'chrome' }]) {
    let browser;
    try {
      browser = await chromium.launch(options);
    } catch (e) {
      continue; // e.g. Chrome isn't installed
    }
    const probe = await browser.newPage();
    const ok = await probe.evaluate((type) => !!window.MediaSource && MediaSource.isTypeSupported(type), H264);
    await probe.close();
    if (ok) return { browser, name: options.channel || 'chromium' };
    console.log(`(${options.channel || 'this Chromium'} can't play H.264 through MSE)`);
    await browser.close();
  }
  throw new Error('no browser here plays H.264 through MSE; install Google Chrome (npx playwright install chrome)');
}

async function main() {
  const { browser, name } = await launch();
  console.log(`using ${name}`);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  const offOrigin = [];
  const errors = [];
  page.on('request', (req) => { if (!req.url().startsWith(origin)) offOrigin.push(req.url()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  fs.writeFileSync(path.join(control, 'pairing'), ''); // the demo phone allows pairing
  await page.goto(base);
  await until(page, messageHidden, 'the first video frame', 20000);
  check(true, 'paired, and the first video frame is drawn');
  check(/video/.test(await detailsText(page)), 'the details say video mode');

  // The 368x800 picture scaled to fit 1920x1200: 552 px wide, centred, full height.
  const px = (fx) => 684 + fx * 552;
  const py = (fy) => fy * 1200;
  const centre = await pixel(page, 960, 600);
  check(!isBlack(centre), `the car shows the phone through the video element (rgb ${centre})`);
  const before = await page.evaluate(() => document.getElementById('screen').toDataURL());
  await sleep(1000);
  check(before !== await page.evaluate(() => document.getElementById('screen').toDataURL()), 'the picture keeps moving');

  // Keeping up: frames drawn against frames the phone made, over the same four seconds.
  const rates = await measureRates(page);
  check(rates.made > 5 && rates.drawn >= rates.made * 0.7,
    `video keeps up: draws ${rates.drawn.toFixed(1)} fps of the ${rates.made.toFixed(1)} the phone makes`);
  const lag = await page.evaluate(() => {
    const v = document.getElementById('video');
    return v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 99;
  });
  check(lag < 0.5, `the picture stays near the newest frame (${(lag * 1000).toFixed(0)} ms behind)`);

  await until(page, () => document.getElementById('nav').style.display === 'flex', 'touch to be on');
  let count = gestures().length;
  await page.mouse.click(px(0.5), py(0.25));
  const g = await nextGesture(count, 'a tap in video mode');
  check(near(g.first[0], 0.5) && near(g.first[1], 0.25), `a tap lands on the same spot of the phone in video mode (${g.first})`);

  setPhonePause('privacy');
  await until(page, messageIncludes, 'the pause', 10000, 'Paused on the phone');
  check(isBlack(await pixel(page, 960, 600)), 'paused: the video picture is gone from the car');
  setPhonePause('');
  await until(page, messageHidden, 'the video after resuming', 15000);
  await sleep(500);
  check(!isBlack(await pixel(page, 960, 600)), 'resuming brings the video back from a fresh keyframe');

  // Black bars, as around a video played on the phone: trimmed in video mode too.
  fs.writeFileSync(path.join(control, 'scene'), 'bars');
  await until(page, litAt, 'the bars to be trimmed', 15000, [640, 600]);
  check(true, 'black bars in the video are trimmed and the picture grows');
  fs.writeFileSync(path.join(control, 'scene'), '');

  await page.reload();
  await until(page, messageHidden, 'the video after a reload', 20000);
  check(true, 'reconnects in video mode after a reload');

  check(offOrigin.length === 0, `no requests leave the phone (${offOrigin.length} off-origin)`);
  check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nvideo smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
