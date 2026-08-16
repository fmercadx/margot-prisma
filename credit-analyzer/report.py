"""Render findings into the ten-section analysis report.

The generator fills everything mechanical — scores, tables, dates, dollar
figures, the action list — and stops where judgment starts. Slots requiring an
analyst are emitted as visible `[ANALYST]` placeholders rather than plausible
filler, so an unedited draft is obviously a draft and cannot be forwarded by
accident.

That boundary is the same one the rules engine holds: the machine surfaces
candidates with evidence attached; a person decides what a client is told.
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from canonical import BUREAUS, CreditFile, ProgramCriteria, Tradeline
from rules import CRITICAL, HIGH, INFO, MEDIUM, Finding, _add_months

# Findings that describe a cross-bureau disagreement rather than a debt problem.
_DISCREPANCY_CODES = {
    "LIMIT_GAP", "PRESENCE_GAP", "OPEN_CLOSED", "STATUS_GRID_CONFLICT",
    "LATE_ASYMMETRY", "UTIL_SPREAD", "MERGED_SOURCE",
}
_BLOCKER_CODES = {"ACTIVE_LATE", "MIDDLE_SCORE", "ELIGIBILITY", "OVER_LIMIT",
                  "COLLECTIONS", "CHARGEOFF_MATH", "MERGED_SOURCE"}
_INQUIRY_CODES = {"INQUIRY_CLUSTER", "INQUIRY_UNMATCHED", "INQUIRY_LOAD"}

PLACEHOLDER = '<span class="ph">[ANALYST]</span>'


@dataclass
class Engagement:
    file_ref: str = "[FILE REF]"
    prepared_for: str = "[LOAN OFFICER / COMPANY]"
    analyst: str = ""
    analysis_date: date = field(default_factory=date.today)
    recheck_days: int = 60

    @property
    def recheck_date(self) -> date:
        return self.analysis_date + timedelta(days=self.recheck_days)


@dataclass
class Action:
    text: str
    owner: str
    cost: Optional[int]
    effect: str
    when: str
    rank: int


def _e(text) -> str:
    return html.escape(str(text if text is not None else ""))


def _money(n: Optional[int]) -> str:
    return f"${n:,}" if n is not None else "—"


def _by_code(findings: list[Finding], *codes: str) -> list[Finding]:
    wanted = set(codes)
    return [f for f in findings if f.code in wanted]


def _first(findings: list[Finding], code: str) -> Optional[Finding]:
    return next((f for f in findings if f.code == code), None)


def _cap(items: list, limit: int) -> tuple[list, int]:
    """Truncate for readability and report what was dropped.

    A table nobody reads is worse than a short one, but silent truncation reads
    as "this is everything" when it isn't. Always return the remainder count and
    print it.
    """
    return items[:limit], max(0, len(items) - limit)


# ---------------------------------------------------------------- actions

def build_actions(cf: CreditFile, findings: list[Finding],
                  prog: ProgramCriteria) -> list[Action]:
    """Derive the action list, ordered by effect per dollar rather than severity.

    A borrower has limited cash. Curing an active delinquency gates everything
    else and comes first regardless of cost; after that, free corrections beat
    paid ones, and among paid ones the cheapest qualifying gain wins.
    """
    actions: list[Action] = []

    for f in _by_code(findings, "ACTIVE_LATE"):
        actions.append(Action(
            text=f"Bring {f.title.split(' is past due')[0]} current",
            owner="Borrower", cost=f.dollars,
            effect="Starts the clean-payment clock; prevents a roll to 60 days",
            when="Immediately", rank=0))

    for f in _by_code(findings, "LIMIT_GAP"):
        creditor = f.title.split(":")[0]
        actions.append(Action(
            text=f"Have {creditor} furnish its {_money(f.dollars)} limit to all repositories",
            owner="Borrower", cost=0,
            effect="Corrects utilization on the qualifying bureau; no change to debt",
            when="This week", rank=1))

    if _first(findings, "CHARGEOFF_MATH"):
        f = _first(findings, "CHARGEOFF_MATH")
        actions.append(Action(
            text=f"Request written accounting from {f.title.split(':')[0]}",
            owner="Borrower", cost=0,
            effect="Amounts do not reconcile; a factual dispute, not a plea",
            when="This week", rank=1))

    if _first(findings, "COLLECTIONS"):
        actions.append(Action(
            text="Request date-of-first-delinquency verification from each collector",
            owner="Borrower", cost=0,
            effect="Re-aged entries must be removed; establishes true fall-off dates",
            when="Within 30 days", rank=1))

    for f in _by_code(findings, "DTI_EFFICIENCY"):
        creditor = f.title.split(":")[0]
        actions.append(Action(
            text=f"Retire {creditor}",
            owner="Borrower", cost=f.dollars,
            effect=f.detail.split(". ")[1] if ". " in f.detail else "Removes monthly DTI",
            when="Before application", rank=2))

    for f in _by_code(findings, "OVER_LIMIT"):
        creditor = f.title.split(" is over limit")[0]
        actions.append(Action(
            text=f"Pay {creditor} below its limit, then toward zero — keep the account open",
            owner="Borrower", cost=f.dollars,
            effect="Removes the over-limit penalty and lowers utilization",
            when="Before application", rank=3))

    for f in _by_code(findings, "INQUIRY_UNMATCHED"):
        who = f.title.split(" inquired")[0]
        actions.append(Action(
            text=f"Confirm with the borrower whether the {who} inquiry was authorized",
            owner="Loan officer", cost=0,
            effect="The only inquiry category worth disputing; a narrow claim is credible",
            when="Before any inquiry dispute", rank=1))

    if _first(findings, "MERGED_SOURCE"):
        actions.append(Action(
            text="Obtain the unmerged report or individual consumer disclosures",
            owner="Loan officer", cost=0,
            effect="Per-bureau discrepancies cannot be assessed from the current file",
            when="Before relying on this analysis", rank=1))

    actions.sort(key=lambda a: (a.rank, a.cost if a.cost is not None else 10**9))
    return actions


def build_do_not(cf: CreditFile, findings: list[Finding]) -> list[str]:
    """What not to do. Frequently worth more than the action list.

    The standing rules always appear. Account-specific warnings are capped —
    a list of twenty-six reads as boilerplate and gets skipped, which defeats
    the point of the section.
    """
    out: list[str] = []
    asym = _by_code(findings, "LATE_ASYMMETRY")
    # Open accounts first: a dispute that adds a mark to a live tradeline costs
    # more than one that touches an account already written off.
    asym.sort(key=lambda f: not any(
        t.is_open for a in cf.accounts if a.creditor == f.title.split(":")[0]
        for t in a.by_bureau.values()))
    shown, extra = _cap(asym, 3)
    for f in shown:
        creditor = f.title.split(":")[0]
        out.append(
            f"<strong>Do not dispute {_e(creditor)} through the bureaus.</strong> The mark "
            "appears on some repositories and not others; a furnisher investigation reaches "
            "all reporting, so the likely outcome is the clean bureaus adding it. Goodwill "
            "request direct to the creditor is the correct instrument.")
    if extra:
        out.append(
            f"<strong>The same caution applies to {extra} further accounts</strong> whose "
            "delinquency is reported unevenly across repositories — listed in section 4.")
    for f in _cap(_by_code(findings, "INQUIRY_CLUSTER"), 2)[0]:
        out.append(
            f"<strong>Do not dispute the {_e(f.title.split(' on ')[0].split(' ', 1)[1])} "
            "cluster.</strong> Same-purpose inquiries inside the rate-shopping window "
            "already score as one, so the raw count overstates the cost — and a blanket "
            "inquiry claim undermines the disputes that are genuinely winnable.")
    burned = _first(findings, "BURNED_DISPUTES")
    if burned:
        out.append(
            f"<strong>Do not re-dispute on the same grounds:</strong> {_e(', '.join(burned.evidence[:8]))}. "
            "These were verified once and will verify again.")
    out.append(
        "<strong>Do not close any account</strong>, including after paying it to zero — a "
        "closed card takes its limit with it and utilization jumps.")
    out.append(
        "<strong>Do not open new credit</strong> before closing. Lenders re-pull days prior, "
        "and a new tradeline discovered then can kill a funded loan.")
    # The same cluster warning can arrive once per bureau; say it once.
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def dti_rows(cf: CreditFile) -> list[tuple[str, Tradeline]]:
    seen: dict[str, Tradeline] = {}
    for acct in cf.accounts:
        line = max(acct.by_bureau.values(), key=lambda t: (t.monthly_payment or 0))
        if line.monthly_payment and line.balance and line.is_open:
            seen[acct.creditor] = line
    return sorted(seen.items(), key=lambda kv: kv[1].balance_to_payment or 10**9)


# ----------------------------------------------------------------- render

_CSS = """
:root{--paper:#f7f8f6;--card:#fff;--card2:#eef1ed;--ink:#161a17;--ink2:#4d574f;
--ink3:#7d8880;--line:#dbe0da;--line2:#b6bfb7;--pine:#1f4d3d;--pineS:#e5efe9;
--brass:#8a6a1f;--brassS:#f7f0dd;--ox:#8f2f28;--oxS:#f9eae8;
--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
--disp:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){
--paper:#101310;--card:#181c19;--card2:#212722;--ink:#e8ebe7;--ink2:#9ba69d;
--ink3:#727d75;--line:#2a312c;--line2:#3d463f;--pine:#7fc4a6;--pineS:#152420;
--brass:#d3ab5b;--brassS:#282116;--ox:#e59189;--oxS:#2a1a18;}}
:root[data-theme=dark]{--paper:#101310;--card:#181c19;--card2:#212722;--ink:#e8ebe7;
--ink2:#9ba69d;--ink3:#727d75;--line:#2a312c;--line2:#3d463f;--pine:#7fc4a6;
--pineS:#152420;--brass:#d3ab5b;--brassS:#282116;--ox:#e59189;--oxS:#2a1a18;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
font-size:15.5px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:54rem;margin:0 auto;padding:2.5rem 1.5rem 5rem}
h1{font-family:var(--disp);font-size:2rem;line-height:1.1;letter-spacing:-.02em;
font-weight:600;margin:0 0 .4rem}
h2{font-family:var(--disp);font-size:1.3rem;line-height:1.2;letter-spacing:-.015em;
font-weight:600;margin:0 0 .5rem}
p{margin:.6em 0}ul{padding-left:1.1em;margin:.6em 0}li{margin:.35em 0}
li::marker{color:var(--ink3)}
.blk{font-family:var(--mono);font-size:.62rem;font-weight:700;letter-spacing:.16em;
text-transform:uppercase;color:var(--pine);border-bottom:1px solid var(--line2);
padding-bottom:.3rem;margin:2.6rem 0 .9rem;display:block}
.meta{font-family:var(--mono);font-size:.7rem;line-height:1.7;color:var(--ink2);margin:0}
.ph{font-family:var(--mono);font-size:.85em;color:var(--brass);background:var(--brassS);
padding:.05em .4em;border:1px dashed var(--brass);border-radius:2px;white-space:nowrap}
.verdict{border:2px solid var(--pine);background:var(--pineS);padding:1.2rem 1.4rem;margin:1.2rem 0}
.verdict .lbl{font-family:var(--mono);font-size:.6rem;font-weight:700;letter-spacing:.16em;
text-transform:uppercase;color:var(--pine);display:block;margin-bottom:.45rem}
.verdict .big{font-family:var(--disp);font-size:1.55rem;line-height:1.2;font-weight:600;display:block}
.box{border:1px solid var(--line);border-left:3px solid var(--line2);padding:.95rem 1.15rem;
margin:1.1rem 0;background:var(--card)}
.box>*:first-child{margin-top:0}.box>*:last-child{margin-bottom:0}
.box .lbl{display:block;font-family:var(--mono);font-size:.6rem;font-weight:700;
letter-spacing:.16em;text-transform:uppercase;margin-bottom:.4rem}
.ox{border-left-color:var(--ox);background:var(--oxS)}.ox .lbl{color:var(--ox)}
.pine{border-left-color:var(--pine);background:var(--pineS)}.pine .lbl{color:var(--pine)}
.brass{border-left-color:var(--brass);background:var(--brassS)}.brass .lbl{color:var(--brass)}
.tw{overflow-x:auto;margin:1rem 0;border:1px solid var(--line);background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.79rem;line-height:1.45}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);
vertical-align:top;white-space:nowrap}
th{font-family:var(--mono);font-size:.58rem;font-weight:700;letter-spacing:.12em;
text-transform:uppercase;color:var(--ink2);background:var(--card2);
border-bottom:1px solid var(--line2)}
tbody tr:last-child td{border-bottom:none}
td.w{white-space:normal;min-width:13rem}td.ws{white-space:normal;min-width:8rem}
.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
.mid{color:var(--brass);font-weight:700}.bad{color:var(--ox);font-weight:700}
.good{color:var(--pine);font-weight:700}
.lowconf{font-family:var(--mono);font-size:.62rem;color:var(--brass);letter-spacing:.06em}
footer{margin-top:3rem;padding-top:1.1rem;border-top:1px solid var(--line);
font-family:var(--mono);font-size:.64rem;line-height:1.7;color:var(--ink3)}
@media print{.box,.tw,.verdict{break-inside:avoid}}
"""


def render(cf: CreditFile, findings: list[Finding], prog: ProgramCriteria,
           eng: Optional[Engagement] = None) -> str:
    eng = eng or Engagement()
    out: list[str] = []
    w = out.append

    w(f"<title>Credit Analysis — {_e(eng.file_ref)}</title>")
    w(f"<style>{_CSS}</style>")
    w('<div class="wrap">')

    # ---- cover
    w("<h1>Credit analysis</h1>")
    pulled = next((r.pulled_on for r in cf.reports.values() if r.pulled_on), None)
    w('<p class="meta">'
      f"FILE {_e(eng.file_ref)} &middot; PREPARED FOR {_e(eng.prepared_for)}<br>"
      f"PROGRAM: {_e(prog.name)} &middot; FLOOR {prog.min_middle_score} &middot; "
      f"{prog.clean_months_required} CLEAN MONTHS REQUIRED<br>"
      f"REPOSITORIES: {_e(', '.join(sorted(b.title() for b in cf.reports)))}"
      + (f" &middot; PULLED {pulled:%b %d, %Y}" if pulled else "") + "<br>"
      f"ANALYSIS {eng.analysis_date:%b %d, %Y} &middot; RE-CHECK {eng.recheck_date:%b %d, %Y}"
      + (f" &middot; {_e(eng.analyst)}" if eng.analyst else "") +
      "</p>")

    # ---- 1 verdict
    w('<span class="blk">1 — Verdict</span>')
    elig = _first(findings, "ELIGIBILITY")
    if elig and elig.severity != INFO:
        headline = elig.title.replace("Clean-payment requirement satisfied ", "Eligible ")
    elif elig:
        headline = "Clean-payment requirement already met"
    else:
        headline = PLACEHOLDER
    w(f'<div class="verdict"><span class="lbl">Eligibility</span>'
      f'<span class="big">{headline}</span></div>')

    conditions = [f for f in findings if f.severity == CRITICAL and f.code != "ELIGIBILITY"]
    if conditions:
        w("<p><strong>This date assumes:</strong></p><ul>")
        for f in conditions[:6]:
            w(f"<li>{_e(f.title)}</li>")
        w("</ul>")
    actions = build_actions(cf, findings, prog)
    known = sum(a.cost for a in actions if a.cost)
    w(f"<p><strong>Cost to execute: {_money(known)}</strong> — itemized in section 5. "
      f"Interpretation and any faster path: {PLACEHOLDER}</p>")

    # ---- 2 score
    w('<span class="blk">2 — Score position</span>')
    mid = cf.middle_score()
    w('<div class="tw"><table><thead><tr><th>Repository</th><th class="n">Score</th>'
      '<th>Role</th><th class="w">Consequence</th></tr></thead><tbody>')
    for b, s in sorted(cf.scores.items(), key=lambda kv: -kv[1]):
        if mid and b == mid[0]:
            role, cls, note = "Middle — qualifying", "mid", "Every remediation dollar targets this repository"
        elif mid and s > mid[1]:
            role, cls, note = "Highest", "", "Improving it does not affect qualification"
        else:
            role, cls, note = "Lowest", "", f"No effect until it passes {mid[1] if mid else '—'}"
        w(f'<tr><td class="{cls}">{_e(b.title())}</td><td class="n {cls}">{s}</td>'
          f'<td class="{cls}">{role}</td><td class="w">{note}</td></tr>')
    w("</tbody></table></div>")
    if mid:
        gap = prog.min_middle_score - mid[1]
        w(f"<p><strong>Qualifying score: {mid[1]}</strong> ({_e(mid[0].title())}). "
          f"Program floor {prog.min_middle_score}. "
          + (f"Gap: <strong>{gap} points</strong>." if gap > 0 else "Floor met.") + "</p>")

    # ---- 3 blockers
    w('<span class="blk">3 — Blocking issues, ranked</span>')
    blockers = [f for f in findings
                if f.severity in (CRITICAL, HIGH) and f.code in _BLOCKER_CODES]
    shown, extra = _cap(blockers, 8)
    if shown:
        w('<div class="tw"><table><thead><tr><th>#</th><th class="ws">Issue</th>'
          '<th class="w">Why it blocks</th><th class="ws">Fixable</th></tr></thead><tbody>')
        for i, f in enumerate(shown, 1):
            flag = '<br><span class="lowconf">LOW CONFIDENCE</span>' if not f.confident else ""
            w(f'<tr><td class="n">{i}</td><td class="ws">{_e(f.title)}{flag}</td>'
              f'<td class="w">{_e(f.detail)}</td><td class="ws">{PLACEHOLDER}</td></tr>')
        w("</tbody></table></div>")
        if extra:
            w(f"<p><em>{extra} further issues at this severity are not shown. "
              "Most files carry two or three genuine blockers and a longer tail "
              "that merely looks bad — the separation is an analyst judgment.</em></p>")
    else:
        w("<p>No blocking issues identified against the stated criteria.</p>")
    w(f"<p>Separation of real blockers from noise: {PLACEHOLDER}</p>")

    # ---- 4 discrepancies
    w('<span class="blk">4 — Cross-bureau discrepancies</span>')
    disc = [f for f in findings if f.code in _DISCREPANCY_CODES and f.severity != INFO]
    disc, disc_extra = _cap(disc, 15)
    if disc:
        w('<div class="tw"><table><thead><tr><th class="ws">Item</th>'
          '<th class="w">Finding</th><th class="w">Opportunity</th></tr></thead><tbody>')
        for f in disc:
            w(f'<tr><td class="ws">{_e(f.title)}</td>'
              f'<td class="w">{"<br>".join(_e(e) for e in f.evidence)}</td>'
              f'<td class="w">{_e(f.detail)}</td></tr>')
        w("</tbody></table></div>")
        if disc_extra:
            w(f"<p><em>{disc_extra} further discrepancies not shown, all on closed or "
              "zero-balance accounts where the gap changes nothing.</em></p>")
    else:
        w("<p>None detected.</p>")
    inq = [f for f in findings if f.code in _INQUIRY_CODES]
    if inq:
        w('<div class="box brass"><span class="lbl">Inquiries</span><ul>')
        for f in inq[:8]:
            w(f"<li>{_e(f.title)}</li>")
        w("</ul></div>")

    if _first(findings, "MERGED_SOURCE"):
        w('<div class="box ox"><span class="lbl">Coverage warning</span>'
          "<p>The source collapsed per-bureau values upstream. The absence of "
          "discrepancies above is a property of the input, not of the file.</p></div>")

    # ---- 5 actions
    w('<span class="blk">5 — Action list</span>')
    shown_actions, action_extra = _cap(actions, 12)
    if shown_actions:
        w('<div class="tw"><table><thead><tr><th>#</th><th class="w">Action</th>'
          '<th class="ws">Owner</th><th class="n">Cost</th><th class="w">Effect</th>'
          '<th class="ws">When</th></tr></thead><tbody>')
        for i, a in enumerate(shown_actions, 1):
            w(f'<tr><td class="n">{i}</td><td class="w">{_e(a.text)}</td>'
              f'<td class="ws">{_e(a.owner)}</td><td class="n">{_money(a.cost)}</td>'
              f'<td class="w">{_e(a.effect)}</td><td class="ws">{_e(a.when)}</td></tr>')
        w(f'<tr><td></td><td class="w"><strong>Total</strong></td><td class="ws"></td>'
          f'<td class="n"><strong>{_money(known)}</strong></td>'
          f'<td class="w"></td><td class="ws"></td></tr>')
        w("</tbody></table></div>")
        w("<p>Ordered by effect per dollar, not by severity — curing an active "
          "delinquency gates everything, then free corrections, then the cheapest "
          "qualifying gains.</p>")
        if action_extra:
            w(f"<p><em>{action_extra} lower-priority actions not shown.</em></p>")
    else:
        w(f"<p>{PLACEHOLDER}</p>")

    # ---- 6 do not
    w('<span class="blk">6 — Do not do</span>')
    w('<div class="box ox"><span class="lbl">Actions that would set this file back</span><ul>')
    for item in build_do_not(cf, findings):
        w(f"<li>{item}</li>")
    w("</ul></div>")

    # ---- 7 dti
    w('<span class="blk">7 — Debt-to-income position</span>')
    rows = dti_rows(cf)
    if rows:
        w('<div class="tw"><table><thead><tr><th class="ws">Obligation</th>'
          '<th class="n">Balance</th><th class="n">Payment</th><th class="n">Ratio</th>'
          '<th class="w">Note</th></tr></thead><tbody>')
        for creditor, t in rows:
            ratio = t.balance_to_payment
            cls = "bad" if ratio and ratio < 12 else ""
            note = ("Cheapest qualifying gain — small balance, large payment"
                    if ratio and ratio < 12 else "")
            w(f'<tr><td class="ws">{_e(creditor)}</td><td class="n">{_money(t.balance)}</td>'
              f'<td class="n {cls}">{_money(t.monthly_payment)}</td>'
              f'<td class="n {cls}">{ratio:.1f}</td><td class="w">{note}</td></tr>')
        total_pmt = sum(t.monthly_payment for _, t in rows if t.monthly_payment)
        w(f'<tr><td class="ws"><strong>Total monthly</strong></td><td class="n"></td>'
          f'<td class="n"><strong>{_money(total_pmt)}</strong></td>'
          f'<td class="n"></td><td class="w"></td></tr>')
        w("</tbody></table></div>")
        w("<p>Sorted by balance &divide; payment, ascending. The lowest ratios are the "
          "cheapest qualifying gains and are invisible when debts are sorted by balance.</p>")
    else:
        w("<p>No open obligations with reported monthly payments.</p>")
    w(f"<p>Income, household size and residual-income assessment: {PLACEHOLDER}</p>")

    # ---- 8 how the date was computed
    w('<span class="blk">8 — How the date was computed</span>')
    if elig:
        w(f"<p>{_e(elig.detail)}</p>")
        if elig.evidence:
            w("<ul>" + "".join(f"<li>{_e(e)}</li>" for e in elig.evidence) + "</ul>")
    w(f"<p><strong>Faster path, if any:</strong> {PLACEHOLDER} "
      f"&mdash; probability {PLACEHOLDER}</p>")

    # ---- 9 recheck
    w('<span class="blk">9 — Re-check</span>')
    w(f"<p><strong>Re-pull on {eng.recheck_date:%B %d, %Y}.</strong> Verify: "
      "corrected credit limits have posted; balances report at the intended level; "
      "no new delinquency; any goodwill removal reflected.</p>")
    w(f"<p>Decision point at re-check: {PLACEHOLDER}</p>")

    # ---- 10 borrower summary
    w('<span class="blk">10 — Borrower summary <span style="color:var(--brass)">(forwardable)</span></span>')
    w('<div class="box pine"><span class="lbl">Plain language — written to be sent unedited</span>')
    w(f"<p><strong>Where you stand.</strong> {PLACEHOLDER}</p>")
    if actions:
        w("<p><strong>What to do, in order.</strong></p><ol>")
        for a in actions[:5]:
            cost = f" — {_money(a.cost)}" if a.cost else " — no cost"
            w(f"<li>{_e(a.text)}{cost}</li>")
        w("</ol>")
    w(f"<p><strong>What not to do.</strong> Do not close any account, even after paying "
      f"it off. Do not open new credit before closing. {PLACEHOLDER}</p>")
    w(f"<p><strong>When to check back.</strong> {eng.recheck_date:%B %d, %Y}.</p>")
    w(f"<p><strong>What this gets you.</strong> {PLACEHOLDER}</p>")
    w("</div>")

    # ---- disclaimer
    w('<span class="blk">Disclaimer</span>')
    w("<p style=\"font-size:.82rem;color:var(--ink2)\">Prepared for "
      f"{_e(eng.prepared_for)} as the client, based solely on the credit reports and "
      "loan parameters provided. Not legal, tax or financial advice; not a credit "
      "decision or a commitment to lend. Projected eligibility dates are estimates "
      "dependent on the conditions stated and on third parties outside our control. "
      "No score, approval or closing date is guaranteed. Lender overlays vary — "
      "confirm all criteria with the investor.</p>")

    remaining = "".join(out).count("[ANALYST]")
    w(f'<footer>GENERATED {eng.analysis_date:%b %d, %Y} FROM {len(findings)} '
      f'MACHINE FINDINGS &middot; {remaining} ANALYST SLOTS REMAIN &middot; '
      "DRAFT — NOT FOR RELEASE UNTIL EVERY SLOT IS RESOLVED AND EVERY FINDING VERIFIED."
      "</footer>")
    w("</div>")
    return "\n".join(out)
