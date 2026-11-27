// A shape fingerprint that survives translation, rotation and mirroring.
//
// Landscape architects scatter plant symbols at random angles so a bed looks
// natural, and a CAD block placed rotated has every coordinate changed. What
// does not change is the set of distances from the shape's centroid to its
// points. Sorted and sampled at fixed quantiles, those distances give a key
// that is the same for every copy of a symbol however it was turned, and
// different for shapes of another size or outline. Scale is deliberately not
// factored out: a 4 pt circle and a 9 pt circle are different symbols.

/** @param {Path} path  @returns {string} */
export function pathSignature(path) {
  const pts = [];
  for (const sp of path.subpaths) for (const p of sp.points) pts.push(p);
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= n; cy /= n;
  const radii = new Float64Array(n);
  for (let i = 0; i < n; i++) radii[i] = Math.hypot(pts[i][0] - cx, pts[i][1] - cy);
  radii.sort();
  // Thirteen quantiles at half-point resolution. Finer terms (perimeter,
  // radius of gyration) were tried and cost more than they gave: a CAD
  // export rounds coordinates, and a rotated copy's sums drift across a
  // rounding boundary often enough to split a tree's parts into two groups.
  const samples = [];
  for (let i = 0; i < 12; i++) samples.push(Math.round(radii[Math.floor((i * n) / 12)] * 2));
  samples.push(Math.round(radii[n - 1] * 2));
  const shape = path.subpaths.map((s) => (s.closed ? 'c' : 'o') + Math.round(s.points.length / 4)).join('');
  return `${path.fill ? 'F' : ''}${path.stroke ? 'S' : ''}|${shape}|${samples.join(',')}`;
}
