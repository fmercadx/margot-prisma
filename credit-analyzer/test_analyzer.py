"""Tests for the canonical model and rules engine.

Deliberately built on synthetic tradelines rather than real report fixtures, so
the suite runs anywhere without consumer data in the repository.

    python -m pytest test_analyzer.py -q
"""

from datetime import date

import pytest

from canonical import (
    BureauReport,
    CreditFile,
    ProgramCriteria,
    Tradeline,
    acct_digits,
    norm_creditor,
    parse_date,
    parse_money,
)
import rules


def card(bureau, creditor, *, acct="", opened=date(2026, 4, 23), balance=None,
         limit=None, past_due=None, payment=None, grid=None, is_open=True,
         status="", comments=None, high=None, original=None, atype="Credit card"):
    return Tradeline(
        bureau=bureau, creditor=creditor, account_number=acct, date_opened=opened,
        is_open=is_open, account_type=atype, status_text=status, balance=balance,
        credit_limit=limit, past_due=past_due, monthly_payment=payment,
        high_balance=high, original_balance=original,
        comments=comments or [], grid=grid or {},
    )


def build(*tradelines, scores=None):
    cf = CreditFile()
    for t in tradelines:
        rep = cf.reports.setdefault(t.bureau, BureauReport(bureau=t.bureau))
        rep.tradelines.append(t)
    for b, s in (scores or {}).items():
        cf.reports.setdefault(b, BureauReport(bureau=b)).score = s
    cf.merge()
    return cf


def codes(findings):
    return [f.code for f in findings]


def only(findings, code):
    return [f for f in findings if f.code == code]


# --------------------------------------------------------------- primitives

@pytest.mark.parametrize("raw,expected", [
    ("$1,234", 1234), ("$0", 0), ("-", None), ("", None), (None, None),
    ("$27,963 written off", 27963),
])
def test_parse_money(raw, expected):
    assert parse_money(raw) == expected


def test_parse_date_formats():
    assert parse_date("Jan 12, 2026") == date(2026, 1, 12)
    assert parse_date("Jun 2026") == date(2026, 6, 1)
    assert parse_date("nonsense") is None


def test_acct_digits_ignores_mask_length():
    assert acct_digits("470793XXXXXX") == "470793"
    assert acct_digits("470793XXXXXXXXXX") == "470793"


def test_norm_creditor_collapses_variants():
    assert norm_creditor("MIDLAND CRED")[:8] == norm_creditor("MIDLAND CREDIT MANAGEM")[:8]


# ------------------------------------------------------------------- merge

def test_merge_joins_on_account_prefix_despite_mask_length():
    cf = build(
        card("experian", "CREDIT ONE BANK NA", acct="470793XXXXXX"),
        card("equifax", "CREDIT ONE BANK", acct="470793XXXXXXXXXX"),
        card("transunion", "CREDITONEBNK", acct="470793XXXXXX"),
    )
    assert len(cf.accounts) == 1
    assert sorted(cf.accounts[0].by_bureau) == ["equifax", "experian", "transunion"]


def test_merge_reconciles_name_variants_via_open_date_and_high_balance():
    """'UPWARDLI' and 'UPWARD FINANCIAL INC' with unrelated masked numbers."""
    cf = build(
        card("experian", "UPWARDLI", acct="AAA111", opened=date(2025, 12, 18), high=19),
        card("equifax", "UPWARD FINANCIAL INC", acct="ZZZ999",
             opened=date(2025, 12, 18), high=19),
    )
    assert len(cf.accounts) == 1


def test_merge_refuses_to_collapse_same_day_different_accounts():
    """Two unrelated accounts opened the same day must stay separate."""
    cf = build(
        card("experian", "SELF/ATLANTIC CAPITAL", acct="AAA", opened=date(2020, 5, 24)),
        card("equifax", "FINGERHUT/WEBBANK", acct="BBB", opened=date(2020, 5, 24)),
    )
    assert len(cf.accounts) == 2


def test_merge_never_merges_groups_claiming_the_same_bureau():
    cf = build(
        card("experian", "ACME ONE", acct="AAA", opened=date(2021, 1, 1), high=500),
        card("experian", "ACME TWO", acct="BBB", opened=date(2021, 1, 1), high=500),
    )
    assert len(cf.accounts) == 2


# ------------------------------------------------------------- middle score

def test_middle_score_picks_the_median_not_the_best():
    cf = build(scores={"experian": 581, "transunion": 576, "equifax": 525})
    assert cf.middle_score() == ("transunion", 576)


def test_two_scores_uses_the_lower():
    cf = build(scores={"experian": 640, "equifax": 600})
    assert cf.middle_score() == ("equifax", 600)


def test_middle_score_rule_flags_wasted_effort():
    cf = build(scores={"experian": 581, "transunion": 576, "equifax": 525})
    f = only(rules.run(cf, ProgramCriteria(min_middle_score=620)), "MIDDLE_SCORE")[0]
    joined = " ".join(f.evidence)
    assert "Experian does not affect qualification" in joined
    assert "Equifax does nothing until it passes 576" in joined


# ---------------------------------------------------------------- findings

def test_limit_gap_is_critical_when_it_hits_the_qualifying_bureau():
    cf = build(
        card("experian", "UPWARDLI", acct="AAA", limit=2000, balance=0),
        card("equifax", "UPWARDLI", acct="AAA", limit=2000, balance=0),
        scores={"experian": 581, "transunion": 576, "equifax": 525},
    )
    f = only(rules.run(cf), "LIMIT_GAP")
    assert f and f[0].severity == rules.CRITICAL
    assert "Transunion" in f[0].title


