// Count repeated symbols.
//
// Two steps. First, loose paths that touch or overlap are clustered into
// units, so a circle with a cross, or a flower of five petals, is one thing.
// A CAD block kept as a form XObject is already one unit. Second, each unit
// is keyed by the multiset of its parts' rotation-invariant signatures
// (`signature.js`), so copies placed at any angle match, and units with the
// same key are one symbol.
//
// Clustering by touch has a known failure: in a massed planting the symbols
// overlap each other and chain into blobs. The legend-driven count in
// `legend.js` does not depend on it; this is the fallback for a sheet with no
// legend, and the source of the "other repeated shapes" list.
//
// The legend's own copy of a symbol still counts as an instance here; the
// legend pass excludes it when it can.

import { bboxUnion, bboxCenter, bboxSize } from './measure.js';
import { pathSignature } from './signature.js';

const MAX_UNIT = 96; // pt; a plant symbol or a small block, never a bed

function isBareSegment(path) {
  return path.subpaths.length === 1 && path.subpaths[0].points.length === 2
    && !path.subpaths[0].closed && !path.fill;
}

function makeUnit(ps, sigOf) {
  let bbox = ps[0].bbox;
  for (let i = 1; i < ps.length; i++) bbox = bboxUnion(bbox, ps[i].bbox);
  const sigs = ps.map((p) => sigOf(p)).sort();
  const [w, h] = bboxSize(bbox);
  return {
    pathIds: ps.map((p) => p.id),
    paths: ps,
    bbox,
    center: bboxCenter(bbox),
    key: sigs.join('#'),
    sigs,
    size: [w, h],
    bare: ps.every(isBareSegment),
  };
}

/**
 * Cluster paths into symbol-sized units. XObject instances small enough are
 * units as drawn; everything else is clustered by bounding-box contact.
 * @returns {{units: Unit[], sigOf: (p: Path) => string}}
 */
export function clusterUnits(paths, { maxUnit = MAX_UNIT, touch = 0.75 } = {}) {
  const sigCache = new Map();
  const sigOf = (p) => {
    let s = sigCache.get(p.id);
    if (s === undefined) { s = pathSignature(p); sigCache.set(p.id, s); }
    return s;
  };

  const units = [];
  const loose = [];
  const byX = new Map();
  for (const p of paths) {
    const [w, h] = bboxSize(p.bbox);
    if (w > maxUnit || h > maxUnit) { continue; }
    if (p.xobject != null) {
      if (!byX.has(p.xobject)) byX.set(p.xobject, []);
      byX.get(p.xobject).push(p);
    } else {
      loose.push(p);
    }
  }
  for (const ps of byX.values()) {
    const u = makeUnit(ps, sigOf);
    if (u.size[0] <= maxUnit && u.size[1] <= maxUnit) units.push(u);
    else loose.push(...ps);
  }

  // Grid index over loose paths for neighbour lookup.
  const cell = 16;
  const grid = new Map();
  const cellsOf = (b) => {
    const out = [];
    for (let gx = Math.floor((b[0] - touch) / cell); gx <= Math.floor((b[2] + touch) / cell); gx++) {
      for (let gy = Math.floor((b[1] - touch) / cell); gy <= Math.floor((b[3] + touch) / cell); gy++) {
        out.push(gx + ',' + gy);
      }
    }
    return out;
  };
  loose.forEach((p, i) => {
    for (const c of cellsOf(p.bbox)) {
      if (!grid.has(c)) grid.set(c, []);
      grid.get(c).push(i);
    }
  });
  const parent = loose.map((_, i) => i);
  const cbox = loose.map((p) => p.bbox.slice());
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touches = (a, b) => !(a[2] + touch < b[0] || b[2] + touch < a[0] || a[3] + touch < b[1] || b[3] + touch < a[1]);

  for (let i = 0; i < loose.length; i++) {
    const seen = new Set();
    for (const c of cellsOf(loose[i].bbox)) {
      for (const j of grid.get(c)) {
        if (j <= i || seen.has(j)) continue;
        seen.add(j);
        if (!touches(loose[i].bbox, loose[j].bbox)) continue;
        const ri = find(i), rj = find(j);
        if (ri === rj) continue;
        const merged = bboxUnion(cbox[ri], cbox[rj]);
        const [w, h] = bboxSize(merged);
        if (w > maxUnit || h > maxUnit) continue;
        parent[rj] = ri;
        cbox[ri] = merged;
      }
    }
  }
  const groups = new Map();
  loose.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });
  for (const ps of groups.values()) units.push(makeUnit(ps, sigOf));
  return { units, sigOf };
}

