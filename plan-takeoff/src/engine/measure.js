// Plane geometry on point lists. Points are [x, y] in PDF user space (points,
// 1/72 inch, y up). Everything here is unit-agnostic; the scale is applied by
// whoever displays the number.

export function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Signed shoelace area. Positive for counter-clockwise rings. A repeated
 *  closing point is harmless: its edge has zero length. */
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** [x0, y0, x1, y1] */
export function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function bboxUnion(a, b) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function bboxCenter(b) {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

export function bboxSize(b) {
  return [b[2] - b[0], b[3] - b[1]];
}
