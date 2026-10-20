# Bobyard: review, and whether we can do it

*Prepared 20 October 2026. Subject: `bobyard.com/general/q3-2026-mobile`.*

> **How this was researched.** The Bobyard page itself could not be loaded from
> the environment this was written in (outbound access is allowlisted), so
> everything below comes from web search: Bobyard's own blog and press
> releases, trade press, data aggregators, and competitor comparison pages.
> **No performance figure in this report has been independently verified.**
> Where a number comes from Bobyard or a competitor, it says so. The ad-click
> identifiers in the original link (`gclid`, `gbraid`) are omitted here
> because this repository is public.

---

## Bottom line

**Can we build Bobyard? No.** Not the whole thing. It is a three-year-old,
venture-funded company ($35M Series A, December 2025) with an estimated
60–120 staff, per-trade computer-vision models trained on plan sets we do not have,
and a paid sales motion. Competing head-on is not realistic.

**Can we build a useful slice of it? Yes, and most of it is geometry rather
than AI.** On CAD-exported (vector) landscape plans, the quantities an
estimator needs (areas, lengths, plant counts, the drawing scale) can be read
straight out of the PDF. A spike in this folder did that using only `pypdf`,
the library the credit analyzer already ships in the browser via Pyodide. It
recovered four of five quantities exactly and the fifth (a hatch-only sod
area) within 0.2%. The hard part, and Bobyard's real moat, is scanned or
messy plans. Those need trained vision models and a labelled corpus.

**Recommendation: test demand with a tool-assisted takeoff *service* before
building a product.** Do takeoffs for landscape contractors per sheet, using
our own extractor plus human review. It costs little to start, earns revenue
from the first job, and tells us within a month whether real plans are vector
enough and whether anyone will pay. Build the self-serve tool only if that
works. Section 7 has a 30-day plan with kill criteria.

The biggest unknown is not technical. **It is whether we have any route to
landscape contractors.** Nothing in this repository's other three products
touches construction, and Bobyard is buying its own brand keyword on Google
(the link you sent is that ad). Distribution is what we would be up against.

---

## 1. The page you sent

The URL is a paid-search landing page, not a product announcement:

| Part | What it tells us |
| --- | --- |
| `/general/q3-2026-mobile` | A general-audience landing page, Q3 2026 cohort, mobile variant |
| `utm_campaign=English-GoogleAds-Brand-Bobyard` | Google Ads, **branded** campaign |
| `utm_content=Exact`, `utm_term=bobyard ai` | Exact-match bid on the query "bobyard ai" |

*Inference, not confirmed:* "mobile" means the page is laid out for phone
visitors from the ad, not that Bobyard has a mobile app. No source found
mentions a Bobyard phone or tablet app. Every 2026 release describes a
desktop/web takeoff workbench. Branded-keyword bidding usually means a company
is defending its name against competitors bidding on it. In this market, that
fits.

## 2. What Bobyard is

**Company**

- San Francisco, founded 2023 (per data aggregators). CEO Michael Ding (per
  RocketReach, one source).
- **$35M Series A, 10 December 2025**, led by 8VC, with Pear VC, Primary
  Venture Partners, Tishman Speyer, RXR, Caffeinated Capital and Merrick
  Ventures. The stated use of funds is expanding into drywall, electrical,
  HVAC, plumbing and framing.
- Headcount estimates range from 22 to 122 depending on the source. Tracxn's
  122 (September 2026) is the most recent. Revenue is about $5M per
  Datanyze, which is low confidence.
- Bobyard says it has "hundreds of customers".

**Product.** AI quantity and material takeoff, plus estimating, from
construction drawings. The contractor uploads a plan set. The software
detects symbols, hatched areas and linework for a trade, turns them into
quantities, and links those to pricing so a bid can go out.

| Date | Release |
| --- | --- |
| Launch market | Landscaping: plants, hardscape, irrigation, sod and mulch areas, edging |
| — | Aerial takeoff for paving and landscape maintenance, measured from aerial imagery rather than plans |
| 8 Apr 2026 | **Bobyard 2.0**: material-centric workflow, quantities linked to pricing from the start |
| Jun 2026 | Electrical: fixture detection, circuits, wire routing and lengths |
| 17 Jun 2026 | Finishes: flooring, drywall, paint, insulation, doors and windows |
| 22 Jul 2026 | Commercial plumbing: pipe measurement, fittings, risers |
| In development | Mechanical |