/**
 * Symbols: shapes that repeat. Each loose path is its own unit here (a petal,
 * a circle, a cross), and a small XObject instance is one unit; clustering by
 * touch is not used because on a real sheet a symbol drawn inside a hatched
 * bed touches the hatch lines. A symbol made of several loose parts shows as
 * several groups; `legend.js` resolves that where there is a legend.
 *
 * @returns {Symbol[]} sorted by count, descending.
 * Symbol: { key, sigs, count, parts, size, minor, instances: [{center, bbox, pathIds}] }
 */
export function findSymbols(paths, { minSize = 1.5, minCount = 2, maxUnit = MAX_UNIT, sigOf: sigIn } = {}) {
  const sigCache = new Map();
  const sigOf = sigIn || ((p) => {
    let s = sigCache.get(p.id);
    if (s === undefined) { s = pathSignature(p); sigCache.set(p.id, s); }
    return s;
  });
  const units = [];
  const byX = new Map();
  for (const p of paths) {
    const [w, h] = bboxSize(p.bbox);
    if (w > maxUnit || h > maxUnit) continue;
    if (p.xobject != null) {
      if (!byX.has(p.xobject)) byX.set(p.xobject, []);
      byX.get(p.xobject).push(p);
    } else if (!isBareSegment(p)) {
      units.push(makeUnit([p], sigOf));
    }
  }
  for (const ps of byX.values()) {
    const u = makeUnit(ps, sigOf);
    if (u.size[0] <= maxUnit && u.size[1] <= maxUnit) units.push(u);
  }
  const groups = new Map();
  for (const u of units) {
    if (u.size[0] < minSize && u.size[1] < minSize) continue;
    if (!groups.has(u.key)) groups.set(u.key, []);
    groups.get(u.key).push(u);
  }
  const out = [];
  for (const [key, insts] of groups) {
    if (insts.length < minCount) continue;
    const size = insts[0].size;
    out.push({
      key,
      sigs: insts[0].sigs,
      count: insts.length,
      parts: insts[0].paths.length,
      size,
      // Too small to be a plant symbol: dash pieces, dots, tick marks.
      minor: Math.max(size[0], size[1]) < 3,
      instances: insts.map((u) => ({ center: u.center, bbox: u.bbox, pathIds: u.pathIds.slice() })),
    });
  }
  mergeCoLocated(out);
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * A symbol flattened into loose parts shows as several groups with about the
 * same count. When nearly every instance of one group has an instance of the
 * other within reach, and the other way round, they are parts of one symbol.
 * Reach is the larger part's size, so this holds for rotated copies too.
 */
function mergeCoLocated(symbols) {
  symbols.sort((a, b) => (b.size[0] * b.size[1]) - (a.size[0] * a.size[1]));
  const gone = new Set();
  const nearestIndex = (s) => {
    const cell = 8, grid = new Map();
    s.instances.forEach((inst, i) => {
      const k = `${Math.floor(inst.center[0] / cell)},${Math.floor(inst.center[1] / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    return (pt, reach) => {
      let best = -1, bestD = reach;
      const r = Math.ceil(reach / cell);
      const gx = Math.floor(pt[0] / cell), gy = Math.floor(pt[1] / cell);
      for (let x = gx - r; x <= gx + r; x++) for (let y = gy - r; y <= gy + r; y++) {
        for (const i of grid.get(`${x},${y}`) || []) {
          const c = s.instances[i].center;
          const d = Math.hypot(c[0] - pt[0], c[1] - pt[1]);
          if (d <= bestD) { bestD = d; best = i; }
        }
      }
      return best;
    };
  };
  for (let i = 0; i < symbols.length; i++) {
    if (gone.has(i) || symbols[i].minor) continue;
    const A = symbols[i];
    const reach = Math.max(A.size[0], A.size[1]) * 0.75 + 1;
    for (let j = i + 1; j < symbols.length; j++) {
      if (gone.has(j) || symbols[j].minor) continue;
      const B = symbols[j];
      if (Math.abs(A.count - B.count) > Math.max(1, 0.2 * A.count)) continue;
      const findB = nearestIndex(B), findA = nearestIndex(A);
      const used = new Set();
      const pairs = [];
      for (const a of A.instances) {
        const k = findB(a.center, reach);
        if (k >= 0 && !used.has(k)) { used.add(k); pairs.push([a, B.instances[k]]); }
      }
      let back = 0;
      for (const b of B.instances) if (findA(b.center, reach) >= 0) back++;
      if (pairs.length < 0.85 * A.count || back < 0.85 * B.count) continue;
      for (const [a, b] of pairs) a.pathIds.push(...b.pathIds);
      A.parts += B.parts;
      A.sigs = A.sigs.concat(B.sigs);
      A.key += '+' + B.key;
      gone.add(j);
    }
  }
  for (let j = symbols.length - 1; j >= 0; j--) if (gone.has(j)) symbols.splice(j, 1);
}
