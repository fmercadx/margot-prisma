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
| `test_analyzer.py` | 63 tests on synthetic tradelines and a fabricated MISMO fixture |

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
