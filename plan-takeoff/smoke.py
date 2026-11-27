#!/usr/bin/env python3
"""Drive the built page in a real browser against the synthetic plan.

    python3 plan-takeoff/smoke.py --dist dist/plan-takeoff

The Node tests prove the engine; this proves the page around it: that the
bundled pdf.js worker loads, that a File becomes a rendered sheet and a list
of quantities, that clicking a row highlights it, that calibration changes
the scale, that the CSV downloads, that nothing was fetched off-origin, and
that the page does not scroll sideways at phone width.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "test" / "fixtures" / "synthetic_plan.pdf"


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D102
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default="dist/plan-takeoff")
    ap.add_argument("--file", default=str(FIXTURE))
    ap.add_argument("--port", type=int, default=8911)
    ap.add_argument("--browser", default=None,
                    help="path to a Chromium binary (default: Playwright's)")
    args = ap.parse_args(argv)

    from playwright.sync_api import sync_playwright

    dist = Path(args.dist).resolve()
    if not (dist / "index.html").exists():
        sys.exit(f"smoke.py: {dist} has no index.html — run `npm run build` in plan-takeoff/ first")

    # A run that died mid-way leaves the port in TIME_WAIT; don't fail the next one.
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", args.port),
                                 functools.partial(_Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{args.port}"

    failures: list[str] = []
    try:
        with sync_playwright() as p:
            launch = {"executable_path": args.browser} if args.browser else {}
            browser = p.chromium.launch(**launch)
            page = browser.new_page(reduced_motion="reduce", accept_downloads=True)

            requests: list[str] = []
            page.on("request", lambda r: requests.append(r.url))
            page.on("pageerror", lambda e: failures.append(f"page error: {e}"))

            page.goto(origin + "/", wait_until="load")

            # The bundled sample loads on its own, so the first view shows the
            # tool working. It also proves the build emitted the file.
            page.wait_for_selector("#results.ready", timeout=120_000)
            if not page.is_hidden("#empty"):
                failures.append("the sample plan loaded but the empty state is still shown")
            if "sample-plan" not in page.inner_text("#status"):
                failures.append("status does not name the sample plan: " + page.inner_text("#status"))

            # Then a file chosen from disk, the real path.
            page.set_input_files("#picker", args.file)
            page.wait_for_selector("#results.ready", timeout=120_000)

            if "err" in (page.get_attribute("#status", "class") or ""):
                failures.append("status shows an error: " + page.inner_text("#status"))

            scale = page.inner_text("#scaleText")
            if "1\" = 20'" not in scale:
                failures.append(f"scale not read from the sheet: {scale!r}")

            # The legend names the plants and the schedule is checked against them.
            names = page.eval_on_selector_all("#symbols .row .name", "els => els.map(e => e.value)")
            counts = page.eval_on_selector_all("#symbols .row .qty", "els => els.map(e => e.textContent)")
            for want_name, want_count in (("QV LIVE OAK", "10"), ("SH SHRUB", "12"), ("BO BOULDER", "5"), ("PF PURPLE FLOWER", "9")):
                if want_name not in names:
                    failures.append(f"expected a plant row named {want_name!r}; got {names}")
                elif counts[names.index(want_name)] != want_count:
                    failures.append(f"{want_name}: expected count {want_count}, got {counts[names.index(want_name)]}")
            chips = page.eval_on_selector_all("#symbols .row .chip", "els => els.map(e => e.className + '|' + e.textContent)")
            if not any(c.startswith("chip ok") for c in chips) or not any(c.startswith("chip warn") for c in chips):
                failures.append(f"expected both an agreeing and a disagreeing schedule chip; got {chips}")
            hatch_names = page.eval_on_selector_all("#hatches .row .name", "els => els.map(e => e.value)")
            if hatch_names.count("SD SOD") != 3:
                failures.append(f"expected 3 sod areas named from the legend swatch, got {hatch_names}")
            if page.locator("#regions .row").count() < 2:
                failures.append("expected at least 2 outlined areas")
            if page.locator("#lines .row").count() < 1:
                failures.append("expected at least 1 line group")

            # Page 2 is stored rotated and has a graphic scale bar, no written scale.
            page.click("#next")
            page.wait_for_selector("#results.ready", timeout=120_000)
            scale2 = page.inner_text("#scaleText")
            if "graphic scale bar" not in scale2 or "1\" = 20'" not in scale2:
                failures.append(f"page 2 scale not read from the bar: {scale2!r}")
            areas2 = page.eval_on_selector_all("#regions .row .qty", "els => els.map(e => e.textContent)")
            if "800" not in areas2:
                failures.append(f"page 2: expected an 800 sq ft rectangle; got {areas2}")
            page.click("#prev")
            page.wait_for_selector("#results.ready", timeout=120_000)

            # Clicking a row highlights it on the overlay.
            page.click("#symbols .row >> nth=0")
            active = page.get_attribute("#canvases", "data-active") or ""
            if not active.startswith("named-"):
                failures.append(f"clicking a plant row did not highlight it (active={active!r})")

            # Calibration: two clicks on the sheet, a distance, and the scale changes.
            page.click("#calibrate")
            box = page.locator("#overlay").bounding_box()
            page.mouse.click(box["x"] + 100, box["y"] + 100)
            page.mouse.click(box["x"] + 200, box["y"] + 100)
            page.wait_for_selector("#calForm:not(.hide)")
            page.fill("#calFeet", "50")
            page.click("#calForm button[type=submit]")
            scale = page.inner_text("#scaleText")
            if "Calibrated" not in scale:
                failures.append(f"calibration did not take: {scale!r}")

            # The CSV downloads and carries the rows.
            with page.expect_download() as dl:
                page.click("#export")
            path = dl.value.path()
            csv = Path(path).read_text(encoding="utf-8")
            if not csv.startswith("Item,Type,Quantity,Unit"):
                failures.append("csv header missing: " + csv[:60])
            if csv.count("\n") < 6:
                failures.append(f"csv has too few rows:\n{csv}")
            if "calibrated" not in csv:
                failures.append("csv does not record the calibrated scale")

            # Copy CSV: the clipboard, or the fallback box with the text in it.
            page.click("#copy")
            page.wait_for_timeout(200)
            st = page.inner_text("#status")
            boxed = page.is_visible("#csvOut") and "Item,Type" in page.input_value("#csvOut")
            if "copied" not in st and not boxed:
                failures.append(f"copy CSV neither copied nor showed the text (status={st!r})")

            offsite = sorted({
                u.split("/")[2] for u in requests
                if not u.startswith((origin, "blob:", "data:", "about:"))
            })
            if offsite:
                failures.append(f"requested off-origin hosts: {offsite}")

            # Phone width: the plan scrolls inside its stage; the page must not.
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(250)
            width = page.evaluate(
                "() => ({doc: document.documentElement.clientWidth,"
                "        scroll: document.body.scrollWidth})")
            if width["scroll"] > width["doc"] + 1:
                culprits = page.evaluate("""() => [...document.querySelectorAll('body *')]
                    .filter(e => e.scrollWidth > e.clientWidth + 1
                                 && e.scrollWidth > document.documentElement.clientWidth)
                    .map(e => `${e.tagName}.${e.className}`.slice(0, 60))
                    .slice(0, 5)""")
                failures.append(
                    f"page scrolls sideways at 390px ({width['scroll']}px wide): {culprits}")

            browser.close()
    finally:
        srv.shutdown()

    if failures:
        print("smoke: FAIL")
        for f in failures:
            print("  -", f)
        return 1
    print("smoke: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
