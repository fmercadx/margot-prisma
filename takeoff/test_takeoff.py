"""Tests on a synthetic drawing set built at test time.

Real drawing sets are copyrighted by the engineers who drew them and are never
committed (see README). This builds a small PDF the way a CAD plotter writes
one -- every symbol as separate one-segment strokes, coordinates quantised to
0.24 pt -- with the look-alikes that matter on a real power plan.
"""

from __future__ import annotations

import math
import os

import numpy as np
import openpyxl
import pytest

import drawings
import match
import report
import takeoff

W, H = 1224.0, 792.0          # 17 x 11 in sheet
Q = 0.24                      # plotter resolution
R = 5.52                      # receptacle circle radius


def _q(v: float) -> float:
    return round(v / Q) * Q


def _circle(n: int = 12):
    pts = [(R * math.cos(math.radians(15 + 30 * k)), R * math.sin(math.radians(15 + 30 * k))) for k in range(n)]
    return [(*pts[k], *pts[(k + 1) % n]) for k in range(n)]


def duplex():
    """Bars run through the circle and on out as the tail, to the left."""
    return _circle() + [(-15.0, -1.68, 5.28, -1.68), (-15.0, 1.68, 5.28, 1.68)]


def quad():
    """Same circle and tail, but the bars run across the tail."""
    return _circle() + [(-1.68, -5.1, -1.68, 5.1), (1.68, -5.1, 1.68, 5.1),
                        (-15.0, -1.68, -5.4, -1.68), (-15.0, 1.68, -5.4, 1.68)]


def counter_duplex():
    """A duplex with a counter line through it, as the USC legend draws it."""
    return duplex() + [(0.0, -8.5, 0.0, 8.5)]


def _place(segs, x, y, turn=0, mirror=False):
    out = []
    for x0, y0, x1, y1 in segs:
        pts = []
        for px, py in ((x0, y0), (x1, y1)):
            if mirror:
                px = -px
            for _ in range(turn):
                px, py = -py, px
            pts += [_q(x + px), _q(y + py)]
        out.append(tuple(pts))
    return out


def _strokes(segs, grey=0.0, width=1.2):
    ops = [f"{grey} G {width} w"]
    for x0, y0, x1, y1 in segs:          # top-left coordinates in, PDF out
        ops.append(f"{x0:.2f} {H - y0:.2f} m {x1:.2f} {H - y1:.2f} l S")
    return ops


def _text(x, y, size, s):
    return [f"BT /F1 {size} Tf {x:.2f} {H - y:.2f} Td ({s}) Tj ET"]


