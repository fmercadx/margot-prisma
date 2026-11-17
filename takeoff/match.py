"""Click one symbol, find every copy.

The seed is one example: the symbol under a click, or whatever a hand-drawn box
holds. Only its own pen (plus solid fills) is kept -- on most sets devices are
drawn black over a grey architectural background, so this drops walls and
furniture -- and sampled into points. A copy elsewhere is the same point set
moved and turned, possibly mirrored. Quarter turns are tried exactly from every
stroke endpoint on the page; other angles come from pairs of endpoints the same
distance apart as the example's two farthest corners. Hypotheses whose other
corners line up too are scored on all of the ink:

  coverage  share of the seed's ink found at the candidate
  purity    share of the candidate's ink that the seed explains, counting only
            strokes that touch the candidate. A line through the circle (the
            above-counter duplex) or a fill inside it (GFCI) counts against
            it; a neighbouring data outlet poking into the box does not, and
            neither does a wire or leader that merely runs into the symbol.
  extra     that unexplained touching ink as a length, in points

Thresholds sort candidates into MATCH and REVIEW. A REVIEW is shown to the
estimator, never silently counted or silently dropped.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from drawings import CIRCUIT_RE, SOLID, Page

MATCH, REVIEW = "match", "review"

# Plotters quantise coordinates (0.24 pt on the USC set), so two copies of one
# block differ by a fraction of a point. Tolerances sit just above that.
TOL = 0.5            # points
STEP = 0.4           # sample spacing along strokes
# Ink is measured by area covered, not strokes drawn: exports stack duplicate
# strokes and trace each fill's outline over the strokes beside it, which
# would otherwise outweigh a genuinely extra line. Samples snap to this grid
# and duplicates go.
SNAP = 0.2

VERTEX_MIN = 0.5     # share of seed vertices that must line up to score a hypothesis
# On the USC set true copies score 1.0 on both with no extra ink at all; the
# closest impostor, a duplex with a counter line through it, scores 0.93
# purity. A share alone hides small additions to a heavy symbol -- the same
# counter line on a hatched GFCI is only 2.5% of its ink -- so extra ink is
# also capped as a length.
MATCH_COVER, MATCH_PURITY = 0.90, 0.95
MATCH_EXTRA = 2.0    # points of touching ink the example doesn't have
# The same in reverse: a plain duplex is all of an above-counter example
# except its slash, so it covers 90% of it. True copies miss almost nothing.
MATCH_MISSING = 2.0  # points of the example's ink not found
REVIEW_COVER, REVIEW_PURITY = 0.70, 0.60
# A candidate carrying more extra ink than this share of the example is a
# different symbol (an exit sign against a GFCI), not a near miss worth a look.
REVIEW_EXTRA = 0.20

# A stroke from a path longer than this is a connection -- a wire, a leader, a
# wall -- not part of a symbol. The click never grows along one, and one that
# runs into a candidate is not extra ink. Receptacle parts are under 21 pt on
# all seven test sets.
MAX_PART = 30.0

# Any-angle search. Within this many degrees of a quarter turn the exact
# search covers it, and a near-square fit would only compete with the exact one.
_SKIP_NEAR_QUARTER = 6.0
_PAIR_TOL = 0.7      # two corners each off by a plotter step

# Rows act on (x, y) row vectors as p @ T.T. y grows downward, so "90" turns
# clockwise on the sheet. The last four are the mirror images.
TRANSFORMS = [np.array(m, dtype=np.float64) for m in (
    ((1, 0), (0, 1)), ((0, -1), (1, 0)), ((-1, 0), (0, -1)), ((0, 1), (-1, 0)),
    ((-1, 0), (0, 1)), ((0, 1), (1, 0)), ((1, 0), (0, -1)), ((0, -1), (-1, 0)),
)]
ORIENT = ["0", "90", "180", "270", "0 mirrored", "90 mirrored", "180 mirrored", "270 mirrored"]

# How far beyond a match to look for a separate mark (a tamper-resistant bar
# drawn clear of the circle), and the cell size those marks are compared in.
_HALO = 4.0
_HALO_CELL = 1.0


def _fill_of(style: tuple) -> tuple:
    """The fill-outline key in the same colour as a stroke pen."""
    return (("fill",) + tuple(style[0]), 0.0)


def _is_area(style: tuple) -> bool:
    return style[0][:1] in (("fill",), ("solid",))


def _ink(page: Page, style: tuple) -> np.ndarray:
    """Segments drawn with the pen, plus fills: outlines in its colour, and
    the interiors of every symbol-sized fill.

    A filled half-circle (GFCI) or a filled band is part of the symbol it sits
    in, but a PDF writes the fill as a separate shape with no stroke, often in
    another colour and with its outline exactly on the strokes beside it.
    """
    ids = [i for i, s in enumerate(page.styles) if s == style or s == _fill_of(style) or s == SOLID]
    return np.isin(page.style, ids)


# An open run of at least this many strokes joined end to end, spanning at
# least this far, is a wire drawn in pieces.
_RUN_STROKES, _RUN_SPAN = 3, 12.0


def _short(page: Page) -> np.ndarray:
    """Per segment: could it be part of a symbol, or is it a connection?

    Connections are strokes from long paths (a wire or wall drawn as one path)
    and open runs of short strokes joined end to end (a wire drawn in pieces,
    as one firm draws every homerun, in the receptacles' own pen). Circles,
    boxes and triangles close on themselves and are never runs.
    """
    if "parts" in page.cache:
        return page.cache["parts"]
    n = len(page.segs)
    if len(page.path) != n or not n:
        return np.ones(n, dtype=bool)
    long = page.path_extent[page.path] > MAX_PART
    s, st = page.segs, page.style.astype(np.int64)
    ends = np.vstack([np.column_stack([st, np.round(s[:, :2] / 0.3)]),
                      np.column_stack([st, np.round(s[:, 2:] / 0.3)])]).astype(np.int64)
    _, node = np.unique(ends, axis=0, return_inverse=True)
    node = node.ravel()
    a, b = node[:n], node[n:]
    real = a != b
    degree = np.bincount(np.concatenate([a[real], b[real]]), minlength=node.max() + 1)
    # Join the two strokes meeting at every node of degree two.
    parent = list(range(n))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    holders: dict[int, list[int]] = {}
    for i in np.flatnonzero(real):
        for k in (a[i], b[i]):
            if degree[k] == 2:
                holders.setdefault(int(k), []).append(int(i))
    for pair in holders.values():
        if len(pair) == 2:
            ra, rb = root(pair[0]), root(pair[1])
            if ra != rb:
                parent[ra] = rb
    comp = np.array([root(i) for i in range(n)])
    order = np.argsort(comp, kind="stable")
    cs = comp[order]
    starts = np.flatnonzero(np.r_[True, cs[1:] != cs[:-1]])
    size = np.diff(np.r_[starts, n])
    lo = np.minimum.reduceat(np.minimum(s[order, :2], s[order, 2:]), starts)
    hi = np.maximum.reduceat(np.maximum(s[order, :2], s[order, 2:]), starts)
    span = (hi - lo).max(axis=1)
    # Closed: every node of the component is shared by two of its strokes.
    open_ = np.zeros(len(starts), dtype=bool)
    for k, (st0, sz) in enumerate(zip(starts, size)):
        if sz >= _RUN_STROKES and span[k] >= _RUN_SPAN:
            members = order[st0:st0 + sz]
            counts = np.unique(np.concatenate([a[members], b[members]]), return_counts=True)[1]
            open_[k] = bool((counts == 1).any())
    run = np.zeros(n, dtype=bool)
    run[order] = np.repeat(open_, size)
    page.cache["parts"] = parts = ~(long | run)
    return parts


@dataclass
class Seed:
    page: int
    box: tuple[float, float, float, float]   # x0, top, x1, bottom
    style: tuple                             # the pen; fills come with it
    pts: np.ndarray                          # samples, relative to box centre
    verts: np.ndarray                        # stroke endpoints, relative to box centre
    inner: str = ""                          # letters printed inside the box ("FB", "TV")

    @property
    def half(self) -> tuple[float, float]:
        x0, t, x1, b = self.box
        return (x1 - x0) / 2, (b - t) / 2


@dataclass
class Hit:
    item: str
    page: int
    sheet: str
    x: float               # centre, PDF points from the top-left corner
    y: float
    hw: float              # half extents on the sheet, after rotation
    hh: float
    orient: str
    coverage: float
    purity: float
    status: str
    extra: float = 0.0     # points of touching ink the example doesn't have
    label: str = ""        # nearest circuit label, unverified
    also: str = ""         # other items that partly matched the same spot
    ink: float = 0.0       # points of the example's ink found here
    text: str = ""         # short labels printed beside it: GFI, WP, USB, 48"
    note: str = ""         # anything the estimator should look at
    halo: frozenset = field(default=frozenset(), repr=False, compare=False)

    @property
    def score(self) -> float:
        return min(self.coverage, self.purity)


def _iou(a: Hit, b: Hit) -> float:
    ix = max(0.0, min(a.x + a.hw, b.x + b.hw) - max(a.x - a.hw, b.x - b.hw))
    iy = max(0.0, min(a.y + a.hh, b.y + b.hh) - max(a.y - a.hh, b.y - b.hh))
    inter = ix * iy
    return inter / (4 * a.hw * a.hh + 4 * b.hw * b.hh - inter)


# Boxes overlapping more than this are the same physical symbol.
SAME_SPOT = 0.25


def sample(segs: np.ndarray, step: float = STEP, with_index: bool = False):
    """Points every `step` along each segment, both endpoints included.

    With `with_index`, also returns which segment each point came from.
    """
    if len(segs) == 0:
        return (np.zeros((0, 2)), np.zeros(0, np.int64)) if with_index else np.zeros((0, 2))
    d = segs[:, 2:] - segs[:, :2]
    # np.intp, not int64: in the browser numpy is 32-bit, and np.repeat
    # refuses counts it would have to narrow.
    n = np.maximum(1, np.ceil(np.hypot(d[:, 0], d[:, 1]) / step).astype(np.intp))
    reps = n + 1
    seg_idx = np.repeat(np.arange(len(segs)), reps)
    starts = np.repeat(np.cumsum(reps) - reps, reps)
    t = (np.arange(reps.sum()) - starts) / np.repeat(n, reps)
    pts = segs[seg_idx, :2] + d[seg_idx] * t[:, None]
    return (pts, seg_idx) if with_index else pts


def _distinct(pts: np.ndarray, owner: np.ndarray | None = None):
    _, keep = np.unique(np.round(pts / SNAP).astype(np.int64), axis=0, return_index=True)
    keep.sort()
    return (pts[keep], owner[keep]) if owner is not None else pts[keep]


def _endpoints(segs: np.ndarray) -> np.ndarray:
    pts = np.concatenate([segs[:, :2], segs[:, 2:]]) if len(segs) else np.zeros((0, 2))
    return np.unique(np.round(pts, 1), axis=0)


class _Grid:
    """Occupancy grid: is there ink within about TOL of a point?"""

    def __init__(self, pts: np.ndarray, x0: float, y0: float, x1: float, y1: float, cell: float = TOL):
        self.cell, self.x0, self.y0 = cell, x0, y0
        nx, ny = int((x1 - x0) / cell) + 3, int((y1 - y0) / cell) + 3
        g = np.zeros((ny, nx), dtype=bool)
        ix, iy, ok = self._index(pts, nx, ny)
        g[iy[ok], ix[ok]] = True
        # Dilate by one cell so points straddling a cell edge still meet.
        d = g.copy()
        d[1:, :] |= g[:-1, :]
        d[:-1, :] |= g[1:, :]
        e = d.copy()
        e[:, 1:] |= d[:, :-1]
        e[:, :-1] |= d[:, 1:]
        self.g = e

    def _index(self, pts, nx, ny):
        ix = np.floor((pts[..., 0] - self.x0) / self.cell).astype(np.int64) + 1
        iy = np.floor((pts[..., 1] - self.y0) / self.cell).astype(np.int64) + 1
        ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
        return ix, iy, ok

    def hit(self, pts: np.ndarray) -> np.ndarray:
        ny, nx = self.g.shape
        ix, iy, ok = self._index(pts, nx, ny)
        out = np.zeros(ok.shape, dtype=bool)
        out[ok] = self.g[iy[ok], ix[ok]]
        return out


def make_seed(page: Page, box: tuple[float, float, float, float], style: tuple | None = None) -> Seed:
    """The example inside `box`, drawn with `style` or the box's dominant pen.

    Dominance counts distinct ink, not strokes: CAD exports often draw one
    furniture outline five times over, which would otherwise outvote the
    symbol the box was drawn around.
    """
    x0, t, x1, b = box
    if x1 <= x0 or b <= t:
        raise ValueError("seed box must have x0 < x1 and top < bottom")
    s = page.segs
    near = (np.maximum(s[:, 0], s[:, 2]) >= x0) & (np.minimum(s[:, 0], s[:, 2]) <= x1) \
        & (np.maximum(s[:, 1], s[:, 3]) >= t) & (np.minimum(s[:, 1], s[:, 3]) <= b)
    if not near.any():
        raise ValueError(
            f"no vector strokes inside the box on page {page.number}: "
            "an empty area, or a scanned sheet (this matcher needs CAD-exported PDFs)")
    pts_by_style = {}
    for sid in np.unique(page.style[near]):
        p = sample(s[near & (page.style == sid)])
        inside = (p[:, 0] >= x0) & (p[:, 0] <= x1) & (p[:, 1] >= t) & (p[:, 1] <= b)
        if inside.any():
            pts_by_style[int(sid)] = np.unique(np.round(p[inside], 1), axis=0)
    if not pts_by_style:
        raise ValueError(f"no strokes fall inside the box on page {page.number}")
    if style is None:
        strokes = [k for k in pts_by_style if not _is_area(page.styles[k])] or list(pts_by_style)
        style = page.styles[max(strokes, key=lambda k: len(pts_by_style[k]))]
    # Only symbol parts: a wall or wire crossing the box would sit somewhere
    # else relative to every other copy.
    ink = near & _ink(page, style) & _short(page)
    c = np.array([(x0 + x1) / 2, (t + b) / 2])
    p = _distinct(sample(s[ink]))
    p = p[(p[:, 0] >= x0) & (p[:, 0] <= x1) & (p[:, 1] >= t) & (p[:, 1] <= b)]
    v = _endpoints(s[ink & ~np.isin(page.style, [i for i, st in enumerate(page.styles) if st == SOLID])])
    v = v[(v[:, 0] >= x0) & (v[:, 0] <= x1) & (v[:, 1] >= t) & (v[:, 1] <= b)]
    if len(v) == 0:
        raise ValueError("the box cuts through strokes without enclosing any endpoint; draw it around the whole symbol")
    return Seed(page=page.number, box=box, style=style, pts=p - c, verts=v - c, inner=_inner(page, box))


def seed_at(page: Page, x: float, y: float) -> Seed:
    """The example under a click: its whole symbol, in the pen that was clicked.

    Built from the symbol's own strokes, not everything in its box, so the
    first piece of a wire running into it doesn't become part of the example.
    """
    box, style, strokes = _grow(page, x, y)
    c = np.array([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])
    solid = [i for i, st in enumerate(page.styles) if st == SOLID]
    return Seed(page=page.number, box=box, style=style,
                pts=_distinct(sample(page.segs[strokes])) - c,
                verts=_endpoints(page.segs[strokes[~np.isin(page.style[strokes], solid)]]) - c,
                inner=_inner(page, box))


def _inner(page: Page, box) -> str:
    """Words lying wholly inside a box: the letters that name a lettered symbol."""
    x0, t, x1, b = box
    words = [w for w in page.words if w["x0"] >= x0 and w["x1"] <= x1 and w["top"] >= t and w["bottom"] <= b]
    return " ".join(sorted(w["text"] for w in words))


def box_at(page: Page, x: float, y: float, reach: float = 25.0) -> tuple[tuple[float, float, float, float], tuple]:
    """The box around the symbol under a click, and the pen it is drawn in."""
    box, pen, _ = _grow(page, x, y, reach)
    return box, pen


def _grow(page: Page, x: float, y: float, reach: float = 25.0):
    """The symbol under a click: its box, its pen, and its strokes (page indices).

    Starts from a stroke under the click and takes in every stroke of the same
    pen that touches it, so a receptacle's tail comes along with its circle --
    on the USC set the tail's direction relative to the bars is the only thing
    that tells a duplex from a quad. Strokes from long paths are left out: one
    firm draws every circuit wire in the receptacles' own pen, touching them,
    and another draws its existing devices in the walls' pen.
    """
    s = page.segs
    window = (np.maximum(s[:, 0], s[:, 2]) >= x - reach) & (np.minimum(s[:, 0], s[:, 2]) <= x + reach) \
        & (np.maximum(s[:, 1], s[:, 3]) >= y - reach) & (np.minimum(s[:, 1], s[:, 3]) <= y + reach)
    idx = np.flatnonzero(window & _short(page))
    if not len(idx):
        raise ValueError(f"nothing drawn near ({x:.0f}, {y:.0f}) on page {page.number}")
    pts = [sample(s[i:i + 1]) for i in idx]
    dist = np.array([float(np.min(np.hypot(p[:, 0] - x, p[:, 1] - y))) for p in pts])
    area = np.array([_is_area(page.styles[page.style[i]]) for i in idx])
    close = np.flatnonzero((dist <= 3) & ~area)
    if not len(close):
        raise ValueError(f"no line of a symbol within 3 pt of ({x:.0f}, {y:.0f}) on page {page.number}")

    # A click on a symbol's centre often lands on a wall or wire running
    # through it. Of the pens under the click, take the one with the most
    # distinct ink nearby: the symbol is dense, the line through it is not.
    def nearby_ink(sid):
        mine = [pts[i] for i in range(len(idx)) if page.style[idx[i]] == sid]
        p = _distinct(np.concatenate(mine))
        return int(np.count_nonzero(np.hypot(p[:, 0] - x, p[:, 1] - y) <= 8))
    sid = max({int(page.style[idx[i]]) for i in close}, key=nearby_ink)
    first = int(close[np.argmin([dist[i] if page.style[idx[i]] == sid else np.inf for i in close])])
    pen = page.styles[sid]
    same_ink = _ink(page, pen)[idx]
    inside = [np.all(np.abs(p - (x, y)) <= reach, axis=1) for p in pts]
    member = {first}
    while True:
        grid = _Grid(np.concatenate([pts[i] for i in member]), x - reach, y - reach, x + reach, y + reach)
        grown = {i for i in range(len(idx))
                 if i not in member and same_ink[i] and grid.hit(pts[i][inside[i]]).any()}
        if not grown:
            break
        member |= grown
    member = _drop_wires(member, idx, page, pts, inside, first, x, y, reach)
    p = np.concatenate([pts[i][inside[i]] for i in member])
    box = (float(p[:, 0].min()) - 1, float(p[:, 1].min()) - 1, float(p[:, 0].max()) + 1, float(p[:, 1].max()) + 1)
    return box, pen, idx[sorted(member)]


def _drop_wires(member: set, idx, page: Page, pts, inside, first: int, x: float, y: float, reach: float) -> set:
    """Take wires drawn as runs of short separate strokes out of a grown symbol.

    One firm draws each circuit wire as a chain of 1-12 pt pieces in the
    receptacles' own pen, touching the circle, so path length can't tell it
    from the symbol. Shape can: circles, triangles and boxes are closed loops,
    bars and tails are single strokes, and a wire is an open chain of three or
    more pieces joined end to end that runs out past the rest of the symbol.
    """
    segs = page.segs[idx]
    snap = 0.3
    keys = {i: (tuple(np.round(segs[i, :2] / snap).astype(int)), tuple(np.round(segs[i, 2:] / snap).astype(int)))
            for i in member}
    at: dict[tuple, list[int]] = {}
    for i, (a, b) in keys.items():
        if a != b:
            at.setdefault(a, []).append(i)
            at.setdefault(b, []).append(i)
    seen, chains = set(), []
    for i in member:
        if i in seen or keys[i][0] == keys[i][1]:
            continue
        chain, closed = [i], False
        seen.add(i)
        ends = []
        for side in (0, 1):
            cur, node = i, keys[i][side]
            while len(at.get(node, ())) == 2:
                nxt = at[node][0] if at[node][1] == cur else at[node][1]
                if nxt in seen:
                    closed = closed or nxt in chain
                    break
                chain.append(nxt)
                seen.add(nxt)
                a, b = keys[nxt]
                node = b if a == node else a
                cur = nxt
            ends.append(node)
        chains.append((chain, closed or ends[0] == ends[1]))
    open_runs = [c for c, closed in chains if not closed and len(c) >= 3]
    runs = {i for c in open_runs for i in c}
    if not runs or first in runs:
        return member

    def reachable(pool):
        kept, frontier = {first}, [first]
        while frontier:
            grid = _Grid(np.concatenate([pts[i] for i in frontier]), x - reach, y - reach, x + reach, y + reach)
            frontier = [i for i in pool - kept if grid.hit(pts[i][inside[i]]).any()]
            kept.update(frontier)
        return kept

    # The symbol proper is what touches the clicked stroke with every open run
    # set aside; an arrowhead at a wire's far end is not part of it.
    core = reachable(member - runs)
    cp = np.concatenate([pts[i] for i in core])
    lo, hi = cp.min(axis=0) - 3.0, cp.max(axis=0) + 3.0
    wires = {i for c in open_runs
             if (np.any(np.concatenate([pts[k] for k in c]) < lo) or np.any(np.concatenate([pts[k] for k in c]) > hi))
             for i in c}
    return reachable(member - wires) if wires else member


def _anchors(verts: np.ndarray, k: int = 3) -> np.ndarray:
    """Up to k seed vertices far apart, so one occluded corner can't hide a copy."""
    chosen = [int(np.argmax(np.hypot(verts[:, 0], verts[:, 1])))]
    while len(chosen) < min(k, len(verts)):
        d = np.min(np.hypot(*(verts[:, None, :] - verts[chosen][None, :, :]).transpose(2, 0, 1)), axis=1)
        chosen.append(int(np.argmax(d)))
    return verts[chosen]


def _pairs(v: np.ndarray, d: float, tol: float, chunk: int = 20000):
    """Ordered index pairs (i, j) of points whose distance is d +/- tol."""
    cell = d + tol
    c = np.floor(v / cell).astype(np.int64)
    c -= c.min(axis=0)
    m = int(c[:, 1].max()) + 3
    key = (c[:, 0] + 1) * m + (c[:, 1] + 1)
    order = np.argsort(key, kind="stable")
    ks = key[order]
    out_i, out_j = [], []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            target = key + dx * m + dy
            lo = np.searchsorted(ks, target, "left")
            cnt = np.searchsorted(ks, target, "right") - lo
            for s in range(0, len(v), chunk):
                cc = cnt[s:s + chunk]
                total = int(cc.sum())
                if not total:
                    continue
                ii = np.repeat(np.arange(s, s + len(cc)), cc)
                jj = order[np.repeat(lo[s:s + chunk], cc) + np.arange(total) - np.repeat(np.cumsum(cc) - cc, cc)]
                dd = np.hypot(v[jj, 0] - v[ii, 0], v[jj, 1] - v[ii, 1])
                ok = np.abs(dd - d) <= tol
                out_i.append(ii[ok])
                out_j.append(jj[ok])
    if not out_i:
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    return np.concatenate(out_i), np.concatenate(out_j)


def _angled_hypotheses(verts: np.ndarray, seed_verts: np.ndarray, vgrid: _Grid):
    """(T, t, label) for placements at angles other than quarter turns."""
    if len(seed_verts) < 3:
        return []
    dists = np.hypot(*(seed_verts[:, None, :] - seed_verts[None, :, :]).transpose(2, 0, 1))
    # Up to three corner pairs, far apart and sharing no corner, so one corner
    # merged into a neighbouring line can't hide a copy.
    pairs, used, work = [], set(), dists.copy()
    while len(pairs) < 3:
        a, b = np.unravel_index(np.argmax(work), work.shape)
        if work[a, b] < 4:              # too small to fix an angle
            break
        pairs.append((int(a), int(b)))
        used |= {int(a), int(b)}
        work[list(used), :] = 0
        work[:, list(used)] = 0
    out = []
    for a, b in pairs:
        out += _angled_from_pair(verts, seed_verts, vgrid, a, b, float(dists[a, b]))
    return out


def _angled_from_pair(verts, seed_verts, vgrid, a, b, d):
    i, j = _pairs(verts, d, _PAIR_TOL)
    if not len(i):
        return []
    phi = np.arctan2(verts[j, 1] - verts[i, 1], verts[j, 0] - verts[i, 0])
    out = []
    for mirror in (False, True):
        sv = seed_verts * (-1.0, 1.0) if mirror else seed_verts
        theta = phi - math.atan2(sv[b, 1] - sv[a, 1], sv[b, 0] - sv[a, 0])
        deg = np.degrees(theta) % 360
        q = deg % 90
        keep = np.minimum(q, 90 - q) >= _SKIP_NEAR_QUARTER
        if not keep.any():
            continue
        th, w1 = theta[keep], verts[i[keep]]
        c, s = np.cos(th), np.sin(th)
        t = w1 - np.stack([c * sv[a, 0] - s * sv[a, 1], s * sv[a, 0] + c * sv[a, 1]], axis=1)
        key = np.round(np.column_stack([t / (TOL / 2), np.degrees(th) % 360]))
        _, first = np.unique(key, axis=0, return_index=True)
        th, t, c, s = th[first], t[first], c[first], s[first]
        for lo in range(0, len(th), 20000):
            cc, ss, tt = c[lo:lo + 20000], s[lo:lo + 20000], t[lo:lo + 20000]
            px = tt[:, None, 0] + cc[:, None] * sv[None, :, 0] - ss[:, None] * sv[None, :, 1]
            py = tt[:, None, 1] + ss[:, None] * sv[None, :, 0] + cc[:, None] * sv[None, :, 1]
            vs = vgrid.hit(np.stack([px, py], axis=-1)).mean(axis=1)
            for k in np.flatnonzero(vs >= VERTEX_MIN):
                th_k, t_k = _refine(verts, sv, math.atan2(ss[k], cc[k]), tt[k])
                R = np.array([[math.cos(th_k), -math.sin(th_k)], [math.sin(th_k), math.cos(th_k)]])
                T = R @ np.diag([-1.0, 1.0]) if mirror else R
                label = f"{math.degrees(th_k) % 360:.0f}" + (" mirrored" if mirror else "")
                out.append((T, t_k, label))
    return out


def _refine(verts: np.ndarray, sv: np.ndarray, theta: float, t: np.ndarray, reach: float = 1.2):
    """Best rotation and shift for one placement, fitted on every corner that lines up.

    Two corners fix an angle only to about a degree; fitting all of them
    brings the far side of the symbol back onto its strokes.
    """
    for _ in range(2):
        c, s = math.cos(theta), math.sin(theta)
        placed = np.column_stack([c * sv[:, 0] - s * sv[:, 1], s * sv[:, 0] + c * sv[:, 1]]) + t
        a, z = np.searchsorted(verts[:, 0], [placed[:, 0].min() - reach, placed[:, 0].max() + reach])
        near = verts[a:z]
        if not len(near):
            break
        d = np.hypot(near[None, :, 0] - placed[:, None, 0], near[None, :, 1] - placed[:, None, 1])
        j = d.argmin(axis=1)
        ok = d[np.arange(len(sv)), j] <= reach
        if ok.sum() < 3:
            break
        src_, dst = sv[ok], near[j[ok]]
        ms, md = src_.mean(axis=0), dst.mean(axis=0)
        p, q = src_ - ms, dst - md
        theta = math.atan2((p[:, 0] * q[:, 1] - p[:, 1] * q[:, 0]).sum(), (p * q).sum())
        c, s = math.cos(theta), math.sin(theta)
        t = md - np.array([c * ms[0] - s * ms[1], s * ms[0] + c * ms[1]])
    return theta, t


def _nearest_label(page: Page, x: float, y: float, reach: float) -> str:
    best, best_d = "", reach
    for w in page.words:
        if not CIRCUIT_RE.match(w["text"]):
            continue
        cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
        d = float(np.hypot(cx - x, cy - y))
        if d < best_d:
            best, best_d = w["text"], d
    return best


def find(page: Page, seed: Seed, item: str = "") -> list[Hit]:
    if seed.style not in page.styles:
        return []                       # this sheet never uses the seed's pen
    if seed.style not in page.cache:    # several items often share one pen
        ink = _ink(page, seed.style)
        segs = page.segs[ink]
        pts, owner = _distinct(*sample(segs, with_index=True))
        is_solid = np.isin(page.style[ink], [i for i, st in enumerate(page.styles) if st == SOLID])
        verts = _endpoints(segs[~is_solid])
        short = _short(page)[ink][owner]
        order = np.argsort(pts[:, 0])
        page.cache[seed.style] = (pts[order], owner[order], short[order], verts,
                                  _Grid(pts, 0, 0, page.width, page.height),
                                  _Grid(verts, 0, 0, page.width, page.height))
    pts_x, owner_x, short_x, verts, pgrid, vgrid = page.cache[seed.style]
    if len(verts) == 0:
        return []
    hw, hh = seed.half
    sgrid = _Grid(seed.pts, -hw - 1, -hh - 1, hw + 1, hh + 1)
    seed_len = len(seed.pts) * STEP

    def local(cx, cy, T, margin=0.0):
        """Ink near a placement, in the seed's frame, within the seed box + margin."""
        bw = abs(T[0, 0]) * (hw + margin) + abs(T[0, 1]) * (hh + margin)
        bh = abs(T[1, 0]) * (hw + margin) + abs(T[1, 1]) * (hh + margin)
        a, z = np.searchsorted(pts_x[:, 0], [cx - bw, cx + bw])
        q, qo, qs = pts_x[a:z], owner_x[a:z], short_x[a:z]
        keep = np.abs(q[:, 1] - cy) <= bh
        sf = (q[keep] - (cx, cy)) @ T
        inside = (np.abs(sf[:, 0]) <= hw + margin) & (np.abs(sf[:, 1]) <= hh + margin)
        return sf[inside], qo[keep][inside], qs[keep][inside]

    def purity(cx, cy, T):
        sf, qo, qs = local(cx, cy, T)
        explained = sgrid.hit(sf)
        touching = np.isin(qo, qo[explained])
        extra = np.count_nonzero(~explained & touching & qs)
        pur = explained.sum() / (explained.sum() + extra) if explained.any() else 0.0
        return float(pur), extra * STEP

    found: list[tuple] = []             # (cx, cy, T, label, coverage, purity, extra)

    def consider(cands, T, label):
        cover = pgrid.hit(cands[:, None, :] + (seed.pts @ T.T)[None, :, :]).mean(axis=1)
        for (cx, cy), cov in zip(cands[cover >= REVIEW_COVER], cover[cover >= REVIEW_COVER]):
            pur, extra = purity(cx, cy, T)
            if pur >= REVIEW_PURITY and extra <= REVIEW_EXTRA * seed_len:
                found.append((float(cx), float(cy), T, label, float(cov), pur, extra))

    for ti, T in enumerate(TRANSFORMS):
        sv = seed.verts @ T.T
        cands = np.concatenate([verts - a for a in _anchors(sv)])
        cands = np.unique(np.round(cands / (TOL / 2)), axis=0) * (TOL / 2)
        for lo in range(0, len(cands), 20000):
            c = cands[lo:lo + 20000]
            vscore = vgrid.hit(c[:, None, :] + sv[None, :, :]).mean(axis=1)
            c = c[vscore >= VERTEX_MIN]
            if len(c):
                consider(c, T, ORIENT[ti])

    for T, t, label in _angled_hypotheses(verts, seed.verts, vgrid):
        consider(t[None, :], T, label)

    # One hit per copy: symmetric symbols match under several orientations,
    # and a symbol with a long tail also half-matches shifted along it.
    found.sort(key=lambda f: (-min(f[4], f[5]), f[6]))
    hits: list[Hit] = []
    for cx, cy, T, label, cov, pur, extra in found:
        ok = cov >= MATCH_COVER and pur >= MATCH_PURITY and extra <= MATCH_EXTRA \
            and (1 - cov) * seed_len <= MATCH_MISSING
        bw = abs(T[0, 0]) * hw + abs(T[0, 1]) * hh
        bh = abs(T[1, 0]) * hw + abs(T[1, 1]) * hh
        hit = Hit(item, page.number, page.sheet, cx, cy, bw, bh, label, round(cov, 3),
                  round(pur, 3), MATCH if ok else REVIEW, round(float(extra), 1), ink=round(cov * seed_len, 1))
        if any(_iou(hit, h) > SAME_SPOT for h in hits):
            continue
        # A square with FB in it and one with TV in it are the same strokes.
        inner = _inner(page, (cx - bw, cy - bh, cx + bw, cy + bh))
        if seed.inner and inner != seed.inner:
            hit.status = REVIEW
            hit.note = f"letters inside differ: {inner or 'none'} vs {seed.inner or 'none'}"
        hit.label = _nearest_label(page, cx, cy, reach=3 * max(hw, hh))
        # What sits just outside the example's box, short strokes only, in the
        # example's own frame: the raw material for spotting a separate mark.
        sf, _, qs = local(cx, cy, T, margin=_HALO)
        ring = qs & ~((np.abs(sf[:, 0]) <= hw) & (np.abs(sf[:, 1]) <= hh))
        hit.halo = frozenset(map(tuple, np.floor(sf[ring] / _HALO_CELL).astype(int).tolist()))
        hits.append(hit)
    hits.sort(key=lambda h: (h.y, h.x))
    return hits


def resolve(hits: list[Hit]) -> list[Hit]:
    """One answer per spot when several items were searched.

    A quad receptacle half-matches a duplex example and fully matches a quad
    one; the spot belongs to the item that matched it best. When two items
    match equally well -- a tamper-resistant duplex is a plain duplex plus a
    separate bar, so a plain example matches it perfectly too -- the item whose
    example accounts for more of the ink there wins: the most specific one.
    The others are noted in `also` so a reviewer can see what else it resembled.
    """
    ranked = sorted(hits, key=lambda h: (h.status != MATCH, -round(h.score, 2), -h.ink))
    kept: list[Hit] = []
    for h in ranked:
        same = [k for k in kept if k.page == h.page and _iou(h, k) > SAME_SPOT]
        if same:
            if h.item != same[0].item and h.score >= 0.8 and h.item not in same[0].also.split(", "):
                same[0].also = ", ".join(filter(None, [same[0].also, h.item]))
            continue
        kept.append(h)
    kept.sort(key=lambda h: (h.page, h.y, h.x))
    return kept


def flag_marks(hits: list[Hit], min_share: float = 0.15, min_cells: int = 3) -> list[str]:
    """Warn when some of an item's matches carry the same separate mark.

    A mark that doesn't touch the symbol is ignored when scoring, which is what
    keeps a neighbouring symbol from spoiling a match. But a variant can be
    exactly that: one firm draws tamper-resistant as the duplex plus a bar just
    clear of the circle. When the same mark sits in the same place beside
    several matches -- but not all of them -- it is probably such a variant.
    The matches stay counted; each gets a note, and a message says how to
    separate them: box one with its mark as an item of its own.
    """
    messages = []
    for item in dict.fromkeys(h.item for h in hits):
        mine = [h for h in hits if h.item == item and h.status == MATCH]
        if len(mine) < 4:
            continue
        seen = Counter(cell for h in mine for cell in h.halo)
        common = {cell for cell, n in seen.items() if n >= max(3, min_share * len(mine))}
        marked = [h for h in mine if len(h.halo & common) >= min_cells]
        if 3 <= len(marked) < len(mine):
            for h in marked:
                h.note = f"same separate mark beside {len(marked)} of {len(mine)} matches"
            messages.append(
                f"{item}: {len(marked)} of {len(mine)} matches have the same separate mark beside them, "
                "in the same place. It may be a neighbouring symbol (a data outlet beside each one) or a "
                "variant (a tamper-resistant bar). If it is a variant, box one with its mark as its own item.")
    return messages


# Labels printed beside a receptacle that make it a different item to price:
# the standard modifiers, and mounting heights. Anything else short near a
# symbol is as likely to be a letter inside a neighbouring symbol (the J of a
# junction box, the F of a fire alarm device) or a room name.
_MODIFIERS = {"GFI", "GFCI", "WP", "USB", "TR", "IG", "C", "SR", "E", "ER", "EX", "SP", "DED"}
_HEIGHT_RE = re.compile(r'^(?:\+?\d{1,3}(?:\.\d)?(?:"|”|IN)(?:AFF)?|\d{1,3}"?AFF|AFF|A\.F\.F\.?)$')
_TAG_RE = re.compile("^(?:" + "|".join(sorted(_MODIFIERS, key=len, reverse=True)) + ")$|" + _HEIGHT_RE.pattern)
_NOT_TAGS: set[str] = set()


def _blocks(words: list[dict]) -> list[list[dict]]:
    """Group words into small text blocks: the lines of one label, stacked or side by side."""
    n = len(words)
    parent = list(range(n))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    cells: dict[tuple, list[int]] = {}
    for i, w in enumerate(words):
        cells.setdefault((int(w["x0"] // 20), int(w["top"] // 20)), []).append(i)
    for (cx, cy), members in cells.items():
        near = [j for dx in (-1, 0, 1) for dy in (-1, 0, 1) for j in cells.get((cx + dx, cy + dy), ())]
        for i in members:
            a = words[i]
            h = max(a["bottom"] - a["top"], 1.0)
            for j in near:
                if j <= i:
                    continue
                b = words[j]
                gx = max(b["x0"] - a["x1"], a["x0"] - b["x1"], 0.0)
                gy = max(b["top"] - a["bottom"], a["top"] - b["bottom"], 0.0)
                if gx <= 1.5 * h and gy <= 0.6 * h:
                    ri, rj = root(i), root(j)
                    if ri != rj:
                        parent[ri] = rj
    groups: dict[int, list[dict]] = {}
    for i in range(n):
        groups.setdefault(root(i), []).append(words[i])
    return list(groups.values())


def attach_text(hits: list[Hit], pages: dict[int, Page]) -> None:
    """Give each hit the short labels printed beside it.

    Several firms tell GFI, WP, USB or a controlled receptacle apart only by a
    label next to the same graphic. The graphic is what gets counted; the label
    lets the estimator price it. Labels are often a little block of lines -- a
    circuit number, then WP, then GFI -- so whole blocks are placed: each goes
    to the nearest hit if any of its lines is close. Big blocks are notes, not
    labels, and are skipped.
    """
    for number, page in pages.items():
        mine = [h for h in hits if h.page == number]
        if not mine:
            continue
        found: dict[int, list[dict]] = {}
        for block in _blocks(page.words):
            if len(block) > 4:
                continue
            tagged = [w for w in block if (t := w["text"].upper().strip(",;:")) not in _NOT_TAGS
                      and not CIRCUIT_RE.match(t) and _TAG_RE.match(t)]
            if not tagged:
                continue
            best, best_d = None, None
            for k, h in enumerate(mine):
                d = min(math.hypot(max(w["x0"] - (h.x + h.hw), (h.x - h.hw) - w["x1"], 0.0),
                                   max(w["top"] - (h.y + h.hh), (h.y - h.hh) - w["bottom"], 0.0)) for w in block)
                if d <= max(8.0, 1.5 * max(h.hw, h.hh)) and (best_d is None or d < best_d):
                    best, best_d = k, d
            if best is not None:
                found.setdefault(best, []).extend(tagged)
        for k, words in found.items():
            words.sort(key=lambda w: (round(w["top"] / 3), w["x0"]))
            mine[k].text = " ".join(w["text"].strip(",;:") for w in words)