def test_limit_gap_ignores_closed_and_charged_off_accounts():
    cf = build(
        card("experian", "LES SCHWAB", acct="AAA", limit=500, balance=613,
             is_open=False, status="Collection account. $613 past due"),
        card("equifax", "LES SCHWAB", acct="AAA", limit=None, balance=613, is_open=False),
    )
    assert not only(rules.run(cf), "LIMIT_GAP")


def test_active_delinquency_is_critical():
    cf = build(card("experian", "CREDIT ONE", acct="AAA", balance=837,
                    limit=800, past_due=70))
    f = only(rules.run(cf), "ACTIVE_LATE")
    assert f and f[0].severity == rules.CRITICAL


def test_over_limit_flags_reg_z_angle_on_young_accounts():
    cf = build(card("experian", "CREDIT ONE", acct="AAA", balance=837, limit=800,
                    opened=date.today().replace(year=date.today().year)))
    f = only(rules.run(cf), "OVER_LIMIT")
    assert f and "1026.56" in f[0].detail


def test_late_asymmetry_warns_against_bureau_disputes():
    cf = build(
        card("experian", "CREDIT ONE", acct="AAA", grid={"2026-08": "30"}),
        card("equifax", "CREDIT ONE", acct="AAA", grid={}),
        card("transunion", "CREDIT ONE", acct="AAA", grid={}),
    )
    f = only(rules.run(cf), "LATE_ASYMMETRY")
    assert f
    assert "Do NOT dispute" in f[0].detail


def test_charge_off_exceeding_original_balance_is_flagged():
    cf = build(
        card("experian", "GM FINANCIAL", acct="AAA", balance=13963, original=None,
             status="Account charged off. $27,963 written off."),
        card("transunion", "GM FINANCIAL", acct="AAA", balance=13963, original=25349),
    )
    f = only(rules.run(cf), "CHARGEOFF_MATH")
    assert f and f[0].dollars == 27963 - 25349


def test_dti_efficiency_ranks_by_balance_to_payment_not_balance():
    cf = build(
        card("experian", "AUTO LOAN", acct="AAA", balance=23311, payment=680,
             atype="Auto Loan"),
        card("experian", "KOALAFI", acct="BBB", balance=861, payment=164,
             atype="Installment"),
    )
    f = only(rules.run(cf), "DTI_EFFICIENCY")
    assert f[0].title.startswith("KOALAFI")  # smallest balance, worst ratio


# ------------------------------------------------------------- eligibility

def test_eligibility_collapses_repeated_charge_off_months():
    """A charge-off restating monthly must not push the date forward forever."""
    grid = {f"2025-{m:02d}": "CO" for m in range(1, 13)}
    grid["2024-11"] = "30"
    cf = build(card("experian", "GM FINANCIAL", acct="AAA", grid=grid, is_open=False))
    f = only(rules.run(cf), "ELIGIBILITY")[0]
    assert "November 2024" in f.detail


def test_eligibility_fencepost_counts_from_the_first_clean_month():
    cf = build(card("experian", "CREDIT ONE", acct="AAA", grid={"2026-08": "30"}))
    f = only(rules.run(cf, ProgramCriteria(clean_months_required=12)), "ELIGIBILITY")[0]
    # Late in Aug 2026 -> clean window Sep 2026..Aug 2027 -> eligible Sep 2027.
    assert "September 2027" in f.title


def test_clean_file_reports_requirement_already_met():
    cf = build(card("experian", "GOOD CARD", acct="AAA", balance=10, limit=1000))
    f = only(rules.run(cf), "ELIGIBILITY")[0]
    assert f.severity == rules.INFO


# ------------------------------------------------------------------ engine

def test_a_broken_rule_does_not_kill_the_run(monkeypatch):
    def exploding(cf, prog):
        raise RuntimeError("boom")

    monkeypatch.setattr(rules, "RULES", rules.RULES + [exploding])
    out = rules.run(build(card("experian", "X", acct="AAA")))
    assert "RULE_ERROR" in codes(out)


def test_no_rule_errors_on_a_representative_file():
    """Guard against silent rule crashes.

    `run()` catches exceptions so one broken rule can't kill an analysis — which
    means a bug becomes an invisible missing finding instead of a traceback.
    This asserts a fully-populated file produces no RULE_ERROR at all.
    """
    cf = build(
        card("experian", "CREDIT ONE", acct="AAA", balance=837, limit=800,
             past_due=70, payment=42, grid={"2026-08": "30"}),
        card("equifax", "CREDIT ONE", acct="AAA", balance=837, limit=800, past_due=70),
        card("transunion", "CREDIT ONE", acct="AAA", balance=837, past_due=70),
        card("experian", "GM FINANCIAL", acct="BBB", balance=13963, is_open=False,
             opened=date(2023, 10, 10), original=25349, atype="Auto Loan",
             status="Account charged off. $27,963 written off.",
             grid={"2025-09": "CO"}, comments=["Account information disputed by consumer"]),
        card("experian", "LVNV FUNDING", acct="CCC", balance=970, is_open=False,
             atype="Collection", status="Collection account. $970 past due"),
        scores={"experian": 581, "transunion": 576, "equifax": 525},
    )
    errors = only(rules.run(cf), "RULE_ERROR")
    assert not errors, [f.detail for f in errors]


def test_findings_sort_critical_first():
    cf = build(
        card("experian", "CREDIT ONE", acct="AAA", balance=837, limit=800, past_due=70),
        scores={"experian": 581, "transunion": 576, "equifax": 525},
    )
    sev = [f.severity for f in rules.run(cf)]
    assert sev == sorted(sev, key=lambda s: rules._ORDER[s])
