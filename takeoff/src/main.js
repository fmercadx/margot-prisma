// The page: open a PDF, run the engine on the current sheet, list what it
// found, highlight on click, calibrate the scale, export CSV. All in the tab;
// the worker is bundled so nothing is fetched from anywhere else.

// The legacy build carries its own polyfills; the default build assumes the
// newest browser only, and an estimator's office machine is rarely that.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Viewer } from './viewer.js';
import { analyzePage } from './engine/takeoff.js';
import { calibrate, describeScale } from './engine/scale.js';
import { toCsv } from './engine/csv.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = (id) => document.getElementById(id);
const el = {
  picker: $('picker'), prev: $('prev'), next: $('next'), pageLabel: $('pageLabel'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'), status: $('status'),
  stage: $('stage'), empty: $('empty'), canvases: $('canvases'),
  results: $('results'), scaleText: $('scaleText'), scaleSelect: $('scaleSelect'),
  calibrate: $('calibrate'), calForm: $('calForm'), calFeet: $('calFeet'), calCancel: $('calCancel'),
  symbols: $('symbols'), hatches: $('hatches'), regions: $('regions'), lines: $('lines'),
  export: $('export'),
};

const viewer = new Viewer({
  stage: el.stage, canvases: el.canvases, pageCanvas: $('page'), overlay: $('overlay'),
});

const state = {
  pdf: null,
  fileName: '',
  pageNo: 1,
  pageCount: 0,
  page: null,
  layerNames: null,
  cache: new Map(),   // pageNo → { analysis, items, scale, names }
  analysis: null,
  items: [],
  scale: null,        // { feetPerPoint, label, source }
  active: null,       // highlighted item id
  picking: null,      // calibration: { points: [] }
};

// ---------------------------------------------------------------- helpers

function status(msg, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle('err', isError);
}

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmt1 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function quantity(item) {
  const fpp = state.scale && state.scale.feetPerPoint;
  if (item.kind === 'count') return { text: fmtInt(item.qtyPt), unit: 'ea', value: item.qtyPt };
  if (!fpp) return { text: '—', unit: item.kind === 'area' ? 'sq ft' : 'lin ft', value: null };
  if (item.kind === 'area') {
    const v = item.qtyPt * fpp * fpp;
    return { text: fmtInt(v), unit: 'sq ft', value: Math.round(v) };
  }
  const v = item.qtyPt * fpp;
  return { text: fmt1(v), unit: 'lin ft', value: Math.round(v * 10) / 10 };
}

function pathPolylines(analysis, ids) {
  const out = [];
  for (const id of ids) {
    const p = analysis.paths[id];
    if (!p) continue;
    for (const sp of p.subpaths) out.push(sp.closed ? [...sp.points, sp.points[0]] : sp.points);
  }
  return out;
}

// ---------------------------------------------------------------- items

function buildItems(analysis) {
  const items = [];
  analysis.symbols.forEach((s, i) => {
    items.push({
      id: `sym-${i}`, section: 'symbols', kind: 'count', name: `Symbol ${i + 1}`,
      qtyPt: s.count, include: true,
      sub: `${s.parts} path${s.parts === 1 ? '' : 's'} · ${Math.round(s.size[0])}×${Math.round(s.size[1])} pt`,
      sample: s.instances[0].pathIds,
      geom: () => ({
        polylines: pathPolylines(analysis, s.instances.flatMap((inst) => inst.pathIds)),
        markers: s.instances.map((inst) => inst.center),
      }),
    });
  });
  analysis.hatches.forEach((h, i) => {
    items.push({
      id: `hatch-${i}`, section: 'hatches', kind: 'area', name: `Hatch ${i + 1} (${h.angle}°)`,
      qtyPt: h.area, include: true,
      sub: `${h.count} lines, ${h.spacing.toFixed(1)} pt apart`,
      geom: () => ({ polylines: pathPolylines(analysis, h.lineIds) }),
    });
  });
  analysis.regions.forEach((r, i) => {
    const what = r.fill ? 'Filled' : 'Outlined';
    items.push({
      id: `region-${i}`, section: 'regions', kind: 'area',
      name: `${what} area ${i + 1}${r.isRect ? ' (rectangle)' : ''}`,
      qtyPt: r.area, include: !r.isRect,
      sub: r.layer ? `layer ${r.layer}` : `${r.polygons[0].length} points`,
      perimeterPt: r.perimeter,
      geom: () => ({ polylines: r.polygons, closed: true, fill: true }),
    });
  });
  analysis.lines.forEach((g, i) => {
    const style = `${g.lineWidth.toFixed(2)} pt${g.dash ? ' dashed' : ''}${g.color && g.color !== '#000000' ? ' ' + g.color : ''}`;
    items.push({
      id: `line-${i}`, section: 'lines', kind: 'length', name: `Lines ${i + 1} (${style})`,
      qtyPt: g.total, include: true,
      sub: `${g.count} run${g.count === 1 ? '' : 's'}`,
      geom: () => ({ polylines: g.items.map((it) => it.points) }),
    });
  });
  return items;
}

function drawThumb(canvas, analysis, ids) {
  const ctx = canvas.getContext('2d');
  const pls = pathPolylines(analysis, ids);
  const pts = pls.flat();
  if (!pts.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = canvas.width, h = canvas.height, pad = 4;
  const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-6), (h - 2 * pad) / Math.max(y1 - y0, 1e-6));
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 1;
  ctx.setTransform(s, 0, 0, -s, w / 2 - s * (x0 + x1) / 2, h / 2 + s * (y0 + y1) / 2);
  ctx.lineWidth = 1 / s;
  for (const pl of pls) {
    ctx.beginPath();
    ctx.moveTo(pl[0][0], pl[0][1]);
    for (let i = 1; i < pl.length; i++) ctx.lineTo(pl[i][0], pl[i][1]);
    ctx.stroke();
  }
}

