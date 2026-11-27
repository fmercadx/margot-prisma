// One page in, quantities out. Pure: no DOM, no pdf.js import.
//
// Classification runs in a fixed order and each stage claims the paths it
// explains, so a hatch line is never also a "line", and a symbol's circle is
// never also an "area":
//
//   legend symbols  →  other repeated symbols  →  hatch  →  closed regions  →  open lines
//
// Every quantity is in PDF points (count, pt², pt). The caller multiplies by
// the scale, which can change after the fact when the estimator calibrates.

import { extractPaths } from './paths.js';
import { textRows, textLines } from './text.js';
import { detectScales, isNotToScale } from './scale.js';
import { detectScaleBar } from './scalebar.js';
import { pathSignature } from './signature.js';
import { findSymbols } from './symbols.js';
import { findLegend, countByLegend } from './legend.js';
import { parseSchedule, matchSchedule } from './schedule.js';
import { findHatch, nameHatches } from './hatch.js';
import { findRegions } from './regions.js';
import { findLines } from './lines.js';

/**
 * The affine map from PDF user space to the upright frame (y up, origin at
 * the displayed sheet's bottom-left), and that frame's extent [0, 0, W, H].
 * Matches how pdf.js displays a page with /Rotate: 90 turns it clockwise.
 */
export function uprightFrame(view, rotate = 0) {
  const [x0, y0, x1, y1] = view;
  const w = x1 - x0, h = y1 - y0;
  switch (((rotate % 360) + 360) % 360) {
    case 90: return { matrix: [0, -1, 1, 0, -y0, x1], upright: [0, 0, h, w] };
    case 180: return { matrix: [-1, 0, 0, -1, x1, y1], upright: [0, 0, w, h] };
    case 270: return { matrix: [0, 1, -1, 0, y1, -x0], upright: [0, 0, h, w] };
    default: return { matrix: [1, 0, 0, 1, -x0, -y0], upright: [0, 0, w, h] };
  }
}

/**
 * @param {object} args
 * @param {{fnArray: number[], argsArray: any[]}} args.opList  page.getOperatorList()
 * @param {{str: string}[]} args.textItems                      page.getTextContent().items
 * @param {number[]} args.view                                  page.view, [x0, y0, x1, y1]
 * @param {Record<string, number>} args.OPS                     pdf.js OPS table
 * @param {Record<string, string>=} args.layerNames             OCG id → layer name
 * @param {Row[]=} args.scheduleRows                            schedule rows from other sheets
 * @param {number=} args.rotate                                 page.rotate: 0, 90, 180 or 270
 *
 * Everything is reported in the page's upright frame: y up, origin at the
 * bottom-left corner of the sheet as displayed, so a sheet stored rotated
 * (a portrait media box shown landscape) still has horizontal text and a
 * legend whose labels sit to the right of their symbols.
 */
export function analyzePage({ opList, textItems, view, OPS, layerNames, scheduleRows, rotate = 0 }) {
  const { matrix, upright } = uprightFrame(view, rotate);
  const paths = extractPaths(opList, OPS, { transform: matrix });
  if (layerNames) {
    for (const p of paths) {
      if (p.layer != null && layerNames[p.layer]) p.layer = layerNames[p.layer];
    }
  }

  const items = (textItems || []).map((it) => {
    if (!it.transform) return it;
    const [a, b, c, d, e, f] = it.transform;
    const [ma, mb, mc, md, me, mf] = matrix;
    return {
      ...it,
      transform: [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d,
        ma * e + mc * f + me, mb * e + md * f + mf],
    };
  });
  const rows = textRows(items);
  const lines = textLines(items);
  const text = rows.map((l) => l.str).join(' ');
  const scales = detectScales(text);
  const bar = detectScaleBar(rows, paths);
  if (bar) scales.push(bar);

  // Symbols: by the legend where there is one, by repetition otherwise.
  const sigCache = new Map();
  const sigOf = (p) => {
    let s = sigCache.get(p.id);
    if (s === undefined) { s = pathSignature(p); sigCache.set(p.id, s); }
    return s;
  };
  const legend = findLegend(paths, lines, sigOf);
  const byLegend = countByLegend(legend, paths, sigOf, { pageArea: upright[2] * upright[3] });
  const named = byLegend.filter((n) => n.kind === 'symbol');
  const patterns = byLegend.filter((n) => n.kind === 'pattern');
  const schedule = parseSchedule([{ rows, page: 0 }]).concat(scheduleRows || []);
  for (const n of named) {
    const row = matchSchedule(n, schedule);
    n.schedule = row ? row.qty : null;
    n.scheduleText = row ? row.text : null;
  }
  // A repeated shape already counted under a legend name is not listed twice.
  const templateSigs = new Set();
  for (const n of byLegend) for (const s of n.estimates ? n.estimates.map((x) => x.sig) : []) templateSigs.add(s);
  for (const n of patterns) for (const id of n.pathIds) templateSigs.add(sigOf(paths[id]));
  const symbols = findSymbols(paths, { sigOf });
  for (const s of symbols) s.claimed = s.sigs.every((sig) => templateSigs.has(sig));
  // A legend drawn at another size than the plan, or more detailed than it,
  // counts wrong. When the schedule gives the quantity and an unclaimed
  // repeated shape has exactly that count, say so; the estimator decides.
  for (const n of named) {
    if (n.schedule == null || n.schedule === n.count) continue;
    const hit = symbols.find((s) => !s.claimed && !s.minor && Math.abs(s.count - n.schedule) <= Math.max(1, 0.03 * n.schedule));
    if (hit) n.suggestion = { count: hit.count, key: hit.key, size: hit.size, parts: hit.parts };
  }

  const consumed = new Set();
  for (const e of legend) for (const id of e.pathIds) consumed.add(id);
  for (const n of named) for (const id of n.pathIds) consumed.add(id);
  for (const n of patterns) for (const id of n.pathIds) consumed.add(id);
  for (const s of symbols) for (const inst of s.instances) for (const id of inst.pathIds) consumed.add(id);

  const hatches = nameHatches(findHatch(paths, consumed), legend);
  for (const h of hatches) for (const id of h.lineIds) consumed.add(id);

  const regions = findRegions(paths, consumed, { pageBbox: upright });
  for (const r of regions) consumed.add(r.pathId);

  const lineGroups = findLines(paths, consumed);

  return {
    paths,
    view: upright,
    text,
    textLines: lines,
    scales,
    scale: scales[0] || null,
    notToScale: isNotToScale(text),
    legend,
    named,
    patterns,
    schedule,
    symbols,
    hatches,
    regions,
    lines: lineGroups,
  };
}
