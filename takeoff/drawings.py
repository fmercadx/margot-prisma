"""Vector geometry and text from a CAD-exported drawing set.

CAD plotters write every symbol as plain strokes. A duplex receptacle on a
typical set is a dozen one-segment paths for the circle and two for the bars,
written identically each time the block is inserted, only moved or rotated.
So shapes can be compared directly, with no rendering and no model.

A scanned set has no strokes at all: `load` reports that rather than guessing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
import pdfplumber

# Segments per cubic Bezier when flattening curves. Symbol arcs are a few
# points across, so this is far below the matching tolerance.
_BEZIER_STEPS = 8

# Sheet numbers as they appear in title blocks: E2.1, E-101, E001, ED101, FA1.0.
_SHEET_RE = re.compile(r"^[A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?[A-Z]?$")

# A legend sheet's heading. Plan sheets say "refer to E000 for symbols", so a
# bare "symbols" is not enough.
_LEGEND_RE = re.compile(r"\bSYMBOLS? LEGEND\b|\bLEGEND OF SYMBOLS\b|\bELECTRICAL SYMBOLS?\b(?! AND)")

# Circuit labels written beside devices: R1A-8, LP-1-12, R1K-10,12, 2LA-5,7,9.
CIRCUIT_RE = re.compile(r"^[A-Z0-9]{1,5}(?:-[A-Z0-9]{1,4})?-\d{1,3}(?:,\d{1,3})*$")


@dataclass
class Page:
    number: int                      # 1-based page index in the PDF
    width: float                     # PDF points
    height: float
    segs: np.ndarray                 # (n, 4) x0, y0, x1, y1; y grows downward
    style: np.ndarray                # (n,) index into `styles`
    styles: list[tuple]              # (stroke colour, line width) per index
    words: list[dict] = field(default_factory=list)
    sheet: str = ""                  # e.g. "E2.1"; "" when no title block found
    images: int = 0                  # embedded raster images on the page
    legend: bool = False             # looks like a symbol legend sheet
    cache: dict = field(default_factory=dict, repr=False, compare=False)

    def style_key(self, idx: int) -> tuple:
        return self.styles[idx]


def _colour(c) -> tuple:
    if c is None:
        return ()
    if isinstance(c, (int, float)):
        c = (c,)
    return tuple(round(float(v), 2) for v in c)


def _flatten(path) -> list[tuple[float, float, float, float]]:
    out, cur, start = [], None, None
    for cmd in path:
        op = cmd[0]
        if op == "m":
            cur = start = cmd[1]
        elif op == "l" and cur is not None:
            out.append((*cur, *cmd[1]))
            cur = cmd[1]
        elif op == "c" and cur is not None:
            (x0, y0), (x1, y1), (x2, y2), (x3, y3) = cur, cmd[1], cmd[2], cmd[3]
            prev = cur
            for i in range(1, _BEZIER_STEPS + 1):
                t = i / _BEZIER_STEPS
                a, b, c, d = (1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3
                pt = (a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3)
                out.append((*prev, *pt))
                prev = pt
            cur = cmd[3]
        elif op == "h" and cur is not None and start is not None:
            if cur != start:
                out.append((*cur, *start))
            cur = start
    return out


def _sheet_number(page) -> str:
    """The largest sheet-number-shaped word in the title block corner.

    Title blocks down the right edge often print the number sideways, reading
    bottom to top, so rotated text is read that way too and the biggest wins.
    """
    best, best_size = "", 0.0
    for direction in ("ttb", "btt"):
        for w in page.extract_words(char_dir_rotated=direction):
            if w["x0"] < page.width * 0.75 or w["top"] < page.height * 0.6:
                continue
            if not _SHEET_RE.match(w["text"]):
                continue
            size = (w["bottom"] - w["top"]) if w["upright"] else (w["x1"] - w["x0"])
            if size > best_size:
                best, best_size = w["text"], size
    return best


def load_page(pdf, index: int) -> Page:
    p = pdf.pages[index]
    segs, style_ids, styles, lookup = [], [], [], {}
    for kind in ("line", "curve", "rect"):
        for obj in p.objects.get(kind, []):
            if obj.get("stroke"):
                key = (_colour(obj.get("stroking_color")), round(float(obj.get("linewidth") or 0), 2))
            elif obj.get("fill"):
                key = (("fill",) + _colour(obj.get("non_stroking_color")), 0.0)
            else:
                continue
            sid = lookup.setdefault(key, len(styles))
            if sid == len(styles):
                styles.append(key)
            for s in _flatten(obj.get("path") or []):
                segs.append(s)
                style_ids.append(sid)
    words = p.extract_words()
    text = " ".join(w["text"].upper() for w in words)
    return Page(
        number=index + 1,
        width=float(p.width),
        height=float(p.height),
        segs=np.asarray(segs, dtype=np.float64).reshape(-1, 4),
        style=np.asarray(style_ids, dtype=np.int32),
        styles=styles,
        words=words,
        sheet=_sheet_number(p),
        images=len(p.images),
        # One copy of every symbol sits in the legend; counting it would add
        # one phantom device per item to the bid.
        legend=bool(_LEGEND_RE.search(text)),
    )


def load(path: str, pages: list[int] | None = None) -> list[Page]:
    """Load the given 1-based pages (all by default)."""
    with pdfplumber.open(path) as pdf:
        wanted = pages or list(range(1, len(pdf.pages) + 1))
        return [load_page(pdf, n - 1) for n in wanted]