function renderRows() {
  const sections = { symbols: el.symbols, hatches: el.hatches, regions: el.regions, lines: el.lines };
  for (const node of Object.values(sections)) node.replaceChildren();
  for (const item of state.items) {
    const row = document.createElement('div');
    row.className = 'row' + (state.active === item.id ? ' on' : '');
    row.dataset.id = item.id;
    row.tabIndex = 0;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.include;
    cb.title = 'Include in the CSV';
    cb.addEventListener('change', () => { item.include = cb.checked; });

    const thumb = document.createElement('canvas');
    thumb.className = 'thumb';
    thumb.width = 26; thumb.height = 26;
    if (item.section === 'symbols') drawThumb(thumb, state.analysis, item.sample);
    else thumb.classList.add('blank');

    const name = document.createElement('input');
    name.className = 'name';
    name.value = item.name;
    name.setAttribute('aria-label', 'Name');
    name.addEventListener('input', () => { item.name = name.value; });
    // Most of a row is the name box; editing a name should show what it names.
    name.addEventListener('focus', () => setActive(item.id));

    const q = quantity(item);
    const qty = document.createElement('span');
    qty.className = 'qty';
    qty.textContent = q.text;
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = q.unit;

    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = item.sub;

    row.append(cb, thumb, name, qty, unit, sub);
    row.addEventListener('click', (e) => {
      if (e.target === cb || e.target === name) return;
      toggleActive(item.id);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === row) toggleActive(item.id);
    });
    sections[item.section].appendChild(row);
  }
  for (const node of Object.values(sections)) {
    if (!node.children.length) {
      const none = document.createElement('p');
      none.className = 'none';
      none.textContent = state.analysis ? `None found on this sheet.` : '';
      node.appendChild(none);
    }
  }
  el.export.disabled = !state.items.length;
}

function toggleActive(id) {
  setActive(state.active === id ? null : id);
}

function setActive(id) {
  if (state.active === id) return;
  state.active = id;
  for (const row of document.querySelectorAll('.row')) {
    row.classList.toggle('on', row.dataset.id === state.active);
  }
  const item = state.items.find((it) => it.id === state.active);
  viewer.setHighlight(item ? item.geom() : null);
  el.canvases.dataset.active = state.active || '';
}

// ---------------------------------------------------------------- scale

