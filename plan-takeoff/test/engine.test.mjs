// The engine against the synthetic plan, through the real pdf.js operator
// list rather than hand-built input, so a change in pdf.js's path encoding
// fails here first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { buildSyntheticPlan, SCALE_FT_PER_IN } from './fixture.mjs';
import { analyzePage } from '../src/engine/takeoff.js';
import { detectScales, calibrate, describeScale } from '../src/engine/scale.js';
import { toCsv } from '../src/engine/csv.js';

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');

async function analyze(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes, standardFontDataUrl: fontDir, isEvalSupported: false }).promise;
  const page = await pdf.getPage(1);
  const [opList, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
  return analyzePage({ opList, textItems: text.items, view: page.view, OPS: pdfjs.OPS });
}

const within = (got, want, pct, what) => {
  const err = Math.abs(got - want) / want * 100;
  assert.ok(err <= pct, `${what}: got ${got.toFixed(2)}, want ${want.toFixed(2)} (${err.toFixed(2)}% off, limit ${pct}%)`);
};

const fixture = await buildSyntheticPlan();
const result = await analyze(fixture.bytes);
const { truth } = fixture;
const fpp = result.scale.feetPerPoint;
const sqft = (pt2) => pt2 * fpp * fpp;
const ft = (pt) => pt * fpp;

test('reads the scale from the title block', () => {
  assert.ok(result.scale, 'no scale found');
  assert.ok(Math.abs(fpp - SCALE_FT_PER_IN / 72) < 1e-9, `feetPerPoint ${fpp}`);
  assert.equal(result.scale.source, 'note');
  assert.equal(result.notToScale, false);
});

test('counts the XObject tree block, 3 paths per instance', () => {
  const tree = result.symbols.find((s) => s.count === truth.tree_count && s.parts === 3);
  assert.ok(tree, `symbols: ${JSON.stringify(result.symbols.map((s) => [s.count, s.parts]))}`);
});

test('counts the loose shrub circle', () => {
  const shrub = result.symbols.find((s) => s.count === truth.shrub_count);
  assert.ok(shrub, `symbols: ${JSON.stringify(result.symbols.map((s) => [s.count, s.parts]))}`);
  assert.equal(shrub.parts, 1);
});

test('merges a flattened three-path block by co-location', () => {
  const boulder = result.symbols.find((s) => s.count === truth.boulder_count);
  assert.ok(boulder, `symbols: ${JSON.stringify(result.symbols.map((s) => [s.count, s.parts]))}`);
  assert.equal(boulder.parts, 3);
  // and nothing else claims to be a 5-count symbol
  assert.equal(result.symbols.filter((s) => s.count === 5).length, 1);
});

test('finds two sod regions hatched at the same angle', () => {
  assert.equal(result.hatches.length, 2, JSON.stringify(result.hatches.map((h) => [h.angle, h.count, sqft(h.area)])));
  const [big, small] = result.hatches;
  assert.equal(big.angle, 45);
  within(big.spacing, 6, 1, 'spacing');
  within(sqft(big.area), truth.sodA_sqft, 2, 'sod A');
  within(sqft(small.area), truth.sodB_sqft, 2, 'sod B');
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

test('measures the edging polyline', () => {
  const items = result.lines.flatMap((g) => g.items);
  const edging = items.find((it) => Math.abs(ft(it.length) - truth.edging_lf) < 0.05);
  assert.ok(edging, `line lengths: ${JSON.stringify(items.map((it) => ft(it.length).toFixed(2)))}`);
});

test('chains segments of one line back into a polyline', () => {
  const items = result.lines.flatMap((g) => g.items);
  const chained = items.find((it) => Math.abs(ft(it.length) - truth.pieces_lf) < 0.05);
  assert.ok(chained, `line lengths: ${JSON.stringify(items.map((it) => ft(it.length).toFixed(2)))}`);
  assert.equal(chained.pathIds.length, 3);
});

test('applies a nested transform to a polyline', () => {
  const items = result.lines.flatMap((g) => g.items);
  const nested = items.find((it) => Math.abs(ft(it.length) - truth.nested_lf) < 0.05);
  assert.ok(nested, `line lengths: ${JSON.stringify(items.map((it) => ft(it.length).toFixed(2)))}`);
});

test('hatch lines are not also reported as lines', () => {
  const total = result.lines.reduce((s, g) => s + g.count, 0);
  assert.ok(total < 10, `${total} line items; hatch leaked into lines`);
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
  // the one next to SCALE wins over a detail scale elsewhere
  const multi = detectScales('DETAIL 1/4" = 1\'-0"   ...   SCALE: 1" = 40\'');
  assert.equal(multi[0].feetPerPoint * 72, 40);
  assert.equal(multi.length, 2);
  assert.equal(describeScale(20 / 72), '1" = 20\'');
  assert.equal(describeScale(8 / 72), '1" = 8\'');
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
