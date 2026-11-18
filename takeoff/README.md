# takeoff

A test of one idea: **click one symbol on an electrical drawing, count every
copy of it on every sheet**, with no machine learning. It is the counting step
of an electrical takeoff, the part an estimator does by hand with a highlighter,
and, from the devices it counts, the measuring step: feet of conduit and wire
for every branch circuit, at the scale printed on the sheet.

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
per sheet, every location, circuits and runs in feet) and `out/markup.pdf` (each
hit boxed and numbered, each circuit's runs drawn).

Lengths come with the count. Add runs to measure by hand, or settle what the
sheet leaves open:

```bash
python takeoff.py plans.pdf --item "Duplex receptacle=9:453,672" \
    --trace "Homerun R1A=9:1210,1080;1210,1150;1300,1150" \
    --follow "Feeder=9:1500,556" \
    --panel "R1A=9:1630,1180" \
    --conduit-height 12 --waste 5 --out out/
```

`--trace` measures a route through the points given; `--follow` measures the
drawn line through one point; `--panel` says where a panel the sheet doesn't
name is; `--scale "9=1/4\" = 1'-0\""` overrides a page's scale; `--wires 9:X,Y`
names the pen a sheet draws its wiring in. `--help` lists the allowances.

## The click screen

`browser/` is the same tool as a web page, built into `dist/takeoff` and served
by GitHub Pages at `fmercadx.github.io/margot-prisma/takeoff/`:

1. Open a drawing set. Pick a sheet, type a name, and click one symbol (or drag
   a box around it). The dashed box shows what was taken as the example.
2. Add one example of each kind to count, then press **Count** (this sheet or
   all sheets).
3. Each kind's copies are boxed in its own colour; orange needs a look. Click
   any box to count or drop it. **Next to check** walks the orange ones.
4. The circuits are measured from the counted devices and drawn in teal. Set
   the allowances (conduit height, device height, make-up, waste), place any
   panel the drawing doesn't name, and trace or follow any other run.
5. Download the spreadsheet, with your calls applied.

It runs entirely in the browser: PDF.js draws the sheets, and the counting runs
these same Python modules in Pyodide (CPython compiled to WebAssembly) in a web
worker. Every file is served from the page's own origin, so the drawing never
leaves the visitor's computer, which matters for confidential bid documents.
`browser/smoke.py` asserts it in Chromium, along with the counts on a
synthetic set.

```bash
npm ci && npm run build:takeoff          # from the repo root
python3 takeoff/browser/smoke.py --dist dist/takeoff
```

## Lengths

An estimator prices conduit and wire by the foot, so `measure.py` turns the
sheet into feet:

- **The scale** is read from the label under each drawing (`1/8" = 1'-0"`,
  `3/32 = 1'-0"`, `1" = 20'`, `1:100`). A sheet with several drawings at
  different scales uses, for each length, the scale printed below it. A row of
  scales along the sheet's edge is a printed ruler and is ignored. The scale can
  be set by hand, or from two points a known distance apart.
- **Circuits.** Most power plans draw no wire at all: each receptacle carries
  its circuit (R1A-8), so devices with the same label share a circuit. Plans
  that do draw their wiring draw arcs that say which devices share a circuit,
  not where the conduit goes, and name each circuit at its homerun arrow. Either
  way a circuit is measured the way an estimator measures one: device to device,
  along the building's axes, plus a drop from the conduit to each device (at the
  height printed beside it, or the default), plus the homerun when the panel is
  named on the same drawing. A label reached from a device by a leader or arrow
  counts before one merely nearby; equipment tags written like circuits (1-V-5,
  EWH-2) are told apart because a panel's circuits recur and tags don't.
- **Runs** are traced point by point or followed along a drawn line from one
  click: every stroke of the same pen joined end to end, across a dashed line's
  gaps, stopping at symbols, each stroke counted once.

Wire is conduit length times conductors (a hot and a neutral per circuit, one
ground), plus make-up at each box. The spreadsheet keeps the allowances in cells
and every total as a formula over them. Circuits use counted devices only, as
the totals do: a device still to review joins its circuit when counted.

### How well it measures

The scale was read right on all seven sheets: door swings measured 3'-0" at the
scale read on six of them, and a door leaf on the seventh. For circuits,
independent checkers read every receptacle's circuit off each sheet, from its
label or by tracing the drawn wiring, and the tool's circuits were scored
against them after an estimator's pass over the devices to review:

| Sheet | The plan | Receptacles | Right circuit | Wrong circuit | No circuit |
|---|---|---|---|---|---|
| University renovation (E2.1) | labels each device | 125 | 117 | 5 | 3 |
| Lawrence Perry & Associates (E-301) | labels each device | 110 | 88 | 12 | 10 |
| Czarnecki Engineering (E201) | labels each device | 84 | 75 | 1 | 8 |
| MODUS Engineering (E-101.3) | draws its wiring | 73 | 59 | 12 named wrong | 2 |
| DCL Engineering (E202) | draws its wiring | 93 | 71 | 19 grouped or named differently | 3 |
| Allen & Shariff (E-301) | draws new wiring only | 35 new | 35 | 0 | 0 |

On the Allen & Shariff sheet the 81 existing devices with no wiring drawn were
rightly left out. Most of DCL's grouping differences are receptacles joined through
junction boxes, which the tool puts on one circuit and the checker counted
separately. What goes wrong:

