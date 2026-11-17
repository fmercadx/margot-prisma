// Helpers shared by the browser smoke tests (viewer-smoke.cjs, video-smoke.cjs).
//
//   const lib = require('./smoke-lib.cjs')(controlDir);

'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function smokeLib(control) {
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

  // "d=60 n=1 strokes=1 first=0.5,0.5 last=0.5,0.5" -> { d, n, strokes, first: [x, y], last: [x, y] },
  // with first2/last2 for a second finger; "action=back" -> { action: 'back' }.
  function parseGesture(line) {
    const f = Object.fromEntries(line.split(' ').map((kv) => kv.split('=')));
    if (f.action) return { action: f.action };
    const pt = (s) => (s ? s.split(',').map(Number) : null);
    return {
      d: Number(f.d), n: Number(f.n), strokes: Number(f.strokes),
      first: pt(f.first), last: pt(f.last), first2: pt(f.first2), last2: pt(f.last2),
    };
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

  // Frames the demo phone has made so far. It replaces the file in one step, but an empty or
  // unreadable read is retried rather than taken as 0: a 0 at the start of a window once made
  // the phone look like it was making 244 fps.
  async function framesMade() {
    for (let attempt = 0; ; attempt++) {
      try {
        const text = fs.readFileSync(path.join(control, 'frames'), 'utf8').trim();
        if (/^\d+$/.test(text)) return Number(text);
      } catch (e) {
        if (attempt >= 20) throw e;
      }
      if (attempt >= 20) throw new Error('the demo phone\'s frame count is unreadable');
      await sleep(10);
    }
  }

  // Frames drawn against frames the phone made, over the same window. Measuring them one after
  // the other compared different windows: on the slow link the phone's count came out at 32 fps
  // (an 80 ms request at each end of a 2 s window) and the page's 25.3 looked like falling
  // behind, though it was drawing about 84% of a real 30.
  async function rates(page, seconds = 4) {
    return withDetails(page, async () => {
      await sleep(1500);
      const made0 = await framesMade();
      const t0 = Date.now();
      const samples = []; // the details line shows the frames drawn in the last second
      for (let i = 0; i < seconds; i++) {
        await sleep(1000);
        samples.push(Number(((await page.locator('#info').innerText()).match(/(\d+) fps/) || [])[1] || 0));
      }
      const made = ((await framesMade()) - made0) / ((Date.now() - t0) / 1000);
      return { made, drawn: samples.reduce((a, b) => a + b, 0) / samples.length };
    });
  }

  return {
    failures, check, sleep, pixel, isBlack, until, messageHidden, messageIncludes, gestures, nextGesture,
    parseGesture, setPhonePause, near, litAt, darkAt, withDetails, detailsText, framesMade, rates,
  };
};
