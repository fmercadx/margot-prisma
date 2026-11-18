#!/usr/bin/env python3
"""Drive the built click screen in a real browser and check the counts.

    python takeoff/browser/smoke.py --dist dist/takeoff [--browser /path/to/chrome]

The unit tests run the matcher under CPython. This runs it the way a visitor
does: compiled to WebAssembly, unpacked into a virtual filesystem, fed a File,
with the clicks landing on a PDF.js canvas through an SVG overlay. A module
left out of the bundle, a Pyodide wheel not copied, a coordinate mismatch
between PDF.js and pdfplumber: each fails here and nowhere else.

Checked:
  · one click on a duplex and one on a quad count a synthetic sheet exactly
  · circuits from the labels beside the devices come out as under CPython
  · a traced run and a followed line are measured at the printed scale
  · dropping a hit takes it out of the count, its circuit and the spreadsheet
  · nothing off-origin is requested, because the drawing never leaving the
    machine is the point of running in the browser
  · the page doesn't scroll sideways at phone width
"""

from __future__ import annotations

import argparse
import functools
import http.server
import io
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import test_takeoff as tt  # noqa: E402  (the synthetic-drawing helpers)

DUPLEXES = [(100, 100, 0, False), (200, 100, 1, False), (300, 100, 2, False), (400, 100, 3, False),
            (500, 100, 0, True), (600, 100, 1, True), (100, 300, 0, False)]
QUADS = [(200, 300, 0, False), (300, 300, 1, False)]
LINE = (700, 500, 900, 500)          # a line to follow: 200 pt, 22'-2" at 1/8"
TRACE = [(100, 600), (172, 600)]     # a run to trace: 72 pt, 8'-0" at 1/8"


def synthetic(path: Path) -> None:
    plan = []
    for x, y, turn, mirror in DUPLEXES:
        plan += tt._strokes(tt._place(tt.duplex(), x, y, turn, mirror))
    for x, y, turn, mirror in QUADS:
        plan += tt._strokes(tt._place(tt.quad(), x, y, turn, mirror))
    plan += tt._text(108, 98, 6, "GFI")          # a label beside the first duplex
    for x, y, *_ in DUPLEXES[:3]:                 # three duplexes on circuit A-1
        plan += tt._text(x + 9, y + 14, 6, "A-1")
    plan += tt._text(100, 700, 9, 'SCALE: 1/8" = 1\'-0"')
    plan += tt._strokes([LINE], grey=0.3, width=0.5)
    plan += tt._text(1120, 760, 40, "E2.1")
    legend = tt._strokes(tt._place(tt.duplex(), 100, 100)) + tt._text(80, 60, 12, "ELECTRICAL SYMBOLS")
    legend += tt._text(1110, 760, 40, "E0.01")
    tt.write_pdf(path, [plan, legend])


socketserver.TCPServer.allow_reuse_address = True


class _Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".wasm": "application/wasm"}

    def log_message(self, *a):  # noqa: D102 - silence per-request logging
        pass


def expected_circuits(pdf: Path) -> list[tuple[str, int, float]]:
    """The circuits CPython finds on the same sheet: (label, devices, feet device to device)."""
    import drawings
    import match
    import measure
    plan = drawings.load(str(pdf), [1])[0]
    hits = match.find(plan, match.seed_at(plan, 100, 100 + 1.68), "Duplex")
    hits += match.find(plan, match.seed_at(plan, 200 - 1.68, 300), "Quad")
    hits = match.resolve(hits)
    match.attach_text(hits, {1: plan})
    found, _ = measure.circuits(hits, {1: plan})
    return [(c.label, len(c.devices), round(c.route_ft, 1)) for c in found]


