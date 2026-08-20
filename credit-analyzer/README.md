# credit-analyzer

Phase 1 prototype: parse a tri-merge credit file, normalize it, and emit ranked
findings with evidence attached.

This is the deterministic layer only. It surfaces candidates; a human decides
what becomes a finding in a client deliverable. That boundary is deliberate —
it is the quality bar and the liability line.

## Install & run

```bash
pip install pypdf pytest

# Preferred: one MISMO CREDIT_RESPONSE covers all three repositories
python analyze.py report.xml --score 620 --clean-months 12

# Fallback: one consumer-disclosure PDF per bureau
python analyze.py path/to/*.PDF --score 620 --clean-months 12

python analyze.py report.xml --report out/analysis.html --file-ref OR-2601
python analyze.py report.xml --json out/findings.json --all
python -m pytest test_analyzer.py -q
```

## Layout

| File | Role |
| --- | --- |
| `canonical.py` | Schema (`Tradeline` / `BureauReport` / `CreditFile`), money and date parsing, cross-bureau merge |
| `parse_mismo.py` | MISMO v2.4 `CREDIT_RESPONSE` XML parser — the **preferred** input path |
| `parse_pdf.py` | Consumer-disclosure PDF parser — the *fallback* input path |
| `rules.py` | Findings engine; each rule reads the model and returns `Finding`s |
| `report.py` | Renders findings into the ten-section HTML analysis report |
| `analyze.py` | CLI |
| `web/` | Flask front end &mdash; upload, review, download, delete |
| `browser/` | Static build that runs the whole engine in the browser via WebAssembly |
| `test_analyzer.py` | 63 tests on synthetic tradelines and a fabricated MISMO fixture |
| `web/test_web.py` | 34 tests, weighted toward auth, traversal and retention |

Adding an input format means writing a parser that emits `BureauReport`
objects. Nothing else changes.

## What it finds

`MIDDLE_SCORE` · `LIMIT_GAP` · `UTIL_SPREAD` · `OVER_LIMIT` · `PRESENCE_GAP` ·
`ACTIVE_LATE` · `LATE_ASYMMETRY` · `ELIGIBILITY` · `OPEN_CLOSED` ·
`STATUS_GRID_CONFLICT` · `CHARGEOFF_MATH` · `BURNED_DISPUTES` ·
`SYSTEMIC_PATTERN` · `DTI_EFFICIENCY` · `COLLECTIONS` · `INQUIRY_CLUSTER` ·
`INQUIRY_UNMATCHED` · `INQUIRY_LOAD` · `MERGED_SOURCE`

Three of these carry most of the value:

- **`MIDDLE_SCORE`** — underwriting uses the median of three, so effort spent on
  the highest bureau is wasted and effort on the lowest is wasted until it
  passes the middle. Every other recommendation should target one bureau.
- **`LIMIT_GAP`** — a credit limit furnished to two bureaus but not the third
  inflates utilization on the third with no change to actual debt. Free points,
  and invisible on any single report.
- **`LATE_ASYMMETRY`** — a delinquency on some bureaus and not others. The
  finding carries a *warning against disputing*: a furnisher investigation
  reaches all reporting, so the likely outcome is the clean bureaus adding the
  mark rather than the dirty one dropping it.

## Design notes

**Prefer MISMO XML over PDF.** Credit vendors deliver structured XML alongside
the PDF they show the loan officer. Payment history arrives as `_PAYMENT_PATTERN`
— one character per month with an explicit start date — so grids parse exactly
and every tradeline comes back `grid_confident = True`. The reconstruction in
`parse_pdf.py` exists only because glyphs are lost in text extraction. Ask
clients for XML.

**A merged input hides the most valuable findings.** Some vendors collapse
per-bureau values before handing the file over. In that shape, missing credit
limits and one-bureau late marks are undetectable — their absence is a property
of the input, not of the borrower. `parse_mismo` detects this and sets
`CreditFile.merged_source`, and the `MERGED_SOURCE` rule says so out loud rather
than reporting a clean file. Request the unmerged report when it fires.

**Grid confidence is tracked, not assumed.** Single-year grids render as one
line of month tokens and parse unambiguously. Multi-year grids drop the on-time
glyphs, so cell-to-year alignment is a positional guess — those tradelines get
`grid_confident = False` and the CLI marks any dependent finding as low
confidence. Legend text is used as a cross-check: if the legend lists no
delinquency codes, marker cells are discarded regardless of what alignment
produced.

