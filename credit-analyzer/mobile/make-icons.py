#!/usr/bin/env python3
"""Generate app icons and splash screens for both platforms.

    pip install pillow
    python credit-analyzer/mobile/make-icons.py

Committed as a script rather than as a folder of PNGs nobody can regenerate.
Changing the mark is one edit here and a re-run, and the diff of a binary is
otherwise unreviewable.

The mark is three bars with the middle one picked out in brass: underwriting
reads the median of three repositories, which is the single idea the whole
product is built on. It is drawn from a common baseline with heights in
descending order, so the highlighted bar genuinely *is* the median rather than
just the one in the middle.

Deliberately no text and no fine detail — the smallest target is 48px, where a
hairline disappears and a letterform turns to mush.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("make-icons.py: needs Pillow — pip install pillow")

HERE = Path(__file__).resolve().parent
ANDROID_RES = HERE / "android/app/src/main/res"
IOS_ICONSET = HERE / "ios/App/App/Assets.xcassets/AppIcon.appiconset"

PINE = (31, 77, 61)        # #1F4D3D — the ground, same as the app chrome
SAGE = (123, 161, 146)     # #7BA192 — the two bureaus that are not the median
BRASS = (232, 195, 107)    # #E8C36B — the qualifying score

# Android adaptive icons crop to the central 72dp of a 108dp canvas, so the
# mark has to live inside 2/3 of the foreground or the OS shaves it off.
ADAPTIVE_SAFE = 72 / 108


def draw_mark(size: int, scale: float = 1.0, background=None) -> Image.Image:
    """The three bars, centred, on `background` (or transparent)."""
    # Supersample and downscale: at 48px, un-antialiased rounded ends look chewed.
    ss = 4
    px = size * ss
    img = Image.new("RGBA", (px, px), background + (255,) if background else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    span = px * 0.62 * scale          # width the three bars occupy together
    bar_w = span / 5.0                # three bars plus two gaps of equal width
    gap = bar_w
    tallest = px * 0.60 * scale
    baseline = px / 2 + tallest / 2
    left = px / 2 - span / 2

    # Descending, so the middle bar's height is the median of the three.
    for i, (frac, colour) in enumerate(
            ((1.00, SAGE), (0.78, BRASS), (0.56, SAGE))):
        x0 = left + i * (bar_w + gap)
        h = tallest * frac
        d.rounded_rectangle(
            [x0, baseline - h, x0 + bar_w, baseline],
            radius=bar_w / 2, fill=colour + (255,))

    return img.resize((size, size), Image.LANCZOS)


def circle_mask(img: Image.Image) -> Image.Image:
    ss = 4
    big = img.resize((img.width * ss, img.height * ss), Image.LANCZOS)
    mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, big.width - 1, big.height - 1], fill=255)
    big.putalpha(mask)
    return big.resize(img.size, Image.LANCZOS)


def splash(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), PINE + (255,))
    # A third of the shorter edge keeps the mark comfortable in both
    # orientations without ever touching a rounded display corner.
    mark_px = int(min(w, h) * 0.34)
    mark = draw_mark(mark_px)
    img.alpha_composite(mark, ((w - mark_px) // 2, (h - mark_px) // 2))
    return img


def save(img: Image.Image, path: Path, keep_alpha: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG") if keep_alpha else img.convert("RGB").save(path, "PNG")


def main() -> int:
    written = 0

    # ---- iOS. One 1024 square, no alpha and no transparency: the App Store
    # rejects an icon with an alpha channel, and the OS applies its own mask.
    icon = draw_mark(1024, background=PINE)
    save(icon, IOS_ICONSET / "AppIcon-512@2x.png", keep_alpha=False)
    written += 1

    # ---- Android launcher icons.
    for density, legacy in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                            ("xxhdpi", 144), ("xxxhdpi", 192)):
        res = ANDROID_RES / f"mipmap-{density}"
        square = draw_mark(legacy, background=PINE)
        save(square, res / "ic_launcher.png")
        save(circle_mask(square), res / "ic_launcher_round.png")

        # Foreground is 108dp with the mark inside the central 72dp, and
        # transparent — the background comes from the colour resource.
        fg_px = int(legacy * 108 / 48)
        save(draw_mark(fg_px, scale=ADAPTIVE_SAFE), res / "ic_launcher_foreground.png")
        written += 3

    # The adaptive icon's background is a colour, not a drawable.
    bg = ANDROID_RES / "values/ic_launcher_background.xml"
    bg.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="ic_launcher_background">#1F4D3D</color>\n'
        '</resources>\n')
    written += 1

    # ---- Splash screens, at exactly the sizes Capacitor scaffolded.
    sizes = {
        "drawable": (480, 320),
        "drawable-port-mdpi": (320, 480), "drawable-land-mdpi": (480, 320),
        "drawable-port-hdpi": (480, 800), "drawable-land-hdpi": (800, 480),
        "drawable-port-xhdpi": (720, 1280), "drawable-land-xhdpi": (1280, 720),
        "drawable-port-xxhdpi": (960, 1600), "drawable-land-xxhdpi": (1600, 960),
        "drawable-port-xxxhdpi": (1280, 1920), "drawable-land-xxxhdpi": (1920, 1280),
    }
    for folder, (w, h) in sizes.items():
        save(splash(w, h), ANDROID_RES / folder / "splash.png")
        written += 1

    print(f"· wrote {written} images")
    print(f"· iOS      {IOS_ICONSET.relative_to(HERE)}")
    print(f"· Android  {ANDROID_RES.relative_to(HERE)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
