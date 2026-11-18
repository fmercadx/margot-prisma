"""Lengths: the sheet's scale, runs measured on it, and branch circuits.

An estimator prices conduit and wire by the foot. Three ways to get feet out
of a CAD-exported sheet, all at the scale printed under each drawing:

* **Trace** a route by clicking points along it.
* **Follow** a drawn line from one click: every stroke of the same pen joined
  to it end to end, across the gaps of a dashed line.
* **Circuits** from the devices already counted. Most power plans draw no wire
  at all; each receptacle carries its circuit (R1A-8), and the devices with
  the same label share a run. Plans that do draw wiring draw it as arcs that
  show which devices share a circuit, not where the conduit goes. Either way
  the estimator's method is device to device: each circuit here is the
  shortest set of runs along the building's axes joining its devices, plus a
  drop from the conduit down to each device, plus the homerun to the panel
  when the panel is on the same drawing.

Every number is a draft for the estimator: the route a circuit takes on site
is the installer's choice, so the spreadsheet carries the allowances (conduit
height, make-up, waste) as cells the estimator can change.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np

import match
from drawings import Page, circuit_text

# -- scale --------------------------------------------------------------------

_QUOTES = str.maketrans({"”": '"', "“": '"', "″": '"', "’": "'", "‘": "'",
                         "′": "'", "–": "-", "—": "-"})
# A whole number of inches and a fraction (1 1/2), a fraction (3/32) or a plain
# number, not glued to a sheet number before it (E-301 3/16" is 3/16").
_NUM = r"(?<![\d\-./])(?:\d{1,2}\s+\d{1,2}/\d{1,3}|\d{1,2}/\d{1,3}|\d{1,3}(?:\.\d+)?)"
_INCHES = r"(?:\d{1,2}\s+\d{1,2}/\d{1,3}|\d{1,2}/\d{1,3}|\d{1,2}(?:\.\d+)?)"
_ARCH = re.compile(rf"({_NUM})\s*(?:\"|IN\b|INCH\b)?\s*=\s*(\d{{1,4}}(?:\.\d+)?)\s*(?:'|FT\b|FEET\b)"
                   rf"(?:\s*-?\s*({_INCHES})\s*(?:\"|IN\b))?")
_RATIO = re.compile(r"(?<![\d/.:])1\s*:\s*(\d{1,5}(?:\.\d+)?)(?![\d/:])")
_NO_SCALE = re.compile(r"NOT\s+TO\s+SCALE|\bN\.?\s?T\.?\s?S\b|\bAS\s+NOTED\b|\bAS\s+SHOWN\b")
# Feet per point outside these bounds is not a drawing scale: 6" = 1'-0" is
# 0.0023, 1" = 200' is 2.8.
_SANE = (0.0005, 5.0)


def _number(text: str) -> float:
    total = 0.0
    for part in text.split():
        if "/" in part:
            a, b = part.split("/")
            total += float(a) / float(b)
        else:
            total += float(part)
    return total


def parse_scale(text: str) -> float | None:
    """Feet on the ground per PDF point on the sheet, from a scale as printed.

    Architectural (1/8" = 1'-0", 3/32 = 1'-0", 1 1/2" = 1'-0"), engineering
    (1" = 20') and metric ratios (SCALE 1:100). None for anything else,
    including NOT TO SCALE.
    """
    t = text.upper().translate(_QUOTES)
    if _NO_SCALE.search(t):
        return None
    m = _ARCH.search(t)
    if m:
        paper = _number(m.group(1))
        real = float(m.group(2)) + (_number(m.group(3)) / 12 if m.group(3) else 0.0)
        if paper > 0 and real > 0:
            f = real / (paper * 72)
            return f if _SANE[0] <= f <= _SANE[1] else None
    m = _RATIO.search(t)
    if m and float(m.group(1)) > 1:
        f = float(m.group(1)) / 72 / 12          # one point is 1/72 in of paper
        return f if _SANE[0] <= f <= _SANE[1] else None
    return None


@dataclass
class Scale:
    text: str                       # as printed, e.g. 1/8" = 1'-0"
    feet_per_point: float
    box: tuple = (0.0, 0.0, 0.0, 0.0)   # where it is printed: x0, top, x1, bottom
    source: str = "sheet"           # "sheet", "set by hand" or "two points"

    def feet(self, points: float) -> float:
        return points * self.feet_per_point


def _lines(words: list[dict]) -> list[list[dict]]:
    """Upright words grouped into lines, and lines split where a wide gap
    separates two pieces of text that merely share a baseline."""
    ups = sorted((w for w in words if w.get("upright", True)), key=lambda w: (w["top"], w["x0"]))
    rows: list[list[dict]] = []
    for w in ups:
        h = max(w["bottom"] - w["top"], 1.0)
        if rows and abs(rows[-1][0]["top"] - w["top"]) <= 0.35 * h:
            rows[-1].append(w)
        else:
            rows.append([w])
    out = []
    for row in rows:
        row.sort(key=lambda w: w["x0"])
        chunk = [row[0]]
        for w in row[1:]:
            if w["x0"] - chunk[-1]["x1"] > 2.5 * max(w["bottom"] - w["top"], 1.0):
                out.append(chunk)
                chunk = [w]
            else:
                chunk.append(w)
        out.append(chunk)
    return out


def scales(page: Page) -> list[Scale]:
    """Every drawing scale printed on the sheet.

    A row of four or more different scales on one line is a printed scale
    ruler along the sheet's edge, not a drawing's scale, and is left out.
    """
    found = []
    for chunk in _lines(page.words):
        text = " ".join(w["text"] for w in chunk)
        upper = text.upper()
        if len(text) > 48 and "SCALE" not in upper:
            continue                     # a sentence in a note, not a label
        if _RATIO.search(upper.translate(_QUOTES)) and not _ARCH.search(upper.translate(_QUOTES)) \
                and "SCALE" not in upper:
            continue                     # a bare 1:50 is as likely a ratio in a note
        f = parse_scale(text)
        if f is None:
            continue
        box = (min(w["x0"] for w in chunk), min(w["top"] for w in chunk),
               max(w["x1"] for w in chunk), max(w["bottom"] for w in chunk))
        found.append(Scale(_printed(text), f, box))
    def ruler(s: Scale) -> bool:
        row = {round(o.feet_per_point, 6) for o in found if abs(o.box[1] - s.box[1]) <= 3}
        return len(row) >= 4
    return [s for s in found if not ruler(s)]


def _printed(text: str) -> str:
    t = text.translate(_QUOTES)
    m = _ARCH.search(t.upper())
    if m:
        return t[m.start():m.end()].strip()
    m = _RATIO.search(t)
    return t[m.start():m.end()].strip() if m else t.strip()


def scale_at(page: Page, x: float, y: float) -> Scale | None:
    """The scale of the drawing a point lies in.

    A drawing's title and scale are printed below it, so the nearest scale
    below the point wins, distance across counting a tenth as much as distance
    down: drawings on a sheet are mostly stacked, and a graphic scale bar in
    the corner should not beat the title of the drawing above it.
    """
    found = scales(page)
    if not found:
        return None
    below = [s for s in found if s.box[1] >= y - 10] or found

    def cost(s: Scale) -> float:
        dx = max(s.box[0] - x, x - s.box[2], 0.0)
        return abs(s.box[1] - y) + 0.1 * dx
    return min(below, key=cost)


def distinct_scales(page: Page) -> list[str]:
    seen: dict[float, str] = {}
    for s in scales(page):
        seen.setdefault(round(s.feet_per_point, 6), s.text)
    return list(seen.values())


def scale_from_points(points: float, feet: float) -> Scale:
    """Calibrate: two points `points` apart on the sheet are `feet` apart on site."""
    if points <= 0 or feet <= 0:
        raise ValueError("pick two different points and give a distance above zero")
    return Scale(f"{feet:g} ft over {points:.1f} pt", feet / points, source="two points")


def scale_from_text(text: str) -> Scale:
    f = parse_scale(text)
    if f is None:
        raise ValueError(f"not a scale: {text!r}; write it the way the sheet does, e.g. 1/8\" = 1'-0\"")
    return Scale(_printed(text), f, source="set by hand")


def fmt_feet(feet: float) -> str:
    """12.5 -> 12'-6\" for display."""
    whole = int(feet)
    inches = round((feet - whole) * 12)
    if inches == 12:
        whole, inches = whole + 1, 0
    return f"{whole}'-{inches}\""


# -- a run on the sheet ----------------------------------------------------------

@dataclass
class Run:
    """A measured length: traced by hand or followed along a drawn line."""
    name: str
    page: int
    sheet: str
    how: str                         # "traced" or "followed"
    segs: list[tuple]                # what was measured, in points
    length: float                    # points
    scale: Scale | None
    conductors: int = 3
    note: str = ""

    @property
    def feet(self) -> float | None:
        return self.scale.feet(self.length) if self.scale else None


def trace(page: Page, points: list[tuple[float, float]], name: str = "", scale: Scale | None = None) -> Run:
    if len(points) < 2:
        raise ValueError("a traced run needs at least two points")
    segs = [(float(a[0]), float(a[1]), float(b[0]), float(b[1])) for a, b in zip(points, points[1:])]
    length = sum(math.hypot(s[2] - s[0], s[3] - s[1]) for s in segs)
    scale = scale or scale_at(page, *points[0])
    return Run(name or "Traced run", page.number, page.sheet, "traced", segs, length, scale,
               note="" if scale else "no scale printed on this sheet: set one")


# Gaps a dashed line leaves between its dashes are bridged when the next dash
# lies straight ahead: within this many points ...
_GAP_MAX = 12.0
# ... no more than this far off the line, and turned no more than this.
_GAP_SIDE = 0.8
_GAP_TURN = math.radians(20)
# Two strokes meeting end to end within this distance are joined.
_JOIN = 0.35


def _pen_strokes(page: Page, pen: tuple) -> np.ndarray:
    return np.flatnonzero(np.isin(page.style, [i for i, s in enumerate(page.styles) if s == pen]))


def nearest_stroke(page: Page, x: float, y: float, reach: float = 4.0) -> int | None:
    """The stroke (not a fill) nearest to a point, within `reach` points."""
    s = page.segs
    if not len(s):
        return None
    areas = [i for i, st in enumerate(page.styles) if match._is_area(st)]
    near = (np.maximum(s[:, 0], s[:, 2]) >= x - reach) & (np.minimum(s[:, 0], s[:, 2]) <= x + reach) \
        & (np.maximum(s[:, 1], s[:, 3]) >= y - reach) & (np.minimum(s[:, 1], s[:, 3]) <= y + reach) \
        & ~np.isin(page.style, areas)
    idx = np.flatnonzero(near)
    if not len(idx):
        return None
    d = _point_seg_dist(np.array([x, y]), s[idx])
    k = int(np.argmin(d))
    return int(idx[k]) if d[k] <= reach else None


def _point_seg_dist(p: np.ndarray, segs: np.ndarray) -> np.ndarray:
    a, b = segs[:, :2], segs[:, 2:]
    ab = b - a
    t = np.clip(((p - a) * ab).sum(axis=1) / np.maximum((ab * ab).sum(axis=1), 1e-12), 0, 1)
    return np.hypot(*(a + ab * t[:, None] - p).T)


class _PenGraph:
    """The strokes of one pen and how they join, for following lines."""

    def __init__(self, page: Page, pen: tuple):
        self.page = page
        self.s = s = page.segs
        self.pool = _pen_strokes(page, pen)
        self.connection = ~match._short(page)
        self.cells: dict[tuple[int, int], list[tuple[int, int]]] = {}
        self.coarse: dict[tuple[int, int], list[tuple[int, int]]] = {}
        for i in self.pool:
            for end in (0, 1):
                px, py = s[i, 2 * end], s[i, 2 * end + 1]
                self.cells.setdefault((int(px // _JOIN), int(py // _JOIN)), []).append((int(i), end))
                self.coarse.setdefault((int(px // _GAP_MAX), int(py // _GAP_MAX)), []).append((int(i), end))

    def touching(self, px: float, py: float):
        s = self.s
        cx, cy = int(px // _JOIN), int(py // _JOIN)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i, end in self.cells.get((cx + dx, cy + dy), ()):
                    if abs(s[i, 2 * end] - px) <= _JOIN and abs(s[i, 2 * end + 1] - py) <= _JOIN:
                        yield i, end

    def ahead(self, i: int, end: int):
        """The nearest dash straight ahead of stroke i's loose end: (gap, j, its end)."""
        s = self.s
        px, py = s[i, 2 * end], s[i, 2 * end + 1]
        ox, oy = s[i, 2 * (1 - end)], s[i, 2 * (1 - end) + 1]
        L = math.hypot(px - ox, py - oy)
        if L < 0.2:
            return None
        ux, uy = (px - ox) / L, (py - oy) / L
        best = None
        cx, cy = int(px // _GAP_MAX), int(py // _GAP_MAX)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j, e in self.coarse.get((cx + dx, cy + dy), ()):
                    if j == i:
                        continue
                    qx, qy = s[j, 2 * e], s[j, 2 * e + 1]
                    along = (qx - px) * ux + (qy - py) * uy
                    side = abs((qx - px) * uy - (qy - py) * ux)
                    if not (0.1 < along <= _GAP_MAX and side <= _GAP_SIDE + 0.05 * along):
                        continue
                    rx, ry = s[j, 2 * (1 - e)] - qx, s[j, 2 * (1 - e) + 1] - qy
                    rl = math.hypot(rx, ry)
                    if rl < 0.2 or math.acos(max(-1.0, min(1.0, (rx * ux + ry * uy) / rl))) > _GAP_TURN:
                        continue
                    if best is None or along < best[0]:
                        best = (along, j, e)
        return best

    def against_a_symbol(self, px: float, py: float, own: int) -> bool:
        """Does a line's loose end touch a symbol's strokes, in any pen?

        A dash ends in clear space; a wire ends against the receptacle it
        feeds. Only the first is a gap to bridge.
        """
        return _parts_near(self.page, px, py, own)

    def nearest_end(self, px: float, py: float, reach: float, skip: set[int]):
        """The stroke end nearest a point within `reach`, not in `skip`: (stroke, end, distance)."""
        s = self.s
        best, best_d = None, reach
        cx, cy = int(px // _GAP_MAX), int(py // _GAP_MAX)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j, e in self.coarse.get((cx + dx, cy + dy), ()):
                    if j in skip:
                        continue
                    d = math.hypot(s[j, 2 * e] - px, s[j, 2 * e + 1] - py)
                    if d <= best_d:
                        best, best_d = (j, e, d), d
        return best

    def grow(self, start: int) -> tuple[set[int], float, list[tuple[float, float]]]:
        """Strokes joined to `start`, the gaps bridged, and where the line ends."""
        s = self.s
        seen = {start}
        gaps = 0.0
        ends: list[tuple[float, float]] = []
        queue = [start]
        while queue and len(seen) <= 50000:
            i = queue.pop()
            for end in (0, 1):
                px, py = float(s[i, 2 * end]), float(s[i, 2 * end + 1])
                joined = [j for j, _ in self.touching(px, py) if j != i]
                # The line may enter connections, or a stroke carrying it
                # straight on (a dash in two pieces); not the arc of a
                # receptacle drawn in the same pen.
                nxt = [j for j in joined if self.connection[j] or (len(joined) == 1 and _straight_on(s, i, end, j))]
                for j in nxt:
                    if j not in seen:
                        seen.add(j)
                        queue.append(j)
                if nxt:
                    continue
                found = self.ahead(i, end) if not joined and not self.against_a_symbol(px, py, i) else None
                if found:
                    if found[1] not in seen:
                        gaps += found[0]
                        seen.add(found[1])
                        queue.append(found[1])
                else:
                    ends.append((px, py))
        return seen, gaps, ends


_PART_CELL = 8.0


def _parts_near(page: Page, px: float, py: float, own: int, reach: float = 0.5) -> bool:
    """Is any symbol part (a short stroke, any pen) other than `own` within `reach` of a point?"""
    index = page.cache.get("parts_index")
    if index is None:
        s = page.segs
        solid = [i for i, st in enumerate(page.styles) if st[0][:1] == ("solid",)]
        idx = np.flatnonzero(match._short(page) & ~np.isin(page.style, solid))
        lo = np.floor(np.minimum(s[idx, :2], s[idx, 2:]) / _PART_CELL).astype(np.intp)
        hi = np.floor(np.maximum(s[idx, :2], s[idx, 2:]) / _PART_CELL).astype(np.intp)
        index = {}
        for i, (ax, ay), (bx, by) in zip(idx.tolist(), lo.tolist(), hi.tolist()):
            for cx in range(ax, bx + 1):
                for cy in range(ay, by + 1):
                    index.setdefault((cx, cy), []).append(i)
        page.cache["parts_index"] = index
    cells = {(int(x // _PART_CELL), int(y // _PART_CELL)) for x in (px - reach, px + reach) for y in (py - reach, py + reach)}
    cand = list({i for c in cells for i in index.get(c, ()) if i != own})
    if not cand:
        return False
    return bool((_point_seg_dist(np.array([px, py]), page.segs[np.array(cand, dtype=np.intp)]) <= reach).any())


def _graph(page: Page, pen: tuple) -> _PenGraph:
    """One pen's join index, kept with the page while its cache lives."""
    key = ("pen graph", pen)
    if key not in page.cache:
        page.cache[key] = _PenGraph(page, pen)
    return page.cache[key]


def _measured(s: np.ndarray, strokes: set[int], gaps: float) -> tuple[np.ndarray, float]:
    """The strokes once each (exports often draw one twice over) and their length."""
    segs = s[np.array(sorted(strokes), dtype=np.intp)]
    a, b = segs[:, :2], segs[:, 2:]
    swap = (a[:, 0] > b[:, 0]) | ((a[:, 0] == b[:, 0]) & (a[:, 1] > b[:, 1]))
    lo, hi = np.where(swap[:, None], b, a), np.where(swap[:, None], a, b)
    _, keep = np.unique(np.round(np.column_stack([lo, hi]), 1), axis=0, return_index=True)
    segs = segs[np.sort(keep)]
    return segs, float(np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]).sum()) + gaps


def follow(page: Page, x: float, y: float, name: str = "", scale: Scale | None = None,
           reach: float = 4.0) -> Run:
    """The drawn line under a click, as far as it goes.

    Takes the stroke under the click and every stroke of the same pen joined
    to it end to end. Symbol parts are not crossed (a run stops where it meets
    a receptacle drawn in the same pen), and where a stroke ends with nothing
    joined to it, a dash straight ahead within a short gap carries the run on,
    which is how a dashed (concealed or underground) run is drawn. A stroke
    drawn twice over, as exports often do, is measured once.
    """
    start = nearest_stroke(page, x, y, reach)
    if start is None:
        raise ValueError(f"no line within {reach:g} pt of ({x:.0f}, {y:.0f}) on page {page.number}")
    graph = _graph(page, page.styles[page.style[start]])
    strokes, gaps, _ = graph.grow(start)
    segs, length = _measured(page.segs, strokes, gaps)
    scale = scale or scale_at(page, x, y)
    note = "" if scale else "no scale printed on this sheet: set one"
    if length > 4 * (page.width + page.height):
        note = "followed a very long network of lines in this pen: check what was measured"
    return Run(name or "Followed run", page.number, page.sheet, "followed",
               [tuple(map(float, r)) for r in segs], length, scale, note=note)


def _straight_on(s: np.ndarray, i: int, end: int, j: int) -> bool:
    """Does stroke j carry stroke i straight on from i's end `end`?"""
    p = s[i, 2 * end:2 * end + 2]
    u = p - s[i, 2 * (1 - end):2 * (1 - end) + 2]
    if np.hypot(*(s[j, :2] - p)) <= np.hypot(*(s[j, 2:] - p)):
        v = s[j, 2:] - s[j, :2]
    else:
        v = s[j, :2] - s[j, 2:]
    n = float(np.hypot(*u) * np.hypot(*v))
    return n > 0 and float(u @ v) / n > math.cos(math.radians(30))


# -- circuits ------------------------------------------------------------------

@dataclass
class Allowances:
    """What turns runs on a plan into feet of conduit and wire. Defaults are
    common for a commercial job with conduit above a ceiling; the spreadsheet
    lets the estimator change each one."""
    conduit_height: float = 10.0     # ft above the floor the conduit runs at
    device_height: float = 1.5       # ft, for devices with no height printed beside them
    makeup: float = 1.0              # ft of each conductor left in every box
    waste: float = 0.10


@dataclass
class Circuit:
    page: int
    sheet: str
    label: str                       # as printed beside the devices: R1A-8, LM-12,14
    panel: str                       # the panel it names: R1A
    devices: list[int]               # indices into the hit list
    items: str                       # "Duplex 4, Quad 1"
    route: list[tuple]               # device-to-device legs, along the sheet's axes
    route_ft: float
    homerun: list[tuple]             # leg to the panel; empty when the panel isn't on this drawing
    homerun_ft: float | None
    heights: list[float | None]      # printed height of each device, ft; None when none printed
    conductors: int
    scale: Scale | None
    note: str = ""

    @property
    def printed_heights(self) -> float:
        return sum(h for h in self.heights if h is not None)

    def drops(self, a: Allowances) -> float:
        return sum(max(0.0, a.conduit_height - (h if h is not None else a.device_height)) for h in self.heights)

    def conduit(self, a: Allowances) -> float:
        return (self.route_ft + (self.homerun_ft or 0.0) + self.drops(a)) * (1 + a.waste)

    def wire(self, a: Allowances) -> float:
        run = self.route_ft + (self.homerun_ft or 0.0) + self.drops(a)
        return (run * self.conductors + a.makeup * self.conductors * len(self.devices)) * (1 + a.waste)


# Circuit numbers in a label: R1K-10,12 is two circuits sharing a run.
def conductors_for(label: str) -> int:
    """A hot and a neutral per circuit, and one ground: 3 for one circuit."""
    tail = re.split(r"[-:]", label)[-1]
    return 2 * max(1, len([c for c in tail.split(",") if c])) + 1


def panel_of(label: str) -> str:
    return re.split(r"[-:](?=[\d,]+$)", label)[0]


_HEIGHT = re.compile(r'^\+?(\d{1,3}(?:\.\d)?)(?:"|”|IN)(?:AFF)?$|^(\d{1,3})"?AFF$')


def device_height(text: str) -> float | None:
    """A mounting height printed beside a device (48", 48" AFF, +18"), in feet."""
    for word in text.upper().replace(" AFF", "AFF").split():
        m = _HEIGHT.match(word.strip(",;"))
        if m:
            return float(m.group(1) or m.group(2)) / 12
    return None


_PANEL_WORD = re.compile(r"^(?:PANEL|PNL)(?:[-_](?P<name>[A-Z0-9][A-Z0-9\-]*))?$")
_NOT_NAMES = {"PANEL", "PANELS", "PNL", "NEW", "EXISTING", "EXIST", "(E)", "E", "BOARD", "BOARDS", "SCHEDULE",
              "SCHEDULES", "ABOVE", "BELOW", "LOCATION", "IN", "ON", "TO", "AT", "SEE", "THE", "AND", "FOR", "OF",
              "MAIN", "SUB", "WALL", "MTD", "MOUNTED", "RECESSED", "SURFACE"}


def _name(text: str) -> str | None:
    t = text.upper().strip('".,:;\'()\u201c\u201d')
    if not t or t in _NOT_NAMES or len(t) > 8 or not re.fullmatch(r"[A-Z0-9][A-Z0-9\-]*", t) or t.isdigit():
        return None
    return t


def panels(page: Page) -> dict[str, tuple[float, float]]:
    """Panels named on the sheet, and where.

    PNL-LM; PANEL "R1K"; PANEL with its name on the line below or just after
    it. Only short labels count: a PANEL in a sentence of a note is not where
    a panel is.
    """
    found: dict[str, tuple[float, float]] = {}
    words = [w for w in page.words if w.get("upright", True)]
    for block in match._blocks(page.words):
        if len(block) > 4:
            continue
        for k, w in enumerate(block):
            m = _PANEL_WORD.match(w["text"].upper().strip('".,:;\'()'))
            if not m:
                continue
            name = m.group("name")
            if not name:
                rest = [n for n in (_name(x["text"]) for x in block if x is not w) if n]
                name = rest[0] if rest else _name_beside(words, w)
            if name:
                found.setdefault(name, ((w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2))
    return found


def _name_beside(words: list[dict], w: dict) -> str | None:
    """A designation printed just after PANEL, or on the line below it."""
    h = max(w["bottom"] - w["top"], 1.0)
    best, best_d = None, None
    for o in words:
        if o is w:
            continue
        right = abs(o["top"] - w["top"]) <= 0.5 * h and 0 <= o["x0"] - w["x1"] <= 4 * h
        below = 0 <= o["top"] - w["bottom"] <= 1.2 * h and o["x0"] <= w["x1"] + 2 * h and o["x1"] >= w["x0"] - 2 * h
        if not (right or below):
            continue
        name = _name(o["text"])
        if name:
            d = math.hypot(o["x0"] - w["x1"], o["top"] - w["top"])
            if best_d is None or d < best_d:
                best, best_d = name, d
    return best


def _manhattan(a: tuple[float, float], b: tuple[float, float]) -> float:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def _leg(a: tuple[float, float], b: tuple[float, float]) -> list[tuple]:
    """Along x, then along y."""
    out = []
    if abs(a[0] - b[0]) > 1e-6:
        out.append((a[0], a[1], b[0], a[1]))
    if abs(a[1] - b[1]) > 1e-6:
        out.append((b[0], a[1], b[0], b[1]))
    return out


def _tree(points: list[tuple[float, float]]) -> list[tuple[int, int]]:
    """Minimum spanning tree under distance along the axes (Prim)."""
    n = len(points)
    if n < 2:
        return []
    inside = [False] * n
    best = [math.inf] * n
    parent = [-1] * n
    best[0] = 0.0
    edges = []
    for _ in range(n):
        k = min((i for i in range(n) if not inside[i]), key=lambda i: best[i])
        inside[k] = True
        if parent[k] >= 0:
            edges.append((parent[k], k))
        for j in range(n):
            if not inside[j]:
                d = _manhattan(points[k], points[j])
                if d < best[j]:
                    best[j], parent[j] = d, k
    return edges


# A circuit named where a homerun arrow ends: P2:14, 1P1-33, A-29, LP-1-12.
HOMERUN_RE = re.compile(r"^[A-Z0-9]{1,5}(?:[-:][A-Z0-9]{1,4})?[-:]\d{1,3}(?:,\d{1,3})*$")
_DEVICE_PAD = 3.0        # a wire ends on a device within this many points of its box
_LABEL_REACH = 20.0      # a homerun label sits within this many points of the arrow's tip
_LEADER_MAX = 120.0      # points: a leader or homerun arrow is no longer than this
_OWN_REACH = 40.0        # a circuit name belongs to the device nearest it, this close
_HOP = 3.5               # points across which a leader's arrowhead meets its shaft
_ARROW = 9.0             # points: an arrowhead's length, from where its shaft stops to its tip
_HOP_WITHIN = 25.0       # points of line from the label within which a hop may happen
_FORK_ARM = 5.0          # points: a leader's arm where it forks is at least this long


def _device_at(hits: list[match.Hit], members: list[int], x: float, y: float) -> int | None:
    best, best_d = None, None
    for k in members:
        h = hits[k]
        dx, dy = abs(x - h.x) - h.hw, abs(y - h.y) - h.hh
        if dx <= _DEVICE_PAD and dy <= _DEVICE_PAD:
            d = max(dx, dy)
            if best_d is None or d < best_d:
                best, best_d = k, d
    return best


def _homerun_label(page: Page, x: float, y: float, reach: float = _LABEL_REACH) -> str:
    best, best_d = "", reach
    allowed = circuit_names(page)
    for w in page.words:
        t = circuit_text(w["text"], HOMERUN_RE)
        if not t or t not in allowed:
            continue
        d = math.hypot(max(w["x0"] - x, x - w["x1"], 0.0), max(w["top"] - y, y - w["bottom"], 0.0))
        if d < best_d:
            best, best_d = t, d
    return best


def circuit_names(page: Page) -> set[str]:
    """The circuit labels on a sheet that name circuits, not equipment.

    Equipment tags are written the same way (1-V-5 for a VAV box, EWH-2 for a
    water heater, EF-1 for a fan). Circuits on one sheet come from a few
    panels, each named again and again, and are all written alike (P2:14, or
    R1A-8): the busiest prefix, a panel named on the sheet, and any prefix used
    at least a tenth as often as the busiest are panels; any other is a tag.
    """
    key = "circuit names"
    if key in page.cache:
        return page.cache[key]
    found = [t for t in (circuit_text(w["text"], HOMERUN_RE) for w in page.words) if t]
    counts: dict[str, int] = {}
    for t in found:
        counts[panel_of(t)] = counts.get(panel_of(t), 0) + 1
    names: set[str] = set()
    if counts:
        top = max(counts, key=counts.get)
        sep = ":" if ":" in found[[panel_of(t) for t in found].index(top)] else "-"
        named = set(panels(page))
        keep = {pfx for pfx, n in counts.items() if pfx == top or pfx in named or n >= max(4, 0.1 * counts[top])}
        names = {t for t in found if panel_of(t) in keep and t[len(panel_of(t))] == sep}
    page.cache[key] = names
    return names


def label_owners(page: Page, hits: list[match.Hit], members: list[int]) -> dict[int, list[tuple[str, str]]]:
    """Which counted device each circuit name on the sheet belongs to, and how
    we know: {device: [(name, "arrow" | "near")]}.

    A name printed away from its device has a line to it: a leader, or the
    short arrow of a homerun, in any pen. From the name's label (the little
    block of text it is part of, e.g. 48" AFF, LM-20, SR), the strokes
    starting at it are followed a short way, through any stroke, until one
    ends on a device; one leader may fork to two receptacles. A name with no
    line is given to the device nearest it, if no other is nearly as near.
    """
    s = page.segs
    areas = [i for i, st in enumerate(page.styles) if match._is_area(st)]
    stroke = ~np.isin(page.style, areas)
    boxes = [(k, hits[k].x - hits[k].hw - 2, hits[k].y - hits[k].hh - 2,
              hits[k].x + hits[k].hw + 2, hits[k].y + hits[k].hh + 2) for k in members]

    def device_of(px, py):
        for k, x0, t, x1, b in boxes:
            if x0 <= px <= x1 and t <= py <= b:
                return k
        return None

    block_of: dict[int, list[dict]] = {}
    for block in match._blocks(page.words):
        for w in block:
            block_of[id(w)] = block
    out: dict[int, list[tuple[str, str]]] = {}
    loose: list[tuple[dict, str]] = []
    allowed = circuit_names(page)
    for w in page.words:
        name = circuit_text(w["text"], HOMERUN_RE)
        if not name or name not in allowed:
            continue
        # The label is the lines of the same text size around the name: a
        # room name printed close by is bigger, and not part of it.
        h0 = max(w["bottom"] - w["top"], 1.0)
        block = [b for b in block_of.get(id(w), [w])
                 if abs((b["bottom"] - b["top"]) - h0) <= 0.15 * h0 and abs(b["top"] - w["top"]) <= 1.4 * h0]
        if len(block) > 6 or sum(1 for b in block if circuit_text(b["text"], HOMERUN_RE)) > 1:
            block = [w]          # a note, or two labels stacked close: only the word itself
        x0 = min(b["x0"] for b in block) - 5
        t = min(b["top"] for b in block) - 5
        x1 = max(b["x1"] for b in block) + 5
        b_ = max(b["bottom"] for b in block) + 5
        a_in = (s[:, 0] >= x0) & (s[:, 0] <= x1) & (s[:, 1] >= t) & (s[:, 1] <= b_)
        b_in = (s[:, 2] >= x0) & (s[:, 2] <= x1) & (s[:, 3] >= t) & (s[:, 3] <= b_)
        # Strokes leaving the label: one end at it, the other out. Longest
        # first: a leader's shaft, before the hatching and lettering nearby.
        leaving = np.flatnonzero(stroke & (a_in ^ b_in))
        leaving = leaving[np.argsort(-np.hypot(s[leaving, 2] - s[leaving, 0], s[leaving, 3] - s[leaving, 1]),
                                     kind="stable")]
        found: set[int] = set()
        for i in leaving[:40]:
            i = int(i)
            # A stroke at a device is the device, or wiring at it, not a
            # leader leaving the label: a device right beside its label is
            # found by nearness below.
            if device_of(s[i, 0], s[i, 1]) is not None or device_of(s[i, 2], s[i, 3]) is not None:
                continue
            found |= _leader_devices(_graph(page, page.styles[page.style[i]]), i, (x0, t, x1, b_), device_of)
        if not found:
            loose.append((w, name))
        for k in found:
            if name not in [n for n, _ in out.get(k, [])]:
                out.setdefault(k, []).append((name, "arrow"))

    # Names with no line to a device go to the nearest one, closest pairs
    # first, each name to one device and each device to one name: two
    # receptacles side by side, each with its label, are not both given the
    # nearer label.
    pairs = []
    for li, (w, name) in enumerate(loose):
        for k in members:
            h = hits[k]
            d = math.hypot(max(w["x0"] - (h.x + h.hw), (h.x - h.hw) - w["x1"], 0.0),
                           max(w["top"] - (h.y + h.hh), (h.y - h.hh) - w["bottom"], 0.0))
            if d <= _OWN_REACH:
                pairs.append((d, li, k))
    taken_label, taken_device = set(), {k for k, v in out.items() if v}
    for d, li, k in sorted(pairs):
        if li in taken_label or k in taken_device:
            continue
        taken_label.add(li)
        taken_device.add(k)
        out.setdefault(k, []).append((loose[li][1], "near"))
    return out


def _leader_devices(graph: _PenGraph, start: int, label_box, device_of) -> set[int]:
    """Devices a short line from a label reaches.

    A leader is one line: it is followed stroke by stroke while it runs on
    alone, and where it meets other strokes (a symbol, a junction) it ends.
    It reaches a device if it ends on one, or points at one from just short of
    it, as a line ending at an arrowhead's base does. An arrowhead drawn as a
    V or a triangle meets its shaft a little off its corners, so when the line
    runs out it may hop, a few times, to the nearest loose end close by.
    """
    s = graph.s
    lx0, lt, lx1, lb = label_box
    a_in = lx0 <= s[start, 0] <= lx1 and lt <= s[start, 1] <= lb
    b_in = lx0 <= s[start, 2] <= lx1 and lt <= s[start, 3] <= lb
    if a_in and b_in:
        return set()                  # wholly beside the text: an underline, a box edge
    seen = {start}
    length = float(np.hypot(s[start, 2] - s[start, 0], s[start, 3] - s[start, 1]))
    frontier = [(start, 1 if a_in else 0)]     # leave the label by the far end
    visited: list[tuple[float, float]] = []
    found: set[int] = set()
    hops = 0

    def ends_at(i, end):
        px, py = float(s[i, 2 * end]), float(s[i, 2 * end + 1])
        k = device_of(px, py)
        if k is not None:
            return k
        ux, uy = px - s[i, 2 * (1 - end)], py - s[i, 2 * (1 - end) + 1]
        n = math.hypot(ux, uy)
        if n < 0.2:
            return None
        for t in range(1, int(_ARROW) + 1):
            k = device_of(px + ux / n * t, py + uy / n * t)
            if k is not None:
                return k
        return None

    while len(seen) < 80 and length <= _LEADER_MAX:
        if not frontier:
            # Hops are for the arrowhead at the label's end of the line only:
            # further on they would jump from line to line across the sheet.
            if found or hops >= 3 or length > _HOP_WITHIN:
                break
            best = None
            for px, py in visited:
                hop = graph.nearest_end(px, py, _HOP, seen)
                if hop and (best is None or hop[2] < best[2]):
                    best = hop
            if best is None:
                break
            j, e, _ = best
            hops += 1
            seen.add(j)
            length += float(np.hypot(s[j, 2] - s[j, 0], s[j, 3] - s[j, 1]))
            frontier.append((j, 1 - e))
            continue
        i, end = frontier.pop()
        px, py = float(s[i, 2 * end]), float(s[i, 2 * end + 1])
        visited.append((px, py))
        if device_of(px, py) is not None:
            found.add(device_of(px, py))
            continue
        nxt = [(j, e) for j, e in graph.touching(px, py) if j not in seen]
        lengths = [float(np.hypot(s[j, 2] - s[j, 0], s[j, 3] - s[j, 1])) for j, _ in nxt]
        # On along the line; and where it forks into arms of its own (one
        # leader to two receptacles), along each. A symbol's outline is
        # short strokes, and stops it.
        if len(nxt) == 1 or (2 <= len(nxt) <= 3 and min(lengths) >= _FORK_ARM):
            for (j, e), L in zip(nxt, lengths):
                seen.add(j)
                length += L
                frontier.append((j, 1 - e))
            continue
        # The line ends here. Where it meets a symbol, it reaches that symbol
        # and nothing past it; at a loose end it may stop at an arrowhead's
        # base, pointing at the device just ahead.
        k = ends_at(i, end) if not nxt else device_of(px, py)
        if k is not None:
            found.add(k)
        for j, _ in nxt:
            seen.add(j)                 # don't wander into the symbol
    return found if length <= _LEADER_MAX else set()


@dataclass
class Wiring:
    """What a sheet's drawn wiring says: which devices share a run."""
    pen: tuple
    links: list[tuple[int, int]]          # hit indices joined by a drawn wire
    labels: list[tuple[int, str]]         # hit index, circuit named at its homerun arrow
    wired: set[int] = field(default_factory=set)


def wiring(page: Page, hits: list[match.Hit], members: list[int], pen: tuple) -> Wiring:
    """Follow every line drawn in `pen` and see which devices each one joins.

    A line with devices at both ends joins them; a line from a device to a
    loose end with a circuit label beside it is the homerun and names the
    circuit. The line's own length is not used: wiring arcs show which devices
    share a circuit, not where the conduit runs.
    """
    graph = _graph(page, pen)
    done: set[int] = set()
    out = Wiring(pen, [], [])
    for i in graph.pool:
        i = int(i)
        if i in done or not graph.connection[i]:
            continue
        strokes, _, ends = graph.grow(i)
        done |= strokes
        at = [_device_at(hits, members, *p) for p in ends]
        # A device the line passes through counts too: two arcs drawn to the
        # same point on a receptacle join there and run on as one line.
        pts = np.concatenate([page.segs[sorted(strokes), :2], page.segs[sorted(strokes), 2:]])
        through = {k for k in members
                   if ((np.abs(pts[:, 0] - hits[k].x) <= hits[k].hw) & (np.abs(pts[:, 1] - hits[k].y) <= hits[k].hh)).any()}
        devices = sorted({d for d in at if d is not None} | through)
        if not devices:
            continue
        out.wired |= set(devices)
        pts = [(hits[k].x, hits[k].y) for k in devices]
        out.links += [(devices[a], devices[b]) for a, b in _tree(pts)]
        for p, d in zip(ends, at):
            if d is None:
                label = _homerun_label(page, *p)
                if label:
                    out.labels.append((devices[0], label))
    return out


def find_wiring(page: Page, hits: list[match.Hit], members: list[int]) -> Wiring | None:
    """The pen a sheet draws its circuit wiring in, if it draws any.

    Only asked of sheets where few devices carry a circuit label, since a plan
    either labels every device or draws the wiring. The pen whose lines join
    the most pairs of devices wins, if it joins enough of them to be wiring
    rather than a wall or leader that happens to meet a device.
    """
    if len(members) < 2:
        return None
    conn = ~match._short(page)
    s = page.segs
    tally: dict[int, int] = {}
    for k in members:
        h = hits[k]
        x0, x1, t, b = h.x - h.hw - _DEVICE_PAD, h.x + h.hw + _DEVICE_PAD, h.y - h.hh - _DEVICE_PAD, h.y + h.hh + _DEVICE_PAD
        for e in (0, 2):
            ends = conn & (s[:, e] >= x0) & (s[:, e] <= x1) & (s[:, e + 1] >= t) & (s[:, e + 1] <= b)
            for sid in np.unique(page.style[ends]):
                tally[int(sid)] = tally.get(int(sid), 0) + 1
    best = None
    for sid, _ in sorted(tally.items(), key=lambda kv: -kv[1])[:3]:
        pen = page.styles[sid]
        if match._is_area(pen):
            continue
        w = wiring(page, hits, members, pen)
        if best is None or len(w.links) > len(best.links):
            best = w
    if best is None or len(best.links) < max(4, 0.15 * len(members)) or len(best.labels) == 0:
        return None
    return best


def circuits(hits: list[match.Hit], pages: dict[int, Page], skip: set[int] = frozenset(),
             panel_at: dict[tuple[int, str], tuple[float, float]] | None = None,
             scale_for: dict[int, Scale] | None = None,
             wire_pens: dict[int, tuple | None] | None = None) -> tuple[list[Circuit], list[str]]:
    """Branch circuits from the counted devices.

    On a sheet that labels its devices, devices with the same circuit label
    share a circuit, joined by the shortest runs along the sheet's axes. On a
    sheet that draws its wiring instead, the drawn lines say which devices
    share a run and the label at each homerun arrow names the circuit; each
    drawn link is measured device to device along the axes.

    `skip` holds hit indices not to use (dropped by the estimator). An
    enlarged plan that repeats part of the floor plan keeps its own circuits.
    `panel_at` places panels by hand, {(page, name): (x, y)}; `scale_for`
    overrides the printed scale per page; `wire_pens` gives a sheet's wiring
    pen by hand ({page: pen}), or None to use labels even if wiring is drawn.

    Returns the circuits and plain-language notes about what was left out.
    """
    panel_at = panel_at or {}
    scale_for = scale_for or {}
    wire_pens = wire_pens if wire_pens is not None else {}
    by_page: dict[int, list[int]] = {}
    to_review: dict[int, int] = {}
    for k, h in enumerate(hits):
        if k in skip or h.page not in pages or pages[h.page].legend:
            continue
        if h.status == match.REVIEW:
            # Lengths follow the count: a device still to review joins its
            # circuit when the estimator counts it.
            to_review[h.page] = to_review.get(h.page, 0) + 1
            continue
        if h.status == match.MATCH:
            by_page.setdefault(h.page, []).append(k)

    out: list[Circuit] = []
    messages: list[str] = []
    for pno, members in sorted(by_page.items()):
        page = pages[pno]
        sheet = page.sheet or f"page {pno}"
        # A label an arrow leads from to the device beats one merely beside
        # it, which beats one that is only nearer this device than any other.
        owners = label_owners(page, hits, members)
        allowed = circuit_names(page)
        label_of = {k: n for k, v in owners.items() for n, how in v[:1] if how == "arrow"}
        label_of.update({k: hits[k].label for k in members
                         if hits[k].label in allowed and k not in label_of})
        label_of.update({k: v[0][0] for k, v in owners.items() if k not in label_of})
        labelled = [k for k in members if k in label_of]
        drawn = None
        if pno in wire_pens:
            if wire_pens[pno] is not None:
                drawn = wiring(page, hits, members, wire_pens[pno])
        elif sum(1 for k in members if hits[k].label in circuit_names(page)) < 0.3 * len(members):
            # Few labels printed right beside the devices: the plan may draw
            # its wiring and name circuits only at the homeruns.
            drawn = find_wiring(page, hits, members)

        groups: list[tuple[str, list[int], list[tuple[int, int]]]] = []
        if drawn is not None:
            parent = {k: k for k in members}

            def root(k):
                while parent[k] != k:
                    parent[k] = parent[parent[k]]
                    k = parent[k]
                return k
            for a, b in drawn.links:
                parent[root(a)] = root(b)
            # A device whose only line is its homerun, drawn in another pen
            # than the wiring, is a circuit of one.
            drawn.wired |= {k for k, v in owners.items() if any(how == "arrow" for _, how in v)}
            sets: dict[int, list[int]] = {}
            for k in sorted(drawn.wired):
                sets.setdefault(root(k), []).append(k)
            # Names come from homerun arrows: the drawn wire's own loose end,
            # or an arrow from a label. A label only near a device names the
            # circuit when nothing else does.
            names: dict[int, list[str]] = {}
            arrows = drawn.labels + [(k, n) for k in sorted(drawn.wired) for n, how in owners.get(k, []) if how == "arrow"]
            for k, label in arrows:
                names.setdefault(root(k), [])
                if label not in names[root(k)]:
                    names[root(k)].append(label)
            for k in sorted(drawn.wired):
                if names.get(root(k)):
                    continue
                fallback = (hits[k].label if hits[k].label in allowed else "") \
                    or next((n for n, _ in owners.get(k, [])), "")
                if fallback:
                    names[root(k)] = [fallback]
            for r, ks in sets.items():
                links = [(a, b) for a, b in drawn.links if root(a) == r]
                groups.append((", ".join(names.get(r, [])), ks, links))
            left = len(members) - len(drawn.wired)
            if left:
                messages.append(f"{sheet}: {left} counted device{'s' if left > 1 else ''} not on any drawn wire "
                                f"{'are' if left > 1 else 'is'} in no circuit")
        else:
            keyed: dict[tuple, list[int]] = {}
            for k in labelled:
                sc = scale_for.get(pno) or scale_at(page, hits[k].x, hits[k].y)
                keyed.setdefault((sc.box if sc else None, label_of[k]), []).append(k)
            for (_, label), ks in keyed.items():
                pts = [(hits[k].x, hits[k].y) for k in ks]
                groups.append((label, ks, [(ks[a], ks[b]) for a, b in _tree(pts)]))
            left = len(members) - len(labelled)
            if left:
                messages.append(f"{sheet}: {left} counted device{'s' if left > 1 else ''} with no circuit label "
                                f"beside {'them are' if left > 1 else 'it is'} in no circuit")

        found_panels = panels(page)
        for label, ks, links in sorted(groups, key=lambda g: (not g[0], _label_key(g[0]), g[1][0])):
            out.append(_circuit(hits, page, label, ks, links, found_panels, panel_at, scale_for))
        if len(distinct_scales(page)) > 1 and groups:
            messages.append(f"{sheet} has drawings at {' and '.join(distinct_scales(page))}: each circuit "
                            "uses the scale printed under its own drawing; check the Scale column")
        if drawn is not None:
            unnamed = sum(1 for g in groups if not g[0])
            if unnamed:
                messages.append(f"{sheet}: circuits from the drawn wiring; {unnamed} of {len(groups)} have no "
                                "homerun label next to an arrow and are listed unnamed")
    for pno, n in sorted(to_review.items()):
        sheet = pages[pno].sheet or f"page {pno}"
        messages.append(f"{sheet}: {n} device{'s' if n > 1 else ''} still to review {'are' if n > 1 else 'is'} in no "
                        "circuit until counted")
    return out, messages


def _circuit(hits, page: Page, label: str, ks: list[int], links: list[tuple[int, int]],
             found_panels: dict, panel_at: dict, scale_for: dict) -> Circuit:
    pno = page.number
    pts = {k: (hits[k].x, hits[k].y) for k in ks}
    sc = scale_for.get(pno) or scale_at(page, *pts[ks[0]])
    route, length = [], 0.0
    for a, b in links:
        route += _leg(pts[a], pts[b])
        length += _manhattan(pts[a], pts[b])
    names = [panel_of(x.strip()) for x in label.split(", ")] if label else []
    name = names[0] if names else ""
    notes = []
    spot = panel_at.get((pno, name)) if name else None
    if spot is None and name in found_panels:
        spot = found_panels[name]
        other = scale_for.get(pno) or scale_at(page, *spot)
        if sc and other and other.box != sc.box:
            spot = None                 # named on another drawing of the sheet
    homerun, homerun_ft = [], None
    if spot is not None:
        near = min(pts.values(), key=lambda p: _manhattan(p, spot))
        homerun = _leg(near, spot)
        homerun_ft = sc.feet(_manhattan(near, spot)) if sc else None
    elif name:
        notes.append(f"panel {name} not found on this drawing: add the homerun")
    else:
        notes.append("no circuit label: add the homerun")
    if sc is None:
        notes.append("no scale printed on this sheet: set one")
    counts: dict[str, int] = {}
    for k in ks:
        counts[hits[k].item] = counts.get(hits[k].item, 0) + 1
    conductors = sum(conductors_for(x) for x in label.split(", ")) - (len(names) - 1) if label else 3
    return Circuit(
        page=pno, sheet=page.sheet, label=label, panel=name, devices=list(ks),
        items=", ".join(f"{i} {n}" for i, n in counts.items()),
        route=route, route_ft=sc.feet(length) if sc else 0.0,
        homerun=homerun, homerun_ft=homerun_ft,
        heights=[device_height(hits[k].text) for k in ks],
        conductors=conductors, scale=sc, note="; ".join(notes))


def _label_key(label: str):
    parts = re.split(r"(\d+)", label)
    return [int(p) if p.isdigit() else p for p in parts]