**Merging is two-pass.** The visible account-number prefix plus the open date is
the strongest key — bureaus mask to different lengths (`470793XXXXXX` vs
`470793XXXXXXXXXX`) but the prefix is identical. A second pass reconciles
leftovers where creditor abbreviations diverge (`UPWARDLI` /
`UPWARD FINANCIAL INC`) using the open date plus a corroborating signal, and
refuses to merge groups that both already claim a bureau — that guard is what
keeps two different accounts opened the same day apart.

**Delinquency events, not delinquent months.** A charged-off account reports
`CO` every month until it ages off. Counting each as a fresh late would push
every eligibility date forward forever, so consecutive runs collapse to the
month the run began.

**Account types are compared on letters only.** PDFs say `Line of Credit`,
MISMO says `LineOfCredit`, some vendors say `LINE_OF_CREDIT`. A substring match
on the raw string catches one of the three and silently drops the account from
utilization — which is how two real credit-limit gaps went unreported until the
XML fixture exposed it.

**Eligibility has a fencepost.** The month of the late is not clean. A 30-day
mark in August 2026 against a 12-month requirement gives a clean window of
September 2026 – August 2027, so eligibility opens **September 2027** — not
August. A month matters here.

## The report

`--report` renders the ten-section deliverable. It fills everything mechanical —
scores, blocker ranking, discrepancy table, action list, DTI ordering, the
eligibility arithmetic — and stops where judgment starts.

Three things it does deliberately:

**Judgment slots are visible.** Anything needing an analyst renders as a boxed
`[ANALYST]` marker rather than plausible filler, and the footer counts how many
remain and stamps the draft `NOT FOR RELEASE`. Filler that reads as finished is
how an unreviewed draft reaches a client.

**Truncation is always announced.** Tables cap at a readable length and print
what was dropped. Silent truncation reads as "this is everything" when it isn't.

**Actions sort by effect per dollar.** Curing an active delinquency gates
everything and comes first regardless of cost; then free corrections; then the
cheapest qualifying gains. Not by severity — a borrower has limited cash and
needs to know where it goes first.

Section 10 is written to be forwarded to the borrower unedited, which is what
makes the originator look good and is the reason they renew.

## The web front end

```bash
export ANALYZER_PASSWORD='something long'     # no default; it refuses to start without one
python web/app.py                             # http://127.0.0.1:5000
```

An **internal analyst tool**, not a consumer product. The operator uploads a file a
loan officer sent them, reviews the findings, downloads a draft report, and deletes
it. Borrowers never log in, never upload and never pay &mdash; which is what keeps
this outside the Credit Repair Organizations Act. There is no consumer-facing route,
by design rather than by omission.

Handling consumer credit files over a network makes the FTC Safeguards Rule concrete,
so the controls are code rather than policy:

| Control | How |
| --- | --- |
| Retention | TTL on every job, purged on **every request** &mdash; not by a cron nobody runs |
| Disposal | Delete is a first-class UI action and removes uploads and derived report together |
| Access control | Session auth on every route, password hashed, no default, minimum length enforced |
| Brute force | Per-IP throttle that blocks the correct password too, or it is trivially bypassed |
| Least data | The form asks for a file reference, never a borrower name |
| Confidentiality | Job dirs `0700`, files `0600`, unguessable job tokens, uploads never served statically |
| Accountability | Append-only audit log of login, upload, analysis, download and delete |
| Failure mode | Debug off &mdash; a traceback would leak file paths and job tokens |

### Deploying it

`Procfile` and `railway.json` at the repo root configure a Railway deploy. Set
these variables in the Railway dashboard:

| Variable | Value |
| --- | --- |
| `ANALYZER_PASSWORD` | something long — there is no default |
| `ANALYZER_SECRET_KEY` | `python -c 'import secrets; print(secrets.token_hex(32))'` |
| `ANALYZER_TRUST_PROXY` | `1` |
| `ANALYZER_DATA_DIR` | `/data/jobs` if you attach a volume, else leave unset |
| `ANALYZER_TTL_HOURS` | `24` |

`ANALYZER_TRUST_PROXY=1` is not optional behind a proxy. Without it every request
appears to come from the proxy's address, which turns the per-IP login throttle
into a *global* one — eight failed guesses from anyone locks out everybody — and
fills the audit log with a single useless address. It is gated behind an explicit
opt-in because trusting `X-Forwarded-For` when *not* behind a proxy is worse than
the bug it fixes: anyone could then set their own address and bypass the throttle.

