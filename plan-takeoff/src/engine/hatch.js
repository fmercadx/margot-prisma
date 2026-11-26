// Area from hatching.
//
// Sod, mulch, gravel and pavers are often shown as a field of parallel lines
// with no boundary polygon of their own, so there is nothing to run the
// shoelace formula on. But each hatch line stands for a strip one spacing
// wide, so the area of a hatched region is the sum of its line lengths times
// the spacing. On a synthetic test sheet that is within a fraction of a
// percent; the error is the half-strip at either edge.
//
// Lines are binned by angle, sorted by their perpendicular offset, and joined
// to their nearest overlapping neighbour when that neighbour is about one
// spacing away. Two regions hatched at the same angle stay separate because
// the gap between them is larger than the spacing on at least one side.

import { dist, bboxOf } from './measure.js';

/**
 * @param {Path[]} paths
 * @param {Set<number>} consumed  path ids already claimed by symbols
 * @returns {Hatch[]} sorted by area descending.
 * Hatch: { angle, spacing, count, area, lineIds, bbox }
 */
export function findHatch(paths, consumed, { minLines = 6, maxGap = 40 } = {}) {
  const segs = [];
  for (const p of paths) {
    if (consumed.has(p.id) || !p.stroke || p.fill || p.subpaths.length !== 1) continue;
    const sp = p.subpaths[0];
    if (sp.closed || sp.points.length !== 2) continue;
    const [a, b] = sp.points;
    const len = dist(a, b);
    if (len < 0.5) continue;
    let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    ang = ((ang % 180) + 180) % 180;
    segs.push({ id: p.id, a, b, len, ang });
  }

  const bins = new Map();
  for (const s of segs) {
    const k = Math.round(s.ang) % 180;
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(s);
  }

  const regions = [];
  for (const [k, lines] of bins) {
    if (lines.length < minLines) continue;
    const th = (k * Math.PI) / 180;
    const d = [Math.cos(th), Math.sin(th)];
    const n = [-d[1], d[0]];
    for (const l of lines) {
      l.off = l.a[0] * n[0] + l.a[1] * n[1];
      const s0 = l.a[0] * d[0] + l.a[1] * d[1];
      const s1 = l.b[0] * d[0] + l.b[1] * d[1];
      l.s0 = Math.min(s0, s1);
      l.s1 = Math.max(s0, s1);
    }
    lines.sort((p, q) => p.off - q.off);

    const overlaps = (p, q) => !(q.s1 < p.s0 || q.s0 > p.s1);

    // Nearest overlapping neighbour in each direction.
    const fwd = new Array(lines.length).fill(null);
    const bwd = new Array(lines.length).fill(null);
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const gap = lines[j].off - lines[i].off;
        if (gap > maxGap) break;
        if (gap < 0.3 || !overlaps(lines[i], lines[j])) continue;
        fwd[i] = { j, gap };
        if (bwd[j] === null || gap < bwd[j].gap) bwd[j] = { i, gap };
        break;
      }
    }

    const parent = lines.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i, j) => { parent[find(i)] = find(j); };
    const usedGap = new Array(lines.length).fill(null);

    for (let i = 0; i < lines.length; i++) {
      const f = fwd[i];
      if (!f) continue;
      const local = Math.min(f.gap, bwd[i] ? bwd[i].gap : Infinity);
      if (f.gap <= 1.5 * local) { union(i, f.j); usedGap[i] = f.gap; }
    }
    // Collinear pieces of one hatch line (a dashed export) share an offset.
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].off - lines[i - 1].off < 0.3
          && lines[i].s0 <= lines[i - 1].s1 + 1 && lines[i - 1].s0 <= lines[i].s1 + 1) {
        union(i - 1, i);
      }
    }

    const groups = new Map();
    lines.forEach((_, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    });
    for (const idx of groups.values()) {
      if (idx.length < minLines) continue;
      const gaps = idx.map((i) => usedGap[i]).filter((g) => g != null).sort((a, b) => a - b);
      if (!gaps.length) continue;
      const spacing = gaps[Math.floor(gaps.length / 2)];
      const members = idx.map((i) => lines[i]);
      const total = members.reduce((s, l) => s + l.len, 0);
      regions.push({
        angle: k,
        spacing,
        count: members.length,
        area: total * spacing,
        lineIds: members.map((m) => m.id),
        bbox: bboxOf(members.flatMap((m) => [m.a, m.b])),
      });
    }
  }
  regions.sort((a, b) => b.area - a.area);
  return regions;
}