def write_pdf(path, pages):
    """Minimal PDF writer: one content stream per page, Helvetica for text."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for ops in pages:
        body = "\n".join(ops).encode()
        objs.append(f"<< /Length {len(body)} >>\nstream\n".encode() + body + b"\nendstream")
        content = len(objs)
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W:.0f} {H:.0f}] "
                    f"/Contents {content} 0 R /Resources << /Font << /F1 3 0 R >> >> >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + (o if isinstance(o, bytes) else o.encode()) + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    with open(path, "wb") as f:
        f.write(bytes(out))


# Where things are on the plan sheet (page 1).
DUPLEXES = [(100, 100, 0, False), (200, 100, 1, False), (300, 100, 2, False), (400, 100, 3, False),
            (500, 100, 0, True), (600, 100, 1, True), (100, 300, 0, False)]
QUADS = [(200, 300, 0, False), (300, 300, 1, False)]
COUNTER = (400, 300)
FILLED = (500, 300)
NEIGHBOUR = (100, 300)          # the duplex here has a data triangle beside it
STACKED = (600, 300)            # a duplex under a furniture outline drawn ten times


@pytest.fixture(scope="module")
def plan_pdf(tmp_path_factory):
    plan = []
    for x, y, turn, mirror in DUPLEXES:
        plan += _strokes(_place(duplex(), x, y, turn, mirror))
    for x, y, turn, mirror in QUADS:
        plan += _strokes(_place(quad(), x, y, turn, mirror))
    plan += _strokes(_place(counter_duplex(), *COUNTER))
    # A duplex with a solid black bar between its bars: a different device.
    plan += _strokes(_place(duplex(), *FILLED))
    fx, fy = FILLED
    plan.append(f"0 g {fx - 4:.2f} {H - fy - 1.68:.2f} 8 3.36 re f")
    # A data outlet triangle near, but not touching, the duplex at NEIGHBOUR.
    nx, ny = NEIGHBOUR
    plan += _strokes([(nx - 4, ny + 8, nx + 4, ny + 8), (nx + 4, ny + 8, nx, ny + 15), (nx, ny + 15, nx - 4, ny + 8)])
    # A grey wall straight through the duplex at (100, 100): another pen entirely.
    plan += _strokes([(60, 100, 140, 100)], grey=0.6, width=0.24)
    sx, sy = STACKED
    plan += _strokes(_place(duplex(), sx, sy))
    plan += _strokes([(sx - 2, sy + 4.5, sx + 6, sy + 4.5)] * 10, grey=0.67, width=0.24)
    plan += _text(DUPLEXES[0][0] + 8, DUPLEXES[0][1] - 2, 6, "R1A-8")
    plan += _text(1120, 760, 40, "E2.1")

    legend = _strokes(_place(duplex(), 100, 100)) + _strokes(_place(quad(), 100, 140))
    legend += _text(80, 60, 12, "ELECTRICAL SYMBOLS") + _text(1110, 760, 40, "E0.01")
    empty = _text(100, 100, 12, "THIS SHEET HAS NO STROKES") + _text(1110, 760, 40, "E9.9")

    path = tmp_path_factory.mktemp("plans") / "synthetic.pdf"
    write_pdf(path, [plan, legend, empty])
    return str(path)


@pytest.fixture(scope="module")
def pages(plan_pdf):
    return drawings.load(plan_pdf)


def _duplex_hits(pages):
    plan = pages[0]
    return match.find(plan, match.seed_at(plan, 100, 100), "Duplex")


def _at(hits, x, y):
    return [h for h in hits if abs(h.x - x) < 8 and abs(h.y - y) < 8]


def test_sheet_numbers_and_legend(pages):
    assert [p.sheet for p in pages] == ["E2.1", "E0.01", "E9.9"]
    assert [p.legend for p in pages] == [False, True, False]


def test_click_takes_in_the_tail(pages):
    box, style = match.box_at(pages[0], 100, 100)
    assert style == ((0.0,), 1.2)
    x0, t, x1, b = box
    assert x1 - x0 == pytest.approx(15 + 5.52 + 2, abs=0.6)    # tail + circle + margins
    assert b - t == pytest.approx(2 * 5.52 + 2, abs=0.6)


def test_every_orientation_of_the_duplex_is_found(pages):
    # Hits are box centres, which sit 4.9 pt from the circle's centre along
    # the tail; _at's 8 pt reach covers that in every orientation.
    hits = _duplex_hits(pages)
    for x, y, turn, mirror in DUPLEXES:
        assert [h.status for h in _at(hits, x, y)] == [match.MATCH], (x, y, turn, mirror)


def test_exact_count(pages):
    matches = [h for h in _duplex_hits(pages) if h.status == match.MATCH]
    # Seven placed duplexes plus the one under the stacked furniture outline.
    assert len(matches) == len(DUPLEXES) + 1


def test_quads_are_not_counted_as_duplexes(pages):
    hits = _duplex_hits(pages)
    for x, y, *_ in QUADS:
        assert all(h.status == match.REVIEW for h in _at(hits, x, y)), (x, y)


def test_extra_marks_send_a_lookalike_to_review(pages):
    hits = _duplex_hits(pages)
    assert [h.status for h in _at(hits, *COUNTER)] == [match.REVIEW]
    assert [h.status for h in _at(hits, *FILLED)] == [match.REVIEW]


def test_neighbours_and_other_pens_do_not_spoil_a_match(pages):
    hits = _duplex_hits(pages)
    assert [h.status for h in _at(hits, *NEIGHBOUR)] == [match.MATCH]
    assert [h.status for h in _at(hits, 100, 100)] == [match.MATCH]   # grey wall through it
    assert [h.status for h in _at(hits, *STACKED)] == [match.MATCH]


def test_a_drawn_box_picks_the_symbol_not_stacked_furniture(pages):
    sx, sy = STACKED
    seed = match.make_seed(pages[0], (sx - 16, sy - 6.5, sx + 6.5, sy + 6.5))
    assert seed.style == ((0.0,), 1.2)


def test_resolve_gives_each_spot_one_item(pages):
    plan = pages[0]
    hits = match.find(plan, match.seed_at(plan, 100, 100), "Duplex")
    hits += match.find(plan, match.seed_at(plan, 200, 300), "Quad")
    hits = match.resolve(hits)
    for x, y, *_ in QUADS:
        assert [(h.item, h.status) for h in _at(hits, x, y)] == [("Quad", match.MATCH)]
    for x, y, *_ in DUPLEXES:
        assert [h.item for h in _at(hits, x, y)] == ["Duplex"]


def test_nearest_circuit_label(pages):
    hit = _at(_duplex_hits(pages), 100, 100)[0]
    assert hit.label == "R1A-8"


def test_a_sheet_without_strokes_is_reported_not_guessed(pages):
    with pytest.raises(ValueError, match="scanned"):
        match.make_seed(pages[2], (90, 90, 110, 110))


def test_full_run_writes_draft_reports_and_skips_the_legend(plan_pdf, tmp_path):
    hits = takeoff.run(plan_pdf, [("Duplex", 1, (100, 100)), ("Quad", 1, (200, 300))],
                       out=str(tmp_path), log=lambda *_: None)
    assert any(h.page == 2 for h in hits)                       # the legend copy is found...
    wb = openpyxl.load_workbook(tmp_path / "takeoff.xlsx")
    rows = {r[0]: r for r in wb["Summary"].iter_rows(values_only=True) if r[0]}
    assert rows[report.DRAFT][0] == report.DRAFT
    assert rows["Duplex"][1] == len(DUPLEXES) + 1               # ...but not totalled
    assert rows["Quad"][1] == len(QUADS)
    assert "legend" in rows["Item"][4]
    assert os.path.getsize(tmp_path / "markup.pdf") > 0


def test_a_set_with_no_strokes_at_all_stops(tmp_path):
    path = tmp_path / "scan.pdf"
    write_pdf(path, [_text(100, 100, 12, "SCANNED")])
    with pytest.raises(SystemExit, match="scanned"):
        takeoff.run(str(path), [("X", 1, (100, 100))], log=lambda *_: None)


@pytest.mark.parametrize("spec, ok", [
    ("Duplex=9:453,672", True),
    ("Duplex receptacle=9:437,666,459,679", True),
    ("Duplex=9:453", False),
    ("=9:453,672", False),
    ("Duplex 9:453,672", False),
])
def test_item_spec(spec, ok):
    if ok:
        name, page, nums = takeoff.parse_item(spec)
        assert page == 9 and len(nums) in (2, 4)
    else:
        with pytest.raises(Exception):
            takeoff.parse_item(spec)


def test_sampling_spacing():
    pts = match.sample(np.array([[0.0, 0.0, 4.0, 0.0]]))
    assert len(pts) == 11 and pts[-1].tolist() == [4.0, 0.0]
