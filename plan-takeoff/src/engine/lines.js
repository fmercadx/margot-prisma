// Lengths from open polylines: edging, pipe, fence, curb.
//
// CAD exporters routinely split one polyline into a separate two-point path
// per segment, so pieces of the same style whose ends meet are chained back
// together first. A junction where three lines meet is left alone — joining
// through it would pick an arbitrary branch.
//
// The result is grouped by line style (width, colour, dashed), because on a
// plan the style is the legend: 1.5 pt solid black is edging, dashed is a
// sleeve, and so on. The estimator names the group once.

import { polylineLength } from './measure.js';

function styleKey(p) {
  return `${Math.round(p.lineWidth * 4) / 4}|${p.strokeColor}|${p.dash ? 'd' : 's'}`;
}

function ptKey([x, y]) {
  return `${Math.round(x * 20)},${Math.round(y * 20)}`;
}

function chain(pieces) {
  // endpoint key -> [{idx, end}] ; end 0 = first point, 1 = last point
  const ends = new Map();
  pieces.forEach((pc, idx) => {
    for (const end of [0, 1]) {
      const k = pc.style + '@' + ptKey(end ? pc.points[pc.points.length - 1] : pc.points[0]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ idx, end });
    }
  });
  const used = new Array(pieces.length).fill(false);
  const out = [];

  const next = (idx, end) => {
    const pc = pieces[idx];
    const k = pc.style + '@' + ptKey(end ? pc.points[pc.points.length - 1] : pc.points[0]);
    const here = ends.get(k) || [];
    if (here.length !== 2) return null; // free end, or a junction
    const other = here.find((h) => h.idx !== idx);
    return other && !used[other.idx] ? other : null;
  };

  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let points = pieces[i].points.slice();
    const pathIds = [pieces[i].pathId];
    // extend forward from the last point
    for (let cur = { idx: i, end: 1 }; ;) {
      const nx = next(cur.idx, cur.end);
      if (!nx) break;
      used[nx.idx] = true;
      pathIds.push(pieces[nx.idx].pathId);
      const pts = nx.end === 0 ? pieces[nx.idx].points : pieces[nx.idx].points.slice().reverse();
      points.push(...pts.slice(1));
      cur = { idx: nx.idx, end: nx.end === 0 ? 1 : 0 };
    }
    // extend backward from the first point
    for (let cur = { idx: i, end: 0 }; ;) {
      const nx = next(cur.idx, cur.end);
      if (!nx) break;
      used[nx.idx] = true;
      pathIds.unshift(pieces[nx.idx].pathId);
      const pts = nx.end === 1 ? pieces[nx.idx].points : pieces[nx.idx].points.slice().reverse();
      points = [...pts.slice(0, -1), ...points];
      cur = { idx: nx.idx, end: nx.end === 1 ? 0 : 1 };
    }
    out.push({ points, pathIds, style: pieces[i].style, lineWidth: pieces[i].lineWidth,
      color: pieces[i].color, dash: pieces[i].dash, layer: pieces[i].layer });
  }
  return out;
}

/**
 * @returns {LineGroup[]} sorted by total length descending.
 * LineGroup: { style, lineWidth, color, dash, count, total, items: [{points, pathIds, length}] }
 */
export function findLines(paths, consumed, { minLength = 6 } = {}) {
  const pieces = [];
  for (const p of paths) {
    if (consumed.has(p.id) || !p.stroke) continue;
    for (const sp of p.subpaths) {
      if (sp.closed || sp.points.length < 2) continue;
      pieces.push({ pathId: p.id, points: sp.points, style: styleKey(p), lineWidth: p.lineWidth,
        color: p.strokeColor, dash: p.dash, layer: p.layer });
    }
  }
  const items = chain(pieces)
    .map((c) => ({ ...c, length: polylineLength(c.points) }))
    .filter((c) => c.length >= minLength);

  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.style)) {
      groups.set(it.style, { style: it.style, lineWidth: it.lineWidth, color: it.color,
        dash: it.dash, count: 0, total: 0, items: [] });
    }
    const g = groups.get(it.style);
    g.count++;
    g.total += it.length;
    g.items.push(it);
  }
  const out = [...groups.values()];
  for (const g of out) g.items.sort((a, b) => b.length - a.length);
  out.sort((a, b) => b.total - a.total);
  return out;
}
