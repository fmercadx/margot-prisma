// A synthetic landscape plan with known quantities, drawn with pdf-lib.
//
// It is deliberately the awkward kind of export: one symbol is a form
// XObject (a CAD block kept intact) and three of its copies are rotated,
// another symbol is flattened into loose paths, a flower is five petals
// placed at random angles, a polyline is drawn under a nested transform, two
// sod areas share a hatch angle, a third hatched bed is a curved ring, the
// sheet has a border that must not be counted as an area, and it carries a
// legend and a plant schedule like a real sheet does. Page 2 is stored
// rotated 90° and has a graphic scale bar instead of a written scale.
//
//   node test/fixture.mjs test/fixtures/synthetic_plan.pdf   # write it out

import { writeFileSync } from 'node:fs';
import {
  PDFDocument, StandardFonts, rgb, degrees,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  moveTo, lineTo, closePath, stroke, fill, fillAndStroke, appendBezierCurve,
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

/** An ellipse as four Béziers, rotated by `rot` about its centre. */
function ellipseOps(cx, cy, rx, ry, rot) {
  const k = 0.5523;
  const c = Math.cos(rot), s = Math.sin(rot);
  const T = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
  const p = (x, y) => T(x, y);
  const ops = [moveTo(...p(rx, 0))];
  const segs = [
    [[rx, ry * k], [rx * k, ry], [0, ry]],
    [[-rx * k, ry], [-rx, ry * k], [-rx, 0]],
    [[-rx, -ry * k], [-rx * k, -ry], [0, -ry]],
    [[rx * k, -ry], [rx, -ry * k], [rx, 0]],
  ];
  for (const [a, b, e] of segs) ops.push(appendBezierCurve(...p(...a), ...p(...b), ...p(...e)));
  ops.push(closePath(), stroke());
  return ops;
}

/** A flower: five petals around (cx, cy), the whole thing turned by `rot`. */
function flowerOps(cx, cy, rot) {
  const ops = [];
  for (let k = 0; k < 5; k++) {
    const a = rot + (k * 2 * Math.PI) / 5;
    ops.push(...ellipseOps(cx + 7 * Math.cos(a), cy + 7 * Math.sin(a), 6, 2.5, a));
  }
  return ops;
}

function boulderOps(x, y) {
  return [
    ...polyOps([[x, y], [x + 8, y], [x + 8, y + 8], [x, y + 8]], 'stroke'),
    moveTo(x, y), lineTo(x + 8, y + 8), stroke(),
    moveTo(x, y + 8), lineTo(x + 8, y), stroke(),
  ];
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

  // ------------------------------------------------------------ page 1
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

  // Sod C, a curved ring in two pieces with a narrow break, the way a bed
  // comes out when a label interrupts its hatch: the pieces are one area.
  const sector = (a0, a1) => {
    const pts = [];
    const rc = [800, 560], r0 = 60, r1 = 130;
    for (let i = 0; i <= 12; i++) { const a = a0 + ((a1 - a0) * i) / 12; pts.push([rc[0] + r1 * Math.cos(a), rc[1] + r1 * Math.sin(a)]); }
    for (let i = 12; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / 12; pts.push([rc[0] + r0 * Math.cos(a), rc[1] + r0 * Math.sin(a)]); }
    return pts;
  };
  const d2r = Math.PI / 180;
  truth.sodC_sqft = 0;
  for (const poly of [sector(0, 55 * d2r), sector(65 * d2r, 120 * d2r)]) {
    for (const [a, b] of hatchLines(poly, 45, 6)) page.pushOperators(moveTo(a[0], a[1]), lineTo(b[0], b[1]), stroke());
    truth.sodC_sqft += shoelace(poly) * FT_PER_PT ** 2;
  }

  // Mulch bed: filled and stroked polygon.
  const mulch = [[650, 120], [900, 140], [950, 300], [760, 380], [640, 260]];
  page.pushOperators(setFillingColor(rgb(0.85, 0.85, 0.85)), setLineWidth(0.75), ...polyOps(mulch, 'both'));
  truth.mulch_sqft = shoelace(mulch) * FT_PER_PT ** 2;

  // Bed outline: stroked, closed, not filled.
  const bed = [[520, 450], [640, 460], [660, 560], [560, 600], [500, 520]];
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

  // Trees: the XObject stamped 7 times upright and 3 times turned.
  const trees = Array.from({ length: 7 }, (_, i) => [940 + 34 * i, 100 + 30 * (i % 3)]);
  for (const [x, y] of trees) page.drawPage(tree, { x, y });
  for (const [x, y, a] of [[960, 200, 37], [1010, 215, 128], [1060, 200, 251]]) page.drawPage(tree, { x, y, rotate: degrees(a) });
  truth.tree_count = trees.length + 3;

  // Shrubs: a loose circle, 12 times.
  for (let i = 0; i < 12; i++) {
    page.drawCircle({ x: 1000 + 16 * i, y: 300, size: 5, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
  }
  truth.shrub_count = 12;

  // Boulders: a flattened block of three loose paths (square + two diagonals), 5 times.
  page.pushOperators(setLineWidth(0.5));
  for (let i = 0; i < 5; i++) page.pushOperators(...boulderOps(1000 + 30 * i, 380));
  truth.boulder_count = 5;

  // Flowers: five petals each, nine of them, each turned by its own angle.
  const flowers = Array.from({ length: 9 }, (_, i) => [1000 + 26 * (i % 5), 440 + 26 * Math.floor(i / 5), (i * 0.7) % (2 * Math.PI)]);
  for (const [x, y, rot] of flowers) page.pushOperators(...flowerOps(x, y, rot));
  truth.flower_count = flowers.length;

  // Legend: symbol, then its name just to the right. Its rows sit on other
  // baselines than the schedule's, which is one thing less for the parser.
  const LX = 1020, LY = 690;
  const legend = [
    { label: 'QV LIVE OAK', draw: (y) => page.drawPage(tree, { x: LX - 30, y: y - 15 }) },
    { label: 'SH SHRUB', draw: (y) => page.drawCircle({ x: LX - 15, y, size: 5, borderWidth: 0.5, borderColor: rgb(0, 0, 0) }) },
    { label: 'BO BOULDER', draw: (y) => page.pushOperators(setLineWidth(0.5), ...boulderOps(LX - 19, y - 4)) },
    { label: 'PF PURPLE FLOWER', draw: (y) => page.pushOperators(setLineWidth(0.5), ...flowerOps(LX - 16, y, 0.3)) },
    { label: 'SD SOD', draw: (y) => {
      const sw = [[LX - 32, y - 4], [LX - 5, y - 4], [LX - 5, y + 4], [LX - 32, y + 4]];
      page.pushOperators(setLineWidth(0.5), ...polyOps(sw, 'stroke'), setLineWidth(0.25));
      for (const [a, b] of hatchLines(sw, 45, 6)) page.pushOperators(moveTo(a[0], a[1]), lineTo(b[0], b[1]), stroke());
    } },
  ];
  legend.forEach((e, i) => {
    const y = LY - 34 * i;
    e.draw(y);
    page.drawText(e.label, { x: LX, y: y - 3, size: 8, font });
  });

  // Plant schedule: the designer's quantities, one deliberately off (shrubs).
  const schedule = [
    ['QV LIVE OAK', 'QUERCUS VIRGINIANA', '100 GAL.', truth.tree_count],
    ['SH SHRUB', 'ILEX VOMITORIA', '3 GAL.', truth.shrub_count + 2],
    ['BO BOULDER', 'FIELDSTONE', '24"', truth.boulder_count],
    ['PF PURPLE FLOWER', 'ECHINACEA PURPUREA', '1 GAL.', truth.flower_count],
  ];
  page.drawText('PLANT SCHEDULE', { x: 560, y: 760, size: 8, font });
  schedule.forEach((row, i) => {
    const y = 748 - 11 * i;
    page.drawText(row[0], { x: 560, y, size: 7, font });
    page.drawText(row[1], { x: 680, y, size: 7, font });
    page.drawText(row[2], { x: 800, y, size: 7, font });
    page.drawText(String(row[3]), { x: 880, y, size: 7, font });
  });
  truth.schedule = Object.fromEntries(schedule.map((r) => [r[0].slice(0, 2), r[3]]));

  // ------------------------------------------------------------ page 2
  // Stored portrait with /Rotate 90, so it displays landscape 17 x 11. Drawn
  // in display coordinates (u right, v up) mapped to the stored page:
  // x = W - v, y = u. Text is turned 90° so it reads left to right on screen.
  const W = 792;
  const p2 = doc.addPage([W, 1224]);
  p2.setRotation(degrees(90));
  const D = (u, v) => [W - v, u];
  const text2 = (s, u, v, size) => { const [x, y] = D(u, v); p2.drawText(s, { x, y, size, font, rotate: degrees(90) }); };
  const rect2 = (u0, v0, u1, v1, opts) => {
    const pts = [D(u0, v0), D(u1, v0), D(u1, v1), D(u0, v1)];
    p2.pushOperators(...(opts.fill ? [setFillingColor(rgb(0.2, 0.2, 0.2))] : []), setLineWidth(0.5), ...polyOps(pts, opts.fill ? 'both' : 'stroke'));
  };
  text2('PLANTING PLAN', 60, 740, 10);
  // Graphic scale bar: 0 to 20 ft over 72 pt (1" = 20'), two segments.
  text2('GRAPHIC SCALE', 100, 118, 7);
  rect2(100, 92, 172, 97, { fill: true });
  rect2(172, 92, 244, 97, { fill: false });
  for (const [v, u] of [[0, 100], [20, 172], [40, 244]]) text2(String(v), u - 2.5 * String(v).length, 101, 7);
  text2('(IN FEET)', 150, 80, 6);
  truth.page2_feetPerPoint = SCALE_FT_PER_IN / 72;
  // A filled rectangle, 144 x 72 pt: 40 x 20 ft.
  rect2(400, 300, 544, 372, { fill: true });
  truth.page2_rect_sqft = 144 * 72 * FT_PER_PT ** 2;
  // Four shrubs.
  for (let k = 0; k < 4; k++) { const [x, y] = D(700, 300 + 20 * k); p2.drawCircle({ x, y, size: 5, borderWidth: 0.5, borderColor: rgb(0, 0, 0) }); }
  truth.page2_shrub_count = 4;

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
