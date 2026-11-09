#!/usr/bin/env node
// Renders the Google Play graphics from the app's own icon shapes:
//   store/icon-512.png        512 x 512, the store icon
//   store/feature-graphic.png 1024 x 500, the banner at the top of the listing
//
//   node tools/store-art.cjs            (run from car-mirror/; needs `npm i playwright`)

'use strict';

const { chromium } = require('playwright');
const path = require('path');

const BLUE = '#1E40AF';

// The launcher icon's foreground (res/drawable/ic_launcher_foreground.xml), same 108-unit grid.
const GLYPH = `
  <path fill="#fff" fill-rule="evenodd" d="M44,36H76A4,4 0 0 1 80,40V60A4,4 0 0 1 76,64H44A4,4 0 0 1 40,60V40A4,4 0 0 1 44,36ZM45,39.5H75A1.5,1.5 0 0 1 76.5,41V59A1.5,1.5 0 0 1 75,60.5H45A1.5,1.5 0 0 1 43.5,59V41A1.5,1.5 0 0 1 45,39.5Z"/>
  <path fill="#fff" d="M60.5,42.5H67.5A1.5,1.5 0 0 1 69,44V56A1.5,1.5 0 0 1 67.5,57.5H60.5A1.5,1.5 0 0 1 59,56V44A1.5,1.5 0 0 1 60.5,42.5Z"/>
  <path fill="${BLUE}" d="M31,44H45A5,5 0 0 1 50,49V69A5,5 0 0 1 45,74H31A5,5 0 0 1 26,69V49A5,5 0 0 1 31,44Z"/>
  <path fill="#fff" fill-rule="evenodd" d="M31.5,46H43.5A3.5,3.5 0 0 1 47,49.5V68.5A3.5,3.5 0 0 1 43.5,72H31.5A3.5,3.5 0 0 1 28,68.5V49.5A3.5,3.5 0 0 1 31.5,46ZM31.5,49.5H43.5V66.5H31.5Z"/>`;

// The visible part of an adaptive icon is the middle 72 of its 108 units.
const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="18 18 72 72">
  <rect x="0" y="0" width="108" height="108" fill="${BLUE}"/>${GLYPH}</svg>`;

const iconPage = `<!doctype html><html><body style="margin:0">${icon(512)}</body></html>`;

const featurePage = `<!doctype html><html><head><style>
  body { margin: 0; width: 1024px; height: 500px; overflow: hidden;
         background: linear-gradient(135deg, #0F1E4D 0%, ${BLUE} 60%, #2B5BE0 100%);
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; }
  .left { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px;
          display: flex; flex-direction: column; justify-content: center; }
  .badge { width: 112px; height: 112px; border-radius: 26px; overflow: hidden;
           box-shadow: 0 10px 30px rgba(0,0,0,.35); margin-bottom: 30px; }
  h1 { margin: 0; font-size: 64px; font-weight: 800; letter-spacing: -1px; }
  p { margin: 14px 0 0; font-size: 28px; line-height: 1.35; color: #DCE5FF; }
  .scene { position: absolute; right: 56px; top: 92px; width: 420px; height: 300px; }
  .car { position: absolute; right: 0; top: 0; width: 360px; height: 230px; border-radius: 18px;
         background: #0B1020; border: 6px solid #1A2238; box-shadow: 0 18px 40px rgba(0,0,0,.45);
         display: flex; align-items: center; justify-content: center; }
  .mirror { width: 108px; height: 210px; border-radius: 10px;
            background: linear-gradient(180deg, #3B6FE0, #1E40AF); position: relative; }
  .phone { position: absolute; left: 0; bottom: 0; width: 112px; height: 210px; border-radius: 20px;
           background: #0B1020; border: 6px solid #E8ECF5; box-shadow: 0 14px 30px rgba(0,0,0,.45); }
  .screen { position: absolute; inset: 8px; border-radius: 10px;
            background: linear-gradient(180deg, #3B6FE0, #1E40AF); }
  .dot { position: absolute; width: 34px; height: 34px; border-radius: 50%; background: #F5B940; }
  .line { position: absolute; height: 8px; border-radius: 4px; background: rgba(255,255,255,.85); }
</style></head><body>
  <div class="left">
    <div class="badge">${icon(112)}</div>
    <h1>Car Mirror</h1>
    <p>Your phone, on your car's screen.<br>No cables. No adapters.</p>
  </div>
  <div class="scene">
    <div class="car"><div class="mirror">
      <div class="line" style="left:14px;top:20px;width:60px"></div>
      <div class="line" style="left:14px;top:36px;width:40px;opacity:.6"></div>
      <div class="dot" style="left:37px;top:110px"></div>
    </div></div>
    <div class="phone"><div class="screen">
      <div class="line" style="left:12px;top:16px;width:52px"></div>
      <div class="line" style="left:12px;top:30px;width:34px;opacity:.6"></div>
      <div class="dot" style="left:30px;top:96px;width:30px;height:30px"></div>
    </div></div>
  </div>
</body></html>`;

async function render(browser, html, width, height, out) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log('wrote', out);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const store = path.join(__dirname, '..', 'store');
  await render(browser, iconPage, 512, 512, path.join(store, 'icon-512.png'));
  await render(browser, featurePage, 1024, 500, path.join(store, 'feature-graphic.png'));
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
