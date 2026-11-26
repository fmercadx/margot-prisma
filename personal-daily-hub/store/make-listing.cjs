// Store listing images for Google Play, from the web build with demo data.
//
//   cd personal-daily-hub && EXPO_OFFLINE=1 npx expo export --platform web --output-dir dist
//   (cd dist && python3 -m http.server 8125 --bind 127.0.0.1) &
//   node store/make-listing.cjs http://127.0.0.1:8125/ store/
//
// Writes phone screenshots (1080x1920, captioned), 7- and 10-inch tablet
// screenshots, and the 1024x500 feature graphic. Everything shown is demo
// data typed in here; nothing comes from anyone's phone.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'http://127.0.0.1:8125/';
const out = path.resolve(process.argv[3] || '.');
const raw = path.join(out, 'raw');
fs.mkdirSync(raw, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();

/** Four weeks of believable days, and today in progress. */
function demoData() {
  const today = new Date();
  const day = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  const sunday = day(today.getDay());
  const lastSunday = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() - 7);
  const empty = {
    focus: '', journal: '', gratitude: [], notes: [], habitsDone: [], habitsSkipped: [],
    water: 0, energy: null, mood: null, sleep: null, expenses: [], focusMinutes: 0,
  };
  const s = {};
  const moods = [4, 3, 5, 4, 4, 2, 5, 4, 3, 4, 5, 4, 3, 4];
  const sleeps = [7, 7.5, 6.5, 8, 7, 6, 8, 7.5, 7, 6.5, 8, 7, 7.5, 8];
  const spends = [
    ['Groceries', 4218, 'food'], ['Coffee', 450, 'food'], ['Bus pass', 275, 'transport'],
    ['Lunch out', 1390, 'food'], ['Cinema', 1600, 'fun'], ['Pharmacy', 860, 'shopping'],
  ];
  for (let i = 1; i <= 27; i++) {
    const d = day(i);
    const done = [];
    if (i % 4 !== 2) done.push('core-mindful');
    if (i % 3 !== 0) done.push('core-read');
    if (i % 2 === 0) done.push('core-move');
    if (i % 5 !== 1) done.push('core-plan');
    if (i % 3 !== 1) done.push('habit-stretch');
    const e = spends[i % spends.length];
    s[`pdh:v1:day:${key(d)}`] = {
      ...empty,
      habitsDone: done,
      water: 5 + (i % 4),
      energy: 5 + (i % 4),
      mood: moods[i % moods.length],
      sleep: sleeps[i % sleeps.length],
      focusMinutes: i % 2 ? 25 : 50,
      expenses: [{ id: `e${i}`, cents: e[1], label: e[0], category: e[2], createdAt: at(d, 12, 15) }],
    };
  }
  const t = today;
  s[`pdh:v1:day:${key(t)}`] = {
    ...empty,
    focus: 'Finish the quarterly report',
    focusMinutes: 50,
    notes: [
      { id: 'n3', text: 'Ideas for Mum’s birthday: pottery class, the blue scarf', createdAt: at(t, 8, 40) },
      { id: 'n2', text: 'Call the dentist about Friday', createdAt: at(t, 8, 12), task: true },
      { id: 'n1', text: 'Pick up dry cleaning', createdAt: at(t, 7, 55), task: true, doneAt: at(t, 8, 30) },
    ],
    habitsDone: ['core-read', 'core-plan'],
    water: 5,
    energy: 7,
    mood: 4,
    sleep: 7.5,
    expenses: [
      { id: 'x2', cents: 450, label: 'Coffee', category: 'food', createdAt: at(t, 8, 5) },
      { id: 'x1', cents: 4218, label: 'Groceries', category: 'food', createdAt: at(t, 7, 50) },
    ],
    journal: 'Good start: report outline done before lunch.',
    gratitude: ['Sunny walk to work', 'A long call with Sam'],
  };
  s['pdh:v1:habits'] = [
    { id: 'core-move', core: true },
    { id: 'core-read', core: true },
    { id: 'core-mindful', core: true },
    { id: 'core-plan', core: true },
    { id: 'habit-stretch', label: 'Stretch for 5 minutes', core: false, since: key(day(40)) },
  ];
  s['pdh:v1:goals'] = [
    { id: 'g1', text: 'Book flights for December', week: key(sunday), createdAt: 1, doneAt: 2 },
    { id: 'g2', text: 'Finish the quarterly report', week: key(sunday), createdAt: 2 },
    { id: 'g3', text: 'Run three times', week: key(sunday), createdAt: 3 },
    { id: 'l1', text: 'Sort out the car insurance', week: key(lastSunday), createdAt: 1, doneAt: 2 },
    { id: 'l2', text: 'Clear the inbox', week: key(lastSunday), createdAt: 2, doneAt: 3 },
    { id: 'l3', text: 'Plan the weekend away', week: key(lastSunday), createdAt: 3 },
  ];
  s['pdh:v1:pinned'] = [{ id: 'p1', text: 'Bins out Tuesday night', createdAt: at(day(20), 9), pinnedAt: at(day(20), 9) }];
  s['pdh:v1:countdowns'] = [
    { id: 'c1', label: 'Mum’s birthday', date: key(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 9)) },
    { id: 'c2', label: 'Lisbon trip', date: key(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 23)) },
  ];
  s['pdh:v1:settings'] = { categoryBudgets: { food: 40000, fun: 10000, transport: 6000 }, monthlyBudgetCents: 150000 };
  return s;
}

