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
import measure
import report

PATH = "/tmp/drawing.pdf"

_pages: dict[int, drawings.Page] = {}
_seeds: dict[str, match.Seed] = {}
_hits: list[match.Hit] = []
_legend: set[int] = set()
_name = ""
_scale_for: dict[int, measure.Scale] = {}         # scales set by hand, per page
_runs: dict[int, measure.Run] = {}                # traced and followed runs, by id
_panels: dict[tuple[int, str], tuple[float, float]] = {}   # panels placed by hand
_wire_pens: dict[int, tuple | None] = {}          # a sheet's wiring pen by hand; None: use labels
_run_id = 0


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
    _scale_for.clear()
    _runs.clear()
    _panels.clear()
    _wire_pens.clear()
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


# -- lengths -------------------------------------------------------------------

def _scale_json(s: measure.Scale | None):
    if s is None:
        return None
    return {"text": s.text, "feet_per_point": s.feet_per_point, "box": [round(v, 1) for v in s.box],
            "source": s.source}


def scale_info(page: int) -> str:
    """The scales printed on a sheet, and the one set by hand if any."""
    load(page)
    p = _pages[page]
    return json.dumps({"page": page, "printed": [_scale_json(s) for s in measure.scales(p)],
                       "distinct": measure.distinct_scales(p), "set": _scale_json(_scale_for.get(page))})


def set_scale(page: int, how: str, value: str) -> str:
    """Set a page's scale by hand: how is "text" (as printed, e.g. 1/8" = 1'-0"),
    "points" (JSON [points apart on the sheet, feet apart on site]) or "clear"."""
    try:
        if how == "clear":
            _scale_for.pop(page, None)
        elif how == "text":
            _scale_for[page] = measure.scale_from_text(value)
        elif how == "points":
            pts, feet = json.loads(value)
            _scale_for[page] = measure.scale_from_points(float(pts), float(feet))
        else:
            raise ValueError(f"unknown way to set a scale: {how}")
    except ValueError as e:
        return json.dumps({"error": str(e)})
    for r in _runs.values():            # runs on that page follow the new scale
        if r.page == page:
            r.scale = _scale_for.get(page) or measure.scale_at(_pages[page], r.segs[0][0], r.segs[0][1])
    return json.dumps({"set": _scale_json(_scale_for.get(page)), "runs": _runs_json()})


def _run_json(k: int, r: measure.Run) -> dict:
    return {"id": k, "name": r.name, "page": r.page, "sheet": r.sheet, "how": r.how,
            "segs": [[round(v, 2) for v in s] for s in r.segs], "length": r.length, "feet": r.feet,
            "scale": _scale_json(r.scale), "conductors": r.conductors, "note": r.note}


def _runs_json() -> list:
    return [_run_json(k, r) for k, r in sorted(_runs.items())]


def measure_run(how: str, page: int, points_json: str, name: str = "") -> str:
    """Trace a run through the given points, or follow the line under the
    first one. Returns the run, or an error."""
    global _run_id
    load(page)
    p = _pages[page]
    pts = [tuple(map(float, q)) for q in json.loads(points_json)]
    try:
        if how == "trace":
            r = measure.trace(p, pts, name, _scale_for.get(page))
        else:
            r = measure.follow(p, pts[0][0], pts[0][1], name, _scale_for.get(page), reach=float(pts[1][0]) if len(pts) > 1 else 4.0)
    except ValueError as e:
        return json.dumps({"error": str(e)})
    _run_id += 1
    _runs[_run_id] = r
    return json.dumps(_run_json(_run_id, r))


def edit_run(run_id: int, changes_json: str) -> str:
    r = _runs.get(int(run_id))
    if r is not None:
        ch = json.loads(changes_json)
        if "name" in ch:
            r.name = str(ch["name"]) or r.name
        if "conductors" in ch:
            r.conductors = max(1, int(ch["conductors"]))
    return json.dumps(_runs_json())


