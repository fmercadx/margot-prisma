# Plan Takeoff

Open a plan PDF in the browser, and it counts the symbols and measures the
areas and lengths drawn on it. Served at
`fmercadx.github.io/margot-prisma/takeoff/`.

This is the first slice of the idea reviewed in
[`reports/bobyard-review/`](../reports/bobyard-review/README.md): a
*vector-first* takeoff tool. CAD exports store a plan as lines and shapes, so
most of what an estimator counts can be read straight out of the file. No
model, no training data, no server.

## What it does

| On the sheet | How it is read | Reported as |
| --- | --- | --- |
| A symbol stamped many times (tree, shrub, light, outlet) | Each path is fingerprinted by its shape; repeats are counted. A CAD block kept as a form XObject counts as one unit; a block flattened into loose paths is reassembled by co-location | **Symbols**, a count each |
| Hatching with no boundary (sod, gravel, pavers) | Parallel lines are binned by angle and joined to their neighbours one spacing apart; area ≈ Σ line length × spacing | **Hatched areas**, sq ft |
| A closed shape, filled or outlined (a bed, a patio) | Shoelace on the polygon; holes subtract | **Outlined areas**, sq ft |
| An open line (edging, pipe, fence) | Segments of one style that meet end to end are chained back into a polyline; grouped by line style | **Lines**, lin ft |
| The scale note in the title block | `1" = 20'-0"`, `1/8" = 1'-0"`, `1:240` | Feet per point, or **Calibrate** by clicking two points a known distance apart |

Click a row to see what it refers to on the plan. Rename rows, untick what you
don't want, download or copy a CSV.

The page opens on a bundled sample sheet (the synthetic test plan, emitted
beside `index.html` at build time) so the first view shows the tool working.
*Open plan* replaces it.

## What it does not do

- **Scanned plans.** A raster sheet has no paths. It renders, and the lists
  stay empty. That is the half of the problem that needs a trained vision
  model, and it is out of scope here on purpose.
- **Mirrored, rotated or rescaled copies of a block** count as a different
  symbol.
- **The legend** is on the sheet too, so a symbol that appears 7 times on the
  plan shows 8 when the legend is on the same page.
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
| `src/engine/paths.js` | pdf.js operator list → painted paths in page space, with the transform stack, form XObjects and layers tracked |
| `src/engine/scale.js` | Scale notation, calibration |
| `src/engine/symbols.js` | Fingerprint and count repeated shapes |
| `src/engine/hatch.js` | Hatch regions and their area |
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
cd takeoff
npm ci
npm test                       # 13 engine tests, Node only
npm run build                  # → ../dist/takeoff
cd ..
python3 takeoff/smoke.py --dist dist/takeoff

# regenerate the synthetic fixture after changing test/fixture.mjs
cd takeoff && node test/fixture.mjs test/fixtures/synthetic_plan.pdf
```

`test/fixtures/` is gitignored except for `synthetic_*`. Do not put a client's
plan set in the repository.

## Next

In the order the report recommends:

1. Run it on 15–20 real landscape plan sets and measure how many are vector.
2. Exclude the legend region; read the plant schedule and reconcile it with
   the counts.
3. Use CAD layer names (already captured per path) to label rows automatically.
4. Rotation- and scale-invariant symbol matching.
5. Per-item pricing and a bid sheet export.
