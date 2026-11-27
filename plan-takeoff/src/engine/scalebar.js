// The graphic scale bar: a drawn ruler with numbers under it, which many
// sheets carry instead of a written scale. The numbers are text with
// positions, so the bar can be read: labels on one baseline, a zero among
// them, and feet per point is the slope of value against position for the
// labels to the right of the zero. A label like "50 ft" is centred on its
// tick by its digits, so the digits' centre is used.

const NUM = /^(\d+(?:\.\d+)?)\s*(?:ft|feet|')?$/i;

/**
 * @param {Row[]} lines    whole baselines from textRows (the labels sit far apart)
 * @param {Path[]=} paths  the sheet's paths; the drawn bar refines the reading
 * @returns {{feetPerPoint:number, label:string, source:'bar'}|null}
 */
export function detectScaleBar(lines, paths = []) {
  let best = null;
  for (const ln of lines) {
    const nums = [];
    for (const w of ln.words) {
      const m = w.str.trim().match(NUM);
      if (!m) continue;
      const v = parseFloat(m[1]);
      const digits = m[1].length, total = w.str.trim().length;
      const cx = w.x0 + (w.x1 - w.x0) * (digits / total) / 2;
      nums.push({ v, x: cx });
    }
    if (nums.length < 2) continue;
    nums.sort((a, b) => a.x - b.x);
    const zero = nums.findIndex((n) => n.v === 0);
    if (zero < 0) continue;
    const right = nums.slice(zero).filter((n, i, arr) => i === 0 || n.v > arr[i - 1].v);
    if (right.length < 2) continue;
    const span = right[right.length - 1].x - right[0].x;
    if (span < 20) continue;
    // Least squares through the origin on (x - x0, v).
    let sxx = 0, sxv = 0;
    for (const n of right) { const dx = n.x - right[0].x; sxx += dx * dx; sxv += dx * n.v; }
    let slope = sxv / sxx; // feet per point
    if (!(slope > 0)) continue;
    let err = 0;
    for (const n of right) err = Math.max(err, Math.abs((n.x - right[0].x) * slope - n.v));
    const max = right[right.length - 1].v;
    if (err > 0.08 * max) continue;
    // The drawn bar, when it is there, is exact where label centres are not:
    // thin shapes just above or below the labels, starting at the zero.
    const xz = right[0].x, xm = right[right.length - 1].x;
    let bx0 = Infinity, bx1 = -Infinity;
    for (const p of paths) {
      const [px0, py0, px1, py1] = p.bbox;
      if (py1 - py0 > 8 || px1 - px0 < 4) continue;
      if (py1 < ln.y - 25 || py0 > ln.y + ln.h + 25) continue;
      if (px0 < xz - 6 || px1 > xm + 30) continue;
      bx0 = Math.min(bx0, px0); bx1 = Math.max(bx1, px1);
    }
    if (bx1 > bx0 && Math.abs((bx1 - bx0) - span) < 0.25 * span) slope = max / (bx1 - bx0);
    // More labels, or a "SCALE" word nearby, make a better reading.
    const score = right.length + (/scale/i.test(ln.str) ? 2 : 0);
    if (!best || score > best.score) {
      best = { feetPerPoint: slope, label: `graphic scale bar, 0–${max} ft`, source: 'bar', score, y: ln.y };
    }
  }
  if (!best) return null;
  const { feetPerPoint, label, source } = best;
  return { feetPerPoint, label, source };
}