Setting `ANALYZER_TRUST_PROXY=1` also makes `ANALYZER_SECRET_KEY` mandatory — a
generated key differs per process and dies on restart, silently breaking sessions.

Two platform facts worth knowing before you rely on it:

**The filesystem is ephemeral.** Uploaded files and reports vanish on every
redeploy and restart. With a 24-hour TTL that is mostly harmless, but a job can
disappear mid-review. Attach a Railway volume and point `ANALYZER_DATA_DIR` at it
if that matters.

**One worker, deliberately.** The throttle counts attempts in process memory, so
N workers allow N times the guesses. The `Procfile` pins `--workers 1`. Raising it
requires moving the throttle into the shared data directory first.

**Think before making it public.** A hosted instance means consumer credit files
sitting on someone else's server, which is where FTC Safeguards Rule obligations
stop being theoretical — a written security program, a named responsible person,
vendor oversight and an incident response plan. Running it on a laptop for one
operator's own files carries none of that. Deploy when a loan officer needs a link,
not before.

## The browser build

`browser/` compiles the same engine to a page that needs no server at all.
Pyodide is CPython built for WebAssembly, so `canonical.py`, `parse_pdf.py`,
`parse_mismo.py`, `rules.py` and `report.py` are bundled and imported
*unchanged* — `browser_api.py` is the only new code, and it is glue. The
findings are the findings the CLI produces, because it is the same code.

```bash
npm ci                       # brings in Pyodide as a devDependency
npm run build:analyzer       # assembles dist/analyzer
python -m http.server -d dist/analyzer

python browser/smoke.py --dist dist/analyzer   # drives it in real Chromium
```

**The credit file never leaves the machine.** Parsing and all nineteen rules
run inside the tab. There is no upload, no session, no retention window and no
server holding consumer reports — which removes most of what makes the FTC
Safeguards Rule expensive, because the data is never in anyone's custody but
the operator's own.

**Everything is served same-origin, deliberately.** The Pyodide runtime, the
Python standard library and pypdf are all vendored into the build rather than
pulled from a CDN or installed by `micropip` at runtime. A page that reads
consumer credit files should not be making third-party requests: a CDN would
learn who opens the tool and when, and "nothing leaves your machine" would stop
being true in the way that matters. `smoke.py` asserts zero off-origin requests
so this cannot regress quietly.

pypdf is pure Python with no dependencies, so unzipping the wheel into the
bundle *is* the install. That is the whole reason `micropip` is not needed.

**It is still not a consumer product.** Publicly reachable is not the same as
consumer-facing: the page is an analyst's tool with no borrower-facing flow, no
payment, and no representation that it repairs anything. That distinction is
what keeps it outside CROA, and it is stated on the page rather than left to
inference.

First load is roughly 13 MB — the WebAssembly build of CPython and its standard
library — and cached afterwards. That cost buys the absence of a server.

## Inquiries

Raw inquiry counts mislead. Same-purpose inquiries inside a 45-day window are
collapsed by the scoring model into one, so twenty-five auto pulls across a
month cost roughly what one costs. `INQUIRY_CLUSTER` detects those windows and
`INQUIRY_LOAD` reports the effective count next to the raw one.

Business type is the primary signal for classification, but bureaus disagree —
TransUnion files auto lenders under `Finance, personal` — so the subscriber name
is checked too.

`INQUIRY_UNMATCHED` is the one that matters. It flags a *standalone* inquiry
inside the scoring window with no tradeline opened within 60 days. Usually a
decline or an abandoned application, but it is also the only inquiry category
worth disputing: a narrow claim naming one unrecognized pull is credible where a
blanket claim is not. Rate-shopping cluster members are excluded — shopping five
lenders and signing with one is expected, not suspicious.

All of it is anchored to `CreditFile.as_of`, the pull date rather than the
clock, so a file re-analyzed months later produces the findings it produced on
the day it was pulled.

## Not done yet

- Per-program criteria beyond score floor and clean-month count

## Handling consumer data

`fixtures/` is gitignored. **Never commit a real credit report** — git history is
permanent and survives any later change in repository visibility. Tests run on
synthetic tradelines built in `test_analyzer.py` for exactly this reason.

Anything built on top of this needs encryption at rest, access logging, MFA, and
a working purge path, per the FTC Safeguards Rule. Design the delete path early;
retrofitting it is miserable.
