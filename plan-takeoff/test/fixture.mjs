// A synthetic landscape plan with known quantities, drawn with pdf-lib.
//
// It is deliberately the awkward kind of export: one symbol is a form
// XObject (a CAD block kept intact), another is flattened into loose paths,
// a polyline is drawn under a nested transform, two sod areas share a hatch
// angle, and the sheet has a border that must not be counted as an area.
//
//   node test/fixture.mjs test/fixtures/synthetic_plan.pdf   # write it out

import { writeFileSync } from 'node:fs';
import {
  PDFDocument, StandardFonts, rgb,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  moveTo, lineTo, closePath, stroke, fill, fillAndStroke,
  setLineWidth, setStrokingColor, setFillingColor,
} from 'pdf-lib';

export const SCALE_FT_PER_IN = 20;
const FT_PER_PT = SCALE_FT_PER_IN / 72;

function shoelace(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
const len = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** Parallel hatch lines clipped to a polygon, as [[x0,y0],[x1,y1]] segments. */
function hatchLines(poly, angleDeg, spacing) {
  const th = (angleDeg * Math.PI) / 180;
  const d = [Math.cos(th), Math.sin(th)], n = [-d[1], d[0]];
  const offs = poly.map(([x, y]) => x * n[0] + y * n[1]);
  const out = [];
  for (let o = Math.min(...offs) + spacing / 2; o < Math.max(...offs); o += spacing) {
    const ss = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length];
      const den = (Q[0] - P[0]) * n[0] + (Q[1] - P[1]) * n[1];
      if (Math.abs(den) < 1e-9) continue;
      const t = (o - (P[0] * n[0] + P[1] * n[1])) / den;
      if (t < 0 || t >= 1) continue;
      const x = P[0] + t * (Q[0] - P[0]), y = P[1] + t * (Q[1] - P[1]);
      ss.push(x * d[0] + y * d[1]);
    }
    ss.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ss.length; i += 2) {
      out.push([
        [o * n[0] + ss[i] * d[0], o * n[1] + ss[i] * d[1]],
        [o * n[0] + ss[i + 1] * d[0], o * n[1] + ss[i + 1] * d[1]],
      ]);
    }
  }
  return out;
}

function polyOps(pts, paint) {
  const ops = [moveTo(pts[0][0], pts[0][1])];
  for (const p of pts.slice(1)) ops.push(lineTo(p[0], p[1]));
  if (paint !== 'open') ops.push(closePath());
  ops.push(paint === 'fill' ? fill() : paint === 'both' ? fillAndStroke() : stroke());
  return ops;
}

export async function buildSyntheticPlan() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const truth = {};

  // The tree block: a circle with a cross, kept as a form XObject.
  const block = doc.addPage([30, 30]);
  block.drawCircle({ x: 15, y: 15, size: 10, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
  block.drawLine({ start: { x: 5, y: 15 }, end: { x: 25, y: 15 }, thickness: 0.5 });
  block.drawLine({ start: { x: 15, y: 5 }, end: { x: 15, y: 25 }, thickness: 0.5 });
  const [tree] = await doc.embedPdf(await doc.save(), [0]);
  doc.removePage(0);

  const page = doc.addPage([1224, 792]); // 17 x 11
  page.drawText(`LANDSCAPE PLAN    SCALE: 1" = ${SCALE_FT_PER_IN}'-0"`, { x: 40, y: 44, size: 9, font });
  page.drawText('L-101', { x: 1120, y: 44, size: 12, font });

  // Sheet border: must be filtered out as an area.
  page.drawRectangle({ x: 36, y: 36, width: 1152, height: 720, borderWidth: 1, borderColor: rgb(0, 0, 0) });

  // Sod A, an L-shape, hatch only.
  const sodA = [[100, 100], [500, 100], [500, 250], [300, 250], [300, 450], [100, 450]];
  // Sod B, a rectangle, same angle, 50 pt away.
  const sodB = [[100, 500], [400, 500], [400, 700], [100, 700]];
  page.pushOperators(setLineWidth(0.25), setStrokingColor(rgb(0, 0, 0)));
  for (const poly of [sodA, sodB]) {
    for (const [a, b] of hatchLines(poly, 45, 6)) {
      page.pushOperators(moveTo(a[0], a[1]), lineTo(b[0], b[1]), stroke());
    }
  }
  truth.sodA_sqft = shoelace(sodA) * FT_PER_PT ** 2;
  truth.sodB_sqft = shoelace(sodB) * FT_PER_PT ** 2;

  // Mulch bed: filled and stroked polygon.
  const mulch = [[650, 120], [900, 140], [950, 300], [760, 380], [640, 260]];
  page.pushOperators(setFillingColor(rgb(0.85, 0.85, 0.85)), setLineWidth(0.75), ...polyOps(mulch, 'both'));
  truth.mulch_sqft = shoelace(mulch) * FT_PER_PT ** 2;

  // Bed outline: stroked, closed, not filled.
  const bed = [[650, 450], [800, 460], [820, 560], [700, 600], [620, 520]];
  page.pushOperators(setLineWidth(1), ...polyOps(bed, 'stroke'));
  truth.bed_sqft = shoelace(bed) * FT_PER_PT ** 2;

  // Steel edging: one open polyline, 1.5 pt.
  const edging = [[520, 420], [700, 420], [760, 480], [900, 480]];
  page.pushOperators(setLineWidth(1.5), ...polyOps(edging, 'open'));
  truth.edging_lf = len(edging) * FT_PER_PT;

  // The same edging style drawn as separate segments, to be chained back.
  const pieces = [[520, 700], [600, 700], [600, 640], [700, 640]];
  for (let i = 1; i < pieces.length; i++) {
    page.pushOperators(moveTo(...pieces[i - 1]), lineTo(...pieces[i]), stroke());
  }
  truth.pieces_lf = len(pieces) * FT_PER_PT;

  // A polyline under a nested transform: translate (900, 600), scale 2.
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(2, 0, 0, 2, 900, 600),
    setLineWidth(0.5), moveTo(0, 0), lineTo(50, 0), lineTo(50, 40), stroke(), popGraphicsState());
  truth.nested_lf = 180 * FT_PER_PT;

  // Trees: the XObject stamped 7 times.
  const trees = Array.from({ length: 7 }, (_, i) => [940 + 34 * i, 100 + 30 * (i % 3)]);
  for (const [x, y] of trees) page.drawPage(tree, { x, y });
  truth.tree_count = trees.length;

  // Shrubs: a loose circle, 12 times.
  for (let i = 0; i < 12; i++) {
    page.drawCircle({ x: 1000 + 16 * i, y: 300, size: 5, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
  }
  truth.shrub_count = 12;

  // Boulders: a flattened block of three loose paths (square + two diagonals), 5 times.
  for (let i = 0; i < 5; i++) {
    const x = 1000 + 30 * i, y = 380;
    page.pushOperators(setLineWidth(0.5),
      ...polyOps([[x, y], [x + 8, y], [x + 8, y + 8], [x, y + 8]], 'stroke'),
      moveTo(x, y), lineTo(x + 8, y + 8), stroke(),
      moveTo(x, y + 8), lineTo(x + 8, y), stroke());
  }
  truth.boulder_count = 5;

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, truth };
}

if (process.argv[1] && process.argv[1].endsWith('fixture.mjs')) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node test/fixture.mjs <out.pdf>'); process.exit(2); }
  const { bytes, truth } = await buildSyntheticPlan();
  writeFileSync(out, bytes);
  console.log(`wrote ${out}`, truth);
}
