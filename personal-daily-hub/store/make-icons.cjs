// Renders the app icon set from one SVG design, at exact sizes, with Chromium.
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2];

const COLORS = ['#A78BFA', '#4ADE80', '#38BDF8', '#FBBF24', '#FB7185', '#2DD4BF']; // notes, habits, water, energy, expenses, mood
const R = 300, SW = 84; // ring radius and stroke, in a 1024 box

function arcs(mono) {
  const capDeg = ((SW / 2) / R) * (180 / Math.PI);
  const gap = 7;
  const span = 60 - gap - 2 * capDeg;
  return COLORS.map((c, i) => {
    const a0 = (-90 + i * 60 + gap / 2 + capDeg) * Math.PI / 180;
    const a1 = a0 + span * Math.PI / 180;
    const p = (a) => `${(512 + R * Math.cos(a)).toFixed(2)} ${(512 + R * Math.sin(a)).toFixed(2)}`;
    return `<path d="M ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)}" stroke="${mono ? '#FFFFFF' : c}" stroke-width="${SW}" stroke-linecap="round" fill="none"/>`;
  }).join('');
}
const check = (color) =>
  `<path d="M 398 522 L 478 602 L 636 436" stroke="${color}" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const background = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#202027"/>
      <stop offset="1" stop-color="#0E0E11"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="420" fill="url(#glow)"/>`;

// scale: shrink the glyph about the centre (adaptive icons keep it in the safe zone)
const glyph = ({ mono = false, scale = 1, checkColor = '#F5F5F5' } = {}) =>
  `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${arcs(mono)}${check(mono ? '#FFFFFF' : checkColor)}</g>`;

const svg = (inner, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">${bg ? background : ''}${inner}</svg>`;

const jobs = [
  { file: 'icon.png', size: 1024, body: svg(glyph(), true) },                                  // iOS + Expo icon: opaque square
  { file: 'store-icon-512.png', size: 512, body: svg(glyph(), true) },                         // Google Play listing icon
  { file: 'android-icon-background.png', size: 512, body: svg('', true) },
  { file: 'android-icon-foreground.png', size: 512, body: svg(glyph({ scale: 0.84 }), false), transparent: true },
  { file: 'android-icon-monochrome.png', size: 432, body: svg(glyph({ mono: true, scale: 0.84 }), false), transparent: true },
  { file: 'splash-icon.png', size: 1024, body: svg(glyph({ scale: 0.92 }), false), transparent: true },
  { file: 'notification-icon.png', size: 96, body: svg(glyph({ mono: true, scale: 1.18 }), false), transparent: true },
  { file: 'favicon.png', size: 48, body: svg(glyph({ scale: 1.1 }), true) },
];

(async () => {
  const browser = await chromium.launch();
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${j.body}</body></html>`);
    await page.screenshot({ path: path.join(out, j.file), omitBackground: !!j.transparent, clip: { x: 0, y: 0, width: j.size, height: j.size } });
    await page.close();
  }
  await browser.close();
  console.log('rendered', jobs.map((j) => j.file).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