def forget_run(run_id: int) -> str:
    _runs.pop(int(run_id), None)
    return json.dumps(_runs_json())


def set_panel(page: int, name: str, x: float, y: float) -> None:
    _panels[(int(page), name)] = (float(x), float(y))


def set_wires(page: int, x: float, y: float, use_labels: bool = False) -> str:
    """Use the pen of the line under (x, y) as the sheet's wiring, or labels."""
    load(page)
    p = _pages[page]
    if use_labels:
        _wire_pens[page] = None
        return json.dumps({"ok": True})
    k = measure.nearest_stroke(p, x, y)
    if k is None:
        return json.dumps({"error": "no line there: click right on one drawn wire"})
    _wire_pens[page] = p.styles[p.style[k]]
    return json.dumps({"ok": True})


def _decided(decisions: dict) -> tuple[list[match.Hit], set[int]]:
    out, dropped = [], set()
    for k, h in enumerate(_hits):
        d = decisions.get(k)
        if d == "count" and h.status != match.MATCH:
            h = _copy(h, status=match.MATCH, note=(h.note + "; " if h.note else "") + "counted by estimator")
        elif d == "drop":
            h = _copy(h, status="dropped", note=(h.note + "; " if h.note else "") + "dropped by estimator")
            dropped.add(k)
        out.append(h)
    return out, dropped


def _circuits(decisions: dict):
    hits, dropped = _decided(decisions)
    pages = {n: _pages[n] for n in sorted({h.page for h in _hits}) if n in _pages}
    return hits, measure.circuits(hits, pages, skip=dropped, panel_at=_panels, scale_for=_scale_for,
                                  wire_pens=_wire_pens)


def circuits(decisions_json: str = "{}") -> str:
    """Branch circuits from the counted devices, with the estimator's calls applied."""
    decisions = {int(k): v for k, v in json.loads(decisions_json or "{}").items()}
    hits, (found, notes) = _circuits(decisions)
    named = {n: measure.panels(_pages[n]) for n in {c.page for c in found}}
    out = []
    for k, c in enumerate(found):
        out.append({"id": k, "page": c.page, "sheet": c.sheet, "label": c.label, "panel": c.panel,
                    "devices": c.devices, "items": c.items,
                    "route": [[round(v, 2) for v in s] for s in c.route],
                    "homerun": [[round(v, 2) for v in s] for s in c.homerun],
                    "route_ft": c.route_ft, "homerun_ft": c.homerun_ft, "heights": c.heights,
                    "conductors": c.conductors, "scale": _scale_json(c.scale), "note": c.note,
                    "panel_placed": (c.page, c.panel) in _panels,
                    "panel_named": c.panel in named.get(c.page, {})})
    return json.dumps({"circuits": out, "notes": notes, "wire_pens": {str(k): v is not None for k, v in _wire_pens.items()}})


def xlsx(decisions_json: str = "{}", allowances_json: str = "{}"):
    """The spreadsheet, with the estimator's calls applied: bytes of an .xlsx.

    `decisions` maps a hit id to "count" or "drop". A counted review becomes a
    match; a dropped hit stays on the Locations tab as "dropped", uncounted.
    Circuits and runs come along, at the estimator's allowances.
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
    a = json.loads(allowances_json or "{}")
    allowances = measure.Allowances(**{k: float(v) for k, v in a.items()
                                       if k in ("conduit_height", "device_height", "makeup", "waste")})
    found, notes = ([], [])
    if _hits:
        _, (found, notes) = _circuits(decisions)
    report.write_xlsx(out, sheets, "/tmp/takeoff.xlsx", source=_name, legend=_legend, circuits=found,
                      runs=[r for _, r in sorted(_runs.items())], allowances=allowances, notes=notes)
    with open("/tmp/takeoff.xlsx", "rb") as f:
        return f.read()


def _copy(h: match.Hit, **changes) -> match.Hit:
    from dataclasses import replace
    return replace(h, **changes)
