// One page in, quantities out. Pure: no DOM, no pdf.js import.
//
// Classification runs in a fixed order and each stage claims the paths it
// explains, so a hatch line is never also a "line", and a symbol's circle is
// never also an "area":
//
//   symbols  →  hatch  →  closed regions  →  open lines
//
// Every quantity is in PDF points (count, pt², pt). The caller multiplies by
// the scale, which can change after the fact when the estimator calibrates.

import { extractPaths } from './paths.js';
import { detectScales, isNotToScale } from './scale.js';
import { findSymbols } from './symbols.js';
import { findHatch } from './hatch.js';
import { findRegions } from './regions.js';
import { findLines } from './lines.js';

/**
 * @param {object} args
 * @param {{fnArray: number[], argsArray: any[]}} args.opList  page.getOperatorList()
 * @param {{str: string}[]} args.textItems                      page.getTextContent().items
 * @param {number[]} args.view                                  page.view, [x0, y0, x1, y1]
 * @param {Record<string, number>} args.OPS                     pdf.js OPS table
 * @param {Record<string, string>=} args.layerNames             OCG id → layer name
 */
export function analyzePage({ opList, textItems, view, OPS, layerNames }) {
  const paths = extractPaths(opList, OPS);
  if (layerNames) {
    for (const p of paths) {
      if (p.layer != null && layerNames[p.layer]) p.layer = layerNames[p.layer];
    }
  }

  const text = (textItems || []).map((t) => t.str).join(' ');
  const scales = detectScales(text);

  const symbols = findSymbols(paths);
  const consumed = new Set();
  for (const s of symbols) for (const inst of s.instances) for (const id of inst.pathIds) consumed.add(id);

  const hatches = findHatch(paths, consumed);
  for (const h of hatches) for (const id of h.lineIds) consumed.add(id);

  const regions = findRegions(paths, consumed, { pageBbox: view });
  for (const r of regions) consumed.add(r.pathId);

  const lines = findLines(paths, consumed);

  return {
    paths,
    text,
    scales,
    scale: scales[0] || null,
    notToScale: isNotToScale(text),
    symbols,
    hatches,
    regions,
    lines,
  };
}
