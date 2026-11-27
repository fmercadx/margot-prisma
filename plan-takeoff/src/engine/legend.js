// Read the legend, then count and measure by it.
//
// A planting sheet's legend is a column of small symbols, each with its name
// to the right. On a CAD export the symbols are vector paths and the names
// are text, so the legend can be read: a line of text that reads like a name,
// with a compact group of small paths just to its left, is a legend entry.
//
// An entry is one of three kinds:
//
//   symbol   a plant symbol: counted on the plan. Its parts are matched by
//            rotation-invariant signature (`signature.js`), and an instance
//            is an anchor part with the symbol's other parts around it, so a
//            lone circle that happens to be the same size is not a plant.
//   hatch    a swatch of parallel lines: names hatched areas by angle and
//            spacing (`hatch.js`).
//   pattern  a swatch of repeated small motifs (triangles, bricks, crosses):
//            the area on the plan is estimated from how many motifs it has
//            compared with the swatch, times the swatch's area.
//
// Legend copies are excluded from the counts.

import { bboxSize, bboxCenter, bboxUnion, dist } from './measure.js';

const CODE = /^[A-Z]{1,3}$/;
// Section headers and column headings a plant legend carries; none names a symbol.
const HEADER = /^(?:palms?|shrubs?|trees?|canopy trees?|groundcovers?|ground covers?|perennials?|grasses|vines|annuals|sod|legend|symbols?|sym|key|notes?|schedule|qty|quantity|size|remarks|comments|description|common name|botanical name|species|container)$/i;
const isBare = (p) => p.subpaths.length === 1 && p.subpaths[0].points.length === 2 && !p.fill;
const segLen = (p) => dist(p.subpaths[0].points[0], p.subpaths[0].points[1]);

/** Parallel bare segments → {angle, spacing}; else null. */
function hatchOf(tmpl) {
  const segs = tmpl.filter(isBare);
  if (segs.length < 3 || segs.length < tmpl.length - 4) return null;
  const angleOf = (p) => {
    const [a, b] = p.subpaths[0].points;
    const d = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    return Math.round(((d % 180) + 180) % 180) % 180;
  };
  // The hatch direction is the one carrying the most line length: a brick
  // swatch has many short ticks across its few long courses.
  const bins = new Map();
  for (const p of segs) {
    const k = angleOf(p);
    const b = bins.get(k) || { n: 0, len: 0 };
    b.n++; b.len += segLen(p);
    bins.set(k, b);
  }
  const [angle, b] = [...bins.entries()].sort((p, q) => q[1].len - p[1].len)[0];
  if (b.n < 3) return null;
  const th = (angle * Math.PI) / 180;
  const nx = -Math.sin(th), ny = Math.cos(th);
  const offs = segs.filter((p) => angleOf(p) === angle)
    .map((p) => p.subpaths[0].points[0][0] * nx + p.subpaths[0].points[0][1] * ny).sort((a, c) => a - c);
  const gaps = [];
  for (let i = 1; i < offs.length; i++) if (offs[i] - offs[i - 1] > 0.3) gaps.push(offs[i] - offs[i - 1]);
  if (!gaps.length) return null;
  gaps.sort((a, c) => a - c);
  return { angle, spacing: gaps[Math.floor(gaps.length / 2)] };
}

/** A swatch of repeated small motifs, wider than tall. */
function isPattern(tmpl, bbox) {
  const [w, h] = bboxSize(bbox);
  if (tmpl.length < 6 || w < 1.8 * h) return false;
  const smallParts = tmpl.filter((p) => Math.max(...bboxSize(p.bbox)) <= Math.max(10, h));
  return smallParts.length >= 0.6 * tmpl.length;
}

/**
 * @param {Path[]} paths
 * @param {Line[]} lines      from textLines
 * @param {(p: Path) => string} sigOf
 * @returns {Entry[]}
 * Entry: { label, code, kind, bbox, pathIds, parts: Map<sig, m>, angle?, spacing? }
 */
