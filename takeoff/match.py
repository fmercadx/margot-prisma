"""Click one symbol, find every copy.

The seed is one example: the symbol under a click, or whatever a hand-drawn box
holds. Only its own pen (and solid fills in that colour) is kept -- on most sets
devices are drawn black over a grey architectural background, so this drops
walls and furniture -- and sampled into points. A copy elsewhere is the same
point set moved, turned by a multiple of 90 degrees and possibly mirrored. So
for every stroke endpoint on the page and every orientation we test the
hypothesis that it is one of the seed's anchor vertices, keep hypotheses whose
other vertices line up too, and score the survivors on all of the ink:

  coverage  share of the seed's ink found at the candidate
  purity    share of the candidate's ink that the seed explains, counting only
            strokes that touch the candidate. A line through the circle (the
            above-counter duplex) or a hatch inside it (GFCI) counts against
            it; a neighbouring data outlet poking into the box does not.
  extra     that unexplained touching ink as a length, in points

Thresholds sort candidates into MATCH and REVIEW. A REVIEW is shown to the
estimator, never silently counted or silently dropped.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from drawings import CIRCUIT_RE, Page

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
REVIEW_COVER, REVIEW_PURITY = 0.70, 0.60
# A candidate carrying more extra ink than this share of the example is a
# different symbol (an exit sign against a GFCI), not a near miss worth a look.
REVIEW_EXTRA = 0.20

# Rows act on (x, y) row vectors as p @ T.T. y grows downward, so "90" turns
# clockwise on the sheet. The last four are the mirror images.
TRANSFORMS = [np.array(m, dtype=np.float64) for m in (
    ((1, 0), (0, 1)), ((0, -1), (1, 0)), ((-1, 0), (0, -1)), ((0, 1), (-1, 0)),
    ((-1, 0), (0, 1)), ((0, 1), (1, 0)), ((1, 0), (0, -1)), ((0, -1), (-1, 0)),
)]
ORIENT = ["0", "90", "180", "270", "0 mirrored", "90 mirrored", "180 mirrored", "270 mirrored"]


def _fill_of(style: tuple) -> tuple:
    """The solid-fill key in the same colour as a stroke pen."""
    return (("fill",) + tuple(style[0]), 0.0)


def _ink(page: Page, style: tuple) -> np.ndarray:
    """Segments drawn with the pen, plus solid fills in its colour.

    A filled half-circle (GFCI) or a filled bar is part of the symbol it sits
    in, but a PDF writes the fill as a separate shape with no stroke.
    """
    ids = [i for i, s in enumerate(page.styles) if s == style or s == _fill_of(style)]
    return np.isin(page.style, ids)


@dataclass
class Seed:
    page: int
    box: tuple[float, float, float, float]   # x0, top, x1, bottom
    style: tuple                             # the pen; same-colour fills come with it
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
        strokes = [k for k in pts_by_style if page.styles[k][0][:1] != ("fill",)] or list(pts_by_style)
        style = page.styles[max(strokes, key=lambda k: len(pts_by_style[k]))]
    ink = near & _ink(page, style)
    c = np.array([(x0 + x1) / 2, (t + b) / 2])
    p = _distinct(sample(s[ink]))
    p = p[(p[:, 0] >= x0) & (p[:, 0] <= x1) & (p[:, 1] >= t) & (p[:, 1] <= b)]
    v = _endpoints(s[ink])
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
    that tells a duplex from a quad. Growth stops `reach` points from the
    click so a wire run drawn in the same pen can't swallow the sheet.
    """
    s = page.segs
    window = (np.maximum(s[:, 0], s[:, 2]) >= x - reach) & (np.minimum(s[:, 0], s[:, 2]) <= x + reach) \
        & (np.maximum(s[:, 1], s[:, 3]) >= y - reach) & (np.minimum(s[:, 1], s[:, 3]) <= y + reach)
    idx = np.flatnonzero(window)
    if not len(idx):
        raise ValueError(f"nothing drawn near ({x:.0f}, {y:.0f}) on page {page.number}")
    pts = [sample(s[i:i + 1]) for i in idx]
    dist = np.array([float(np.min(np.hypot(p[:, 0] - x, p[:, 1] - y))) for p in pts])
    close = np.flatnonzero(dist <= 3)
    if not len(close):
        raise ValueError(f"no stroke within 3 pt of ({x:.0f}, {y:.0f}) on page {page.number}")
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
    if pen[0][:1] == ("fill",):
        # Clicked a solid fill: the symbol's pen is the stroke in the same colour.
        strokes = [st for st in page.styles if st[0] == pen[0][1:]]
        pen = strokes[0] if strokes else pen
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
        segs = page.segs[_ink(page, seed.style)]
        pts, owner = _distinct(*sample(segs, with_index=True))
        verts = _endpoints(segs)
        order = np.argsort(pts[:, 0])
        page.cache[seed.style] = (pts[order], owner[order], verts,
                                  _Grid(pts, 0, 0, page.width, page.height),
                                  _Grid(verts, 0, 0, page.width, page.height))
    pts_x, owner_x, verts, pgrid, vgrid = page.cache[seed.style]
    if len(verts) == 0:
        return []
    hw, hh = seed.half
    sgrid = _Grid(seed.pts, -hw - 1, -hh - 1, hw + 1, hh + 1)
    seed_len = len(seed.pts) * STEP

    found: list[tuple[float, float, int, float, float, float]] = []
    for ti, T in enumerate(TRANSFORMS):
        sv, sp = seed.verts @ T.T, seed.pts @ T.T
        cands = np.concatenate([verts - a for a in _anchors(sv)])
        cands = np.unique(np.round(cands / (TOL / 2)), axis=0) * (TOL / 2)
        for lo in range(0, len(cands), 20000):
            c = cands[lo:lo + 20000]
            vscore = vgrid.hit(c[:, None, :] + sv[None, :, :]).mean(axis=1)
            c = c[vscore >= VERTEX_MIN]
            if not len(c):
                continue
            cover = pgrid.hit(c[:, None, :] + sp[None, :, :]).mean(axis=1)
            for (cx, cy), cov in zip(c[cover >= REVIEW_COVER], cover[cover >= REVIEW_COVER]):
                # The box on the sheet: half extents swap under a quarter turn.
                bw, bh = (hh, hw) if ti % 2 else (hw, hh)
                a, z = np.searchsorted(pts_x[:, 0], [cx - bw, cx + bw])
                q, qo = pts_x[a:z], owner_x[a:z]
                keep = np.abs(q[:, 1] - cy) <= bh
                q, qo = q[keep], qo[keep]
                explained = sgrid.hit((q - (cx, cy)) @ T)
                touching = np.isin(qo, qo[explained])
                extra = np.count_nonzero(~explained & touching)
                pur = explained.sum() / (explained.sum() + extra) if explained.any() else 0.0
                if pur >= REVIEW_PURITY and extra * STEP <= REVIEW_EXTRA * seed_len:
                    found.append((float(cx), float(cy), ti, float(cov), pur, extra * STEP))

    # One hit per copy: symmetric symbols match under several orientations,
    # and a symbol with a long tail also half-matches shifted along it.
    found.sort(key=lambda f: (-min(f[3], f[4]), f[5]))
    hits: list[Hit] = []
    for cx, cy, ti, cov, pur, extra in found:
        ok = cov >= MATCH_COVER and pur >= MATCH_PURITY and extra <= MATCH_EXTRA
        bw, bh = (hh, hw) if ti % 2 else (hw, hh)
        hit = Hit(item, page.number, page.sheet, cx, cy, bw, bh, ORIENT[ti], round(cov, 3),
                  round(float(pur), 3), MATCH if ok else REVIEW, round(float(extra), 1))
        if any(_iou(hit, h) > SAME_SPOT for h in hits):
            continue
        hit.label = _nearest_label(page, cx, cy, reach=3 * max(hw, hh))
        hits.append(hit)
    hits.sort(key=lambda h: (h.y, h.x))
    return hits


def resolve(hits: list[Hit]) -> list[Hit]:
    """One answer per spot when several items were searched.

    A quad receptacle half-matches a duplex example and fully matches a quad
    one; the spot belongs to the item that matched it best, and the others are
    noted in `also` so a reviewer can see what else it resembled.
    """
    ranked = sorted(hits, key=lambda h: (h.status != MATCH, -h.score))
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
