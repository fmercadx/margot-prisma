"""The bridge between the page and the takeoff modules, run inside Pyodide.

The page renders the drawing with PDF.js and handles every click; this module
does the counting with the same drawings/match/report modules the command line
uses, unchanged. Everything crosses the boundary as JSON strings or bytes, so
the JavaScript side never holds a Python object.

Coordinates are pdfplumber's: PDF points from the top-left corner of the page
as displayed. `open_pdf` returns each page's crop box in those coordinates,
which is where PDF.js puts its canvas origin.
"""

from __future__ import annotations

import json

import pdfplumber

import drawings
import match
import report

PATH = "/tmp/drawing.pdf"

_pages: dict[int, drawings.Page] = {}
_seeds: dict[str, match.Seed] = {}
_hits: list[match.Hit] = []
_legend: set[int] = set()
_name = ""


def open_pdf(data, name: str = "") -> str:
    """Take the PDF's bytes; return page sizes and crop boxes."""
    global _name
    if hasattr(data, "to_bytes"):        # a JavaScript Uint8Array, via Pyodide
        data = data.to_bytes()
    with open(PATH, "wb") as f:
        f.write(bytes(data))
    _pages.clear()
    _seeds.clear()
    _hits.clear()
    _legend.clear()
    _name = name
    out = []
    with pdfplumber.open(PATH) as pdf:
        for i, p in enumerate(pdf.pages, 1):
            x0, top, x1, bottom = p.cropbox
            out.append({"page": i, "width": float(p.width), "height": float(p.height),
                        "crop": [float(x0), float(top), float(x1), float(bottom)]})
    return json.dumps(out)


def load(page: int) -> str:
    """Read one page's strokes and text (slow on a heavy sheet; cached)."""
    if page not in _pages:
        with pdfplumber.open(PATH) as pdf:
            _pages[page] = drawings.load_page(pdf, page - 1)
        if _pages[page].legend:
            _legend.add(page)
    p = _pages[page]
    return json.dumps({"page": page, "sheet": p.sheet, "legend": p.legend,
                       "strokes": int(len(p.segs)), "scanned": int(len(p.segs)) == 0})


def seed(name: str, page: int, x: float, y: float, box_json: str = "") -> str:
    """Make the example for an item from a click (or a box); return its box."""
    load(page)
    p = _pages[page]
    try:
        if box_json:
            s = match.make_seed(p, tuple(json.loads(box_json)))
        else:
            s = match.seed_at(p, x, y)
    except ValueError as e:
        return json.dumps({"error": str(e)})
    _seeds[name] = s
    return json.dumps({"box": [round(v, 2) for v in s.box], "inner": s.inner})


def forget(name: str) -> None:
    _seeds.pop(name, None)


def count(pages_json: str) -> str:
    """Find every item's copies on the given (already loaded) pages."""
    global _hits
    pages = json.loads(pages_json)
    hits: list[match.Hit] = []
    for n in pages:
        load(n)
        p = _pages[n]
        for name, s in _seeds.items():
            hits += match.find(p, s, name)
        p.cache.clear()
    hits = match.resolve(hits)
    match.attach_text(hits, {n: _pages[n] for n in pages})
    notes = match.flag_marks([h for h in hits if h.page not in _legend])
    _hits = hits
    return json.dumps({
        "hits": [{"id": k, "item": h.item, "page": h.page, "sheet": h.sheet, "x": h.x, "y": h.y,
                  "hw": h.hw, "hh": h.hh, "status": h.status, "coverage": h.coverage,
                  "purity": h.purity, "extra": h.extra, "orient": h.orient, "text": h.text,
                  "label": h.label, "also": h.also, "note": h.note}
                 for k, h in enumerate(hits)],
        "legend": sorted(_legend),
        "notes": notes,
    })


def xlsx(decisions_json: str = "{}"):
    """The spreadsheet, with the estimator's calls applied: bytes of an .xlsx.

    `decisions` maps a hit id to "count" or "drop". A counted review becomes a
    match; a dropped hit stays on the Locations tab as "dropped", uncounted.
    """
    decisions = {int(k): v for k, v in json.loads(decisions_json or "{}").items()}
    out = []
    for k, h in enumerate(_hits):
        d = decisions.get(k)
        if d == "count" and h.status != match.MATCH:
            h = _copy(h, status=match.MATCH, note=(h.note + "; " if h.note else "") + "counted by estimator")
        elif d == "drop":
            h = _copy(h, status="dropped", note=(h.note + "; " if h.note else "") + "dropped by estimator")
        out.append(h)
    sheets = {n: _pages[n].sheet for n in sorted({h.page for h in _hits} | set(_pages))}
    report.write_xlsx(out, sheets, "/tmp/takeoff.xlsx", source=_name, legend=_legend)
    with open("/tmp/takeoff.xlsx", "rb") as f:
        return f.read()


def _copy(h: match.Hit, **changes) -> match.Hit:
    from dataclasses import replace
    return replace(h, **changes)