async function openApp(browser, viewport, scale) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  // A morning clock, so the header says "Good morning" whatever time this runs.
  const now = new Date();
  await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 41));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate((s) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
  }, demoData());
  await page.reload();
  await page.getByText('Quick Capture').first().waitFor();
  await page.waitForTimeout(400);
  return { page, errors };
}

/** Scroll so `testID` sits near the top of the screen. */
async function scrollTo(page, testId, offset = 12) {
  await page.evaluate(
    ({ id, offset }) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const scroller = document.querySelector('[data-testid="home-scroll"]');
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTop = Math.max(0, top - offset);
    },
    { id: testId, offset },
  );
  await page.waitForTimeout(250);
}

const scenes = [
  { file: 'home', title: 'Your whole day, one screen', sub: 'Focus, notes and to-dos, private on your phone', accent: '#FB923C', go: async () => {} },
  {
    file: 'habits', title: 'Habits that stick', sub: 'Streaks, schedules and four weeks at a glance', accent: '#4ADE80',
    go: async (p) => {
      await p.getByRole('button', { name: 'Edit Meditate for 10 minutes' }).click();
      await scrollTo(p, 'card-habits');
    },
  },
  { file: 'week', title: 'Plan the week', sub: 'Three goals, and a look back at last week', accent: '#60A5FA', go: (p) => scrollTo(p, 'card-week') },
  { file: 'wellbeing', title: 'How the day feels', sub: 'Water, sleep, energy and mood', accent: '#38BDF8', go: (p) => scrollTo(p, 'card-water') },
  { file: 'money', title: 'Spend with intent', sub: 'Budgets by category, bills that add themselves', accent: '#FB7185', go: (p) => scrollTo(p, 'card-expenses') },
  {
    file: 'month', title: 'See your month', sub: 'A calendar shaded by habits or by mood', accent: '#2DD4BF',
    go: async (p) => {
      await scrollTo(p, 'month-calendar', 4);
      await p.getByRole('radio', { name: 'Shade by mood' }).click();
      await p.waitForTimeout(200);
    },
  },
];

const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