export function findLegend(paths, lines, sigOf, { maxGap = 40, maxSize = 60 } = {}) {
  const freq = new Map();
  const small = [];
  for (const p of paths) {
    const [w, h] = bboxSize(p.bbox);
    if (w > maxSize || h > maxSize) continue;
    small.push(p);
    const s = sigOf(p);
    freq.set(s, (freq.get(s) || 0) + 1);
  }

  // A legend label is a short name, not a sentence from the notes and not a
  // callout on the plan ("(16) GENISTA ..."): few words, real letters, no
  // clause punctuation, not a line of a paragraph.
  const labelLines = lines.filter((ln, i) => {
    const s = ln.str;
    if (!/[A-WYZa-wyz]{3}/.test(s) || /^\(?\d+\)?/.test(s) || /\d$/.test(s)) return false;
    if (!/^[A-Za-z('"“]/.test(s) || /www\.|\.com\b|@/i.test(s) || HEADER.test(s.trim())) return false;
    if (s.split(/\s+/).length > 8 || /[,;:]/.test(s) || /\b(and|the|for|with|shall|be|of|to)\b/i.test(s)) return false;
    const above = lines[i - 1], below = lines[i + 1];
    const para = above && below && Math.abs(above.x0 - ln.x0) < 2 && Math.abs(below.x0 - ln.x0) < 2
      && above.y - ln.y < 1.6 * ln.h && ln.y - below.y < 1.6 * ln.h && above.str.length > 25 && below.str.length > 25;
    return !para;
  });

  const touches = (a, b, t) => !(a[2] + t < b[0] || b[2] + t < a[0] || a[3] + t < b[1] || b[3] + t < a[1]);
  const contains = (outer, b, t) => b[0] >= outer[0] - t && b[2] <= outer[2] + t && b[1] >= outer[1] - t && b[3] <= outer[3] + t;

  const entries = [];
  const used = new Set();
  for (const best of labelLines) {
    if (used.has(best)) continue;
    const cy = best.y + 0.5 * best.h;
    const wx0 = best.x0 - maxGap - maxSize, wx1 = best.x0 + 1;
    // Candidates: small paths left of the label, within a symbol's height of its line.
    const band = small.filter((p) => {
      const [px0, py0, px1, py1] = p.bbox;
      if (px1 > wx1 || px0 < wx0) return false;
      if (isBare(p) && Math.max(px1 - px0, py1 - py0) > 20) return false; // underline, leader
      return Math.abs((py0 + py1) / 2 - cy) <= maxSize / 2 + 2;
    });
    // The seed: on the label's own line, nearest to it.
    const online = band.filter((p) => Math.abs((p.bbox[1] + p.bbox[3]) / 2 - cy) <= 0.75 * best.h + 3);
    if (!online.length) continue;
    const seed = online.reduce((a, b) => (b.bbox[2] > a.bbox[2] ? b : a));
    if (best.x0 - seed.bbox[2] > maxGap) continue;
    // The symbol: what the seed is connected to, then what lies inside that.
    const tmpl = [seed];
    let bbox = seed.bbox;
    const inTmpl = new Set([seed.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of band) {
        if (inTmpl.has(p.id) || !touches(bbox, p.bbox, 2)) continue;
        const nb = bboxUnion(bbox, p.bbox);
        if (nb[2] - nb[0] > maxSize || nb[3] - nb[1] > maxSize) continue;
        tmpl.push(p); inTmpl.add(p.id); bbox = nb; grew = true;
      }
    }
    for (const p of band) {
      if (!inTmpl.has(p.id) && contains(bbox, p.bbox, 1)) { tmpl.push(p); inTmpl.add(p.id); }
    }
    // Alone: nothing else small within 3 pt of it. A legend is spaced out;
    // a symbol on the plan sits among other things.
    if (small.some((p) => !inTmpl.has(p.id) && touches(bbox, p.bbox, 3))) continue;
    const sigs = tmpl.map(sigOf);

    let kind = 'symbol', hatch = null;
    if (isPattern(tmpl, bbox)) kind = 'pattern';
    else if ((hatch = hatchOf(tmpl))) kind = 'hatch';
    else {
      // A plant symbol has a closed shape, a curve or a polyline with turns in it; a few stray strokes do not.
      if (!tmpl.some((p) => p.hasCurves || p.fill || p.subpaths.some((s) => s.closed || s.points.length >= 4))) continue;
      // A one-word label on a one-path, straight-edged shape is a table cell, not a plant.
      if (!/\s/.test(best.str) && best.str.length <= 4 && tmpl.length === 1 && !tmpl[0].hasCurves) continue;
      // Its parts must recur elsewhere, or it is a one-off (a north arrow with a label).
      if (!sigs.some((s) => freq.get(s) >= 3)) continue;
    }
    let label = best.str;
    // A second line of the same label, directly below and left-aligned.
    const below = labelLines.find((ln) => ln !== best && Math.abs(ln.x0 - best.x0) < 3
      && best.y - ln.y > 0.6 * best.h && best.y - ln.y < 1.6 * best.h);
    if (below && !used.has(below)) { label += ' ' + below.str; used.add(below); }
    used.add(best);

    const parts = new Map();
    for (const s of sigs) parts.set(s, (parts.get(s) || 0) + 1);
    const m = label.match(/^([A-Z]{1,3})\s+(.+)$/);
    entries.push({
      label,
      code: m && CODE.test(m[1]) ? m[1] : null,
      kind,
      bbox,
      pathIds: tmpl.map((p) => p.id),
      parts,
      ...(hatch || {}),
    });
  }
  return entries;
}

/**
 * Count each legend symbol on the sheet, and estimate each pattern's area.
 * @returns {Named[]}
 * Named (symbol):  { kind:'symbol', label, code, count, estimates, pathIds, centers, template }
 * Named (pattern): { kind:'pattern', label, code, area (pt²), motifs, pathIds, template }
 */
export function countByLegend(entries, paths, sigOf, { pageArea = Infinity } = {}) {
  const templated = entries.filter((e) => e.kind !== 'hatch');
  if (!templated.length) return [];
  const owners = new Map();
  for (const e of templated) for (const s of e.parts.keys()) owners.set(s, (owners.get(s) || 0) + 1);
  const inLegend = (p) => entries.some((e) => p.bbox[0] >= e.bbox[0] - 2 && p.bbox[2] <= e.bbox[2] + 2
    && p.bbox[1] >= e.bbox[1] - 2 && p.bbox[3] <= e.bbox[3] + 2);
  const bySig = new Map();
  for (const p of paths) {
    const [w, h] = bboxSize(p.bbox);
    if (w > 96 || h > 96) continue;
    const s = sigOf(p);
    if (!owners.has(s) || inLegend(p)) continue;
    if (!bySig.has(s)) bySig.set(s, []);
    bySig.get(s).push(p);
  }

  const out = [];
  for (const e of templated) {
    const [tw, th] = bboxSize(e.bbox);
    if (e.kind === 'pattern') {
      // Motifs on the plan versus motifs in the swatch. A motif drawn as a
      // short stroke matches every hatch line of that length on the sheet,
      // and the estimate then outgrows the sheet: that one is not reported.
      const est = [...e.parts].map(([sig, m]) => ({ sig, m, n: (bySig.get(sig) || []).length, specific: owners.get(sig) === 1 }));
      const pick = est.filter((x) => x.specific).sort((a, b) => b.m - a.m)[0] || est.sort((a, b) => b.m - a.m)[0];
      let area = pick ? (pick.n / pick.m) * tw * th : null;
      if (area != null && area > 0.25 * pageArea) area = null;
      out.push({
        kind: 'pattern', label: e.label, code: e.code,
        area, motifs: pick ? pick.n : 0,
        pathIds: pick ? (bySig.get(pick.sig) || []).map((p) => p.id) : [],
        template: { bbox: e.bbox, pathIds: e.pathIds },
      });
      continue;
    }
    // Parts the plan actually carries agree on a count; a part the legend
    // drawing has and the plan does not (a trunk mark, a flourish) does not.
    // The anchor is a single-copy part whose estimate sits at that consensus.
    const parts = [...e.parts].map(([sig, m]) => ({ sig, m, n: (bySig.get(sig) || []).length, specific: owners.get(sig) === 1 }));
    const present = parts.filter((x) => x.n > 0);
    if (!present.length) continue;
    const ests = present.map((x) => x.n / x.m).sort((a, b) => a - b);
    const med = ests[Math.floor(ests.length / 2)];
    const core = present.filter((x) => Math.abs(x.n / x.m - med) <= 0.4 * med + 1);
    const anchor = core.slice().sort((a, b) => (a.m - b.m) || (b.specific - a.specific)
      || Math.abs(a.n / a.m - med) - Math.abs(b.n / b.m - med))[0];
    const reach = Math.hypot(tw, th) / 2 + 2;
    const others = core.filter((x) => x !== anchor);
    const needed = others.reduce((s, x) => s + x.m, 0);
    // Every other part goes to its nearest anchor within reach, so two
    // symbols drawn close together do not rob each other.
    const anchors = (bySig.get(anchor.sig) || []).map((p) => ({ p, c: bboxCenter(p.bbox), members: [p], found: 0 }));
    const cell = Math.max(reach, 1), grid = new Map();
    anchors.forEach((a, i) => {
      const k = `${Math.floor(a.c[0] / cell)},${Math.floor(a.c[1] / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const anchorIds = new Set(anchors.map((a) => a.p.id));
    for (const o of others) {
      const taken = new Map(); // anchor index → parts of this sig taken so far
      for (const p of bySig.get(o.sig) || []) {
        if (anchorIds.has(p.id)) continue;
        const c = bboxCenter(p.bbox);
        const gx = Math.floor(c[0] / cell), gy = Math.floor(c[1] / cell);
        let best = -1, bestD = reach;
        for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) {
          for (const i of grid.get(`${x},${y}`) || []) {
            if ((taken.get(i) || 0) >= o.m) continue;
            const d = dist(c, anchors[i].c);
            if (d <= bestD) { bestD = d; best = i; }
          }
        }
        if (best < 0) continue;
        taken.set(best, (taken.get(best) || 0) + 1);
        anchors[best].members.push(p);
        anchors[best].found++;
      }
    }
    const centers = [];
    const pathIds = [];
    let instances = 0;
    for (const a of anchors) {
      // At least half the other core parts must be there; a one-part symbol has none to check.
      if (needed && a.found < Math.ceil(needed / 2)) continue;
      for (const p of a.members) pathIds.push(p.id);
      instances++;
      centers.push(a.c);
    }
    // An anchor used m times per symbol was counted m times.
    const count = Math.round(instances / anchor.m);
    if (count < 1) continue;
    out.push({
      kind: 'symbol', label: e.label, code: e.code, count,
      estimates: parts.map((x) => ({ sig: x.sig, n: x.n, m: x.m, estimate: x.n / x.m, specific: x.specific })),
      pathIds, centers: centers.slice(0, Math.max(count, 1) * anchor.m),
      template: { bbox: e.bbox, pathIds: e.pathIds },
    });
  }
  out.sort((a, b) => (b.count || 0) - (a.count || 0));
  return out;
}
