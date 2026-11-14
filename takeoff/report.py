"""What the estimator gets: a marked-up drawing and a spreadsheet.

Both say DRAFT. Every count is a candidate for the estimator to confirm, the
way the credit analyzer's report stamps itself NOT FOR RELEASE: a miscount in a
bid comes out of the contractor's margin, so nothing here is final.
"""

from __future__ import annotations

from collections import Counter, defaultdict

import pypdfium2 as pdfium
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from PIL import Image, ImageDraw, ImageFont

from match import MATCH, REVIEW, Hit

DRAFT = "DRAFT - CANDIDATE COUNTS - VERIFY EVERY ITEM BEFORE BIDDING"
REVIEW_COLOUR = (235, 120, 0)
# One colour per item for matches; orange is kept for review alone.
_ITEM_COLOURS = [(0, 150, 70), (30, 90, 220), (150, 40, 170), (0, 140, 150),
                 (200, 0, 110), (120, 80, 20), (20, 40, 110), (110, 120, 0)]


def _font(size: int):
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def markup(pdf_path: str, page_number: int, hits: list[Hit], scale: float = 1.5,
           crop: tuple[float, float, float, float] | None = None,
           items: list[str] | None = None) -> Image.Image:
    """Render one page with every hit boxed and numbered.

    Each item's matches get their own colour, keyed under the banner; orange
    always means needs review. Numbers are 1-based positions in the page's hit
    list, the same numbers the spreadsheet's Locations tab uses. `crop`
    (x0, top, x1, bottom in points) renders part of the page, for zooming.
    `items` fixes the colour order so it stays the same across pages.
    """
    items = items or list(dict.fromkeys(h.item for h in hits))
    colours = {name: _ITEM_COLOURS[i % len(_ITEM_COLOURS)] for i, name in enumerate(items)}
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[page_number - 1]
    w, h = page.get_size()
    x0, t, x1, b = crop or (0, 0, w, h)
    img = page.render(scale=scale, crop=(x0, h - b, w - x1, t)).to_pil().convert("RGB")
    draw = ImageDraw.Draw(img)
    font = _font(max(10, int(6 * scale)))
    pad = 1.5
    for n, hit in enumerate(hits, 1):
        box = [(hit.x - hit.hw - pad - x0) * scale, (hit.y - hit.hh - pad - t) * scale,
               (hit.x + hit.hw + pad - x0) * scale, (hit.y + hit.hh + pad - t) * scale]
        if box[2] < 0 or box[3] < 0 or box[0] > img.width or box[1] > img.height:
            continue
        colour = REVIEW_COLOUR if hit.status == REVIEW else colours[hit.item]
        draw.rectangle(box, outline=colour, width=max(2, int(scale)))
        draw.text((box[2] + 2, box[1] - 2), str(n), fill=colour, font=font)
    size = max(14, int(10 * scale))
    banner = _font(size)
    draw.text((10, 10), DRAFT, fill=(200, 0, 0), font=banner)
    key = _font(max(11, int(7 * scale)))
    x, y = 10, 14 + size
    for name in items + ["needs review"]:
        colour = REVIEW_COLOUR if name == "needs review" else colours[name]
        draw.rectangle([x, y + 2, x + 12, y + 14], fill=colour)
        draw.text((x + 18, y), name, fill=colour, font=key)
        x += 40 + int(draw.textlength(name, font=key))
    return img


def save_markup_pdf(pdf_path: str, hits_by_page: dict[int, list[Hit]], out_path: str, scale: float = 1.5) -> None:
    items = list(dict.fromkeys(h.item for hits in hits_by_page.values() for h in hits))
    pages = [markup(pdf_path, n, hits, scale, items=items) for n, hits in sorted(hits_by_page.items()) if hits]
    if pages:
        pages[0].save(out_path, save_all=True, append_images=pages[1:], resolution=72 * scale)


def write_xlsx(hits: list[Hit], sheets: dict[int, str], out_path: str, source: str = "",
               legend: set[int] = frozenset()) -> None:
    """`legend` pages are shown per sheet but left out of the totals."""
    wb = Workbook()
    bold = Font(bold=True)
    red = Font(bold=True, color="C00000")

    ws = wb.active
    ws.title = "Summary"
    ws.append([DRAFT])
    ws["A1"].font = red
    ws.append([f"Source: {source}"] if source else [])
    ws.append([])
    pages = sorted(sheets)
    head = ["Item", "Matches", "Needs review"] + [
        (sheets[p] or f"page {p}") + (" (legend, not totalled)" if p in legend else "") for p in pages]
    ws.append(head)
    for c in ws[ws.max_row]:
        c.font = bold
    by_item: dict[str, list[Hit]] = defaultdict(list)
    for h in hits:
        by_item[h.item].append(h)
    for item, hs in by_item.items():
        per_page = Counter(h.page for h in hs if h.status == MATCH)
        rev = Counter(h.page for h in hs if h.status == REVIEW)
        ws.append([item, sum(n for p, n in per_page.items() if p not in legend),
                   sum(n for p, n in rev.items() if p not in legend)]
                  + [f"{per_page[p]}" + (f" (+{rev[p]}?)" if rev[p] else "") for p in pages])
    ws.append([])
    ws.append(["Per-sheet cells read 'matches (+needs review?)'. Totals leave out sheets that look "
               "like a symbol legend, which holds one copy of each symbol."])
    ws.column_dimensions["A"].width = 28

    loc = wb.create_sheet("Locations")
    loc.append(["Item", "Sheet", "Page", "No. on markup", "Status", "X (in)", "Y (in)",
                "Orientation", "Coverage", "Purity", "Extra ink (pt)", "Nearest circuit label (unverified)",
                "Also resembles"])
    for c in loc[1]:
        c.font = bold
    orange = PatternFill("solid", fgColor="FCE4D6")
    numbered: dict[int, int] = Counter()
    for h in sorted(hits, key=lambda h: (h.page, h.y, h.x)):
        numbered[h.page] += 1
        loc.append([h.item, h.sheet, h.page, numbered[h.page], h.status,
                    round(h.x / 72, 2), round(h.y / 72, 2), h.orient, h.coverage, h.purity, h.extra, h.label,
                    h.also])
        if h.status == REVIEW:
            for c in loc[loc.max_row]:
                c.fill = orange
    loc.freeze_panes = "A2"

    note = wb.create_sheet("Read me")
    for line in (
        DRAFT,
        "",
        "How these counts were made: one example of each symbol was boxed by hand, and every",
        "stroke-for-stroke copy of it was found on each sheet, at any quarter-turn or mirrored.",
        "",
        "match: the copy has all of the example's lines and nothing extra inside its box.",
        "review: something differs, often a different device drawn on the same circle, a",
        "label or wire crossing it, or a different symbol. An estimator decides.",
        "",
        "Not found by this method: symbols at angles other than quarter-turns, symbols drawn",
        "at a different size, symbols on scanned sheets, and devices shown only in schedules.",
        "",
        "X and Y are inches from the top-left corner of the sheet. Circuit labels are the",
        "nearest label text to each symbol and are not checked against the panel schedule.",
    ):
        note.append([line])
    note["A1"].font = red
    note.column_dimensions["A"].width = 100
    for row in note.iter_rows():
        row[0].alignment = Alignment(wrap_text=False)
    wb.save(out_path)
