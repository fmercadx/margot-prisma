"""Count symbols in a CAD-exported drawing set from one example of each.

    python takeoff.py plans.pdf \\
        --item "Duplex receptacle=9:453,672" \\
        --item "Quad receptacle=9:371,693" \\
        --out out/

Each --item is NAME=PAGE:X,Y, a point on one example symbol in PDF points
from the page's top-left corner, or NAME=PAGE:X0,TOP,X1,BOTTOM to give the box
yourself. Writes takeoff.xlsx and markup.pdf to --out. Every count is a
candidate: see report.py.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections import Counter

import drawings
import match
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


def run(pdf: str, items: list[tuple[str, int, tuple[float, ...]]], pages: list[int] | None = None,
        out: str | None = None, log=print) -> list[match.Hit]:
    t0 = time.time()
    seed_pages = {p for _, p, _ in items}
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

    legend = {p.number for p in search if p.legend}
    if legend:
        log("legend sheet(s), shown but not totalled: " + ", ".join(loaded[n].sheet or f"page {n}" for n in sorted(legend)))
    for name, _, _ in items:
        c = Counter(h.status for h in hits if h.item == name and h.page not in legend)
        log(f"{name}: {c[match.MATCH]} match, {c[match.REVIEW]} to review")
    if out:
        os.makedirs(out, exist_ok=True)
        sheets = {p.number: p.sheet for p in search}
        report.write_xlsx(hits, sheets, os.path.join(out, "takeoff.xlsx"), source=os.path.basename(pdf), legend=legend)
        by_page: dict[int, list[match.Hit]] = {}
        for h in hits:
            by_page.setdefault(h.page, []).append(h)
        report.save_markup_pdf(pdf, by_page, os.path.join(out, "markup.pdf"))
        log(f"wrote {out}/takeoff.xlsx and {out}/markup.pdf in {time.time() - t0:.1f}s total")
    return hits


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--item", action="append", type=parse_item, required=True)
    ap.add_argument("--pages", help="comma-separated 1-based pages to search (default: all)")
    ap.add_argument("--out", default="out")
    a = ap.parse_args(argv)
    pages = [int(p) for p in a.pages.split(",")] if a.pages else None
    try:
        run(a.pdf, a.item, pages, a.out)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
