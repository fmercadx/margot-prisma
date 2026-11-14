# takeoff

A test of one idea: **click one symbol on an electrical drawing, count every
copy of it on every sheet**, with no machine learning. It is the counting step
of an electrical takeoff, the part an estimator does by hand with a highlighter.

```bash
pip install -r requirements.txt
python takeoff.py plans.pdf \
    --item "Duplex receptacle=9:453,672" \
    --item "Quad receptacle=9:371,693" \
    --out out/
```

Each `--item` is a name and one click: `PAGE:X,Y` in PDF points from the
page's top-left corner, on any stroke of one example symbol. `PAGE:X0,TOP,X1,BOTTOM`
gives the box by hand instead. The output is `out/takeoff.xlsx` (totals, counts
per sheet, every location) and `out/markup.pdf` (each hit boxed and numbered).

## Never commit a drawing set

Construction drawings are the copyrighted work of the architects and engineers
who drew them, even when a public agency posts them for bidding. Downloading
one to test against privately is fine; publishing it is not, and this repo is
public. `*.pdf` is gitignored here and CI fails if a PDF or an image is tracked
under `takeoff/`. Tests build a synthetic drawing set at run time instead.

For the same reason, nothing made from a real set (screenshots, markups,
demo videos) goes into marketing without the owner's written permission.

## Counts are candidates

The spreadsheet and the markup both say `DRAFT`. A miscount in a bid comes out
of the contractor's margin, so every hit is either a **match** (an exact copy)
or **review** (close, but something differs), and the estimator confirms both.
Nothing that partly matches is silently counted or silently dropped.

## How it works

CAD plotters write each symbol as plain strokes, the same every time the block
is inserted, only moved or turned. So:

1. **The click** takes the stroke under the pointer and every stroke of the
   same pen that touches it. That pulls in a receptacle's tail along with its
   circle, which matters: on a typical set the tail's direction relative to the
   bars is the only thing that tells a duplex from a quad.
2. **The search** tries every stroke endpoint on every sheet as a corner of the
   example, at each quarter turn and mirrored, and keeps the placements where
   the example's corners line up.
3. **The score** has three parts:
   - *coverage*: how much of the example's ink is there
   - *purity*: how much of the ink touching the candidate the example explains
   - *extra*: that unexplained ink as a length

   A neighbouring symbol that doesn't touch the candidate is ignored. A line
   through the circle (the above-counter variant) or a hatch inside it (GFCI)
   counts against it. Ink is measured by area, because exports stack duplicate
   strokes and trace fills over lines.
4. **Several items** at one spot go to whichever matched best; the others are
   listed under "Also resembles".

Sheets whose heading reads like a symbol legend are shown but left out of the
totals, since the legend holds one copy of every symbol.

## What it was tested on

An 11-sheet public university renovation bid set, kept private. On the
first-floor power plan, one click on a wall duplex found all 66 duplexes, with
no false matches and no misses. That was checked by hand, symbol by symbol,
and independently by finding every receptacle-sized circle on the sheet and
looking at each one the duplex search had left unboxed. With one click each on
six receptacle types, every type's count matched the hand count. The only
non-exact cases were sent to review: GFCI receptacles above a counter, a
combination none of the six examples showed.

### Across six more firms

Six more public bid sets, each from a different electrical engineering firm,
were checked the same way: one example of the plain duplex receptacle per
power plan, then every hit and every possible miss checked by hand against an
independent count. The threshold and code were left as they are.

| Firm (sheet) | Duplexes drawn | Counted | To review | Missed | Other devices counted as duplex |
|---|---|---|---|---|---|
| Allen & Shariff (E-301) | 26 | 26 | 0 | 0 | 0 |
| DCL Engineering (E202) | 80 | 80 | 0 | 0 | 0, but 42 are GFI/WP/USB by text label only |
| MODUS Engineering (E-101.3) | 27 | 25 | 2 | 0 | 0, with a hand-drawn box (a click fails) |
| Lawrence Perry & Associates (E-301) | 75 | 73 | 2 | 0 | 17 GFCI |
| MEP&T Engineers (E121) | 16 | 16 | 0 | 0 | 18 tamper-resistant |
| Czarnecki Engineering (E201) | 50 | 11 | 38 | 1 | 1 GFCI-style |

It misses almost nothing: 1 of 274. What it gets wrong is telling apart
variants that look almost alike, and that is where the work is:

- **Fills.** A GFCI drawn as the duplex with its band filled solid adds no ink
  the matcher can see: the fill's outline lies on the bars, and fills are
  sampled only along their outline. Fills that are also stroked, or drawn in
  another colour, are dropped altogether.
- **Marks that don't touch.** A tamper-resistant bar drawn just clear of the
  circle is ignored, by the same rule that ignores neighbouring symbols.
- **Angled walls.** Only quarter turns are tried. A duplex on a 26° wall goes
  to review rather than missing, because its circle still matches.
- **Wires in the symbol's pen.** Growing a box from a click follows a wire
  that touches the symbol; a hand-drawn box works.
- **Text labels.** GFI, WP, USB, "C" for controlled are often only text beside
  the same graphic. It counts the graphic, which is right, but the count can't
  be priced until the labels are read.

## What it can't do yet

- **Scanned sets.** There are no strokes to compare; it says so and stops.
- **Symbols at angles other than quarter turns, or a different size** than the
  example. See above.
- **Enlarged plans** can repeat a device that is also on the floor plan. It
  counts per sheet and leaves that call to the estimator.
- **Reading the legend.** A legend's drawing of a symbol isn't always stroke
  for stroke the one on the plan (the tail length or bar spacing differed on
  two test sets), so the examples come from the plan.
- **Linear runs** (conduit, wire, cable tray), panel schedules and pricing.
