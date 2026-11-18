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


# ---------------------------------------------------------------------------
# The five things the cross-firm test found, each on a sheet of its own.

def _turn(segs, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [(c * x0 - s * y0, s * x0 + c * y0, c * x1 - s * y1, s * x1 + c * y1) for x0, y0, x1, y1 in segs]


def _shift(segs, x, y):
    return [(_q(x + x0), _q(y + y0), _q(x + x1), _q(y + y1)) for x0, y0, x1, y1 in segs]


def tamper_resistant():
    """A duplex plus a bar just clear of the circle, opposite the tail."""
    return duplex() + [(R + 2.2, -4.5, R + 2.2, 4.5)]


def _band(x, y, op="f", grey=0.0):
    """A solid band between a duplex's bars, its outline exactly on them."""
    return [f"{grey} g 0 w {x - 15:.2f} {H - y - 1.68:.2f} {20.28:.2f} 3.36 re {op}"]


PLAIN = [(100, 100), (200, 100), (300, 100), (400, 100)]
GFCI = [(100, 200), (200, 200)]
GFCI_STROKED = (300, 200)       # filled and stroked with a 0-width pen
GFCI_GREY = (400, 200)          # filled in grey, not the pen's black
ANGLED = [(100, 300, 30), (200, 300, 52), (300, 300, 146)]
WIRED = (100, 400)              # a wire in the duplex's own pen runs into it
TR = [(200, 400), (300, 400), (400, 400), (500, 400)]
TAGGED = {(500, 100): ["GFI"], (500, 200): ["WP", "GFI"]}
VERTICAL_TAG = (600, 100)       # "GFI" printed sideways, reading bottom to top
ON_WALLS = [(100, 500), (200, 500), (300, 500)]   # grey devices in the walls' own pen


@pytest.fixture(scope="module")
def fixes(tmp_path_factory):
    ops = []
    for x, y in PLAIN + list(TAGGED):
        ops += _strokes(_place(duplex(), x, y))
    for x, y in GFCI + [GFCI_STROKED, GFCI_GREY]:
        ops += _strokes(_place(duplex(), x, y))
    for x, y in GFCI:
        ops += _band(x, y)
    ops += _band(*GFCI_STROKED, op="B")
    ops += _band(*GFCI_GREY, grey=0.7)
    for x, y, deg in ANGLED:
        ops += _strokes(_shift(_turn(duplex(), deg), x, y))
    wx, wy = WIRED
    ops += _strokes(_place(duplex(), wx, wy))
    ops.append(f"0 G 1.2 w {wx + R:.2f} {H - wy:.2f} m {wx + 30:.2f} {H - wy - 20:.2f} l "
               f"{wx + 60:.2f} {H - wy - 25:.2f} l {wx + 90:.2f} {H - wy - 20:.2f} l S")
    for x, y in TR:
        ops += _strokes(_place(tamper_resistant(), x, y))
    for (x, y), words in TAGGED.items():
        for k, word in enumerate(words):
            ops += _text(x - 6, y - 9 - 7 * (len(words) - 1 - k), 6, word)
    vx, vy = VERTICAL_TAG
    ops += _strokes(_place(duplex(), vx, vy))
    ops.append(f"BT /F1 6 Tf 0 1 -1 0 {vx + 9:.2f} {H - vy - 4:.2f} Tm (GFI) Tj ET")
    for k, (x, y) in enumerate(ON_WALLS):
        ops += _strokes(_place(duplex(), x, y), grey=0.5, width=0.36)
        # The wall the tail ends on: one long path, in the same pen, at a
        # different place along it for each device.
        ops.append(f"0.5 G 0.36 w {x - 15:.2f} {H - y + 40 + 9 * k:.2f} m {x - 15:.2f} {H - y - 60:.2f} l S")
    ops += _text(1120, 760, 40, "E2.2")
    path = tmp_path_factory.mktemp("fixes") / "fixes.pdf"
    write_pdf(path, [ops])
    return drawings.load(str(path))[0]


def _plain_hits(page):
    page.cache.clear()
    return match.find(page, match.seed_at(page, *PLAIN[0]), "Duplex")


def test_a_fill_lying_on_the_bars_still_counts_as_ink(fixes):
    # A solid band is a lot of extra ink: never a match, and usually past
    # even the review cut-off, like any heavily different symbol.
    hits = _plain_hits(fixes)
    for x, y in GFCI + [GFCI_STROKED, GFCI_GREY]:
        assert all(h.status != match.MATCH for h in _at(hits, x, y)), (x, y)


def test_a_filled_example_finds_its_own_kind(fixes):
    fixes.cache.clear()
    hits = match.find(fixes, match.seed_at(fixes, GFCI[0][0] - 10, GFCI[0][1] - 1.68), "GFCI")
    assert all(any(h.status == match.MATCH for h in _at(hits, x, y)) for x, y in GFCI)
    assert all(h.status != match.MATCH for x, y in PLAIN for h in _at(hits, x, y))


def test_symbols_at_any_angle_are_found(fixes):
    hits = _plain_hits(fixes)
    for x, y, deg in ANGLED:
        assert [h.status for h in _at(hits, x, y)] == [match.MATCH], deg


def test_a_click_does_not_follow_a_wire_in_the_same_pen(fixes):
    box, _ = match.box_at(fixes, *WIRED)
    assert box[2] - box[0] < 25 and box[3] - box[1] < 15
    assert [h.status for h in _at(_plain_hits(fixes), *WIRED)] == [match.MATCH]


def test_a_separate_mark_is_flagged_and_its_own_example_wins(fixes):
    hits = _plain_hits(fixes)
    tr = [h for x, y in TR for h in _at(hits, x, y)]
    assert all(h.status == match.MATCH for h in tr)        # the bar doesn't touch, so it matches...
    notes = match.flag_marks(hits)
    assert notes and all(h.note for h in tr)               # ...but is flagged
    assert not any(h.note for x, y in PLAIN for h in _at(hits, x, y))

    x, y = TR[0]
    fixes.cache.clear()
    both = hits + match.find(fixes, match.make_seed(fixes, (x - 16, y - 6.5, x + R + 3.5, y + 6.5)), "TR")
    both = match.resolve(both)
    for x, y in TR:
        assert [h.item for h in _at(both, x, y)] == ["TR"]
    for x, y in PLAIN:
        assert [h.item for h in _at(both, x, y)] == ["Duplex"]


def test_labels_beside_a_symbol_are_read(fixes):
    hits = _plain_hits(fixes)
    match.attach_text(hits, {fixes.number: fixes})
    assert _at(hits, 500, 100)[0].text == "GFI"
    assert _at(hits, 500, 200)[0].text == "WP GFI"
    assert _at(hits, *PLAIN[1])[0].text == ""


def test_devices_in_the_walls_pen_are_found_from_a_click(fixes):
    box, _ = match.box_at(fixes, *ON_WALLS[0])
    assert box[3] - box[1] < 15                            # the wall is not part of the example
    fixes.cache.clear()
    hits = match.find(fixes, match.seed_at(fixes, *ON_WALLS[0]), "Existing")
    for x, y in ON_WALLS:
        assert [h.status for h in _at(hits, x, y)] == [match.MATCH], (x, y)


def test_sideways_labels_are_read_the_right_way_round(fixes):
    hits = _plain_hits(fixes)
    match.attach_text(hits, {fixes.number: fixes})
    assert _at(hits, *VERTICAL_TAG)[0].text == "GFI"


# ---------------------------------------------------------------------------
# Lengths: scales, measured runs and circuits, on sheets of their own.

import measure  # noqa: E402

FT8 = 8 / 72        # feet per point at 1/8" = 1'-0": an inch of paper is 8 ft
FT4 = 4 / 72        # at 1/4" = 1'-0"

TOP = [(100, 100, ""), (200, 100, ""), (200, 200, ""), (400, 100, '48"')]   # x, y, height label
LABELS = ["A-1", "A-1", "A-1", "A-2"]
LOWER = [(100, 450), (160, 450)]        # the enlarged plan repeats circuit A-1
PANEL_AT = (100, 250)
PEN = (0.3, 0.5)                        # the lines to follow: grey 0.3, 0.5 wide


@pytest.mark.parametrize("text, feet_per_inch", [
    ('1/8" = 1\'-0"', 8), ('SCALE: 3/32" = 1\'-0"', 32 / 3), ("3/8\"= 1' - 0\"", 8 / 3),
    ('3/32 = 1\'-0"', 32 / 3), ('E-301 3/16" = 1\'-0"', 16 / 3), ('1 1/2" = 1\'-0"', 2 / 3),
    ('1" = 20\'', 20), ('1/4" = 1\'-6"', 6), ("SCALE 1:100", 100 / 12),
])
def test_scales_as_printed(text, feet_per_inch):
    assert measure.parse_scale(text) * 72 == pytest.approx(feet_per_inch)


@pytest.mark.parametrize("text", ["NOT TO SCALE", "SCALE: AS NOTED", "12'-0\" CLEAR", "NTS"])
def test_things_that_are_not_scales(text):
    assert measure.parse_scale(text) is None


@pytest.fixture(scope="module")
def lengths_path(tmp_path_factory):
    ops = []
    for (x, y, height), label in zip(TOP, LABELS):
        ops += _strokes(_place(duplex(), x, y))
        ops += _text(x + 8, y - 3, 6, label)
        if height:
            ops += _text(x + 8, y + 9, 6, height)
    ops += _text(PANEL_AT[0], PANEL_AT[1], 7, "PANEL A")
    ops += _text(100, 330, 9, 'SCALE: 1/8" = 1\'-0"')
    for x, y in LOWER:
        ops += _strokes(_place(duplex(), x, y))
        ops += _text(x + 8, y - 3, 6, "A-1")
    ops += _text(100, 560, 9, 'SCALE: 1/4" = 1\'-0"')
    # A printed scale ruler along the bottom: not any drawing's scale.
    for k, s in enumerate(['1/16" = 1\'-0"', '1/8" = 1\'-0"', '1/4" = 1\'-0"', '1/2" = 1\'-0"']):
        ops += _text(100 + 150 * k, 760, 6, s)
    g, w = PEN
    # An L of two strokes, the first drawn twice over, as exports do.
    ops += _strokes([(600, 100, 700, 100), (600, 100, 700, 100), (700, 100, 700, 200)], grey=g, width=w)
    # A dashed run: 6 pt dashes, 3 pt gaps, from x = 600 to 795.
    ops += _strokes([(600 + 9 * k, 300, 606 + 9 * k, 300) for k in range(22)], grey=g, width=w)
    # A line that ends on a receptacle drawn in the same pen.
    ops += _strokes([(600, 400, 680.5, 400)] + _place(duplex(), 686, 400, 2), grey=g, width=w)
    ops += _text(1120, 760, 40, "E3.1")
    path = tmp_path_factory.mktemp("lengths") / "lengths.pdf"
    write_pdf(path, [ops])
    return str(path)


@pytest.fixture(scope="module")
def lengths(lengths_path):
    return drawings.load(lengths_path)[0]


def test_each_drawing_has_its_own_scale_and_the_ruler_is_ignored(lengths):
    assert sorted(round(s.feet_per_point * 72, 3) for s in measure.scales(lengths)) == [4, 8]
    assert measure.scale_at(lengths, 300, 150).feet_per_point == pytest.approx(FT8)
    assert measure.scale_at(lengths, 130, 450).feet_per_point == pytest.approx(FT4)


def test_a_traced_run_is_measured_at_the_drawing_scale(lengths):
    run = measure.trace(lengths, [(100, 120), (172, 120), (172, 192)], "Homerun")
    assert run.length == pytest.approx(144)
    assert run.feet == pytest.approx(16)                    # two inches of paper at 1/8"
    assert measure.fmt_feet(run.feet) == "16'-0\""


def test_following_a_line_takes_every_stroke_once(lengths):
    run = measure.follow(lengths, 650, 100)
    assert run.length == pytest.approx(200, abs=0.5)        # the doubled stroke counts once
    assert run.feet == pytest.approx(200 * FT8, abs=0.1)


def test_following_a_dashed_line_bridges_its_gaps(lengths):
    run = measure.follow(lengths, 603, 300)
    assert run.length == pytest.approx(195, abs=0.5)
    assert len(run.segs) == 22


def test_following_stops_at_a_receptacle_in_the_same_pen(lengths):
    run = measure.follow(lengths, 640, 400)
    assert run.length == pytest.approx(80.5, abs=0.5)


def _lengths_hits(page):
    page.cache.clear()
    hits = match.find(page, match.seed_at(page, *TOP[0][:2]), "Duplex")
    match.attach_text(hits, {page.number: page})
    return hits


def test_circuits_from_labels(lengths):
    hits = _lengths_hits(lengths)
    circuits, notes = measure.circuits(hits, {lengths.number: lengths})
    by = {(c.label, round(c.scale.feet_per_point * 72)): c for c in circuits}
    assert set(by) == {("A-1", 8), ("A-2", 8), ("A-1", 4)}  # the enlarged plan keeps its own
    a1 = by[("A-1", 8)]
    assert len(a1.devices) == 3
    # Joined along the axes: 100 pt across and 100 pt down, at 1/8".
    assert a1.route_ft == pytest.approx(200 * FT8, abs=0.2)
    # The panel is named on the same drawing: a homerun from the nearest device.
    assert a1.homerun_ft is not None and a1.homerun
    a2 = by[("A-2", 8)]
    assert a2.heights == [4.0]                              # 48" printed beside it
    a = measure.Allowances(conduit_height=10, device_height=1.5, makeup=1, waste=0.1)
    assert a2.drops(a) == pytest.approx(6.0)
    assert a1.drops(a) == pytest.approx(3 * 8.5)
    assert a1.conductors == 3
    assert a1.conduit(a) == pytest.approx((a1.route_ft + a1.homerun_ft + 25.5) * 1.1)
    assert a1.wire(a) == pytest.approx(((a1.route_ft + a1.homerun_ft + 25.5) * 3 + 1 * 3 * 3) * 1.1)
    lower = by[("A-1", 4)]
    assert lower.homerun_ft is None and "panel A" in lower.note   # its panel is on the other drawing
    assert any("1/8" in n and "1/4" in n for n in notes)


def test_conductors_and_panels_from_labels():
    assert measure.conductors_for("R1A-8") == 3
    assert measure.conductors_for("R1K-10,12") == 5
    assert measure.panel_of("LP-1-12") == "LP-1"
    assert measure.panel_of("P2:14") == "P2"
    assert measure.device_height('48" AFF') == pytest.approx(4.0)
    assert measure.device_height("GFI") is None


WIRED_ROW = [(100, 600), (200, 600), (300, 600), (400, 600), (500, 600), (600, 600)]
WIRE = (0.0, 0.84)


@pytest.fixture(scope="module")
def wired(tmp_path_factory):
    """A plan that draws its wiring: devices joined by arcs, named only at
    the homerun arrow."""
    ops = []
    for x, y in WIRED_ROW:
        ops += _strokes(_place(duplex(), x, y))
    g, w = WIRE
    for (x0, y0), (x1, y1) in zip(WIRED_ROW, WIRED_ROW[1:]):
        # An arc drawn in pieces from the top of one circle to the next.
        pts = [(x0 + (x1 - x0) * k / 6, y0 - R - 25 * math.sin(math.pi * k / 6)) for k in range(7)]
        ops += _strokes([(*a, *b) for a, b in zip(pts, pts[1:])], grey=g, width=w)
    # The homerun: a short arc from the last device to an arrow and its label.
    hx, hy = WIRED_ROW[-1]
    pts = [(hx + R, hy), (hx + 15, hy + 10), (hx + 22, hy + 25), (hx + 25, hy + 40)]
    ops += _strokes([(*a, *b) for a, b in zip(pts, pts[1:])], grey=g, width=w)
    ops += _text(hx + 18, hy + 52, 7, "A-3")
    ops += _text(100, 700, 9, 'SCALE: 1/4" = 1\'-0"')
    ops += _text(1120, 760, 40, "E3.2")
    path = tmp_path_factory.mktemp("wired") / "wired.pdf"
    write_pdf(path, [ops])
    return drawings.load(str(path))[0]


def test_circuits_from_drawn_wiring(wired):
    hits = _lengths_hits_at(wired, WIRED_ROW[0])
    assert len([h for h in hits if h.status == match.MATCH]) == len(WIRED_ROW)
    circuits, notes = measure.circuits(hits, {wired.number: wired})
    assert len(circuits) == 1
    c = circuits[0]
    assert c.label == "A-3" and len(c.devices) == len(WIRED_ROW)
    # Device to device along the axes, not along the arcs: 500 pt at 1/4".
    assert c.route_ft == pytest.approx(500 * FT4, abs=0.3)


def test_the_wiring_pen_can_be_given_by_a_click(wired):
    hits = _lengths_hits_at(wired, WIRED_ROW[0])
    k = measure.nearest_stroke(wired, 150, WIRED_ROW[0][1] - R - 25)
    pen = wired.styles[wired.style[k]]
    assert pen == ((0.0,), 0.84)
    circuits, _ = measure.circuits(hits, {wired.number: wired}, wire_pens={wired.number: pen})
    assert [c.label for c in circuits] == ["A-3"]


def _lengths_hits_at(page, at):
    page.cache.clear()
    hits = match.find(page, match.seed_at(page, *at), "Duplex")
    match.attach_text(hits, {page.number: page})
    return hits


def test_the_spreadsheet_carries_lengths_as_formulas(lengths, tmp_path):
    hits = _lengths_hits(lengths)
    circuits, notes = measure.circuits(hits, {lengths.number: lengths})
    runs = [measure.trace(lengths, [(100, 120), (172, 120)], "Homerun")]
    out = tmp_path / "t.xlsx"
    report.write_xlsx(hits, {1: lengths.sheet}, str(out), circuits=circuits, runs=runs, notes=notes)
    wb = openpyxl.load_workbook(out)
    assert wb.sheetnames[:3] == ["Summary", "Circuits", "Runs"]
    c = wb["Circuits"]
    assert c["B3"].value == 10 and c["B6"].value == 0.1
    head = [cell.value for cell in c[8]]
    assert head[:4] == ["Sheet", "Circuit", "Panel", "Devices"]
    row = [cell.value for cell in c[9]]
    assert row[9] == "=MAX(0,D9*$B$3-((D9-H9)*$B$4+I9))"
    assert row[10] == "=(F9+G9+J9)*(1+$B$6)"
    assert row[12] == "=((F9+G9+J9)*L9+$B$5*L9*D9)*(1+$B$6)"
    r = wb["Runs"]
    assert r["D5"].value == pytest.approx(8.0) and r["F5"].value == "=D5*(1+Circuits!$B$6)"
    summary = [row[0] for row in wb["Summary"].iter_rows(values_only=True)]
    assert "Conduit, circuits (ft)" in summary


def test_command_line_lengths(lengths_path, tmp_path):
    result = takeoff.run(lengths_path, [("Duplex", 1, TOP[0][:2])], out=str(tmp_path), log=lambda *_: None,
                         traces=[("Homerun", 1, [(100, 120), (172, 120)])], follows=[("L", 1, [(650, 100)])],
                         scales=[(1, measure.scale_from_text('1/4" = 1\'-0"'))])
    assert [round(r.feet, 1) for r in result.runs] == [4.0, round(200 * FT4, 1)]   # the scale given wins
    assert result.circuits and all(c.scale.source == "set by hand" for c in result.circuits)
    assert os.path.getsize(tmp_path / "takeoff.xlsx") > 0


@pytest.mark.parametrize("spec, flag, many, named, ok", [
    ("Homerun A=9:120,400;300,400", "--trace", True, True, True),
    ("Homerun A=9:120,400", "--trace", True, True, False),           # one point is not a route
    ("Feeder=9:850,1210", "--follow", False, True, True),
    ("9:850,1210", "--follow", False, True, False),
    ("9:1100,880", "--wires", False, False, True),
])
def test_length_flags(spec, flag, many, named, ok):
    if ok:
        takeoff.parse_where(spec, flag, many=many, named=named)
    else:
        with pytest.raises(Exception):
            takeoff.parse_where(spec, flag, many=many, named=named)
