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
# search already covers it.
_SKIP_NEAR_QUARTER = 2.0
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


def _short(page: Page) -> np.ndarray:
    """Per segment: does it come from a path short enough to be a symbol part?"""
    if len(page.path) != len(page.segs):
        return np.ones(len(page.segs), dtype=bool)
    return page.path_extent[page.path] <= MAX_PART


@dataclass
class Seed:
    page: int
    box: tuple[float, float, float, float]   # x0, top, x1, bottom
    style: tuple                             # the pen; fills come with it
    pts: np.ndarray                          # samples, relative to box centre
    verts: np.ndarray                        # stroke endpoints, relative to box centre

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
    n = np.maximum(1, np.ceil(np.hypot(d[:, 0], d[:, 1]) / step).astype(np.int64))
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
    return Seed(page=page.number, box=box, style=style, pts=p - c, verts=v - c)


def seed_at(page: Page, x: float, y: float) -> Seed:
    """The example under a click: its whole symbol, in the pen that was clicked."""
    box, style = box_at(page, x, y)
    return make_seed(page, box, style)


def box_at(page: Page, x: float, y: float, reach: float = 25.0) -> tuple[tuple[float, float, float, float], tuple]:
    """The box around the symbol under a click, and the pen it is drawn in.

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
    p = np.concatenate([pts[i][inside[i]] for i in member])
    box = (float(p[:, 0].min()) - 1, float(p[:, 1].min()) - 1, float(p[:, 0].max()) + 1, float(p[:, 1].max()) + 1)
    return box, pen


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
    a, b = np.unravel_index(np.argmax(dists), dists.shape)
    d = float(dists[a, b])
    if d < 4:                           # too small to fix an angle
        return []
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
                R = np.array([[cc[k], -ss[k]], [ss[k], cc[k]]])
                T = R @ np.diag([-1.0, 1.0]) if mirror else R
                label = f"{math.degrees(math.atan2(ss[k], cc[k])) % 360:.0f}" + (" mirrored" if mirror else "")
                out.append((T, tt[k], label))
    return out


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


# Short labels printed beside a device: GFI, WP, USB, C, SR, TR, 48", +60" AFF.
_TAG_RE = re.compile(r'^(?:[A-Z]{1,4}\.?|\+?\d{1,3}(?:\.\d)?(?:"|”|IN)(?:AFF)?|\d{1,3}"?AFF|AFF|A\.F\.F\.?)$')
_NOT_TAGS = {"THE", "TO", "AND", "OF", "FOR", "IN", "AT", "ON", "BY", "OR", "NEW", "SEE", "TYP", "TYP.",
             "NOTE", "ALL", "EACH", "WITH", "FROM", "ABOVE", "BELOW", "MIN", "MAX", "NO", "NO."}


def attach_text(hits: list[Hit], pages: dict[int, Page]) -> None:
    """Give each hit the short labels printed beside it.

    Several firms tell GFI, WP, USB or a controlled receptacle apart only by a
    label next to the same graphic. The graphic is what gets counted; the label
    lets the estimator price it. Each label goes to the nearest hit only.
    """
    for number, page in pages.items():
        mine = [h for h in hits if h.page == number]
        if not mine:
            continue
        found: dict[int, list[dict]] = {}
        for w in page.words:
            t = w["text"].upper()
            if t in _NOT_TAGS or CIRCUIT_RE.match(t) or not _TAG_RE.match(t):
                continue
            cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
            best, best_d = None, None
            for k, h in enumerate(mine):
                d = math.hypot(max(abs(cx - h.x) - h.hw, 0.0), max(abs(cy - h.y) - h.hh, 0.0))
                if d <= max(6.0, 1.2 * max(h.hw, h.hh)) and (best_d is None or d < best_d):
                    best, best_d = k, d
            if best is not None:
                found.setdefault(best, []).append(w)
        for k, words in found.items():
            words.sort(key=lambda w: (round(w["top"] / 3), w["x0"]))
            mine[k].text = " ".join(w["text"] for w in words)
