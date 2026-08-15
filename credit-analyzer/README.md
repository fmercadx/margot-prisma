# credit-analyzer

Phase 1 prototype: parse a tri-merge credit file, normalize it, and emit ranked
findings with evidence attached.

This is the deterministic layer only. It surfaces candidates; a human decides
what becomes a finding in a client deliverable. That boundary is deliberate —
it is the quality bar and the liability line.

## Install & run

```bash
pip install pypdf pytest
python analyze.py path/to/*.PDF --score 620 --clean-months 12
python analyze.py path/to/*.PDF --json out/findings.json --all
python -m pytest test_analyzer.py -q
```

## Layout

| File | Role |
| --- | --- |
| `canonical.py` | Schema (`Tradeline` / `BureauReport` / `CreditFile`), money and date parsing, cross-bureau merge |
| `parse_pdf.py` | Consumer-disclosure PDF parser — the *fallback* input path |
| `rules.py` | Findings engine; each rule reads the model and returns `Finding`s |
| `analyze.py` | CLI |
| `test_analyzer.py` | 29 tests on synthetic tradelines — no consumer data required |

Adding an input format means writing a parser that emits `BureauReport`
objects. Nothing else changes.

## What it finds

`MIDDLE_SCORE` · `LIMIT_GAP` · `UTIL_SPREAD` · `OVER_LIMIT` · `PRESENCE_GAP` ·
`ACTIVE_LATE` · `LATE_ASYMMETRY` · `ELIGIBILITY` · `OPEN_CLOSED` ·
`STATUS_GRID_CONFLICT` · `CHARGEOFF_MATH` · `BURNED_DISPUTES` ·
`SYSTEMIC_PATTERN` · `DTI_EFFICIENCY` · `COLLECTIONS`

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
the PDF, with payment grids as real fields. The grid reconstruction in
`parse_pdf.py` exists only because glyphs are lost in text extraction; the XML
path avoids the problem entirely. Ask clients for XML.

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

**Eligibility has a fencepost.** The month of the late is not clean. A 30-day
mark in August 2026 against a 12-month requirement gives a clean window of
September 2026 – August 2027, so eligibility opens **September 2027** — not
August. A month matters here.

## Not done yet

- MISMO XML parser (should become the primary path)
- Report generation from findings JSON
- Inquiry clustering (rate-shop windows vs. genuine credit seeking)
- Per-program criteria beyond score floor and clean-month count

## Handling consumer data

`fixtures/` is gitignored. **Never commit a real credit report** — git history is
permanent and survives any later change in repository visibility. Tests run on
synthetic tradelines built in `test_analyzer.py` for exactly this reason.

Anything built on top of this needs encryption at rest, access logging, MFA, and
a working purge path, per the FTC Safeguards Rule. Design the delete path early;
retrofitting it is miserable.
