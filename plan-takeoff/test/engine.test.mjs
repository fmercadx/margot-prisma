// The engine against the synthetic plan, through the real pdf.js operator
// list rather than hand-built input, so a change in pdf.js's path encoding
// fails here first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { buildSyntheticPlan, SCALE_FT_PER_IN } from './fixture.mjs';
import { analyzePage, uprightFrame } from '../src/engine/takeoff.js';
import { detectScales, calibrate, describeScale } from '../src/engine/scale.js';
import { textRows, textLines } from '../src/engine/text.js';
import { parseSchedule, matchSchedule } from '../src/engine/schedule.js';
import { pathSignature } from '../src/engine/signature.js';
import { toCsv } from '../src/engine/csv.js';

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');

async function load(bytes) {
  return pdfjs.getDocument({ data: bytes, standardFontDataUrl: fontDir, isEvalSupported: false }).promise;
}
async function analyze(pdf, n, extra = {}) {
  const page = await pdf.getPage(n);
  const [opList, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
  return analyzePage({ opList, textItems: text.items, view: page.view, OPS: pdfjs.OPS, rotate: page.rotate, ...extra });
}

const within = (got, want, pct, what) => {
  const err = Math.abs(got - want) / want * 100;
  assert.ok(err <= pct, `${what}: got ${got.toFixed(2)}, want ${want.toFixed(2)} (${err.toFixed(2)}% off, limit ${pct}%)`);
};

const fixture = await buildSyntheticPlan();
const pdf = await load(fixture.bytes);
const result = await analyze(pdf, 1);
const { truth } = fixture;
const fpp = result.scale.feetPerPoint;
const sqft = (pt2) => pt2 * fpp * fpp;
const ft = (pt) => pt * fpp;
const named = (code) => result.named.find((n) => n.code === code);

test('reads the scale from the title block', () => {
  assert.ok(result.scale, 'no scale found');
  assert.ok(Math.abs(fpp - SCALE_FT_PER_IN / 72) < 1e-9, `feetPerPoint ${fpp}`);
  assert.equal(result.scale.source, 'note');
  assert.equal(result.notToScale, false);
});

test('reads the legend: four symbols and a hatch swatch, with codes', () => {
  const codes = result.legend.map((e) => `${e.code}:${e.kind}`).sort();
  assert.deepEqual(codes, ['BO:symbol', 'PF:symbol', 'QV:symbol', 'SD:hatch', 'SH:symbol'],
    `legend: ${JSON.stringify(result.legend.map((e) => [e.label, e.kind]))}`);
  assert.equal(result.legend.find((e) => e.code === 'QV').label, 'QV LIVE OAK');
});

test('counts the tree block by its legend entry, rotated copies included, legend copy excluded', () => {
  const qv = named('QV');
  assert.ok(qv, `named: ${JSON.stringify(result.named.map((n) => [n.label, n.count]))}`);
  assert.equal(qv.count, truth.tree_count);
});

test('counts the loose shrub circle and flags the schedule mismatch', () => {
  const sh = named('SH');
  assert.ok(sh);
  assert.equal(sh.count, truth.shrub_count);
  assert.equal(sh.schedule, truth.schedule.SH);
  assert.notEqual(sh.schedule, sh.count);
});

test('counts a flattened three-path block by assembling its parts', () => {
  const bo = named('BO');
  assert.ok(bo);
  assert.equal(bo.count, truth.boulder_count);
  assert.equal(bo.schedule, truth.schedule.BO);
});

test('counts a five-petal flower placed at nine different angles', () => {
  const pf = named('PF');
  assert.ok(pf, `named: ${JSON.stringify(result.named.map((n) => [n.label, n.count]))}`);
  assert.equal(pf.count, truth.flower_count);
  assert.equal(pf.schedule, truth.schedule.PF);
});

test('matches every legend symbol to its plant schedule row', () => {
  for (const code of ['QV', 'SH', 'BO', 'PF']) {
    assert.equal(named(code).schedule, truth.schedule[code], `${code}: ${named(code).scheduleText}`);
  }
});

test('finds three sod areas hatched at one angle and names them from the swatch', () => {
  const sod = result.hatches.filter((h) => h.angle === 45);
  assert.equal(sod.length, 3, JSON.stringify(result.hatches.map((h) => [h.angle, h.count, sqft(h.area), h.pieces])));
  const nearest = (want) => sod.reduce((a, b) => (Math.abs(sqft(b.area) - want) < Math.abs(sqft(a.area) - want) ? b : a));
  within(sqft(nearest(truth.sodA_sqft).area), truth.sodA_sqft, 2, 'sod A');
  within(sqft(nearest(truth.sodB_sqft).area), truth.sodB_sqft, 2, 'sod B');
  const ring = nearest(truth.sodC_sqft);
  within(sqft(ring.area), truth.sodC_sqft, 3, 'sod C (curved ring)');
  assert.ok(ring.pieces > 1, 'the ring was expected to arrive in pieces that merged');
  for (const h of sod) assert.equal(h.name, 'SD SOD');
});

test('measures the filled mulch bed and the outlined bed, not the border', () => {
  const areas = result.regions.map((r) => sqft(r.area));
  const mulch = result.regions.find((r) => r.fill);
  assert.ok(mulch, `regions: ${JSON.stringify(areas)}`);
  within(sqft(mulch.area), truth.mulch_sqft, 0.1, 'mulch');
  const bed = result.regions.find((r) => !r.fill && !r.isRect);
  assert.ok(bed, `regions: ${JSON.stringify(areas)}`);
  within(sqft(bed.area), truth.bed_sqft, 0.1, 'bed');
  const pageSqft = sqft(1224 * 792);
  assert.ok(areas.every((a) => a < 0.7 * pageSqft), 'the sheet border was counted as an area');
});

test('measures the edging polyline, chains split segments, applies a nested transform', () => {
  const items = result.lines.flatMap((g) => g.items);
  const lengths = items.map((it) => ft(it.length).toFixed(2));
  for (const [what, want] of [['edging', truth.edging_lf], ['chained pieces', truth.pieces_lf], ['nested', truth.nested_lf]]) {
    assert.ok(items.some((it) => Math.abs(ft(it.length) - want) < 0.05), `${what}: line lengths ${JSON.stringify(lengths)}`);
  }
  assert.equal(items.find((it) => Math.abs(ft(it.length) - truth.pieces_lf) < 0.05).pathIds.length, 3);
});

test('hatch lines and legend symbols are not also reported as lines or other shapes', () => {
  const total = result.lines.reduce((s, g) => s + g.count, 0);
  assert.ok(total < 10, `${total} line items; hatch leaked into lines`);
  const loud = result.symbols.filter((s) => !s.claimed && !s.minor);
  assert.ok(loud.length <= 2, `unclaimed repeated shapes: ${JSON.stringify(loud.map((s) => [s.count, s.parts, s.size]))}`);
});

test('page 2: stored rotated, read upright; scale from the graphic bar; area and count hold', async () => {
  const r2 = await analyze(pdf, 2);
  assert.equal(r2.view[2] > r2.view[3], true, 'upright frame should be landscape');
  assert.ok(r2.scale, `no scale: ${JSON.stringify(r2.scales)}`);
  assert.equal(r2.scale.source, 'bar');
  within(r2.scale.feetPerPoint, truth.page2_feetPerPoint, 1, 'bar scale');
  const f2 = r2.scale.feetPerPoint;
  const filled = r2.regions.find((r) => r.fill && r.isRect);
  assert.ok(filled, `regions: ${JSON.stringify(r2.regions.map((r) => [r.fill, r.isRect, r.area]))}`);
  within(filled.area * f2 * f2, truth.page2_rect_sqft, 0.5, 'rect area');
  const shrubs = r2.symbols.find((s) => s.count === truth.page2_shrub_count && !s.minor);
  assert.ok(shrubs, `symbols: ${JSON.stringify(r2.symbols.map((s) => [s.count, s.size]))}`);
  // Text reads left to right in the upright frame.
  assert.ok(r2.textLines.some((l) => l.str === 'PLANTING PLAN'), JSON.stringify(r2.textLines.map((l) => l.str)));
});

test('a schedule on another sheet is used when passed in', async () => {
  const page = await pdf.getPage(1);
  const text = await page.getTextContent();
  const rows = parseSchedule([{ rows: textRows(text.items), page: 1 }]);
  assert.ok(rows.length >= 4, JSON.stringify(rows));
  const r2 = await analyze(pdf, 2, { scheduleRows: rows });
  assert.equal(r2.schedule.length >= 4, true);
});

test('upright frames', () => {
  const v = [0, 0, 792, 1224];
  assert.deepEqual(uprightFrame(v, 0).upright, [0, 0, 792, 1224]);
  assert.deepEqual(uprightFrame(v, 90).upright, [0, 0, 1224, 792]);
  const m = uprightFrame(v, 90).matrix;
  const apply = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  // bottom-left of the stored page lands at the top-left of the display,
  // and its top-left at the top-right
  assert.deepEqual(apply(0, 0), [0, 792]);
  assert.deepEqual(apply(0, 1224), [1224, 792]);
});

test('text rows keep a baseline whole; lines split it at wide gaps', () => {
  const items = [
    { str: 'SYMPHYOTRICHUM', transform: [1, 0, 0, 1, 100, 500], width: 80, height: 8 },
    { str: '0', transform: [1, 0, 0, 1, 300, 500], width: 4, height: 8 },
    { str: '50 ft', transform: [1, 0, 0, 1, 360, 500], width: 20, height: 8 },
    { str: 'ROTATED', transform: [0, 1, -1, 0, 50, 50], width: 40, height: 8 },
  ];
  assert.equal(textRows(items).length, 1);
  assert.equal(textRows(items)[0].str, 'SYMPHYOTRICHUM 0 50 ft');
  const lines = textLines(items);
  assert.deepEqual(lines.map((l) => l.str), ['SYMPHYOTRICHUM', '0', '50 ft']);
});

test('schedule rows and matching', () => {
  const rows = parseSchedule([{ page: 2, rows: [
    { str: "LI TUSCARORA CRAPE MYRTLE LAGERSTROEMIA 'TUSCARORA' 14' HT. 3" },
    { str: 'Genista tinctoria ‘Royal Gold’ Royal Gold Woadwaxen #3 CONT. 34' },
    { str: 'PLANT LIST' },
    { str: '28 PM' },
  ] }]);
  assert.deepEqual(rows.map((r) => r.qty), [3, 34]);
  assert.equal(matchSchedule({ label: 'LI TUSCARORA CRAPE MYRTLE', code: 'LI' }, rows).qty, 3);
  assert.equal(matchSchedule({ label: "GENISTA TINCTORIA 'ROYAL GOLD'", code: null }, rows).qty, 34);
  assert.equal(matchSchedule({ label: 'QV LIVE OAK', code: 'QV' }, rows), null);
});

test('the signature is the same for a rotated copy and different for another size', () => {
  const circle = (cx, cy, r, rot) => {
    const pts = [];
    for (let i = 0; i < 32; i++) { const a = rot + (i * 2 * Math.PI) / 32; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return { subpaths: [{ points: pts, closed: true }], fill: false, stroke: true };
  };
  assert.equal(pathSignature(circle(0, 0, 5, 0)), pathSignature(circle(300, 40, 5, 1.1)));
  assert.notEqual(pathSignature(circle(0, 0, 5, 0)), pathSignature(circle(0, 0, 9, 0)));
});

test('scale notation', () => {
  const fpi = (t) => detectScales(t)[0]?.feetPerPoint * 72;
  assert.equal(fpi('SCALE: 1" = 20\'-0"'), 20);
  assert.equal(fpi('1"=30\''), 30);
  assert.equal(fpi('SCALE 1 IN = 50 FT'), 50);
  assert.equal(fpi('1/8" = 1\'-0"'), 8);
  assert.equal(fpi('3/16"=1\''), 16 / 3);
  assert.equal(fpi('1 1/2" = 1\'-0"'), 1 / 1.5);
  assert.equal(fpi('SCALE 1:240'), 20);
  assert.equal(detectScales('NOT TO SCALE').length, 0);
  const multi = detectScales('DETAIL 1/4" = 1\'-0"   ...   SCALE: 1" = 40\'');
  assert.equal(multi[0].feetPerPoint * 72, 40);
  assert.equal(multi.length, 2);
  assert.equal(describeScale(20 / 72), '1" = 20\'');
  assert.equal(describeScale(0.125 / 72), '8" = 1\'');
});

test('calibration overrides the note', () => {
  const c = calibrate([100, 100], [172, 100], 20);
  assert.ok(Math.abs(c.feetPerPoint - 20 / 72) < 1e-12);
  assert.equal(c.source, 'calibrated');
  assert.equal(calibrate([0, 0], [0, 0], 10), null);
});

test('csv quoting', () => {
  assert.equal(toCsv([['a', 'b,c', 'd"e'], [1, null, 2.5]]), 'a,"b,c","d""e"\r\n1,,2.5\r\n');
});
