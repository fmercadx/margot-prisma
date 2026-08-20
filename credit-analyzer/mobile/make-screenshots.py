#!/usr/bin/env python3
"""Generate store listing assets by driving the real app.

    cd credit-analyzer/mobile && npm run build
    python make-screenshots.py

Writes to `store/`, which is gitignored — these regenerate in under a minute
and 10 MB of PNGs does not belong in git history.

    store/ios-6.7/       1290 x 2796   iPhone, covers every iPhone size
    store/ios-ipad/      2048 x 2732   only needed if the app ships for iPad
    store/play-phone/    1080 x 1920   Play requires at least two
    store/play-icon.png   512 x 512
    store/play-feature.png 1024 x 500

These are screenshots of the app actually running, not mockups. The Capacitor
bridge is stubbed the same way `smoke_native.py` stubs it, so the gate can be
walked through without a deployed licence service.

**Only the synthetic fixture is ever used.** A store screenshot is published
permanently and indexed; a real tri-merge in one would put a person's credit
file on the internet with no way to take it back. The check below is not a
formality.
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
sys.path.insert(0, str(HERE))

from smoke_native import BRIDGE, STUB_LICENCE  # noqa: E402

FIXTURE = HERE.parent / "fixtures" / "synthetic_mismo.xml"

PINE = (31, 77, 61)
SAGE = (123, 161, 146)
BRASS = (232, 195, 107)
PAPER = (246, 248, 246)

# device label -> (css width, css height, device scale factor)
DEVICES = {
    "ios-6.7":    (430, 932, 3),    # -> 1290 x 2796
    "ios-ipad":   (1024, 1366, 2),  # -> 2048 x 2732
    "play-phone": (360, 640, 3),    # -> 1080 x 1920
}


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def scenes(page, out: Path) -> int:
    """Walk the app and capture each screen. Returns how many were written."""
    shot = 0

    def cap(name):
        nonlocal shot
        page.wait_for_timeout(350)
        page.screenshot(path=str(out / f"{shot + 1}-{name}.png"))
        shot += 1

    def scroll_to_heading(text, offset=18):
        """Put a section heading just under the top edge.

        scrollIntoView alone lands the *element* at the top, which clips the
        heading itself once any margin is involved — a store screenshot that
        starts mid-sentence looks like a bug.
        """
        page.evaluate("""([text, offset]) => {
          const h = [...document.querySelectorAll('h2')]
            .find(el => el.textContent.trim().toLowerCase() === text.toLowerCase());
          if (!h) return false;
          const y = h.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo(0, Math.max(0, y));
          return true;
        }""", [text, offset])

    # The gate, captured before it is dismissed. Worth including in the listing:
    # it is the clearest statement that this is not a consumer product, and a
    # reviewer asking why there is no in-app purchase can see the answer.
    page.wait_for_selector("#gate", timeout=120_000)
    page.fill("#g-nmls", "1234567")
    page.fill("#g-company", "Cascade Mortgage Partners")
    page.evaluate("() => ['g-c1','g-c2','g-c3']"
                  ".forEach(i => document.getElementById(i).checked = true)")
    cap("professional-gate")

    page.evaluate("() => document.querySelector('.gate-go').click()")
    page.wait_for_selector("#g-email", timeout=60_000)
    page.fill("#g-email", "review@cascademortgage.example")
    page.fill("#g-key", "CA-4K7MN-PQR2T-8WXYZ-3HJ6D")
    page.evaluate("() => document.querySelector('.gate-go').click()")

    page.wait_for_selector("#rt.ready", timeout=240_000)
    cap("home")

    page.fill("#fileRef", "OR-2601")
    page.fill("#preparedFor", "Cascade Mortgage Partners")
    page.set_input_files("#picker", str(FIXTURE))
    page.evaluate("() => document.getElementById('run').click()")
    page.wait_for_selector("#out:not(.hide)", timeout=240_000)

    # The payoff: the qualifying middle score and which repository produced it.
    scroll_to_heading("File summary")
    cap("middle-score")

    # Findings, framed so the heading and the first CRITICAL row are together.
    scroll_to_heading("Findings")
    cap("findings")

    # Saving a report exercises the file and share path, and populates history.
    page.evaluate("() => document.getElementById('dlReport').click()")
    page.wait_for_function(
        "() => window.__calls.some(c => c[0] === 'Share.share')", timeout=60_000)
    scroll_to_heading("Deliverables")
    cap("share-and-save")

    scroll_to_heading("Saved reports")
    cap("saved-reports")

    return shot


def store_graphics(out: Path) -> None:
    """The two Play assets that are not screenshots."""
    from PIL import Image, ImageDraw, ImageFont
    sys.path.insert(0, str(HERE))
    from importlib import import_module
    mark = import_module("make-icons".replace("-", "_")) if False else None

    # Reuse the icon generator rather than redrawing the mark.
    import importlib.util
    spec = importlib.util.spec_from_file_location("mkicons", HERE / "make-icons.py")
    mkicons = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mkicons)

    # 512 x 512 listing icon, full bleed, no transparency.
    icon = mkicons.draw_mark(512, background=PINE).convert("RGB")
    icon.save(out / "play-icon.png")

    # 1024 x 500 feature graphic. Play crops this differently across its
    # surfaces, so the mark and the words are measured and centred as one group
    # rather than positioned by eye — anything near an edge can be shaved off.
    fg = Image.new("RGB", (1024, 500), PINE)
    d = ImageDraw.Draw(fg)

    def font(path, size):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            return ImageFont.load_default()

    serif = font("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 56)
    mono = font("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 21)

    title, l1, l2 = "Credit Analyzer", "TRI-MERGE REVIEW", "RUNS ON THE DEVICE"
    tw = d.textlength(title, font=serif)
    text_w = max(tw, d.textlength(l1, font=mono), d.textlength(l2, font=mono))

    mark_px, gutter = 250, 54
    group_w = mark_px + gutter + text_w
    x = (1024 - group_w) / 2

    m = mkicons.draw_mark(mark_px)
    fg.paste(m, (int(x), (500 - mark_px) // 2), m)

    tx = x + mark_px + gutter
    d.text((tx, 176), title, font=serif, fill=PAPER)
    d.text((tx + 3, 258), l1, font=mono, fill=BRASS)
    d.text((tx + 3, 290), l2, font=mono, fill=SAGE)
    fg.save(out / "play-feature.png")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default=str(HERE / "www"))
    ap.add_argument("--out", default=str(HERE / "store"))
    ap.add_argument("--port", type=int, default=8909)
    ap.add_argument("--browser", default=None)
    ap.add_argument("--only", default=None, choices=sorted(DEVICES),
                    help="just one device")
    args = ap.parse_args(argv)

    # A published screenshot cannot be recalled. Refuse anything but the
    # committed synthetic fixture, however the script is invoked.
    if FIXTURE.name != "synthetic_mismo.xml" or not FIXTURE.exists():
        sys.exit("make-screenshots.py: the synthetic fixture is the only "
                 "permitted input for a published screenshot")

    from playwright.sync_api import sync_playwright

    dist = Path(args.dist).resolve()
    if not (dist / "shell.js").exists():
        sys.exit(f"make-screenshots.py: {dist} is not a build — npm run build")

    out_root = Path(args.out).resolve()
    srv = socketserver.TCPServer(("127.0.0.1", args.port),
                                 functools.partial(_Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{args.port}"

    total = 0
    try:
        with sync_playwright() as p:
            launch = {"executable_path": args.browser} if args.browser else {}
            browser = p.chromium.launch(**launch)
            wanted = [args.only] if args.only else list(DEVICES)

            for label in wanted:
                w, h, dsf = DEVICES[label]
                out = out_root / label
                out.mkdir(parents=True, exist_ok=True)
                ctx = browser.new_context(
                    viewport={"width": w, "height": h},
                    device_scale_factor=dsf,
                    is_mobile=label != "ios-ipad",
                    has_touch=True,
                    color_scheme="light",
                    reduced_motion="reduce",
                )
                ctx.add_init_script(BRIDGE)
                ctx.add_init_script(STUB_LICENCE)
                page = ctx.new_page()
                page.goto(origin + "/", wait_until="load")
                n = scenes(page, out)
                ctx.close()
                print(f"· {label:11} {w * dsf} x {h * dsf}  {n} screenshots")
                total += n

            browser.close()
    finally:
        srv.shutdown()

    out_root.mkdir(parents=True, exist_ok=True)
    store_graphics(out_root)
    print(f"· play-icon.png    512 x 512")
    print(f"· play-feature.png 1024 x 500")
    print(f"\n{total} screenshots in {out_root}")
    print("Synthetic fixture only — no real credit data in any of these.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
