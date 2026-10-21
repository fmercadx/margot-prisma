// Areas from closed shapes: a filled bed, a stroked outline, a paver field
// drawn as a polygon. Shoelace on every closed subpath. Holes drawn with the
// opposite winding subtract, which is what a filled path with a cut-out means.
//
// The sheet border and the viewport frame are closed rectangles too; anything
// covering most of the page is dropped. The title block survives this filter
// and shows up as an outlined area — the estimator unticks it.

import { polygonArea, polylineLength, bboxSize } from './measure.js';

/**
 * @param {Path[]} paths
 * @param {Set<number>} consumed
 * @param {{pageBbox: number[], minArea?: number, maxPageFraction?: number}} opts
 * @returns {Region[]} sorted by area descending.
 * Region: { pathId, area, perimeter, fill, stroke, lineWidth, bbox, polygons, isRect }
 */
export function findRegions(paths, consumed, { pageBbox, minArea = 100, maxPageFraction = 0.7 }) {
  const [pw, ph] = bboxSize(pageBbox);
  const pageArea = pw * ph;
  const out = [];
  for (const p of paths) {
    if (consumed.has(p.id)) continue;
    const rings = p.subpaths.filter((sp) => sp.points.length >= 3 && (sp.closed || p.fill));
    if (!rings.length) continue;
    let signed = 0, perimeter = 0;
    for (const sp of rings) {
      signed += polygonArea(sp.points);
      perimeter += polylineLength([...sp.points, sp.points[0]]);
    }
    const area = Math.abs(signed);
    if (area < minArea) continue;
    const [bw, bh] = bboxSize(p.bbox);
    if (bw * bh > maxPageFraction * pageArea) continue;
    const isRect = rings.length === 1 && isAxisRect(rings[0].points);
    out.push({
      pathId: p.id,
      area,
      perimeter,
      fill: p.fill,
      stroke: p.stroke,
      lineWidth: p.lineWidth,
      bbox: p.bbox,
      polygons: rings.map((r) => r.points),
      isRect,
      layer: p.layer,
    });
  }
  out.sort((a, b) => b.area - a.area);
  return out;
}

function isAxisRect(pts) {
  const p = pts[pts.length - 1][0] === pts[0][0] && pts[pts.length - 1][1] === pts[0][1]
    ? pts.slice(0, -1) : pts;
  if (p.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 0.01 && Math.abs(a[1] - b[1]) > 0.01) return false;
  }
  return true;
}