function renderScale() {
  const a = state.analysis;
  el.calibrate.disabled = !a;
  el.scaleSelect.classList.add('hide');
  if (!a) { el.scaleText.textContent = 'Open a plan to begin.'; return; }
  const s = state.scale;
  if (s && s.source === 'calibrated') {
    el.scaleText.textContent = `Calibrated: ${describeScale(s.feetPerPoint)} (${s.label}).`;
  } else if (s) {
    el.scaleText.textContent = `${describeScale(s.feetPerPoint)}, from the sheet: “${s.label}”.`;
    if (a.scales.length > 1) {
      el.scaleSelect.replaceChildren(...a.scales.map((c, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${describeScale(c.feetPerPoint)} — “${c.label}”`;
        o.selected = c === s;
        return o;
      }));
      el.scaleSelect.classList.remove('hide');
    }
  } else {
    el.scaleText.textContent = a.notToScale
      ? 'The sheet says it is not to scale. Calibrate against a known dimension to measure anyway.'
      : 'No scale statement found on this sheet. Calibrate: click two points a known distance apart.';
  }
  if (s && s.source !== 'calibrated') {
    el.scaleText.textContent += ' If the PDF was printed at another sheet size, calibrate instead.';
  }
}

function setScale(scale) {
  state.scale = scale;
  const c = state.cache.get(state.pageNo);
  if (c) c.scale = scale;
  renderScale();
  renderRows();
}

function startCalibration() {
  state.picking = { points: [] };
  el.stage.classList.add('picking');
  el.calForm.classList.add('hide');
  viewer.setMarkers([]);
  status('Calibrate: click the first point on the plan.');
}

function cancelCalibration() {
  state.picking = null;
  el.stage.classList.remove('picking');
  el.calForm.classList.add('hide');
  viewer.setMarkers([]);
  status('');
}

viewer.onClick((pt) => {
  if (!state.picking) return;
  state.picking.points.push(pt);
  viewer.setMarkers(state.picking.points);
  if (state.picking.points.length === 1) {
    status('Calibrate: now click the second point.');
  } else {
    el.stage.classList.remove('picking');
    el.calForm.classList.remove('hide');
    el.calFeet.value = '';
    el.calFeet.focus();
    status('Calibrate: enter the real distance between the two points.');
  }
});

el.calibrate.addEventListener('click', startCalibration);
el.calCancel.addEventListener('click', cancelCalibration);
el.calForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const feet = parseFloat(el.calFeet.value);
  const pts = state.picking && state.picking.points;
  if (!pts || pts.length !== 2 || !(feet > 0)) return;
  const s = calibrate(pts[0], pts[1], feet);
  if (!s) { status('Those two points are the same spot. Try again.', true); return; }
  setScale(s);
  state.picking = null;
  el.calForm.classList.add('hide');
  viewer.setMarkers([]);
  status(`Scale set: ${describeScale(s.feetPerPoint)}.`);
});
el.scaleSelect.addEventListener('change', () => {
  const c = state.analysis.scales[+el.scaleSelect.value];
  if (c) setScale(c);
});

// ---------------------------------------------------------------- pages

async function showPage(n) {
  if (!state.pdf) return;
  state.pageNo = n;
  state.active = null;
  cancelCalibration();
  viewer.setHighlight(null);
  el.pageLabel.textContent = `${n} / ${state.pageCount}`;
  el.prev.disabled = n <= 1;
  el.next.disabled = n >= state.pageCount;
  status(`Rendering page ${n}…`);

  const page = await state.pdf.getPage(n);
  state.page = page;
  await viewer.show(page, viewer.fitZoom(page));

  let c = state.cache.get(n);
  if (!c) {
    status(`Reading page ${n}…`);
    const [opList, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
    const analysis = analyzePage({
      opList, textItems: text.items, view: page.view, OPS: pdfjsLib.OPS, layerNames: state.layerNames,
    });
    c = { analysis, items: buildItems(analysis), scale: analysis.scale };
    state.cache.set(n, c);
  }
  state.analysis = c.analysis;
  state.items = c.items;
  state.scale = c.scale;
  renderScale();
  renderRows();
  const found = c.items.length;
  status(`Page ${n}: ${c.analysis.paths.length.toLocaleString('en-US')} paths, ${found} item${found === 1 ? '' : 's'}.`);
  el.results.classList.add('ready');
}

async function openFile(file) {
  if (!file) return;
  el.results.classList.remove('ready');
  status(`Opening ${file.name}…`);
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (state.pdf) await state.pdf.destroy();
    state.pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    status(`Could not open ${file.name}: ${e && e.message ? e.message : e}`, true);
    return;
  }
  state.fileName = file.name.replace(/\.pdf$/i, '');
  state.pageCount = state.pdf.numPages;
  state.cache = new Map();
  state.layerNames = null;
  try {
    const occ = await state.pdf.getOptionalContentConfig();
    const groups = occ && occ.getGroups ? occ.getGroups() : null;
    if (groups) {
      state.layerNames = {};
      for (const [id, g] of Object.entries(groups)) state.layerNames[id] = g && g.name ? g.name : id;
    }
  } catch { /* no layers */ }
  el.empty.classList.add('hide');
  for (const b of [el.zoomIn, el.zoomOut, el.zoomFit]) b.disabled = false;
  await showPage(1);
}

el.picker.addEventListener('change', () => openFile(el.picker.files[0]));
el.prev.addEventListener('click', () => showPage(state.pageNo - 1));
el.next.addEventListener('click', () => showPage(state.pageNo + 1));
el.zoomIn.addEventListener('click', () => viewer.setZoom(viewer.zoom * 1.25));
el.zoomOut.addEventListener('click', () => viewer.setZoom(viewer.zoom / 1.25));
el.zoomFit.addEventListener('click', () => state.page && viewer.setZoom(viewer.fitZoom(state.page)));

for (const ev of ['dragenter', 'dragover']) {
  el.stage.addEventListener(ev, (e) => { e.preventDefault(); el.stage.classList.add('dragover'); });
}
el.stage.addEventListener('dragleave', () => el.stage.classList.remove('dragover'));
el.stage.addEventListener('drop', (e) => {
  e.preventDefault();
  el.stage.classList.remove('dragover');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) openFile(f);
});

// ---------------------------------------------------------------- export

el.export.addEventListener('click', () => {
  const rows = [['Item', 'Type', 'Quantity', 'Unit', 'Page', 'Scale', 'Scale source']];
  const scaleLabel = state.scale ? describeScale(state.scale.feetPerPoint) : '';
  const source = state.scale ? state.scale.source : 'none';
  for (const item of state.items) {
    if (!item.include) continue;
    const q = quantity(item);
    rows.push([item.name, item.kind, q.value == null ? '' : q.value, q.unit, state.pageNo, scaleLabel, source]);
  }
  const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.fileName || 'plan'}-p${state.pageNo}-takeoff.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

renderRows();
