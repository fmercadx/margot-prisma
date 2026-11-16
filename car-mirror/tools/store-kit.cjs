#!/usr/bin/env node
// Builds the store kit: everything a Google Play or Galaxy Store listing asks for, in one folder.
//
//   node tools/store-kit.cjs --shots <dir with store-*.png> --out <dir>
//
// (run from car-mirror/; needs `npm i playwright`). CI runs it on every build and attaches the
// zipped folder to the release. The listing screenshots are made from the real app screens that
// StoreScreenshotTest renders, with a caption above each; nothing on them is mocked up except
// the plain frame around the phone and the car's screen.

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const shots = opt('--shots');
const out = opt('--out');
if (!shots || !out) {
  console.error('usage: node tools/store-kit.cjs --shots <dir with store-*.png> --out <dir>');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const store = path.join(root, 'store');

const BLUE = '#1E40AF';
const BACKGROUND = `linear-gradient(160deg, #0F1E4D 0%, ${BLUE} 55%, #2B5BE0 100%)`;
const FONT = 'Inter, "Inter Display", Roboto, system-ui, sans-serif';

// Order tells the story: what it does, how to start, what you type, what you see, the settings.
const PHONE_SHOTS = [
  { file: 'store-3-ready.png', name: 'listing-2-start.png',
    title: 'Hotspot on. Tap Start.', text: 'A short checklist gets you going the first time.' },
  { file: 'store-2-waiting.png', name: 'listing-3-address.png',
    title: 'Type one address in your car', text: "If one won't open, try the next. Car Mirror remembers which works." },
  { file: 'store-1-connected.png', name: 'listing-4-connected.png',
    title: 'Pause or stop in one tap', text: "Blank the car's screen before you open anything private." },
  { file: 'store-4-settings.png', name: 'listing-5-settings.png',
    title: 'Pause while driving, on from the start', text: 'Plus touch control, picture quality and phone dimming.' },
];
const CAR_SHOT = { file: 'store-1-connected.png', name: 'listing-1-car.png',
  title: "Your phone, on your car's screen", text: "Over your phone's own hotspot.\nNo cables, no adapters, no account." };

const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');

const page = (width, height, css, body) => `<!doctype html><html><head><style>
  body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; position: relative;
         background: ${BACKGROUND}; font-family: ${FONT}; color: #fff; }
  h1 { margin: 0; font-weight: 800; letter-spacing: -0.02em; line-height: 1.08; }
  p { margin: 0; color: #DCE5FF; line-height: 1.35; }
  .phone { position: absolute; background: #0B1020; border: 3px solid #2A3550;
           box-shadow: 0 40px 80px rgba(0, 0, 0, .45); }
  .phone img { display: block; width: 100%; }
  ${css}
</style></head><body>${body}</body></html>`;

// 1080 x 1920: caption on top, the real screen in a plain phone frame below.
const phonePage = (shot, src) => page(1080, 1920, `
  .cap { position: absolute; left: 90px; right: 90px; top: 110px; }
  h1 { font-size: 76px; }
  p { font-size: 38px; margin-top: 28px; }
  .phone { left: 160px; top: 560px; width: 720px; padding: 20px; border-radius: 72px; }
  .phone img { border-radius: 54px; }
`, `<div class="cap"><h1>${esc(shot.title)}</h1><p>${esc(shot.text)}</p></div>
    <div class="phone"><img src="${src}"></div>`);

// 1920 x 1080: the car's screen showing the phone the way the car's page does (a portrait
// phone on a landscape screen, with black at the sides), and the phone itself in front.
const carPage = (shot, src) => page(1920, 1080, `
  .cap { position: absolute; left: 110px; width: 600px; top: 0; bottom: 0;
         display: flex; flex-direction: column; justify-content: center; }
  h1 { font-size: 84px; }
  p { font-size: 34px; margin-top: 30px; }
  .car { position: absolute; left: 820px; top: 150px; width: 1000px; height: 625px; box-sizing: border-box;
         border: 22px solid #0B1020; border-radius: 30px; background: #000; overflow: hidden;
         box-shadow: 0 40px 90px rgba(0, 0, 0, .5); display: flex; justify-content: center; }
  .car img { height: 100%; }
  .phone { left: 760px; top: 560px; width: 232px; padding: 9px; border-radius: 34px; }
  .phone img { border-radius: 26px; }
`, `<div class="cap"><h1>${esc(shot.title)}</h1><p>${esc(shot.text)}</p></div>
    <div class="car"><img src="${src}"></div>
    <div class="phone"><img src="${src}"></div>`);

async function render(browser, html, width, height, file) {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await tab.setContent(html);
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
  await tab.close();
  console.log('wrote', path.relative(process.cwd(), file));
}

// The blocks of store/listing.md, by heading, so each can be pasted on its own.
function listingText() {
  const md = fs.readFileSync(path.join(store, 'listing.md'), 'utf8');
  const sections = {};
  let current = null;
  for (const line of md.split('\n')) {
    const heading = line.match(/^## (.+)$/);
    if (heading) { current = heading[1]; sections[current] = []; } else if (current) sections[current].push(line);
  }
  const block = (prefix) => {
    const key = Object.keys(sections).find((k) => k.startsWith(prefix));
    if (!key) throw new Error(`listing.md has no "## ${prefix}" section`);
    return sections[key].join('\n').trim() + '\n';
  };
  return {
    'app-name.txt': block('App name'),
    'short-description.txt': block('Short description'),
    'full-description.txt': block('Full description'),
  };
}

function check(text, file, max) {
  const length = [...text.trim()].length;
  if (length > max) throw new Error(`${file} is ${length} characters; the stores allow ${max}`);
}

(async () => {
  for (const shot of [...PHONE_SHOTS, CAR_SHOT]) {
    if (!fs.existsSync(path.join(shots, shot.file))) throw new Error(`missing ${shot.file} in ${shots}`);
  }
  const dirs = ['screenshots', 'screenshots/plain', 'graphics', 'text'].map((d) => path.join(out, d));
  dirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await render(browser, carPage(CAR_SHOT, dataUri(path.join(shots, CAR_SHOT.file))), 1920, 1080,
    path.join(out, 'screenshots', CAR_SHOT.name));
  for (const shot of PHONE_SHOTS) {
    await render(browser, phonePage(shot, dataUri(path.join(shots, shot.file))), 1080, 1920,
      path.join(out, 'screenshots', shot.name));
  }
  await browser.close();

  for (const shot of PHONE_SHOTS) fs.copyFileSync(path.join(shots, shot.file), path.join(out, 'screenshots/plain', shot.file));
  for (const art of ['icon-512.png', 'feature-graphic.png']) fs.copyFileSync(path.join(store, art), path.join(out, 'graphics', art));

  const text = listingText();
  check(text['app-name.txt'], 'app-name.txt', 30);
  check(text['short-description.txt'], 'short-description.txt', 80);
  check(text['full-description.txt'], 'full-description.txt', 4000);
  for (const [file, body] of Object.entries(text)) fs.writeFileSync(path.join(out, 'text', file), body);
  fs.writeFileSync(path.join(out, 'text', 'privacy-policy-url.txt'),
    'https://github.com/fmercadx/margot-prisma/blob/main/car-mirror/PRIVACY.md\n');

  for (const doc of ['CHECKLIST.md', 'play-console-answers.md']) fs.copyFileSync(path.join(store, doc), path.join(out, doc));
  fs.writeFileSync(path.join(out, 'README.txt'), [
    'Car Mirror store kit',
    '',
    'Start with CHECKLIST.md: it goes through Google Play and the Galaxy Store step by step.',
    '',
    'screenshots/          upload these, in order (1 is landscape, 2-5 are portrait 1080x1920)',
    'screenshots/plain/    the same screens without captions, if a store wants those instead',
    'graphics/             icon-512.png (app icon) and feature-graphic.png (1024x500 banner)',
    'text/                 the listing text, one file per box in the store form',
    'play-console-answers.md  what to answer in Play Console\'s App content forms',
    '',
  ].join('\n'));
})().catch((err) => { console.error(err); process.exit(1); });
