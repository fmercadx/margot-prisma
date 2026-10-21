#!/usr/bin/env python3
"""Drive the built page in a real browser against the synthetic plan.

    python3 takeoff/smoke.py --dist dist/takeoff

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
    ap.add_argument("--dist", default="dist/takeoff")
    ap.add_argument("--file", default=str(FIXTURE))
    ap.add_argument("--port", type=int, default=8911)
    ap.add_argument("--browser", default=None,
                    help="path to a Chromium binary (default: Playwright's)")
    args = ap.parse_args(argv)

    from playwright.sync_api import sync_playwright

    dist = Path(args.dist).resolve()
    if not (dist / "index.html").exists():
        sys.exit(f"smoke.py: {dist} has no index.html — run `npm run build` in takeoff/ first")

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
            page.set_input_files("#picker", args.file)
            page.wait_for_selector("#results.ready", timeout=120_000)

            if "err" in (page.get_attribute("#status", "class") or ""):
                failures.append("status shows an error: " + page.inner_text("#status"))

            scale = page.inner_text("#scaleText")
            if "1\" = 20'" not in scale:
                failures.append(f"scale not read from the sheet: {scale!r}")

            counts = page.eval_on_selector_all("#symbols .row .qty", "els => els.map(e => e.textContent)")
            for want in ("7", "12", "5"):
                if want not in counts:
                    failures.append(f"expected a symbol with count {want}; got {counts}")
            hatch_rows = page.locator("#hatches .row").count()
            if hatch_rows != 2:
                failures.append(f"expected 2 hatched areas, got {hatch_rows}")
            if page.locator("#regions .row").count() < 2:
                failures.append("expected at least 2 outlined areas")
            if page.locator("#lines .row").count() < 1:
                failures.append("expected at least 1 line group")

            # Clicking a row highlights it on the overlay.
            page.click("#symbols .row >> nth=0")
            active = page.get_attribute("#canvases", "data-active") or ""
            if not active.startswith("sym-"):
                failures.append(f"clicking a symbol row did not highlight it (active={active!r})")

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
