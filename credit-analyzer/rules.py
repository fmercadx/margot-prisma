"""Deterministic findings engine.

Every rule here is mechanical: it reads the canonical model and emits findings
with the evidence attached. Nothing in this module decides what to tell a
borrower — it surfaces candidates for a human to judge, which is both the
quality bar and the liability boundary.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Optional

from canonical import (
    BUREAUS,
    CreditFile,
    MARKER_CODES,
    ProgramCriteria,
    Tradeline,
)

CRITICAL, HIGH, MEDIUM, INFO = "critical", "high", "medium", "info"
_ORDER = {CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3}


@dataclass
class Finding:
    code: str
    severity: str
    title: str
    detail: str
    evidence: list[str] = field(default_factory=list)
    bureau: Optional[str] = None
    dollars: Optional[int] = None
    confident: bool = True


RULES: list[Callable[[CreditFile, ProgramCriteria], list[Finding]]] = []


def rule(fn):
    RULES.append(fn)
    return fn


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    return date(d.year + m // 12, m % 12 + 1, 1)


def _money(n: Optional[int]) -> str:
    return f"${n:,}" if n is not None else "—"


def _new_delinquencies(t: Tradeline) -> list[tuple[str, str]]:
    """Delinquency *events*, not the months a bad status keeps repeating.

    A charged-off account reports 'CO' every month until it falls off. Those are
    the same event restated, not a fresh late each month — counting them would
    push every eligibility date forward forever. Collapse consecutive runs of
    the same code to the month the run began.
    """
    cells = t.late_cells()
    events: list[tuple[str, str]] = []
    prev_code: Optional[str] = None
    for cell, code in cells:
        if code != prev_code:
            events.append((cell, code))
        prev_code = code
    # A derogatory status that is still open-ended is not a new event either.
    return [(c, code) for c, code in events if code not in ("CO", "R", "FC", "CL")] or events


# --------------------------------------------------------------------------
# Score position
# --------------------------------------------------------------------------

@rule
def middle_score(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    mid = cf.middle_score()
    if not mid:
        return []
    bureau, score = mid
    others = {b: s for b, s in cf.scores.items() if b != bureau}
    gap = prog.min_middle_score - score
    detail = (
        f"Underwriting uses the middle score. Yours is {score} ({bureau.title()}). "
        f"Program floor is {prog.min_middle_score}."
    )
    if gap > 0:
        detail += f" Gap: {gap} points."
    else:
        detail += " Floor is already met."
    ev = [f"{b.title()}: {s}" for b, s in sorted(cf.scores.items(), key=lambda kv: -kv[1])]
    higher = [b for b, s in others.items() if s > score]
    lower = [b for b, s in others.items() if s < score]
    if higher:
        ev.append(f"Improving {', '.join(b.title() for b in higher)} does not affect qualification.")
    if lower:
        ev.append(
            f"Improving {', '.join(b.title() for b in lower)} does nothing until it passes {score}."
        )
    return [Finding(
        code="MIDDLE_SCORE",
        severity=HIGH if gap > 0 else INFO,
        title=f"Qualifying score is {score} — {bureau.title()}",
        detail=detail,
        evidence=ev,
        bureau=bureau,
    )]


# --------------------------------------------------------------------------
# Reporting gaps — the free-points rules
# --------------------------------------------------------------------------

@rule
def credit_limit_gaps(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """A limit reported to some bureaus but not others inflates utilization."""
    out: list[Finding] = []
    mid = cf.middle_score()
    mid_bureau = mid[0] if mid else None
    for acct in cf.accounts:
        # Only open revolving accounts matter here. A missing limit on a closed
        # or charged-off tradeline costs nothing, because closed accounts do not
        # contribute available credit.
        if not any(t.is_open for t in acct.by_bureau.values()):
            continue
        if any(t.is_collection or t.is_chargeoff for t in acct.by_bureau.values()):
            continue
        limits = {b: t.credit_limit for b, t in acct.by_bureau.items() if t.is_revolving}
        if not limits:
            continue
        known = {b: v for b, v in limits.items() if v}
        missing = [b for b, v in limits.items() if not v] + acct.missing_from
        if not known or not missing:
            continue
        value = max(known.values())
        sev = CRITICAL if mid_bureau in missing else HIGH
        out.append(Finding(
            code="LIMIT_GAP",
            severity=sev,
            title=f"{acct.creditor}: {_money(value)} limit missing from {', '.join(b.title() for b in missing)}",
            detail=(
                "This account's credit limit is reported to "
                f"{', '.join(b.title() for b in known)} but not to "
                f"{', '.join(b.title() for b in missing)}. The missing limit inflates "
                "utilization on those bureaus with no change to actual debt."
                + (" This is the qualifying bureau." if mid_bureau in missing else "")
            ),
            evidence=[f"{b.title()}: {_money(v)}" for b, v in limits.items()]
                     + [f"{b.title()}: account absent" for b in acct.missing_from],
            dollars=value,
        ))
    return out


@rule
def utilization_spread(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    utils = {b: r.utilization() for b, r in cf.reports.items() if r.utilization() is not None}
    if len(utils) < 2:
        return []
    hi_b, hi = max(utils.items(), key=lambda kv: kv[1])
    lo_b, lo = min(utils.items(), key=lambda kv: kv[1])
    if hi - lo < 0.10:
        return []
    return [Finding(
        code="UTIL_SPREAD",
        severity=HIGH,
        title=f"Utilization reads {hi:.0%} on {hi_b.title()} but {lo:.0%} on {lo_b.title()}",
        detail=(
            "Identical balances producing different utilization means a reporting "
            "gap, not a real difference. Usually a missing credit limit."
        ),
        evidence=[f"{b.title()}: {u:.0%}" for b, u in sorted(utils.items(), key=lambda kv: -kv[1])],
    )]


@rule
def over_limit(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    out: list[Finding] = []
    for acct in cf.accounts:
        line = next((t for t in acct.by_bureau.values() if t.is_over_limit), None)
        if not line:
            continue
        young = line.date_opened and (date.today() - line.date_opened).days < 400
        detail = (
            f"Balance {_money(line.balance)} exceeds the {_money(line.credit_limit)} limit "
            f"({line.utilization:.0%}). Scored as a penalty twice — for the ratio and "
            "for the over-limit condition."
        )
        if young:
            detail += (
                " Account is under a year old: check whether fees created the overage. "
                "Reg Z §1026.56 bars over-limit fees without affirmative opt-in, which "
                "would convert a goodwill request into a billing-error dispute."
            )
        out.append(Finding(
            code="OVER_LIMIT",
            severity=HIGH,
            title=f"{acct.creditor} is over limit at {line.utilization:.0%}",
            detail=detail,
            evidence=[f"{b.title()}: {_money(t.balance)} / {_money(t.credit_limit)}"
                      for b, t in acct.by_bureau.items() if t.credit_limit],
            dollars=(line.balance - line.credit_limit) if line.balance and line.credit_limit else None,
        ))
    return out


@rule
def presence_gaps(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """Accounts on some bureaus and not others — helps or hurts, always worth noting."""
    out: list[Finding] = []
    for acct in cf.accounts:
        if not acct.missing_from or len(acct.by_bureau) == 0:
            continue
        line = acct.any_line
        helps = line.is_collection or line.is_chargeoff
        out.append(Finding(
            code="PRESENCE_GAP",
            severity=INFO if helps else MEDIUM,
            title=f"{acct.creditor} absent from {', '.join(b.title() for b in acct.missing_from)}",
            detail=("Derogatory item not reported everywhere — works in the borrower's favor."
                    if helps else
                    "Account missing from at least one bureau; if it carries a limit or positive "
                    "history, that value is not being counted there."),
            evidence=[f"Reported to: {', '.join(b.title() for b in acct.by_bureau)}"],
            dollars=line.balance,
        ))
    return out


# --------------------------------------------------------------------------
# Delinquency
# --------------------------------------------------------------------------

@rule
def active_delinquency(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """Anything past due right now dominates every other finding."""
    out: list[Finding] = []
    for acct in cf.accounts:
        due = {b: t.past_due for b, t in acct.by_bureau.items() if t.past_due}
        if not due:
            continue
        line = acct.any_line
        if line.is_collection or line.is_chargeoff:
            continue
        amount = max(due.values())
        out.append(Finding(
            code="ACTIVE_LATE",
            severity=CRITICAL,
            title=f"{acct.creditor} is past due now — {_money(amount)}",
            detail=(
                "An open account currently past due restarts every clean-payment clock "
                "for as long as it stays delinquent, and rolls to a 60-day mark at the "
                "next reporting cycle. Curing this outranks every other action."
            ),
            evidence=[f"{b.title()}: {_money(v)} past due" for b, v in due.items()],
            dollars=amount,
        ))
    return out


@rule
def late_mark_asymmetry(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """Late marks on some bureaus but not others — changes the whole strategy."""
    out: list[Finding] = []
    for acct in cf.accounts:
        marks = {b: t.late_cells() for b, t in acct.by_bureau.items()}
        with_marks = {b: m for b, m in marks.items() if m}
        without = [b for b, m in marks.items() if not m]
        if not with_marks or not without:
            continue
        confident = all(acct.by_bureau[b].grid_confident for b in with_marks)
        ev = []
        for b, cells in with_marks.items():
            ev.append(f"{b.title()}: " + ", ".join(f"{d} ({c})" for d, c in cells))
        for b in without:
            ev.append(f"{b.title()}: no delinquency in payment grid")
        out.append(Finding(
            code="LATE_ASYMMETRY",
            severity=HIGH,
            title=f"{acct.creditor}: late marks on {', '.join(b.title() for b in with_marks)} only",
            detail=(
                "Delinquency appears on some bureaus and not others. Do NOT dispute this "
                "through the bureaus — a furnisher investigation reaches all reporting, and "
                "the likely outcome is the other bureaus adding the mark rather than this "
                "one removing it. Goodwill request direct to the creditor is the correct tool."
            ),
            evidence=ev,
            confident=confident,
        ))
    return out


@rule
def eligibility_date(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """The gating clock: most recent delinquency + required clean months."""
    latest: Optional[tuple[str, str, str]] = None  # (yyyy-mm, code, creditor)
    for acct in cf.accounts:
        for b, t in acct.by_bureau.items():
            for cell, code in _new_delinquencies(t):
                if latest is None or cell > latest[0]:
                    latest = (cell, code, acct.creditor)
    if latest is None:
        return [Finding(
            code="ELIGIBILITY",
            severity=INFO,
            title="No delinquency found — clean-payment requirement already met",
            detail=f"{prog.name} requires {prog.clean_months_required} clean months.",
        )]
    cell, code, creditor = latest
    year, month = (int(x) for x in cell.split("-"))
    late_month = date(year, month, 1)
    # Fencepost: the month of the late is not clean. The first clean month is the
    # one after it, and the requirement is satisfied once that many clean months
    # have each been *reported* — so eligibility opens the month after the last
    # required clean month, not on its anniversary.
    first_clean = _add_months(late_month, 1)
    eligible = _add_months(first_clean, prog.clean_months_required)
    return [Finding(
        code="ELIGIBILITY",
        severity=CRITICAL,
        title=f"Clean-payment requirement satisfied {eligible:%B %Y}",
        detail=(
            f"Most recent delinquency: {creditor}, {late_month:%B %Y} ({code}). "
            f"{prog.name} requires {prog.clean_months_required} consecutive clean months. "
            f"First clean month is {first_clean:%B %Y}, so the requirement is met once "
            f"{_add_months(eligible, -1):%B %Y} reports — eligibility opens {eligible:%B %Y}, "
            "and only if nothing goes late in between. Removing the controlling mark is the "
            "only thing that moves this date."
        ),
        evidence=[f"Controlling mark: {creditor} {cell} ({code})",
                  f"Clean window: {first_clean:%b %Y} – {_add_months(eligible, -1):%b %Y}"],
    )]


# --------------------------------------------------------------------------
# Contradictions — the winnable disputes
# --------------------------------------------------------------------------

@rule
def open_closed_contradiction(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    out: list[Finding] = []
    for acct in cf.accounts:
        states = {b: t.is_open for b, t in acct.by_bureau.items() if t.is_open is not None}
        if len(set(states.values())) > 1:
            out.append(Finding(
                code="OPEN_CLOSED",
                severity=MEDIUM,
                title=f"{acct.creditor}: open on one bureau, closed on another",
                detail=(
                    "An account cannot be simultaneously open and closed. A factual "
                    "contradiction needing no outside evidence — one of the most winnable "
                    "dispute categories, and an underwriter will ask about it."
                ),
                evidence=[f"{b.title()}: {'open' if v else 'closed'}" for b, v in states.items()],
            ))
    return out


@rule
def status_vs_grid(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """'Pays as agreed' on a tradeline whose grid shows 90/120-day marks."""
    out: list[Finding] = []
    ok_phrases = ("as agreed", "never late", "paid or paying")
    for acct in cf.accounts:
        for b, t in acct.by_bureau.items():
            status = t.status_text.lower()
            if not any(p in status for p in ok_phrases):
                continue
            severe = [c for _, c in t.late_cells() if c in ("90", "120", "150", "180") or c in ("CO", "R")]
            if not severe:
                continue
            out.append(Finding(
                code="STATUS_GRID_CONFLICT",
                severity=MEDIUM,
                title=f"{acct.creditor} ({b.title()}): status says current, grid shows {severe[0]}-day marks",
                detail=(
                    "The status field and the payment history contradict each other on the "
                    "same tradeline. Worth a targeted accuracy dispute and worth explaining "
                    "before an underwriter finds it."
                ),
                evidence=[f"Status: {t.status_text}",
                          "Grid: " + ", ".join(f"{d} ({c})" for d, c in t.late_cells()[:8])],
                bureau=b,
                confident=t.grid_confident,
            ))
    return out


@rule
def chargeoff_reconciliation(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """A written-off amount larger than the original balance does not reconcile."""
    out: list[Finding] = []
    import re as _re
    for acct in cf.accounts:
        originals = [t.original_balance for t in acct.by_bureau.values() if t.original_balance]
        if not originals:
            continue
        cap = max(originals)
        for b, t in acct.by_bureau.items():
            m = _re.search(r"\$([\d,]+)\s*(?:written off|charged off)", t.status_text, _re.I)
            if not m:
                continue
            written = int(m.group(1).replace(",", ""))
            if written <= cap:
                continue
            out.append(Finding(
                code="CHARGEOFF_MATH",
                severity=HIGH,
                title=f"{acct.creditor}: {_money(written)} written off exceeds {_money(cap)} original balance",
                detail=(
                    "A write-off larger than the original loan does not reconcile, especially "
                    "where collateral was sold — proceeds should reduce the deficiency. Dispute "
                    "the amounts, not ownership, and demand a written accounting."
                ),
                evidence=[f"{bb.title()}: original {_money(tt.original_balance)}, "
                          f"balance {_money(tt.balance)}" for bb, tt in acct.by_bureau.items()],
                bureau=b,
                dollars=written - cap,
            ))
    return out


@rule
def burned_dispute_angles(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    disputed = [a for a in cf.accounts
                if any(t.previously_disputed for t in a.by_bureau.values())]
    if not disputed:
        return []
    return [Finding(
        code="BURNED_DISPUTES",
        severity=MEDIUM,
        title=f"{len(disputed)} accounts already carry dispute flags",
        detail=(
            "These were disputed before and verified. Re-disputing on the same grounds "
            "will fail again and spends credibility needed for the winnable items."
        ),
        evidence=[a.creditor for a in disputed[:12]],
    )]


@rule
def systemic_pattern(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """Many tradelines failing in identical lockstep implies one external cause."""
    sigs: dict[str, list[str]] = defaultdict(list)
    for acct in cf.accounts:
        line = acct.any_line
        sig = line.grid_signature()
        if sig:
            sigs[sig].append(acct.creditor)
    out = []
    for sig, creditors in sigs.items():
        if len(creditors) < 4:
            continue
        months = sorted({c.split(":")[0] for c in sig.split(";")})
        out.append(Finding(
            code="SYSTEMIC_PATTERN",
            severity=MEDIUM,
            title=f"{len(creditors)} accounts share an identical delinquency pattern",
            detail=(
                "Accounts failing in perfect lockstep point to one external cause rather "
                "than many independent failures. Identify it — the cause drives both the "
                "dispute strategy and the letter of explanation, and may carry a remedy "
                "the individual tradelines do not."
            ),
            evidence=[f"Window: {months[0]} to {months[-1]}",
                      f"Accounts: {', '.join(sorted(set(creditors))[:6])}"],
        ))
    return out


# --------------------------------------------------------------------------
# Debt structure
# --------------------------------------------------------------------------

@rule
def dti_efficiency(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    """Small balances with large payments are the cheapest qualifying gains."""
    seen: dict[str, Tradeline] = {}
    for acct in cf.accounts:
        line = max(acct.by_bureau.values(), key=lambda t: (t.monthly_payment or 0))
        if line.monthly_payment and line.balance and line.is_open:
            seen[acct.creditor] = line
    ranked = sorted(
        (t for t in seen.values() if t.balance_to_payment),
        key=lambda t: t.balance_to_payment,
    )
    if not ranked:
        return []
    out = []
    for line in ranked[:3]:
        if line.balance_to_payment > 24:
            continue
        out.append(Finding(
            code="DTI_EFFICIENCY",
            severity=HIGH,
            title=(f"{line.creditor}: {_money(line.balance)} balance costs "
                   f"{_money(line.monthly_payment)}/mo"),
            detail=(
                f"Clears in {line.balance_to_payment:.1f} months. Retiring this removes "
                f"{_money(line.monthly_payment)} of monthly DTI for {_money(line.balance)} — "
                "among the cheapest qualifying gains available, and invisible when debts "
                "are sorted by balance."
            ),
            evidence=[f"Balance-to-payment ratio: {line.balance_to_payment:.1f}"],
            dollars=line.balance,
        ))
    return out


@rule
def collections_summary(cf: CreditFile, prog: ProgramCriteria) -> list[Finding]:
    accts = [a for a in cf.accounts if a.any_line.is_collection]
    if not accts:
        return []
    total = sum(max((t.balance or 0) for t in a.by_bureau.values()) for a in accts)
    per_bureau = Counter()
    for a in accts:
        for b in a.by_bureau:
            per_bureau[b] += 1
    ev = [f"{len(accts)} unique collections across all bureaus"]
    ev += [f"{b.title()}: {n} reported" for b, n in per_bureau.items()]
    detail = (
        "Verify each collector's reported date of first delinquency against the original "
        "account — the seven-year clock runs from the original delinquency, not from when "
        "the debt was purchased. Re-aged entries must be removed."
    )
    if not prog.collections_payoff_required:
        detail += (
            f" {prog.name} does not require these paid as a condition of approval, so they "
            "should not be the first call on limited funds."
        )
    return [Finding(
        code="COLLECTIONS",
        severity=MEDIUM,
        title=f"{len(accts)} collections totaling {_money(total)}",
        detail=detail,
        evidence=ev,
        dollars=total,
    )]


# --------------------------------------------------------------------------

def run(cf: CreditFile, prog: Optional[ProgramCriteria] = None) -> list[Finding]:
    prog = prog or ProgramCriteria()
    out: list[Finding] = []
    for fn in RULES:
        try:
            out.extend(fn(cf, prog))
        except Exception as exc:  # a broken rule must not kill the run
            out.append(Finding(
                code="RULE_ERROR",
                severity=INFO,
                title=f"Rule {fn.__name__} failed",
                detail=str(exc),
            ))
    out.sort(key=lambda f: (_ORDER.get(f.severity, 9), f.code))
    return out