Named features:

- **Multi-Measure** gives area, perimeter and volume from one outline.
- **Pattern Search** picks a hatch (sod, pavers, mulch) and generates polygons
  and area totals.
- **Legend Manager** builds symbol and pattern legends.
- **Item Callouts** counts plants from text labels when there are no symbols.
- **Edge Finder** is also listed.
- **Review Workflow** shows a confidence level on every AI output.

**Customers.** Trade press describes the landscaping customers as mid-market
and enterprise commercial installers, "typically those handling commercial
installation projects valued between $3 million and more than $20 million".

**Claims (all Bobyard's own, none independently verified)**

- Automates "up to 70%" of quantity and material takeoff.
- "65% reduction in takeoff times" on average. Elsewhere it says 40–70%, and
  its FAQ says "50-90%, depending on drawing quality, trade, and the estimator
  review process".
- "3–5x more bids submitted per estimator".
- Bobyard publishes **no accuracy percentage**.

**Pricing.** Not published. Bobyard says customers pay a flat subscription per
estimator seat, regardless of takeoff volume, with a premium tier that
includes customer-success managers. Capterra lists "contact vendor", no free
trial, and zero reviews.

## 3. The market it sits in

Prices are as reported by comparison sites in 2026. The sources disagree, and
several are vendor-written, so treat this table as a range, not a quote.

| Tool | Model | Reported price | Notes |
| --- | --- | --- | --- |
| **Bobyard** | Per-trade AI takeoff + estimating | Undisclosed, per seat | Landscaping first, now multi-trade |
| Togal.AI | AI takeoff | $199–$299/user/mo, billed yearly | Architectural floor plans. "Up to 98%" accuracy with no stated method |
| Kreo | AI takeoff | $35–$175/user/mo | Auto-measure and auto-count in the Pro tier |
| STACK | Takeoff + estimating | ~$199–$249/mo, or $1,899–$2,999/yr | AI sold as add-ons |
| PlanSwift | Desktop takeoff | ~$1,495 one-time, or ~$1,749/yr | Windows only |
| Bluebeam Revu | PDF markup + measure | ~$260–$440/user/yr | Measurement, not AI takeoff |
| On-Screen Takeoff | Desktop takeoff | ~$15/user/mo + "Takeoff Boost" add-on | Price per Bobyard's own comparison |
| Beam AI (Attentive.ai) | Managed AI takeoff | Custom; credits per sheet | Attentive raised a $30.5M Series B |
| SiteRecon | Aerial measurement | From $39/user/mo | Lawn, landscape, snow maintenance |
| Takeoff Monkey | Outsourced human takeoff | $39/sheet | Price per Bobyard's own comparison |

**On accuracy, nobody has independent numbers.** No head-to-head test of
Bobyard against Togal exists. A comparison site summarises a single-user
study of Togal: the corrected takeoff came within 5% of a manual one, and the
authors advised against relying on the AI output alone. Field reports put the
raw first pass anywhere from about 60% to the mid-90s, depending on the
sheet. Every vendor, Bobyard included, builds a human review step into the
product.

**What this means:** the market is crowded, venture-funded on at least two
fronts (Bobyard, Attentive), and prices are compressing at the low end ($15–$39
a month). The one gap nobody fills is *measured, published* accuracy.

## 4. How the product works, and which parts are hard

| Layer | Difficulty | Why |
| --- | --- | --- |
| Ingest PDF, split sheets, read the title block | Easy | Text extraction. The scale note ("1" = 20'-0"") is a regex |
| Closed polygons → area, polylines → length | Easy on vector PDFs | Shoelace formula on path coordinates |
| Repeated symbols → counts | Easy–moderate on vector PDFs | Fingerprint a symbol's path shape and find every copy |
| Hatch → area (Pattern Search) | Moderate | Hatch is often loose parallel lines with no boundary. See the spike |
| Legend and plant schedule ↔ symbols | Moderate | Text layout plus matching. Gives a free cross-check: schedule quantity vs. counted quantity |
| Real-world PDF mess | Moderate | Transforms, block references (form XObjects), multiple scales per sheet, layers, text drawn as outlines |
| Scanned or raster plans, hand markups, overlapping symbols | **Hard** | Needs trained vision models and thousands of labelled sheets. **This is Bobyard's moat** |
| Price book, waste factors, labour → estimate | Easy software, real domain knowledge | The spreadsheet part, but you have to know landscaping |
| Each new trade | Hard | Every trade has its own symbology and its own data to collect |

Two points follow from this table:

- **The share of real plans that are vector-native decides everything.** If
  most landscape plans arrive as CAD exports, most of the value is reachable
  without ML. If they arrive as scans, it is not. We do not know that share
  yet, and it is the first thing the test plan measures.
- CAD layers (PDF optional-content groups, with names like `L-PLNT-SYMB`) can
  survive export. When they do, they label the linework for us, and much of
  the "AI" becomes a lookup.

## 5. Can we do it? Mapped to what this repository already has

| Needed | Already here | Gap |
| --- | --- | --- |
| Parse PDFs in the browser, no server | `pypdf` vendored into Pyodide (`credit-analyzer/browser/build.py`) | None |
| Keep client documents on the client's machine | `browser/smoke.py` asserts zero off-origin requests | None. Bid sets are often confidential, so this is a selling point |
| Mobile app with file import and share | Capacitor shell, `mobile/shell-native.js` | Plan viewing on a phone is a poor fit anyway. Treat as desktop-first |
| Licence check and billing | `credit-analyzer/licence/`: Cloudflare Worker, Stripe-backed | Reusable as is |
| Findings marked for human review | `[ANALYST]` markers, `NOT FOR RELEASE` stamp | Same idea as Bobyard's Review Workflow. Port the pattern |
| One engine, separate host shells | The `--target web\|mobile` seam | Reusable pattern |
| **Interactive plan viewer**: pan, zoom, click to outline, edit polygons | Nothing | **The largest build item.** pdf.js (Apache-2.0) for rendering |
| Vector extraction: areas, lengths, counts, hatch, scale | The spike in this folder | Real-PDF hardening (transforms, XObjects, layers, pattern fills) |
| Vision models for raster plans | Nothing | Needs labelled data we do not have |
| Landscape estimating knowledge and price books | Nothing | Needs a partner or hire who has bid landscape jobs |
| A route to contractors | Unknown | **The deciding question** |

**Legal posture: far lighter than the credit analyzer's.** No consumer is
involved, so CROA, RESPA and FCRA do not apply. Three things do matter:

1. **Bid errors.** A wrong quantity can lose a contractor money on a
   fixed-price bid. Keep the "candidates, an estimator signs off" stance and
   put a limitation of liability in the terms. The credit analyzer's habit of
   never filling a gap with plausible filler carries over directly.
2. **Plan sets are copyrighted and often under bid NDAs.** Processing them
   locally sidesteps most of this. Keeping any of them to train models needs
   the client's explicit, written permission.
3. **Open-source licences.** The closest open project, OpenTakeoff, exists
   in many GitHub copies. Some say AGPL-3.0 and some say Apache-2.0, and a
   fork cannot relicense code on its own authority. Treat it as AGPL until
   the original author and licence are confirmed. PyMuPDF is also AGPL. `pypdf` (BSD) and pdf.js
   (Apache-2.0) are safe to ship in a closed product.

One choice to make deliberately: "nothing leaves the machine" is a *credit
analyzer* rule, adopted because of consumer data. A takeoff tool could send a
legend crop to a cloud vision model to classify symbols. That would help with
raster plans, but it gives up the confidentiality pitch. Decide that on
purpose rather than by default.

## 6. Options

| | Option | Effort (rough) | Risk | Verdict |
| --- | --- | --- | --- | --- |
| A | Full multi-trade Bobyard competitor | Years, a funded ML team | Very high | **No** |
| B | Self-serve, local-only, vector-first landscape takeoff tool | A few months to a usable version: viewer + extraction + export | Distribution; low-end price pressure ($15–$39/mo) | **Later, only if C works** |
| C | Tool-assisted takeoff service: our extractor + a human reviewer, priced per sheet or per job | Weeks to start | Labour-bound; needs estimating skill | **Start here** |

Why C first:

- It earns from the first job.
- It answers the vector-share question with real plans.
- It produces the labelled corpus that B needs, if clients consent.
- It is the same shape as the credit analyzer: deterministic candidates, a
  human decides.

The $39/sheet outsourced benchmark and $30–$75/hour for human takeoff
specialists frame the price.

## 7. A 30-day test, with kill criteria

1. **Collect 15–20 real landscape plan sets.** Public-works bids (city,
   county, state DOT) post full plan sets publicly, which avoids NDA
   questions during testing. Add a few from contractors, with permission.
2. **Measure the vector share.** Open each sheet and check whether the plant
   symbols and hatches are vector paths or pixels.
   *Kill if fewer than ~60% of planting and hardscape sheets are vector.*
3. **Harden the spike** against those files: transforms, form XObjects,
   layers, pattern fills, plant-schedule parsing. Compare against a manual
   takeoff of the same sheets.
   *Target: counts within ±2% and areas within ±5% on vector sheets.*
4. **Time it.** Assisted takeoff (extractor plus review) against a manual
   takeoff in Bluebeam or On-Screen Takeoff.
   *Kill if it is not at least 2x faster.*
5. **Talk to 10 landscape contractors** who bid commercial installs.
   *Kill if fewer than 3 will pay for a takeoff at a stated price.*

If all four gates pass, run option C for a quarter. Revisit B with real
volume, real plans and a real price point in hand.

---

## Appendix: the vector-takeoff spike

[`vector_takeoff_spike.py`](vector_takeoff_spike.py) draws a synthetic 17×11
landscape plan at 1" = 20'-0" with known quantities, using reportlab. It then
recovers them from the PDF using **only `pypdf`**: no ML and no rasterising.
It reads the scale from the title-block text and walks the content-stream
path operators (`m l c re h S f B`).

| Quantity | How it is recovered | Truth | Recovered | Error |
| --- | --- | ---: | ---: | ---: |
| Sod area, hatch lines only, no boundary | Group segments by angle, find the hatch spacing, area ≈ Σ(line length) × spacing | 7,716.0 sf | 7,701.7 sf | −0.19% |
| Mulch bed, closed filled polygon | Shoelace | 4,444.4 sf | 4,444.4 sf | 0.00% |
| Steel edging, open polyline | Sum of segment lengths | 201.2 lf | 201.2 lf | 0.00% |
| Trees, repeated symbol | Translation-invariant path fingerprint | 7 | 7 | 0 |
| Shrubs, a second symbol | Same | 12 | 12 | 0 |

```bash
pip install pypdf reportlab
python3 reports/bobyard-review/vector_takeoff_spike.py /tmp/plan.pdf
```

**What this proves, and what it does not.** It proves the mechanism works in
the library we already ship. It says nothing about real plans. The synthetic
sheet has no transforms, block references, layers, pattern fills, overlapping
linework or raster content, all of which real CAD exports do have. An earlier
run showed −4.8% on the sod area. That was a bug in the *generator*, which
left a corner unhatched, not in the extraction; it was fixed before the
numbers above were taken. The angle-grouping heuristic would also be confused
on a busy real sheet, where layer names or pattern-fill objects should
identify the hatch instead. Step 3 of the test plan exists to find out how
much of this survives contact with real files.

---

## Sources

Bobyard's own pages and releases (vendor claims):

- [Bobyard homepage](https://www.bobyard.com/)
- [Bobyard vs. Togal.AI](https://www.bobyard.com/blogs/bobyard-vs-togal-ai/) · [vs. On-Screen Takeoff](https://www.bobyard.com/blogs/bobyard-vs-on-screen-takeoff/) · [vs. Takeoff Monkey](https://www.bobyard.com/blogs/bobyard-vs-takeoff-monkey/)
- [New features: Edge Finder, AI Item Callouts](https://www.bobyard.com/blogs/new-features-edge-finder-ai-item-callouts-and-more?id=202684386712) · [Aerial paving takeoff](https://www.bobyard.com/blogs/bobyard-aerial-paving-ai-takeoff-software-launch) · [Paving trade page](https://www.bobyard.com/trade/paving)
- [Bobyard 2.0 launch, Business Wire, 8 Apr 2026](https://www.businesswire.com/news/home/20260408131586/en/Bobyard-Launches-Bobyard-2.0-Delivering-Faster-Takeoffs-a-Consolidated-AI-Workbench-and-a-Platform-Built-to-Scale-Across-Trades)
- [Series A, Business Wire, 10 Dec 2025](https://www.businesswire.com/news/home/20251210946193/en/) · [Pear VC](https://pear.vc/bobyard-series-a/) · [8VC](https://www.8vc.com/resources/from-plans-to-progress-announcing-the-8vc-bobyard-partnership)
- [Finishes trades, GlobeNewswire, 17 Jun 2026](https://www.globenewswire.com/news-release/2026/06/17/3313581/0/en/bobyard-launches-ai-takeoff-and-estimating-for-flooring-drywall-paint-insulation-and-doors-windows.html) · [Plumbing, GlobeNewswire, 22 Jul 2026](https://www.globenewswire.com/news-release/2026/07/22/3331481/0/en/bobyard-launches-ai-takeoff-and-estimating-for-commercial-plumbing-contractors.html) · [Electrical, Dealroom](https://app.dealroom.co/news/feed/bobyard-launches-ai-electrical-takeoff-tool-to-cut-estimating-time-by-65)

Trade press and reviews:

- [Lawn & Landscape: Series A](https://www.lawnandlandscape.com/news/bobyard-raises-35-million-funding) · [Bobyard 2.0](https://www.lawnandlandscape.com/news/bobyard-launches-bobyard-2/)
- [Landscape Management: Bobyard 2.0](https://www.landscapemanagement.net/bobyard-launches-bobyard-2-0/) · [Estimate table](https://www.landscapemanagement.net/bobyards-new-estimate-table-streamlines-landscaping-bids/)
- [AI News: Bobyard 2.0](https://www.artificialintelligence-news.com/news/bobyard-2-0-offers-improved-takeoffs-and-unified-ai-for-estimators/) · [Built In SF: Series A](https://www.builtinsf.com/articles/bobyard-raises-35m-to-advance-ai-powered-construction-takeoffs-20251211) · [For Construction Pros: finishes](https://www.forconstructionpros.com/construction-technology/surveying-layout/product/22969599/bobyard-bobyard-expands-ai-takeoff-platform-to-finishes-trades)
- [BestCRE review](https://bestcre.com/bobyard-review-cre-ai/) · [Capterra listing](https://www.capterra.com/p/10145663/Bobyard/)

Company data (aggregators, low confidence):

- [Tracxn](https://tracxn.com/d/companies/bobyard/__IDEttZmVgz6sEYZ1CoNtgfRsxhMB0sxGHiBNtHDBPLE) · [PitchBook](https://pitchbook.com/profiles/company/540711-55) · [Datanyze](https://www.datanyze.com/companies/bobyard/5000580028) · [RocketReach](https://rocketreach.co/bobyard-profile_b718ae3cc4825bed) · [CB Insights](https://www.cbinsights.com/company/bobyard)

Competitors and market (several vendor-written):

- [Foreman AI: AI takeoff pricing 2026](https://foremanai.co/blog/best-ai-takeoff-software-2026) · [Quotr: Togal alternatives](https://quotr.ai/blog/best-togal-ai-alternatives-2026/) · [BuildVision](https://www.buildvisionai.com/best-construction-takeoff-software) · [Ruh AI comparison](https://www.ruh.ai/blogs/takeoff-tool-comparison-2026)
- [Bildrix: advertised vs measured accuracy](https://bildrix.com/research/ai-takeoff-accuracy) · [TheTakeoff.ai: 8-tool comparison](https://www.thetakeoff.ai/blog/ai-takeoff-software-comparison-8-tools-across-six-drawing-types-in-2026)
- [SiteRecon vs Bobyard (competitor page)](https://order.siterecon.ai/comparison/siterecon-vs-bobyard) · [SiteRecon on Capterra](https://www.capterra.com/p/276749/SiteRecon/) · [Attentive.ai Series B](https://attentive.ai/blog/attentive-ai-secures-30-5m-series-b-to-make-ai-the-backbone-of-preconstruction) · [Attentive.ai on SoftwareFinder](https://softwarefinder.com/construction/attentive-ai)
- [Takeoff services cost guide](https://scrapbox.io/brandboa1/%23_Understanding_Construction_Takeoff_Services_Cost:_A_Complete_Guide)

Open source:

- [OpenTakeoff (one of several copies; licence varies by copy)](https://github.com/Kentucky-ai/opentakeoff)
