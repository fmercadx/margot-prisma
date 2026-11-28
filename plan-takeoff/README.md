# Plan Takeoff

Open a plan PDF in the browser, and it counts the symbols and measures the
areas and lengths drawn on it. Served at
`fmercadx.github.io/margot-prisma/plan-takeoff/`.

This is the first slice of the idea reviewed in
[`reports/bobyard-review/`](../reports/bobyard-review/README.md): a
*vector-first* takeoff tool. CAD exports store a plan as lines and shapes, so
most of what an estimator counts can be read straight out of the file. No
model, no training data, no server.

Not to be confused with [`takeoff/`](../takeoff/README.md), the repo's other
takeoff tool. That one counts electrical symbols from one clicked example and
measures circuits, with its Python modules running in Pyodide. This one reads
every repeated shape, hatch, polygon and line off a sheet unprompted, in
JavaScript over pdf.js's own path data. They share no code. Whether they stay
two tools or become one is an open decision.

## What it does

| On the sheet | How it is read | Reported as |
| --- | --- | --- |
| The legend: a symbol with its name to the right | Each label line's symbol is read as a template. On the plan, its parts are matched by a rotation-invariant fingerprint and assembled around an anchor part, so copies placed at any angle count and a lone circle of the same size does not | **Plants**, a named count each |
| The plant schedule (on this or another sheet) | A row that ends in a whole number is a quantity; it is matched to the legend entry by name or code | A chip on the row: agrees, or `schedule N` |
| A symbol stamped many times with no legend entry | Rotation-invariant fingerprint; loose parts whose instances sit together are merged | **Other repeated shapes**, collapsed, for the estimator to name |
| A legend swatch of parallel lines, or of repeated motifs | Names hatched areas by angle and spacing; estimates a motif pattern's area from motif counts | **Hatched and patterned areas**, sq ft, named |
| Hatching with no boundary (sod, gravel, pavers) | Parallel lines are binned by angle and joined to their neighbours one spacing apart; pieces a few spacings apart are one area; area ≈ Σ line length × spacing | **Hatched areas**, sq ft |
| A closed shape, filled or outlined (a bed, a patio) | Shoelace on the polygon; holes subtract | **Outlined areas**, sq ft |
| An open line (edging, pipe, fence) | Segments of one style that meet end to end are chained back into a polyline; grouped by line style | **Lines**, lin ft |
| The scale: a note or a graphic bar | `1" = 20'-0"`, `1/8" = 1'-0"`, `1:240`; or the drawn ruler, read from its labels and its length | Feet per point, or **Calibrate** by clicking two points a known distance apart |

A sheet stored rotated (a portrait page displayed landscape) is read upright.

Click a row to see what it refers to on the plan. Rename rows, untick what you
don't want, download or copy a CSV.

### Tested on real sheets

Three public bid sets, all vector: Lake County FL's roundabout landscape
plan (CPH), the City of Madison's 2019 parks landscaping set, and a 2026
Lake County procurement set for housing in Tavares FL (Halff), whose plant
schedule sits on another sheet with the quantity column before the name.
Where the legend is drawn the way the plan is, the count lands on the
schedule's number: Tavares red maple 11, crape myrtle 28 and live oak 34;
Lake County dwarf yaupon 95. Tavares magnolia came out 17 of 18 and Walter's
viburnum 376 of 373. Where the legend is drawn at another size (Lake
County's podocarpus, 9 pt in the legend and 4 pt on the plan) or in more
detail than the plan (Madison's starbursts, Tavares's bald cypress), the
named count is wrong or missing and the schedule chip says so; when an
unnamed repeated shape matches the schedule's quantity, the row says that
too. Madison's schedule is a pasted image, so it cannot be read. Lake
County's graphic scale bar is drawn as outlines, not text, so that sheet
needs calibration. A legend whose rows are packed, with big tree symbols
nearly touching, reads; a palm section whose symbols are grouped with
leaders rather than placed beside their names does not.

The page opens on a bundled sample sheet (the synthetic test plan, emitted
beside `index.html` at build time) so the first view shows the tool working.
*Open plan* replaces it.

## What it does not do

- **Scanned plans.** A raster sheet has no paths. It renders, and the lists
  stay empty. That is the half of the problem that needs a trained vision
  model, and it is out of scope here on purpose.
- **A legend drawn at another size than the plan, or in more detail,** does
  not match it; the schedule chip and the unnamed-shape suggestion are the
  fallback.
- **Overlapping symbols in a massed bed** share parts with their neighbours;
  counts there are approximate.
- **Cross-hatch** reports once per angle, so it double-counts.
- **Title blocks** come through as outlined rectangles. They are unticked by
  default; delete or ignore them.
- **Pricing, waste factors, plant schedules.** Not yet.

Every quantity is a candidate. An estimator checks it before it goes in a bid.

## Nothing leaves the browser

pdf.js and its worker are bundled with the page. `smoke.py` asserts that
loading the page and running a takeoff makes zero off-origin requests. Bid
sets are confidential; this is a feature, not an implementation detail.

## Layout

| Path | Role |
| --- | --- |
| `src/engine/paths.js` | pdf.js operator list → painted paths in the upright frame, with the transform stack, form XObjects and layers tracked |
| `src/engine/text.js` | Text rows and lines with positions |
| `src/engine/scale.js`, `scalebar.js` | Scale notation and calibration; the graphic scale bar |
| `src/engine/signature.js` | The rotation-invariant shape fingerprint |
| `src/engine/legend.js` | Read the legend; count symbols and measure patterns by it |
| `src/engine/schedule.js` | Plant schedule rows and matching |
| `src/engine/symbols.js` | Repeated shapes with no legend entry |
| `src/engine/hatch.js` | Hatch regions, their area, their legend names |
| `src/engine/regions.js` | Closed polygons |
| `src/engine/lines.js` | Open polylines, chained and grouped by style |
| `src/engine/takeoff.js` | Runs the stages in order; each claims the paths it explains |
| `src/main.js`, `src/viewer.js` | The page |
| `test/fixture.mjs` | Draws the synthetic plan with known quantities |
| `test/engine.test.mjs` | The engine against that plan, through pdf.js |
| `smoke.py` | The built page in Chromium |

The engine takes pdf.js's `OPS` table as an argument rather than importing
pdf.js, so it has no runtime dependency and can be tested against any shape.

## Commands

```bash
cd plan-takeoff
npm ci
npm test                       # 20 engine tests, Node only
npm run build                  # → ../dist/plan-takeoff
cd ..
python3 plan-takeoff/smoke.py --dist dist/plan-takeoff

# regenerate the synthetic fixture after changing test/fixture.mjs
cd plan-takeoff && node test/fixture.mjs test/fixtures/synthetic_plan.pdf
```

`test/fixtures/` is gitignored except for `synthetic_*`. Do not put a client's
plan set in the repository.

## Next

1. More real sets: two are not a sample. Public-works bid sets are free.
2. Scale-invariant template matching, for a legend drawn at another size.
3. Read a graphic scale bar whose numbers are outlines, not text.
4. Use CAD layer names (already captured per path) to label rows.
5. Per-item pricing and a bid sheet export.
