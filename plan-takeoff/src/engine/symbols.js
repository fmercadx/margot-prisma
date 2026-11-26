// Count repeated symbols.
//
// A plant symbol on a CAD export is the same geometry stamped at many places.
// So: describe each path by its shape relative to its own corner, rounded to
// half a point, and anything that appears twice or more is a symbol.
//
// Two complications, both handled here:
//
//  · A symbol is usually several paths — a circle and a cross, say. When the
//    exporter kept the CAD block as a form XObject, `paths.js` has already
//    tagged every path with the instance it came from and the whole instance
//    is fingerprinted as one unit. When the block was flattened into loose
//    paths, the parts are grouped separately at first and merged afterwards
//    if every instance of one sits at a constant offset from an instance of
//    the other ("co-location").
//
//  · Hatch lines of equal length look like a repeated symbol. A bare straight
//    segment never forms a symbol on its own; it can only join one as a part.
//
// Not handled: the same block placed mirrored, rotated or at another scale.
// Those count as different symbols. And the legend's own copy of a symbol
// counts as an instance, so a sheet with its legend on it over-counts by one.

import { bboxOf, bboxUnion, bboxCenter, bboxSize } from './measure.js';

const Q = 2; // quantisation: 1/Q point

function pathKey(path, origin) {
  const parts = [];
  for (const sp of path.subpaths) {
    const pts = sp.points.map(([x, y]) =>
      `${Math.round((x - origin[0]) * Q)},${Math.round((y - origin[1]) * Q)}`);
    parts.push((sp.closed ? 'c' : 'o') + pts.join(' '));
  }
  return (path.fill ? 'F' : '') + (path.stroke ? 'S' : '') + '|' + parts.join('|');
}

function isBareSegment(path) {
  return path.subpaths.length === 1 && path.subpaths[0].points.length === 2
    && !path.subpaths[0].closed && !path.fill;
}

function unitFromPaths(ps) {
  let bbox = ps[0].bbox;
  for (let i = 1; i < ps.length; i++) bbox = bboxUnion(bbox, ps[i].bbox);
  const origin = [bbox[0], bbox[1]];
  const key = ps.map((p) => pathKey(p, origin)).sort().join('#');
  return {
    pathIds: ps.map((p) => p.id),
    bbox,
    center: bboxCenter(bbox),
    key,
    bare: ps.length === 1 && isBareSegment(ps[0]),
  };
}

/**
 * @returns {Symbol[]} sorted by count, descending.
 * Symbol: { key, count, parts, size: [w, h], instances: [{center, bbox, pathIds}] }
 */
export function findSymbols(paths, { minSize = 1.5, maxSize = 144, minCount = 2 } = {}) {
  // 1. Units: one per XObject instance, one per loose path.
  const byXObject = new Map();
  const units = [];
  for (const p of paths) {
    if (p.xobject != null) {
      if (!byXObject.has(p.xobject)) byXObject.set(p.xobject, []);
      byXObject.get(p.xobject).push(p);
    } else {
      units.push(unitFromPaths([p]));
    }
  }
  for (const ps of byXObject.values()) units.push(unitFromPaths(ps));

  // 2. Size filter: symbols are small; a border or a bed outline is not one.
  const fits = (b) => {
    const [w, h] = bboxSize(b);
    return w <= maxSize && h <= maxSize && (w >= minSize || h >= minSize);
  };
  const groups = new Map();
  for (const u of units) {
    if (!fits(u.bbox)) continue;
    if (!groups.has(u.key)) groups.set(u.key, []);
    groups.get(u.key).push(u);
  }

  // 3. Candidate groups: repeated at least minCount times.
  let cands = [];
  for (const [key, insts] of groups) {
    if (insts.length < minCount) continue;
    cands.push({
      key,
      bare: insts[0].bare,
      instances: insts.map((u) => ({ center: u.center, bbox: u.bbox, pathIds: u.pathIds.slice() })),
      area: bboxSize(insts[0].bbox).reduce((a, b) => a * b, 1),
    });
  }
  // Bigger shapes anchor; parts attach to them.
  cands.sort((a, b) => b.area - a.area);

  // 4. Co-location merge for flattened multi-path symbols.
  const TOL = 0.3;
  const merged = new Set();
  for (let i = 0; i < cands.length; i++) {
    if (merged.has(i)) continue;
    const A = cands[i];
    for (let j = i + 1; j < cands.length; j++) {
      if (merged.has(j)) continue;
      const B = cands[j];
      if (B.instances.length !== A.instances.length) continue;
      // Pair each A instance with its nearest B instance; offsets must agree.
      const used = new Set();
      let offset = null, ok = true;
      const pairs = [];
      for (const a of A.instances) {
        let best = -1, bestD = Infinity;
        B.instances.forEach((b, k) => {
          if (used.has(k)) return;
          const d = Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1]);
          if (d < bestD) { bestD = d; best = k; }
        });
        if (best < 0) { ok = false; break; }
        const b = B.instances[best];
        const off = [b.center[0] - a.center[0], b.center[1] - a.center[1]];
        if (offset === null) offset = off;
        else if (Math.abs(off[0] - offset[0]) > TOL || Math.abs(off[1] - offset[1]) > TOL) { ok = false; break; }
        // A part must overlap or touch the anchor's footprint, with some slack.
        const [aw, ah] = bboxSize(a.bbox);
        if (Math.abs(off[0]) > aw + 4 || Math.abs(off[1]) > ah + 4) { ok = false; break; }
        used.add(best);
        pairs.push([a, b]);
      }
      if (!ok) continue;
      for (const [a, b] of pairs) {
        a.pathIds.push(...b.pathIds);
        a.bbox = bboxUnion(a.bbox, b.bbox);
      }
      merged.add(j);
    }
  }

  // 5. Bare segments that found no anchor are not symbols.
  const out = [];
  cands.forEach((c, i) => {
    if (merged.has(i) || c.bare) return;
    const parts = c.instances[0].pathIds.length;
    let bbox = c.instances[0].bbox;
    for (const inst of c.instances) inst.center = bboxCenter(inst.bbox);
    out.push({
      key: c.key,
      count: c.instances.length,
      parts,
      size: bboxSize(bbox),
      instances: c.instances,
    });
  });
  out.sort((a, b) => b.count - a.count);
  return out;
}

export { bboxOf };