def results(page) -> dict[str, tuple[int, int]]:
    rows = page.eval_on_selector_all(
        "#resTable tr:not(.sub)", "rs => rs.slice(1).map(r => [...r.cells].map(c => c.textContent.trim()))")
    return {r[0]: (int(r[1]), int(r[2])) for r in rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default="dist/takeoff")
    ap.add_argument("--port", type=int, default=8917)
    ap.add_argument("--browser", default=None, help="path to a Chromium binary (default: Playwright's)")
    a = ap.parse_args(argv)

    from playwright.sync_api import sync_playwright

    dist = Path(a.dist).resolve()
    if not (dist / "takeoff.zip").exists():
        sys.exit(f"smoke.py: {dist} has no takeoff.zip — run build.py first")
    pdf = Path(tempfile.mkdtemp()) / "synthetic-set.pdf"
    synthetic(pdf)

    srv = socketserver.TCPServer(("127.0.0.1", a.port), functools.partial(_Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{a.port}"

    failures: list[str] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(**({"executable_path": a.browser} if a.browser else {}))
            page = browser.new_page(viewport={"width": 1400, "height": 900}, accept_downloads=True)
            requests: list[str] = []
            page.on("request", lambda r: requests.append(r.url))
            page.on("pageerror", lambda e: failures.append(f"page error: {e}"))
            page.on("console", lambda m: m.type == "error" and failures.append(f"console error: {m.text}"))

            page.goto(origin + "/", wait_until="load")
            page.wait_for_selector("#rt.ready", timeout=300_000)

            page.set_input_files("#picker", str(pdf))
            page.wait_for_selector("#ws:not(.hide)")
            page.wait_for_selector("#veil.hide", state="attached", timeout=120_000)
            page.wait_for_selector("#sheets button")

            def pick(name: str, x: float, y: float) -> None:
                page.fill("#itemName", name)
                page.click("#pick")
                pt = page.evaluate(f"__takeoff.pdfToClient({x}, {y})")
                page.mouse.click(pt["x"], pt["y"])
                page.wait_for_selector("#veil.hide", state="attached", timeout=180_000)
                page.wait_for_function(f"__takeoff.state.items.some(i => i.name === {name!r})", timeout=60_000)

            # On a bar of the first duplex and of the first quad.
            pick("Duplex", 100, 100 + 1.68)
            pick("Quad", 200 - 1.68, 300)
            page.click("#count")
            page.wait_for_selector("#results:not(.hide)", timeout=180_000)
            got = results(page)
            if got.get("Duplex") != (len(DUPLEXES), 0):
                failures.append(f"Duplex: expected {len(DUPLEXES)} counted, 0 to check; got {got.get('Duplex')}")
            if got.get("Quad") != (len(QUADS), 0):
                failures.append(f"Quad: expected {len(QUADS)} counted, 0 to check; got {got.get('Quad')}")
            subs = page.eval_on_selector_all("#resTable tr.sub", "rs => rs.map(r => r.textContent)")
            if not any("GFI" in s for s in subs):
                failures.append(f"the GFI label beside the first duplex was not split out: {subs}")

            # Circuits from the labels, the same as under CPython.
            page.wait_for_function("__takeoff.state.circuits.length > 0", timeout=120_000)
            got_c = page.evaluate("__takeoff.state.circuits.map(c => [c.label, c.devices.length, Math.round(c.route_ft * 10) / 10])")
            want_c = expected_circuits(pdf)
            if [tuple(c) for c in got_c] != want_c or not want_c:
                failures.append(f"circuits: browser {got_c}, CPython {want_c}")
            if "1/8" not in page.text_content("#scaleLine"):
                failures.append(f"scale not read: {page.text_content('#scaleLine')!r}")

            # A traced run and a followed line, at the printed scale.
            page.fill("#runName", "Homerun")
            page.click("#trace")
            for x, y in TRACE:
                pt = page.evaluate(f"__takeoff.pdfToClient({x}, {y})")
                page.mouse.click(pt["x"], pt["y"])
                page.wait_for_timeout(150)
            page.click("#traceDone")
            page.wait_for_function("__takeoff.state.runs.length === 1", timeout=60_000)
            page.click("#follow")
            pt = page.evaluate(f"__takeoff.pdfToClient({(LINE[0] + LINE[2]) / 2}, {LINE[1]})")
            page.mouse.click(pt["x"], pt["y"])
            page.wait_for_function("__takeoff.state.runs.length === 2", timeout=60_000)
            # A click lands within half a screen pixel of its point: a traced
            # run is good to a few hundredths of a foot here, a followed one exact.
            feet = page.evaluate("__takeoff.state.runs.map(r => r.feet)")
            if len(feet) != 2 or abs(feet[0] - 8.0) > 0.15 or abs(feet[1] - 200 / 9) > 0.01:
                failures.append(f"run lengths: expected [8.0, {200 / 9:.2f}], got {feet}")

            # Drop one duplex by clicking its box, then check the count and the download.
            hit = page.evaluate("__takeoff.state.hits.find(h => h.item === 'Duplex' && h.page === 1)")
            pt = page.evaluate(f"__takeoff.pdfToClient({hit['x'] + hit['hw']}, {hit['y']})")
            page.mouse.click(pt["x"], pt["y"])
            page.wait_for_selector("#detail:not(.hide)")
            page.click("#detail button:has-text(\"Don't count\")")
            if results(page).get("Duplex", (0, 0))[0] != len(DUPLEXES) - 1:
                failures.append(f"dropping a hit did not lower the count: {results(page)}")
            with page.expect_download(timeout=60_000) as dl:
                page.click("#download")
            data = Path(dl.value.path()).read_bytes()
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(data))
                rows = {r[0]: r for r in wb["Summary"].iter_rows(values_only=True) if r[0]}
                if rows.get("Duplex", (None, None))[1] != len(DUPLEXES) - 1:
                    failures.append(f"spreadsheet Duplex count: {rows.get('Duplex')}")
                circ = {r[1]: r for r in wb["Circuits"].iter_rows(min_row=9, values_only=True) if r[0] and r[1]}
                if circ.get("A-1", [None] * 4)[3] != 2:      # the dropped duplex was one of A-1's three
                    failures.append(f"spreadsheet circuit A-1: {circ.get('A-1')}")
                runs = [r for r in wb["Runs"].iter_rows(min_row=5, values_only=True) if r[1] and r[0] != "Total"]
                if len(runs) != 2 or abs(runs[0][3] - 8.0) > 0.15 or abs(runs[1][3] - 200 / 9) > 0.06:
                    failures.append(f"spreadsheet runs: {runs}")
            except Exception as e:  # noqa: BLE001 - report, don't crash the smoke test
                failures.append(f"downloaded spreadsheet unreadable: {e}")

            offsite = sorted({u.split("/")[2] for u in requests
                              if not u.startswith((origin, "blob:", "data:", "about:"))})
            if offsite:
                failures.append(f"requested off-origin hosts: {offsite}")

            for where in ("workspace", "intro"):
                if where == "intro":
                    page.goto(origin + "/", wait_until="load")
                page.set_viewport_size({"width": 390, "height": 844})
                page.wait_for_timeout(300)
                w = page.evaluate("() => ({doc: document.documentElement.clientWidth, scroll: document.body.scrollWidth})")
                if w["scroll"] > w["doc"] + 1:
                    failures.append(f"{where} scrolls sideways at 390px ({w['scroll']}px wide)")
            browser.close()
    finally:
        srv.shutdown()

    if failures:
        print("SMOKE FAILED:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"smoke ok: Duplex {len(DUPLEXES)}, Quad {len(QUADS)}, circuits and runs measured, drop and download "
          "checked, no off-origin requests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