async function frame(browser, scene, shot) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin:0; width:1080px; height:1920px; overflow:hidden; font-family: 'Inter', sans-serif;
      background: radial-gradient(900px 700px at 50% 30%, ${scene.accent}22, transparent 70%), linear-gradient(160deg, #1b1b21, #0d0d10); }
    h1 { font-family: 'Inter Display', 'Inter', sans-serif; font-weight: 700; font-size: 76px; letter-spacing: -1.5px;
      color: #F5F5F5; text-align: center; margin: 150px 60px 0; }
    p { font-size: 38px; color: #A3A3A3; text-align: center; margin: 26px 80px 0; }
    .phone { position: absolute; left: 110px; top: 470px; width: 860px; height: 1600px; border-radius: 60px; overflow: hidden;
      box-shadow: 0 0 0 10px #2a2a31, 0 40px 120px rgba(0,0,0,0.6); background: #121212; }
    .phone img { width: 860px; display: block; }
  </style></head><body>
    <h1>${scene.title}</h1><p>${scene.sub}</p>
    <div class="phone"><img src="${dataUrl(shot)}"/></div>
  </body></html>`);
  await page.waitForTimeout(150);
  const file = path.join(out, `phone-${scenes.indexOf(scene) + 1}-${scene.file}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

async function featureGraphic(browser, homeShot) {
  const icon = path.join(out, 'icon-512.png');
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const dots = ['#A78BFA', '#4ADE80', '#38BDF8', '#FBBF24', '#FB7185', '#2DD4BF']
    .map((c) => `<span style="background:${c}"></span>`).join('');
  await page.setContent(`<!doctype html><html><head><style>
    body { margin:0; width:1024px; height:500px; overflow:hidden; font-family:'Inter',sans-serif;
      background: radial-gradient(600px 400px at 78% 40%, #A78BFA26, transparent 70%), linear-gradient(135deg, #1d1d24, #0d0d10); }
    .icon { position:absolute; left:64px; top:96px; width:112px; height:112px; border-radius:26px; }
    h1 { position:absolute; left:64px; top:226px; margin:0; font-family:'Inter Display','Inter',sans-serif; font-weight:700;
      font-size:56px; letter-spacing:-1px; color:#F5F5F5; width:520px; line-height:1.05; }
    p { position:absolute; left:64px; top:292px; margin:0; font-size:26px; color:#A3A3A3; width:480px; line-height:1.35; }
    .dots { position:absolute; left:64px; top:356px; display:flex; gap:10px; }
    .dots span { width:14px; height:14px; border-radius:7px; display:block; }
    .phone { position:absolute; left:640px; top:48px; width:300px; height:620px; border-radius:36px; overflow:hidden;
      transform: rotate(-6deg); box-shadow: 0 0 0 7px #2a2a31, 0 30px 80px rgba(0,0,0,0.6); background:#121212; }
    .phone img { width:300px; display:block; }
  </style></head><body>
    <img class="icon" src="${dataUrl(icon)}"/>
    <h1>Personal Daily Hub</h1>
    <p>Your whole day on one private screen.</p>
    <div class="dots">${dots}</div>
    <div class="phone"><img src="${dataUrl(homeShot)}"/></div>
  </body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, 'feature-graphic-1024x500.png') });
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  const report = { errors: [] };

  // Phones: 390x844 at 3x, then framed onto 1080x1920.
  const phone = await openApp(browser, { width: 390, height: 844 }, 3);
  const shots = {};
  for (const scene of scenes) {
    await scrollTo(phone.page, 'home-scroll', 0).catch(() => {});
    await phone.page.evaluate(() => (document.querySelector('[data-testid="home-scroll"]').scrollTop = 0));
    await scene.go(phone.page);
    shots[scene.file] = path.join(raw, `phone-${scene.file}.png`);
    await phone.page.screenshot({ path: shots[scene.file] });
  }
  report.sideways = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  report.errors.push(...phone.errors);
  await phone.page.close();
  for (const scene of scenes) await frame(browser, scene, shots[scene.file]);
  await featureGraphic(browser, shots.home);

  // Tablets: plain screenshots of the app at tablet sizes (9:16).
  for (const [name, viewport] of [
    ['tablet7', { width: 540, height: 960 }],
    ['tablet10', { width: 720, height: 1280 }],
  ]) {
    const t = await openApp(browser, viewport, 2);
    await t.page.screenshot({ path: path.join(out, `${name}-1-home.png`) });
    await scrollTo(t.page, 'card-week');
    await t.page.screenshot({ path: path.join(out, `${name}-2-week.png`) });
    await scrollTo(t.page, 'card-expenses');
    await t.page.screenshot({ path: path.join(out, `${name}-3-money.png`) });
    await scrollTo(t.page, 'month-calendar', 4);
    await t.page.screenshot({ path: path.join(out, `${name}-4-month.png`) });
    report.errors.push(...t.errors);
    await t.page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
