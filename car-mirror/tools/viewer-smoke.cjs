#!/usr/bin/env node
// Drives the viewer page in Chromium against the demo server (a stand-in for the phone)
// and checks what the car's browser would see and send.
//
//   ./gradlew -PcoreOnly :core:demoServer --args="8090 --control /tmp/cm" &   # wait for READY
//   node tools/viewer-smoke.cjs http://127.0.0.1:8090/ --control /tmp/cm [--shots dir]
//
// --control must name the same folder the demo server was given: the test pauses the
// "phone" by writing to <dir>/pause and reads the taps it received from <dir>/gestures.log.
// Without it, touch and pause checks are skipped.
//
// Uses Playwright's Chromium. Set CHROMIUM_PATH to use a different browser binary.

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const base = args.find((a, i) => !a.startsWith('--') && !['--shots', '--control'].includes(args[i - 1])) || 'http://127.0.0.1:8090/';
const shots = flag('--shots');
const control = flag('--control');
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

// Polls `fn` in the page until it returns something truthy. page.evaluate goes through the
// DevTools protocol, so it works under the page's CSP, which forbids eval. Some Playwright
// versions' waitForFunction poll with eval and fail there.
async function until(page, fn, what, timeout = 10000, arg = undefined) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout} ms waiting for: ${what}`);
    await sleep(100);
  }
}

const messageHidden = () => getComputedStyle(document.getElementById('msg')).display === 'none';
// The text travels as an argument: a closure over a Node variable would not exist in the page.
const messageIncludes = (text) => document.getElementById('msg').textContent.includes(text);

// ---- The demo phone's side of touch and pause ----

function gestures() {
  const file = path.join(control, 'gestures.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

async function nextGesture(countBefore, what, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const lines = gestures();
    if (lines.length > countBefore) return parseGesture(lines[lines.length - 1]);
    if (Date.now() > deadline) throw new Error(`the phone never received: ${what}`);
    await sleep(50);
  }
}

// "d=60 n=1 first=0.5,0.5 last=0.5,0.5" -> { d, n, first: [x, y], last: [x, y] }
function parseGesture(line) {
  const f = Object.fromEntries(line.split(' ').map((kv) => kv.split('=')));
  const pt = (s) => s.split(',').map(Number);
  return { d: Number(f.d), n: Number(f.n), first: pt(f.first), last: pt(f.last) };
}

function setPhonePause(reason) {
  fs.writeFileSync(path.join(control, 'pause'), reason);
}

const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

// Whether the canvas pixel at [x, y] (CSS px) is lit. Runs in the page.
const litAt = ([x, y]) => {
  const c = document.getElementById('screen');
  const r = c.width / c.clientWidth;
  const d = c.getContext('2d').getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data;
  return d[0] + d[1] + d[2] > 30;
};
// The opposite, spelled out: functions passed to the page can't call each other.
const darkAt = ([x, y]) => {
  const c = document.getElementById('screen');
  const r = c.width / c.clientWidth;
  const d = c.getContext('2d').getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data;
  return d[0] + d[1] + d[2] <= 30;
};

// Runs fn with the details line showing, then leaves it as it was. (It toggles, and other
// taps, such as one on the screen while paused, may already have opened it.)
async function withDetails(page, fn) {
  const wasShowing = await page.locator('#info').isVisible();
  if (!wasShowing) await page.click('#menu');
  try {
    return await fn();
  } finally {
    if (!wasShowing) await page.click('#menu');
  }
}

// The details line the corner button shows.
function detailsText(page) {
  return withDetails(page, async () => {
    await sleep(1200);
    return page.locator('#info').innerText();
  });
}

// Frames the page draws per second, averaged over three readings of the details line.
function drawRate(page) {
  return withDetails(page, async () => {
    await sleep(1500);
    const samples = [];
    for (let i = 0; i < 3; i++) {
      await sleep(1000);
      samples.push(Number(((await page.locator('#info').innerText()).match(/(\d+) fps/) || [])[1] || 0));
    }
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  });
}

// Frames the phone makes per second.
async function phoneRate(page) {
  const seqNow = () => page.evaluate(() => fetch('status', { cache: 'no-store' }).then((r) => r.json()).then((s) => s.seq));
  const a = await seqNow();
  await sleep(2000);
  return ((await seqNow()) - a) / 2;
}

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
  await until(page, messageHidden, 'the first frame');
  check(true, 'first frame drawn and the status message hidden');

  const snapshot = () => page.evaluate(() => document.getElementById('screen').toDataURL('image/png'));
  const centre = await pixel(page, 960, 600);
  check(!isBlack(centre), `centre of the screen shows the phone (rgb ${centre})`);
  const before = await snapshot();
  await sleep(1000);
  check(before !== (await snapshot()), 'picture keeps updating');

  // A portrait phone on a landscape car screen is letterboxed, not stretched.
  check(isBlack(await pixel(page, 20, 600)) && isBlack(await pixel(page, 1900, 600)), 'portrait phone is pillarboxed with black bars');

  // Keeping up: the page should draw nearly every frame the phone makes, whatever rate the
  // phone (here, a CI machine drawing a test pattern) manages.
  const produced = await phoneRate(page);
  const drawnRate = await drawRate(page);
  check(produced > 0 && drawnRate >= produced * 0.8,
    `keeps up with the phone: draws ${drawnRate.toFixed(1)} fps of the ${produced.toFixed(1)} it makes`);

  // The corner button brings up details.
  await page.click('#menu');
  await sleep(1200);
  const infoText = await page.locator('#info').innerText();
  check(/\d+×\d+ · \d+ fps/.test(infoText), `the corner button shows size and frame rate [${infoText}]`);
  if (shots) await page.screenshot({ path: path.join(shots, 'viewer-1920x1200.png') });
  await page.click('#menu'); // hide them again

  if (control) {
    // The picture is 576x1280 scaled to fit 1920x1200: 540 px wide, centred, full height.
    const px = (fx) => 690 + fx * 540;
    const py = (fy) => fy * 1200;
    await until(page, () => fetch('status').then((r) => r.json()).then((s) => s.touch), 'touch to be on');
    await sleep(300); // let the page's own status refresh land

    let count = gestures().length;
    await page.mouse.click(px(0.5), py(0.25));
    let g = await nextGesture(count, 'a tap');
    check(g.n === 1 && g.d === 60 && near(g.first[0], 0.5) && near(g.first[1], 0.25),
      `a tap on the car screen lands on the same spot on the phone (${g.first})`);

    count = gestures().length;
    await page.mouse.move(px(0.5), py(0.75));
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      await page.mouse.move(px(0.5), py(0.75 - (0.5 * i) / 15));
      await sleep(20);
    }
    await page.mouse.up();
    g = await nextGesture(count, 'a swipe');
    check(g.n > 2 && near(g.first[1], 0.75) && near(g.last[1], 0.25),
      `a swipe up is performed as a swipe up (${g.n} points, y ${g.first[1]} → ${g.last[1]})`);

    count = gestures().length;
    await page.mouse.move(px(0.3), py(0.6));
    await page.mouse.down();
    await sleep(800);
    await page.mouse.up();
    g = await nextGesture(count, 'a long press');
    check(g.n === 1 && g.d >= 700, `holding is performed as a long press (${g.d} ms)`);

    count = gestures().length;
    await page.mouse.click(150, 600); // the black bar beside the picture
    await sleep(500);
    check(gestures().length === count, 'a tap beside the picture is not sent to the phone');
    check(await page.locator('#info').isVisible(), 'a tap beside the picture shows details instead');
    await page.click('#menu');

    // Paused on the phone: the picture is dropped, not just covered, and taps stop.
    setPhonePause('privacy');
    await until(page, messageIncludes, 'the privacy pause', 10000, 'Paused on the phone');
    check(isBlack(await pixel(page, 960, 600)) && isBlack(await pixel(page, 960, 100)), 'paused: the last picture is gone from the car');
    if (shots) await page.screenshot({ path: path.join(shots, 'viewer-paused.png') });
    count = gestures().length;
    await page.mouse.click(px(0.5), py(0.5));
    await sleep(500);
    check(gestures().length === count, 'paused: taps are not sent to the phone');

    setPhonePause('driving');
    await until(page, messageIncludes, 'the driving pause', 10000, 'while the car is moving');
    check(true, 'shows "Paused while the car is moving" for the driving pause');

    setPhonePause('');
    await until(page, messageHidden, 'resume');
    check(!isBlack(await pixel(page, 960, 600)), 'resumes by itself with the picture back');

    // A video with black bars around it: the bars are trimmed so the video fills the screen.
    // Untrimmed, the portrait picture is 540 px wide, so x = 600 is in the black margin.
    fs.writeFileSync(path.join(control, 'scene'), 'bars');
    await until(page, litAt, 'the bars to be trimmed', 10000, [600, 600]);
    check(true, 'black bars around a video are trimmed and the picture grows');
    const trimmedInfo = await detailsText(page);
    check(/bars trimmed/.test(trimmedInfo), `details say the bars are trimmed [${trimmedInfo}]`);
    if (shots) await page.screenshot({ path: path.join(shots, 'viewer-bars-trimmed.png') });
    // Taps still land in the right place: the top edge of the trimmed picture is just below
    // the top bar, which covers the phone's top fifth.
    count = gestures().length;
    await page.mouse.click(960, 60);
    g = await nextGesture(count, 'a tap on the trimmed picture');
    check(near(g.first[0], 0.5) && near(g.first[1], 0.228, 0.015),
      `taps on the trimmed picture land on the right spot (${g.first}, expected about 0.5,0.228)`);
    fs.writeFileSync(path.join(control, 'scene'), '');
    await until(page, darkAt, 'the whole picture to come back', 5000, [600, 600]);
    check(true, 'the whole picture comes back as soon as the bars go away');

    // Touch control off on the phone: tapping the picture says so instead of doing nothing.
    fs.writeFileSync(path.join(control, 'touch'), 'off');
    await sleep(5500); // the page re-reads what the phone allows every 5 s
    await page.mouse.click(px(0.5), py(0.5));
    await until(page, () => getComputedStyle(document.getElementById('toast')).display !== 'none', 'the touch hint');
    const hint = await page.locator('#toast').innerText();
    check(/Touch control is off/.test(hint), `tapping with touch control off explains it [${hint}]`);
    fs.writeFileSync(path.join(control, 'touch'), 'on');
  }

  // Phone unreachable for a while: the page says so, then recovers by itself. The frame
  // stream is one long-lived connection, so block new ones and reload to drop it.
  await page.route('**/frame*', (route) => route.abort('connectionrefused'));
  await page.reload();
  await until(page, messageIncludes, '"Lost the connection"', 10000, 'Lost the connection');
  check(true, 'shows "Lost the connection" when the phone stops answering');
  if (shots) await page.screenshot({ path: path.join(shots, 'viewer-lost-connection.png') });
  await page.unroute('**/frame*');
  await until(page, messageHidden, 'recovery');
  check(true, 'recovers on its own when the phone is back');

  // A slow link: 80 ms added to every request, typical of a busy phone hotspot. Asking for
  // each frame separately managed only about 11 fps here; the stream should not care.
  const slow = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  const cdp = await slow.context().newCDPSession(slow);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 3000000, uploadThroughput: 1000000 });
  await slow.goto(base);
  await until(slow, messageHidden, 'the first frame on a slow link');
  const slowMade = await phoneRate(slow);
  const slowDrawn = await drawRate(slow);
  check(slowDrawn >= slowMade * 0.8,
    `keeps up on a slow link too: draws ${slowDrawn.toFixed(1)} fps of the ${slowMade.toFixed(1)} it makes`);
  await slow.close();

  // Fallback for browsers that can't read a stream: one request per frame.
  const poll = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  poll.on('request', (req) => { if (!req.url().startsWith(origin)) offOrigin.push(req.url()); });
  await poll.goto(base + '?mode=poll');
  await until(poll, messageHidden, 'the first frame in poll mode');
  check(/poll/.test(await detailsText(poll)), 'the one-request-per-frame fallback shows the picture');
  await poll.close();

  // Fallback for browsers without fetch/createImageBitmap.
  const mjpeg = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  mjpeg.on('request', (req) => { if (!req.url().startsWith(origin)) offOrigin.push(req.url()); });
  await mjpeg.goto(base + '?mode=mjpeg');
  await until(mjpeg, () => document.getElementById('mjpeg').naturalWidth > 0, 'the MJPEG stream');
  check(true, 'MJPEG fallback shows the stream');
  await mjpeg.close();

  check(offOrigin.length === 0, `no requests leave the phone (${offOrigin.length} off-origin: ${offOrigin.slice(0, 3).join(', ')})`);
  const unexpected = errors.filter((e) => !/net::ERR_|Failed to load resource|Failed to fetch/.test(e));
  check(unexpected.length === 0, `no script errors ${unexpected.length ? JSON.stringify(unexpected) : ''}`);

  await browser.close();
  if (!control) console.log('\n(touch and pause checks skipped: no --control folder)');
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