- **Crowded labels.** A label between two devices, or a leader that crosses
  another, can go to the wrong device or none (one firm's dental lab).
- **Equipment labels near receptacles** on a wired plan can add a second name
  to a circuit (an FCU's circuit beside a receptacle's homerun).
- **Wires broken at crossings.** A drafter who breaks a wire where it crosses
  another splits one circuit in two.
- **Bare circuit numbers.** A sheet that prints only `9` or `20,22` beside each
  device, with the panel named in a note, gets no circuits (the MEP&T sheet);
  trace those by hand.

Feet are geometry at the printed scale: right when the grouping is right. The
route a circuit takes on site is the installer's choice, which is why the
allowances are editable and the totals say DRAFT.

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
Nothing that partly matches is silently counted. Something carrying a lot of
ink the example doesn't have (a GFCI's solid band, an exit sign's cross) is
left out of that item's review list; give it an example of its own.

## How it works

CAD plotters write each symbol as plain strokes, the same every time the block
is inserted, only moved or turned. So:

1. **The click** takes the stroke under the pointer and every stroke of the
   same pen that touches it. That pulls in a receptacle's tail along with its
   circle, which matters: on a typical set the tail's direction relative to the
   bars is the only thing that tells a duplex from a quad. Connections are left
   out: strokes from paths longer than 30 pt (a wall, a leader) and open runs of
   short strokes joined end to end (a wire drawn in pieces). A box drawn by
   hand still works where a click can't isolate a symbol.
2. **The search** tries every stroke endpoint on every sheet as a corner of the
   example, at each quarter turn and mirrored. Other angles come from pairs of
   endpoints the same distance apart as two of the example's corners, refined
   on every corner that lines up.
3. **The score** has four parts:
   - *coverage*: how much of the example's ink is there, and how much is
     missing as a length
   - *purity*: how much of the ink touching the candidate the example explains
   - *extra*: that unexplained ink as a length

   A neighbouring symbol that doesn't touch the candidate is ignored, and so is
   a wire or leader running into it. A line through the circle, a hatch or a
   solid fill inside it counts against it. Symbol-sized fills count by their
   area, whatever their colour. Ink is measured by area, because exports stack
   duplicate strokes and trace fills over lines. A lettered symbol (a square
   with FB in it) only matches copies with the same letters.
4. **Several items** at one spot go to whichever matched best; on a tie, the
   item whose example covers more ink there, so a tamper-resistant example
   beats a plain one on a tamper-resistant duplex. The others are listed under
   "Also resembles".
5. **Labels** beside each hit, the standard modifiers (GFI, WP, USB, TR, IG, C,
   SR, E...) and mounting heights, are read as small text blocks and split the
   counts on the Summary tab. When the same separate mark sits beside many of an
   item's matches, they get a note: it may be a neighbouring symbol or a variant.

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
were checked by hand: one example of the plain duplex receptacle per power
plan, every hit and every possible miss compared with an independent count.
Each checker then wrote an answer key of every receptacle on the sheet, so the
matcher can be scored automatically. Before and after the fixes, one click on
a plain duplex:

| Firm (sheet) | Duplexes | Round one: counted / review / missed | Now: counted / review / missed | Other devices counted as duplex, now |
|---|---|---|---|---|
| Allen & Shariff (E-301) | 26 | 26 / 0 / 0 | 26 / 0 / 0 | 0 |
| DCL Engineering (E202) | 80 | 80 / 0 / 0 | 80 / 0 / 0 | 0; labels GFI/WP/USB read on 44 of 45 |
| MODUS Engineering (E-101.3) | 27 | 25 / 2 / 0 by hand box; a click found 1 | 26 / 1 / 0 from a click | 0 |
| Lawrence Perry & Associates (E-301) | 75 | 73 / 2 / 0 | 74 / 1 / 0 | 0 (was 17 GFCI) |
| MEP&T Engineers (E121) | 16 | 16 / 0 / 0 | 16 / 0 / 0 | 18 tamper-resistant, now flagged with a note |
| Czarnecki Engineering (E201) | 50 | 11 / 38 / 1 | 43 / 7 / 0 | 0 (was 1) |

With one example of each receptacle type, the way an estimator would work,
600 of the 667 receptacles on the seven sheets are counted as the right type,
66 go to review and 1 is counted as the wrong type. Three hits land on
something that isn't a receptacle at all.

What is left, and why:

- **A separate mark, one click.** A tamper-resistant duplex is a plain duplex
  plus a bar that doesn't touch it, so a plain example matches it. The matches
  get a note; an example of the tamper-resistant one separates them (17 of 18).
- **Something touching.** A data outlet, arrowhead or neighbouring symbol drawn
  touching a receptacle sends it to review: 28 of one firm's 39 quads.
- **Not exact copies.** The same device drawn with a longer tail goes to
  review (one firm's furniture group). 12 of the same firm's 14 filled-bar
  duplexes, a symbol its legend doesn't list, come back with different fill
  ink from copy to copy and go to review or aren't shown; not yet looked into.
- **Identical drawings.** One firm draws a ceiling fan's hub with exactly the
  same symbol as its flush ceiling receptacle.
- **Labels far from the symbol.** Heights and "C" tags at the end of a leader
  line are not read; GFI, WP and USB next to the symbol mostly are.

## What it can't do yet

- **Scanned sets.** There are no strokes to compare; it says so and stops.
- **Symbols drawn at a different size** than the example.
- **Enlarged plans** can repeat a device that is also on the floor plan. It
  counts per sheet and leaves that call to the estimator.
- **Reading the legend.** A legend's drawing of a symbol isn't always stroke
  for stroke the one on the plan (the tail length or bar spacing differed on
  two test sets), so the examples come from the plan.
- **Panel schedules and pricing.** Lengths stop at feet of conduit and wire;
  wire sizes, conduit sizes and the price per foot are the estimator's.
