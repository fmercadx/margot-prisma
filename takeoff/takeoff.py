"""Count symbols in a CAD-exported drawing set from one example of each.

    python takeoff.py plans.pdf \\
        --item "Duplex receptacle=9:453,672" \\
        --item "Quad receptacle=9:371,693" \\
        --out out/

Each --item is NAME=PAGE:X,Y, a point on one example symbol in PDF points
from the page's top-left corner, or NAME=PAGE:X0,TOP,X1,BOTTOM to give the box
yourself. Writes takeoff.xlsx and markup.pdf to --out. Every count is a
candidate: see report.py.

Lengths (see measure.py): circuits are estimated from the counted devices at
the scale printed under each drawing. Also:

    --trace "Homerun A=9:120,400;300,400;300,610"   points along a route
    --follow "Feeder=9:850,1210"                     a drawn line, from one click
    --scale "9=1/8\" = 1'-0\""                       a page's scale, by hand
    --panel "R1A=9:1630,1520"                        where a panel is
    --wires "9:1100,880"                             the pen a sheet draws wiring in
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections import Counter

import drawings
import match
import measure
import report


def parse_item(spec: str) -> tuple[str, int, tuple[float, ...]]:
    try:
        name, where = spec.rsplit("=", 1)
        page, coords = where.split(":", 1)
        nums = tuple(float(v) for v in coords.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError(f"--item {spec!r}: expected NAME=PAGE:X,Y or NAME=PAGE:X0,TOP,X1,BOTTOM")
    if len(nums) not in (2, 4) or not name.strip():
        raise argparse.ArgumentTypeError(f"--item {spec!r}: expected NAME=PAGE:X,Y or NAME=PAGE:X0,TOP,X1,BOTTOM")
    return name.strip(), int(page), nums


def _points(text: str) -> list[tuple[float, float]]:
    return [tuple(float(v) for v in pair.split(",")) for pair in text.split(";") if pair.strip()]


def parse_where(spec: str, flag: str, many: bool = False, named: bool = True):
    """NAME=PAGE:X,Y, or PAGE:X,Y when not `named`, or several X,Y pairs
    separated by ; when `many`. Returns (name, page, points)."""
    shape = ("NAME=" if named else "") + ("PAGE:X,Y;X,Y;..." if many else "PAGE:X,Y")
    try:
        name, where = spec.rsplit("=", 1) if named else ("", spec)
        page, coords = where.split(":", 1)
        pts = _points(coords)
        if not pts or any(len(p) != 2 for p in pts) or (len(pts) < 2 if many else len(pts) != 1) \
                or (named and not name.strip()):
            raise ValueError
        return name.strip(), int(page), pts
    except ValueError:
        raise argparse.ArgumentTypeError(f"{flag} {spec!r}: expected {shape}")


def parse_scale_flag(spec: str) -> tuple[int, measure.Scale]:
    try:
        page, text = spec.split("=", 1)
        return int(page), measure.scale_from_text(text)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"--scale {spec!r}: expected PAGE=SCALE, e.g. 9=1/8\" = 1'-0\" ({e})")


class Takeoff(list):
    """The hits, plus the lengths measured with them."""
    circuits: list = []
    runs: list = []
    notes: list = []


def run(pdf: str, items: list[tuple[str, int, tuple[float, ...]]], pages: list[int] | None = None,
        out: str | None = None, log=print, traces=(), follows=(), scales=(), panels=(), wires=(),
        allowances: measure.Allowances | None = None, circuits: bool = True) -> Takeoff:
    t0 = time.time()
    allowances = allowances or measure.Allowances()
    seed_pages = {p for _, p, _ in items} | {p for _, p, _ in traces} | {p for _, p, _ in follows} \
        | {p for _, p, _ in panels} | {p for _, p, _ in wires}
    wanted = sorted(set(pages) | seed_pages) if pages else None
    loaded = {p.number: p for p in drawings.load(pdf, wanted)}
    search = [loaded[n] for n in (pages or sorted(loaded))]
    log(f"loaded {len(loaded)} page(s) in {time.time() - t0:.1f}s")
    if not any(len(p.segs) for p in search):
        raise SystemExit("no vector strokes on any page searched: a scanned set, which this matcher cannot read")

    seeds = []
    for name, page_no, nums in items:
        page = loaded[page_no]
        seeds.append((name, match.make_seed(page, nums) if len(nums) == 4 else match.seed_at(page, *nums)))
    hits: list[match.Hit] = []
    for p in search:                    # sheet by sheet, so only one sheet's grids are held
        for name, seed in seeds:
            hits += match.find(p, seed, name)
        p.cache.clear()
    hits = match.resolve(hits)
    match.attach_text(hits, loaded)

    legend = {p.number for p in search if p.legend}
    if legend:
        log("legend sheet(s), shown but not totalled: " + ", ".join(loaded[n].sheet or f"page {n}" for n in sorted(legend)))
    for name, _, _ in items:
        mine = [h for h in hits if h.item == name and h.page not in legend]
        c = Counter(h.status for h in mine)
        log(f"{name}: {c[match.MATCH]} match, {c[match.REVIEW]} to review")
        labels = Counter(h.text for h in mine if h.status == match.MATCH)
        if len(labels) > 1 or "" not in labels:
            log("    by label: " + ", ".join(f"{t or 'no label'} {n}" for t, n in labels.most_common()))
    for message in match.flag_marks([h for h in hits if h.page not in legend]):
        log("note: " + message)

    result = Takeoff(hits)
    scale_for = dict(scales)
    result.runs = [measure.trace(loaded[p], pts, name, scale_for.get(p)) for name, p, pts in traces]
    result.runs += [measure.follow(loaded[p], *pts[0], name, scale_for.get(p)) for name, p, pts in follows]
    for r in result.runs:
        feet = r.feet
        log(f"{r.name} ({r.how}, {r.sheet or f'page {r.page}'}): "
            + (f"{measure.fmt_feet(feet)} at {r.scale.text}" if feet is not None else "no scale on this sheet"))
    result.circuits, result.notes = [], []
    if circuits and hits:
        pens = {}
        for _, p, pts in wires:
            k = measure.nearest_stroke(loaded[p], *pts[0])
            if k is None:
                raise ValueError(f"--wires: no line near {pts[0]} on page {p}")
            pens[p] = loaded[p].styles[loaded[p].style[k]]
        result.circuits, result.notes = measure.circuits(
            hits, {n: loaded[n] for n in (pages or sorted(loaded))},
            panel_at={(p, name): pts[0] for name, p, pts in panels}, scale_for=scale_for, wire_pens=pens)
        if result.circuits:
            conduit = sum(c.conduit(allowances) for c in result.circuits)
            wire = sum(c.wire(allowances) for c in result.circuits)
            log(f"circuits: {len(result.circuits)}, about {conduit:,.0f} ft of conduit and {wire:,.0f} ft of wire "
                f"(drops to {allowances.conduit_height:g} ft, {allowances.waste:.0%} waste)")
        for message in result.notes:
            log("note: " + message)
    if out:
        os.makedirs(out, exist_ok=True)
        sheets = {p.number: p.sheet for p in search}
        report.write_xlsx(hits, sheets, os.path.join(out, "takeoff.xlsx"), source=os.path.basename(pdf), legend=legend,
                          circuits=result.circuits, runs=result.runs, allowances=allowances, notes=result.notes)
        by_page: dict[int, list[match.Hit]] = {}
        for h in hits:
            by_page.setdefault(h.page, []).append(h)
        report.save_markup_pdf(pdf, by_page, os.path.join(out, "markup.pdf"),
                               circuits=result.circuits, runs=result.runs, all_hits=hits)
        log(f"wrote {out}/takeoff.xlsx and {out}/markup.pdf in {time.time() - t0:.1f}s total")
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--item", action="append", type=parse_item, default=[])
    ap.add_argument("--pages", help="comma-separated 1-based pages to search (default: all)")
    ap.add_argument("--out", default="out")
    ap.add_argument("--trace", action="append", default=[], type=lambda s: parse_where(s, "--trace", many=True),
                    help="NAME=PAGE:X,Y;X,Y;... a route to measure, point by point")
    ap.add_argument("--follow", action="append", default=[], type=lambda s: parse_where(s, "--follow"),
                    help="NAME=PAGE:X,Y a drawn line to measure, from one point on it")
    ap.add_argument("--scale", action="append", default=[], type=parse_scale_flag,
                    help="PAGE=SCALE, e.g. 9=1/8\" = 1'-0\", over what the sheet says")
    ap.add_argument("--panel", action="append", default=[], type=lambda s: parse_where(s, "--panel"),
                    help="NAME=PAGE:X,Y where a panel is, for homeruns")
    ap.add_argument("--wires", action="append", default=[], type=lambda s: parse_where(s, "--wires", named=False),
                    help="PAGE:X,Y a point on one drawn wire: circuits follow that pen on that page")
    ap.add_argument("--no-circuits", action="store_true", help="count only; no circuit lengths")
    d = measure.Allowances()
    ap.add_argument("--conduit-height", type=float, default=d.conduit_height,
                    help=f"ft above the floor the conduit runs at (default {d.conduit_height:g})")
    ap.add_argument("--device-height", type=float, default=d.device_height,
                    help=f"ft, for devices with no height printed beside them (default {d.device_height:g})")
    ap.add_argument("--makeup", type=float, default=d.makeup,
                    help=f"ft of each conductor left in every box (default {d.makeup:g})")
    ap.add_argument("--waste", type=float, default=d.waste * 100, help=f"percent (default {d.waste * 100:g})")
    a = ap.parse_args(argv)
    if not (a.item or a.trace or a.follow):
        ap.error("give at least one --item, --trace or --follow")
    pages = [int(p) for p in a.pages.split(",")] if a.pages else None
    allowances = measure.Allowances(a.conduit_height, a.device_height, a.makeup, a.waste / 100)
    try:
        run(a.pdf, a.item, pages, a.out, traces=a.trace, follows=a.follow, scales=a.scale, panels=a.panel,
            wires=a.wires, allowances=allowances, circuits=not a.no_circuits)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
