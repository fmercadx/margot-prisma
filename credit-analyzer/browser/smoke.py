#!/usr/bin/env python3
"""Drive the built page in a real browser and assert it produced real findings.

    python credit-analyzer/browser/smoke.py --dist dist/analyzer

Unit tests cover the analyzer under CPython; they say nothing about whether the
same code runs once it has been compiled to WebAssembly, zipped, unpacked into
a virtual filesystem and handed a File object. Every failure this build can
have that the Python tests cannot — a module left out of the bundle, a Pyodide
file not copied, pypdf missing, an FFI signature that only breaks in the
browser — shows up here and nowhere else.

Two assertions matter beyond "it ran":

  · the known findings from the synthetic fixture are present, so a bundle that
    loads but analyzes nothing fails instead of passing
  · nothing off-origin was requested, because "your credit file never leaves
    the machine" is the product, and a stray CDN reference would quietly make
    it untrue
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
FIXTURE = HERE.parent / "fixtures" / "synthetic_mismo.xml"

# From the fabricated fixture, which is committed and therefore stable.
EXPECT_TEXT = ["576", "Transunion", "ACTIVE_LATE", "LIMIT_GAP", "MIDDLE_SCORE"]


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D102 - silence per-request logging
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default="dist/analyzer")
    ap.add_argument("--file", default=str(FIXTURE))
    ap.add_argument("--port", type=int, default=8907)
    ap.add_argument("--browser", default=None,
                    help="path to a Chromium binary (default: Playwright's)")
    args = ap.parse_args(argv)

    from playwright.sync_api import sync_playwright

    dist = Path(args.dist).resolve()
    if not (dist / "analyzer.zip").exists():
        sys.exit(f"smoke.py: {dist} has no analyzer.zip — run build.py first")

    srv = socketserver.TCPServer(("127.0.0.1", args.port),
                                 functools.partial(_Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{args.port}"

    failures: list[str] = []
    try:
        with sync_playwright() as p:
            launch = {"executable_path": args.browser} if args.browser else {}
            browser = p.chromium.launch(**launch)
            page = browser.new_page(reduced_motion="reduce")

            requests: list[str] = []
            page.on("request", lambda r: requests.append(r.url))
            page.on("pageerror", lambda e: failures.append(f"page error: {e}"))

            page.goto(origin + "/", wait_until="load")
            page.wait_for_selector("#rt.ready", timeout=240_000)

            page.fill("#fileRef", "CI-SMOKE")
            page.set_input_files("#picker", args.file)
            page.wait_for_selector("#run:not([disabled])")
            page.click("#run")
            page.wait_for_selector("#out:not(.hide)", timeout=240_000)

            if not page.is_hidden("#err"):
                failures.append("error banner: " + page.inner_text("#errText"))

            body = page.inner_text("#out")
            for needle in EXPECT_TEXT:
                if needle not in body:
                    failures.append(f"expected {needle!r} in the results")

            offsite = sorted({
                u.split("/")[2] for u in requests
                if not u.startswith((origin, "blob:", "data:", "about:"))
            })
            if offsite:
                failures.append(f"requested off-origin hosts: {offsite}")

            # Both stores require a reachable privacy policy, and a dead link
            # to one is a rejection. Check it is linked, that it loads, and
            # that it makes no requests of its own — a privacy page that
            # phoned a font host would undercut what it says.
            if not page.locator('footer a[href="privacy.html"]').count():
                failures.append("no privacy link in the footer")
            requests.clear()
            resp = page.goto(origin + "/privacy.html", wait_until="load")
            if not resp or resp.status != 200:
                failures.append(f"privacy.html did not load ({resp and resp.status})")
            elif "Privacy policy" not in page.inner_text("body"):
                failures.append("privacy.html loaded but has no policy on it")
            stray = sorted({
                u.split("/")[2] for u in requests
                if not u.startswith((origin, "blob:", "data:", "about:"))
            })
            if stray:
                failures.append(f"privacy.html requested off-origin hosts: {stray}")

            # A phone-width pass. Wide tables are meant to scroll inside their
            # own container; the page itself must not, and a single stray
            # white-space:nowrap on prose is enough to break that — which is
            # exactly how it broke once already.
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
                    f"page scrolls sideways at 390px "
                    f"({width['scroll']}px wide): {culprits}")

            browser.close()
    finally:
        srv.shutdown()

    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        return 1
    print("smoke: analyzed in-browser, findings present, no off-origin requests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
