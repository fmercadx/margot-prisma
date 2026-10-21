// Drawing scale: how many feet one PDF point stands for.
//
// A plan's title block usually states it in one of three ways:
//
//   engineering    1" = 20'-0"     1"=30'     1 IN = 50 FT
//   architectural  1/8" = 1'-0"    3/16"=1'   1 1/2" = 1'
//   ratio          1:240           SCALE 1:500
//
// All three reduce to feet per paper inch, and a PDF point is 1/72 of a paper
// inch — provided the PDF was exported at the sheet size the note assumes. A
// 24×36 plan printed to 11×17 keeps its note and halves its scale, which is why
// `calibrate` exists: click two points a known distance apart and the note is
// ignored.

const FRACTION = String.raw`(?:\d+\s+)?\d+\s*\/\s*\d+|\d+(?:\.\d+)?`;
const INCH = String.raw`(?:"|''|”|″|\s*in(?:ch(?:es)?)?\.?)`;
const FOOT = String.raw`(?:'|’|′|\s*f(?:ee)?t\.?)`;

// 1" = 20'   1/8" = 1'-0"   1 in = 50 ft
const EQUALS = new RegExp(
  String.raw`(${FRACTION})\s*${INCH}\s*=\s*(${FRACTION})\s*${FOOT}`, 'gi');
// 1:240   1 : 500
const RATIO = /\b1\s*:\s*(\d{2,5})\b/g;
const NTS = /\b(?:N\.?T\.?S\.?|NOT\s+TO\s+SCALE)\b/i;

function parseNumber(s) {
  s = s.trim();
  const m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return +m[1] + +m[2] / +m[3];
  const f = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (f) return +f[1] / +f[2];
  return parseFloat(s);
}

/**
 * Every scale statement found in the page text, best first. Each entry is
 * { feetPerPoint, label, source: 'note' }. A sheet with details at other
 * scales yields several; the one nearest the word SCALE is listed first.
 */
export function detectScales(text) {
  const found = [];
  const seen = new Set();
  const push = (feetPerInch, label, index) => {
    if (!(feetPerInch > 0) || !isFinite(feetPerInch)) return;
    const key = feetPerInch.toFixed(6);
    if (seen.has(key)) return;
    seen.add(key);
    // Rank by proximity to a "SCALE" keyword before the match.
    const before = text.slice(Math.max(0, index - 24), index);
    const rank = /scale/i.test(before) ? 0 : 1;
    found.push({ feetPerPoint: feetPerInch / 72, label, source: 'note', rank, index });
  };

  for (const m of text.matchAll(EQUALS)) {
    const inches = parseNumber(m[1]);
    const feet = parseNumber(m[2]);
    if (inches > 0 && feet > 0) push(feet / inches, m[0].replace(/\s+/g, ' ').trim(), m.index);
  }
  for (const m of text.matchAll(RATIO)) {
    push(+m[1] / 12, `1:${m[1]}`, m.index);
  }
  found.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return found.map(({ feetPerPoint, label, source }) => ({ feetPerPoint, label, source }));
}

export function isNotToScale(text) {
  return NTS.test(text);
}

/** Two points in page space and the real distance between them. */
export function calibrate(p1, p2, feet) {
  const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (!(d > 0) || !(feet > 0)) return null;
  return { feetPerPoint: feet / d, label: `${feet} ft over ${d.toFixed(1)} pt`, source: 'calibrated' };
}

/** Human-readable "1" = 20'" for a feet-per-point value. */
export function describeScale(feetPerPoint) {
  const fpi = feetPerPoint * 72;
  if (fpi >= 1) {
    const r = Math.round(fpi * 100) / 100;
    return `1" = ${Number.isInteger(r) ? r : r.toFixed(2)}'`;
  }
  // architectural: inches per foot
  const ipf = 1 / fpi;
  const r = Math.round(ipf * 64) / 64;
  return `${r}" = 1'`;
}
