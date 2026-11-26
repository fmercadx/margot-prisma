"""What the estimator gets: a marked-up drawing and a spreadsheet.

Both say DRAFT. Every count is a candidate for the estimator to confirm, the
way the credit analyzer's report stamps itself NOT FOR RELEASE: a miscount in a
bid comes out of the contractor's margin, so nothing here is final.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from match import MATCH, REVIEW, Hit

# The markup renders with pypdfium2 and Pillow, which the browser build has no
# use for (the page draws its own boxes), so they load only when a markup is
# drawn. The spreadsheet needs openpyxl alone.

DRAFT = "DRAFT - CANDIDATE COUNTS - VERIFY EVERY ITEM BEFORE BIDDING"
REVIEW_COLOUR = (235, 120, 0)
CIRCUIT_COLOUR = (0, 130, 140)
RUN_COLOUR = (190, 0, 150)
# One colour per item for matches; orange is kept for review alone.
_ITEM_COLOURS = [(0, 150, 70), (30, 90, 220), (150, 40, 170), (0, 140, 150),
                 (200, 0, 110), (120, 80, 20), (20, 40, 110), (110, 120, 0)]


def _font(size: int):
    from PIL import ImageFont
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def markup(pdf_path: str, page_number: int, hits: list[Hit], scale: float = 1.5,
           crop: tuple[float, float, float, float] | None = None,
           items: list[str] | None = None, circuits: list | None = None, runs: list | None = None,
           all_hits: list[Hit] | None = None):
    """Render one page with every hit boxed and numbered.

    Each item's matches get their own colour, keyed under the banner; orange
    always means needs review. Numbers are 1-based positions in the page's hit
    list, the same numbers the spreadsheet's Locations tab uses. `crop`
    (x0, top, x1, bottom in points) renders part of the page, for zooming.
    `items` fixes the colour order so it stays the same across pages.
    """
    import pypdfium2 as pdfium
    from PIL import ImageDraw

    items = items or list(dict.fromkeys(h.item for h in hits))
    colours = {name: _ITEM_COLOURS[i % len(_ITEM_COLOURS)] for i, name in enumerate(items)}
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[page_number - 1]
    w, h = page.get_size()
    x0, t, x1, b = crop or (0, 0, w, h)
    img = page.render(scale=scale, crop=(x0, h - b, w - x1, t)).to_pil().convert("RGB")
    draw = ImageDraw.Draw(img)
    font = _font(max(10, int(6 * scale)))
    _draw_lengths(draw, circuits or [], runs or [], all_hits or hits, x0, t, scale, font)
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
    keys = items + ["needs review"] + (["circuit runs"] if circuits else []) + (["measured runs"] if runs else [])
    for name in keys:
        colour = {"needs review": REVIEW_COLOUR, "circuit runs": CIRCUIT_COLOUR,
                  "measured runs": RUN_COLOUR}.get(name) or colours[name]
        draw.rectangle([x, y + 2, x + 12, y + 14], fill=colour)
        draw.text((x + 18, y), name, fill=colour, font=key)
        x += 40 + int(draw.textlength(name, font=key))
    return img



def _draw_lengths(draw, circuits: list, runs: list, hits: list[Hit], x0: float, t: float, scale: float, font) -> None:
    """Circuit routes (solid, device to device), homeruns (dashed, to the panel)
    and measured runs, under the hit boxes."""
    import measure

    def xy(px, py):
        return (px - x0) * scale, (py - t) * scale
    width = max(2, int(scale))
    for c in circuits:
        for s in c.route:
            draw.line([xy(s[0], s[1]), xy(s[2], s[3])], fill=CIRCUIT_COLOUR, width=width)
        for s in c.homerun:
            _dashed(draw, xy(s[0], s[1]), xy(s[2], s[3]), CIRCUIT_COLOUR, width, 4 * scale)
        first = hits[c.devices[0]]
        total = c.route_ft + (c.homerun_ft or 0.0)
        text = f"{c.label or 'unnamed'} {measure.fmt_feet(total)}"
        px, py = xy(first.x + first.hw + 2, first.y + first.hh + 1)
        draw.text((px, py), text, fill=CIRCUIT_COLOUR, font=font)
    for r in runs:
        for s in r.segs:
            draw.line([xy(s[0], s[1]), xy(s[2], s[3])], fill=RUN_COLOUR, width=width + 1)
        if r.segs:
            s = r.segs[0]
            feet = r.feet
            draw.text(xy(s[0] + 3, s[1] - 9), f"{r.name}: {measure.fmt_feet(feet) if feet is not None else 'no scale'}",
                      fill=RUN_COLOUR, font=font)


def _dashed(draw, a, b, colour, width, dash) -> None:
    import math
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length < 1:
        return
    n = max(1, int(length / dash))
    for i in range(0, n, 2):
        s, e = i / n, min(1.0, (i + 1) / n)
        draw.line([(a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s),
                   (a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e)], fill=colour, width=width)

def save_markup_pdf(pdf_path: str, hits_by_page: dict[int, list[Hit]], out_path: str, scale: float = 1.5,
                    circuits: list | None = None, runs: list | None = None, all_hits: list[Hit] | None = None) -> None:
    items = list(dict.fromkeys(h.item for hits in hits_by_page.values() for h in hits))
    circuits, runs = circuits or [], runs or []
    numbers = sorted(set(hits_by_page) | {c.page for c in circuits} | {r.page for r in runs})
    pages = [markup(pdf_path, n, hits_by_page.get(n, []), scale, items=items,
                    circuits=[c for c in circuits if c.page == n], runs=[r for r in runs if r.page == n],
                    all_hits=all_hits)
             for n in numbers if hits_by_page.get(n) or any(c.page == n for c in circuits)
             or any(r.page == n for r in runs)]
    if pages:
        pages[0].save(out_path, save_all=True, append_images=pages[1:], resolution=72 * scale)


def write_xlsx(hits: list[Hit], sheets: dict[int, str], out_path: str, source: str = "",
               legend: set[int] = frozenset(), circuits: list | None = None, runs: list | None = None,
               allowances=None, notes: list[str] | None = None) -> None:
    """`legend` pages are shown per sheet but left out of the totals.

    With `circuits` (measure.Circuit) or `runs` (measure.Run), adds a Circuits
    and a Runs tab whose feet are spreadsheet formulas over allowance cells at
    the top of the Circuits tab, so the estimator's own conduit height, make-up
    and waste carry through every total.
    """
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
    grey = Font(italic=True, color="595959")
    for item, hs in by_item.items():
        per_page = Counter(h.page for h in hs if h.status == MATCH)
        rev = Counter(h.page for h in hs if h.status == REVIEW)
        ws.append([item, sum(n for p, n in per_page.items() if p not in legend),
                   sum(n for p, n in rev.items() if p not in legend)]
                  + [f"{per_page[p]}" + (f" (+{rev[p]}?)" if rev[p] else "") for p in pages])
        # The same graphic with a different label is often a different device
        # (GFI, WP, USB, controlled), so matches are also split by label.
        labels = Counter(h.text for h in hs if h.status == MATCH and h.page not in legend)
        if len(labels) > 1 or (labels and "" not in labels):
            for text, n in labels.most_common():
                ws.append([f"    labelled {text}" if text else "    no label", n])
                for c in ws[ws.max_row]:
                    c.font = grey
    ws.append([])
    ws.append(["Per-sheet cells read 'matches (+needs review?)'. Totals leave out sheets that look "
               "like a symbol legend, which holds one copy of each symbol. Indented rows split the "
               "matches by the short label printed beside each one."])
    ws.column_dimensions["A"].width = 28
    if circuits or runs:
        totals = _write_lengths(wb, hits, circuits or [], runs or [], allowances, notes or [])
        ws.append([])
        ws.append(["Lengths (feet; formulas over the Circuits tab's allowances)"])
        ws[ws.max_row][0].font = bold
        for label, ref in totals:
            ws.append([label, ref])
            ws.cell(ws.max_row, 2).number_format = "#,##0"

    loc = wb.create_sheet("Locations")
    loc.append(["Item", "Sheet", "Page", "No. on markup", "Status", "X (in)", "Y (in)",
                "Orientation", "Coverage", "Purity", "Extra ink (pt)", "Text beside it",
                "Nearest circuit label (unverified)", "Also resembles", "Note"])
    for c in loc[1]:
        c.font = bold
    orange = PatternFill("solid", fgColor="FCE4D6")
    numbered: dict[int, int] = Counter()
    for h in sorted(hits, key=lambda h: (h.page, h.y, h.x)):
        numbered[h.page] += 1
        loc.append([h.item, h.sheet, h.page, numbered[h.page], h.status,
                    round(h.x / 72, 2), round(h.y / 72, 2), h.orient, h.coverage, h.purity, h.extra, h.text,
                    h.label, h.also, h.note])
        if h.status == REVIEW:
            for c in loc[loc.max_row]:
                c.fill = orange
    loc.freeze_panes = "A2"

    note = wb.create_sheet("Read me")
    for line in (
        DRAFT,
        "",
        "How these counts were made: one example of each symbol was picked by hand, and every",
        "stroke-for-stroke copy of it was found on each sheet, at any angle, mirrored or not.",
        "Where two items fit one spot equally well, the item whose example covers more of the",
        "drawing there wins.",
        "",
        "match: the copy has all of the example's lines and fills and nothing extra touching it.",
        "review: something differs, often a different device drawn on the same circle, a",
        "leader or fill touching it, or a different symbol. An estimator decides.",
        "",
        "Text beside it: short labels printed next to the symbol (GFI, WP, USB, C, heights).",
        "Some firms mark a different device only this way, so check the split by label on the",
        "Summary tab. Note: flags matches that share the same separate mark beside them, which",
        "may be a variant (e.g. tamper-resistant) that needs its own example.",
        "",
        "Not found by this method: symbols drawn at a different size, symbols on scanned sheets,",
        "and devices shown only in schedules.",
        "",
        "X and Y are inches from the top-left corner of the sheet. Circuit labels are the",
        "nearest label text to each symbol and are not checked against the panel schedule.",
        "",
        "Lengths, on the Circuits and Runs tabs, are at the scale printed under each drawing",
        "(the Scale column says which). A circuit is its devices joined by the shortest runs",
        "along the sheet's axes, device to device: the method an estimator uses, not the route",
        "an installer will take. On a plan that labels each device, devices with the same",
        "circuit label share a circuit; on a plan that draws its wiring, the drawn lines say",
        "which devices share a run and the label at the homerun arrow names it. Drops run",
        "from the conduit height down to each device, at the height printed beside it or the",
        "default. Homeruns are measured only when the panel is named on the same drawing;",
        "otherwise the cell is blank for you to fill. Change the allowances at the top of the",
        "Circuits tab and every total follows. Measured runs were traced or followed by hand.",
    ):
        note.append([line])
    note["A1"].font = red
    note.column_dimensions["A"].width = 100
    for row in note.iter_rows():
        row[0].alignment = Alignment(wrap_text=False)
    wb.save(out_path)


def _write_lengths(wb, hits: list[Hit], circuits: list, runs: list, allowances, notes: list[str]):
    """The Circuits and Runs tabs. Returns Summary rows: (label, formula)."""
    import measure
    a = allowances or measure.Allowances()
    bold = Font(bold=True)
    red = Font(bold=True, color="C00000")
    grey = Font(italic=True, color="595959")
    head_fill = PatternFill("solid", fgColor="DDEBF7")

    c = wb.create_sheet("Circuits", 1)
    c.append([DRAFT])
    c["A1"].font = red
    c.append(["Allowances: change these and every total follows"])
    c["A2"].font = bold
    c.append(["Conduit runs at (ft above the floor)", a.conduit_height])
    c.append(["Device height when none is printed (ft)", a.device_height])
    c.append(["Make-up left in each box, per conductor (ft)", a.makeup])
    c.append(["Waste", a.waste])
    c["B6"].number_format = "0%"
    for r in range(3, 7):
        c.cell(r, 2).fill = PatternFill("solid", fgColor="FFF2CC")
    c.append([])
    head = ["Sheet", "Circuit", "Panel", "Devices", "What", "Device to device (ft)", "Homerun (ft)",
            "Devices with a height printed", "Their heights (ft)", "Drops (ft)", "Conduit (ft)",
            "Conductors", "Wire (ft)", "Scale", "Note"]
    c.append(head)
    first = c.max_row + 1
    for cell in c[c.max_row]:
        cell.font = bold
        cell.fill = head_fill
    for x in circuits:
        r = c.max_row + 1
        printed = [h for h in x.heights if h is not None]
        c.append([x.sheet or f"page {x.page}", x.label or "(no label)", x.panel, len(x.devices), x.items,
                  round(x.route_ft, 1), round(x.homerun_ft, 1) if x.homerun_ft is not None else None,
                  len(printed), round(sum(printed), 2),
                  f"=MAX(0,D{r}*$B$3-((D{r}-H{r})*$B$4+I{r}))",
                  f"=(F{r}+G{r}+J{r})*(1+$B$6)",
                  x.conductors,
                  f"=((F{r}+G{r}+J{r})*L{r}+$B$5*L{r}*D{r})*(1+$B$6)",
                  x.scale.text if x.scale else "none", x.note])
        for col in (6, 7, 9, 10, 11, 13):
            c.cell(r, col).number_format = "#,##0.0"
        if x.note:
            c.cell(r, 15).font = grey
    last = c.max_row
    c.append(["Total", "", "", f"=SUM(D{first}:D{last})" if circuits else 0, "",
              f"=SUM(F{first}:F{last})" if circuits else 0, f"=SUM(G{first}:G{last})" if circuits else 0, "", "",
              f"=SUM(J{first}:J{last})" if circuits else 0, f"=SUM(K{first}:K{last})" if circuits else 0, "",
              f"=SUM(M{first}:M{last})" if circuits else 0])
    total_row = c.max_row
    for cell in c[total_row]:
        cell.font = bold
    for col in (6, 7, 10, 11, 13):
        c.cell(total_row, col).number_format = "#,##0"
    for n in notes:
        c.append([n])
        c[c.max_row][0].font = grey
    c.freeze_panes = f"A{first}"
    for col, width in zip("ABCDEFGHIJKLMNO", (10, 16, 8, 8, 26, 12, 11, 12, 11, 10, 11, 10, 11, 14, 50)):
        c.column_dimensions[col].width = width
    c.column_dimensions["A"].width = 40

    rws = wb.create_sheet("Runs", 2)
    rws.append([DRAFT])
    rws["A1"].font = red
    rws.append(["Runs traced or followed by hand. Waste is the Circuits tab's."])
    rws.append([])
    rws.append(["Sheet", "Name", "How", "Length on plan (ft)", "Conductors", "Conduit (ft)", "Wire (ft)", "Scale", "Note"])
    rfirst = rws.max_row + 1
    for cell in rws[rws.max_row]:
        cell.font = bold
        cell.fill = head_fill
    for x in runs:
        r = rws.max_row + 1
        feet = x.feet
        rws.append([x.sheet or f"page {x.page}", x.name, x.how, round(feet, 1) if feet is not None else None,
                    x.conductors, f"=D{r}*(1+Circuits!$B$6)", f"=D{r}*E{r}*(1+Circuits!$B$6)",
                    x.scale.text if x.scale else "none", x.note])
        for col in (4, 6, 7):
            rws.cell(r, col).number_format = "#,##0.0"
    rlast = rws.max_row
    rws.append(["Total", "", "", f"=SUM(D{rfirst}:D{rlast})" if runs else 0, "",
                f"=SUM(F{rfirst}:F{rlast})" if runs else 0, f"=SUM(G{rfirst}:G{rlast})" if runs else 0])
    rtotal = rws.max_row
    for cell in rws[rtotal]:
        cell.font = bold
    for col, width in zip("ABCDEFGHI", (10, 24, 10, 12, 10, 11, 11, 14, 50)):
        rws.column_dimensions[col].width = width

    return [("Conduit, circuits (ft)", f"=Circuits!K{total_row}"),
            ("Wire, circuits (ft)", f"=Circuits!M{total_row}"),
            ("Conduit, measured runs (ft)", f"=Runs!F{rtotal}"),
            ("Wire, measured runs (ft)", f"=Runs!G{rtotal}")]
