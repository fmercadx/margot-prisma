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


# ---------------------------------------------------------------- MISMO XML

import parse_mismo
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_mismo.xml"


def test_payment_pattern_reads_most_recent_first():
    grid = parse_mismo.decode_payment_pattern("1CCC", date(2026, 8, 1))
    assert grid["2026-08"] == "30"
    assert grid["2026-07"] == "OK"
    assert grid["2026-05"] == "OK"
    assert "2026-04" not in grid


def test_payment_pattern_maps_derogatory_codes():
    grid = parse_mismo.decode_payment_pattern("98321", date(2026, 5, 1))
    assert grid["2026-05"] == "CO"   # 9
    assert grid["2026-04"] == "R"    # 8
    assert grid["2026-03"] == "90"   # 3
    assert grid["2026-02"] == "60"   # 2
    assert grid["2026-01"] == "30"   # 1


def test_payment_pattern_skips_no_data_characters():
    grid = parse_mismo.decode_payment_pattern("C-X0C", date(2026, 8, 1))
    assert set(grid) == {"2026-08", "2026-04"}


def test_payment_pattern_without_start_date_is_empty():
    assert parse_mismo.decode_payment_pattern("CCC", None) == {}


def test_namespaced_mismo_parses():
    import tempfile
    from xml.etree import ElementTree as ET
    xml = """<?xml version="1.0"?>
    <RESPONSE_GROUP xmlns="http://www.mismo.org/residential/2009/schemas">
      <CREDIT_RESPONSE>
        <CREDIT_SCORE _Value="600" CreditRepositorySourceType="Equifax"/>
        <CREDIT_LIABILITY _AccountIdentifier="123456XXXX" _AccountOpenedDate="2024-01-01"
                          _AccountStatusType="Open" _AccountType="Revolving"
                          _UnpaidBalanceAmount="100" _CreditLimitAmount="1000">
          <_CREDITOR _Name="TEST BANK"/>
          <CREDIT_REPOSITORY _SourceType="Equifax"/>
        </CREDIT_LIABILITY>
      </CREDIT_RESPONSE>
    </RESPONSE_GROUP>"""
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as fh:
        fh.write(xml)
        path = fh.name
    cf = parse_mismo.load_file(path)
    assert cf.scores == {"equifax": 600}
    assert cf.accounts[0].creditor == "TEST BANK"


def test_repositories_from_indicator_attributes():
    import tempfile
    xml = """<?xml version="1.0"?>
    <RESPONSE_GROUP><CREDIT_RESPONSE>
      <CREDIT_LIABILITY _AccountIdentifier="999999XXXX" _AccountOpenedDate="2024-01-01"
                        _AccountStatusType="Open" _AccountType="Revolving"
                        _EquifaxIndicator="Y" _ExperianIndicator="Y"
                        _TransUnionIndicator="N">
        <_CREDITOR _Name="LEGACY FORMAT"/>
      </CREDIT_LIABILITY>
    </CREDIT_RESPONSE></RESPONSE_GROUP>"""
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as fh:
        fh.write(xml)
        path = fh.name
    cf = parse_mismo.load_file(path)
    assert sorted(cf.accounts[0].by_bureau) == ["equifax", "experian"]


def test_line_of_credit_camelcase_counts_as_revolving():
    """MISMO writes 'LineOfCredit'; PDFs write 'Line of Credit'."""
    assert card("experian", "X", atype="LineOfCredit").is_revolving
    assert card("experian", "X", atype="Line of Credit").is_revolving
    assert card("experian", "X", atype="LINE_OF_CREDIT").is_revolving
    assert not card("experian", "X", atype="Installment").is_revolving


def test_mismo_per_repository_override_produces_a_limit_gap():
    cf = parse_mismo.load_file(FIXTURE)
    gaps = only(rules.run(cf), "LIMIT_GAP")
    assert gaps, "per-repository CreditLimitAmount override should surface a gap"
    assert "Transunion" in gaps[0].title
    assert gaps[0].severity == rules.CRITICAL  # TransUnion holds the middle score


def test_mismo_fixture_end_to_end():
    cf = parse_mismo.load_file(FIXTURE)
    assert cf.scores == {"experian": 581, "transunion": 576, "equifax": 525}
    assert cf.middle_score() == ("transunion", 576)
    assert not cf.merged_source
    found = codes(rules.run(cf))
    for expected in ("ACTIVE_LATE", "ELIGIBILITY", "LIMIT_GAP", "OVER_LIMIT",
                     "DTI_EFFICIENCY", "COLLECTIONS"):
        assert expected in found, f"{expected} missing from {found}"
    assert "RULE_ERROR" not in found


def test_mismo_grids_are_always_confident():
    """Structured patterns need no alignment guessing."""
    cf = parse_mismo.load_file(FIXTURE)
    assert all(t.grid_confident for t in cf.all_lines())


def test_collection_detected_from_original_creditor():
    cf = parse_mismo.load_file(FIXTURE)
    midland = next(a for a in cf.accounts if "MIDLAND" in a.creditor.upper())
    assert midland.any_line.is_collection
    assert midland.any_line.original_creditor == "COMENITY CAPITAL BANK"


def test_merged_source_is_flagged_when_no_per_bureau_variance():
    import tempfile
    xml = """<?xml version="1.0"?>
    <RESPONSE_GROUP><CREDIT_RESPONSE>
      <CREDIT_SCORE _Value="600" CreditRepositorySourceType="Equifax"/>
      <CREDIT_SCORE _Value="610" CreditRepositorySourceType="Experian"/>
      <CREDIT_LIABILITY _AccountIdentifier="123456XXXX" _AccountOpenedDate="2024-01-01"
                        _AccountStatusType="Open" _AccountType="Revolving"
                        _UnpaidBalanceAmount="100" _CreditLimitAmount="1000">
        <_CREDITOR _Name="SAME EVERYWHERE"/>
        <CREDIT_REPOSITORY _SourceType="Equifax"/>
        <CREDIT_REPOSITORY _SourceType="Experian"/>
      </CREDIT_LIABILITY>
    </CREDIT_RESPONSE></RESPONSE_GROUP>"""
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as fh:
        fh.write(xml)
        path = fh.name
    cf = parse_mismo.load_file(path)
    assert cf.merged_source
    warn = only(rules.run(cf), "MERGED_SOURCE")
    assert warn and "cannot be detected" in warn[0].detail


# ------------------------------------------------------- report generation

import report as report_mod


def _demo_file():
    return build(
        card("experian", "CREDIT ONE", acct="AAA", balance=837, limit=800,
             past_due=70, payment=42, grid={"2026-08": "30"}),
        card("equifax", "CREDIT ONE", acct="AAA", balance=837, limit=800, past_due=70),
        card("transunion", "CREDIT ONE", acct="AAA", balance=837, past_due=70),
        card("experian", "UPWARDLI", acct="BBB", balance=0, limit=2000,
             atype="LineOfCredit"),
        card("equifax", "UPWARDLI", acct="BBB", balance=0, limit=2000,
             atype="LineOfCredit"),
        card("transunion", "UPWARDLI", acct="BBB", balance=0, limit=None,
             atype="LineOfCredit"),
        card("transunion", "KOALAFI", acct="CCC", balance=861, payment=164,
             atype="Installment"),
        scores={"experian": 581, "transunion": 576, "equifax": 525},
    )


def _render(cf=None, prog=None):
    cf = cf or _demo_file()
    prog = prog or ProgramCriteria(min_middle_score=620, clean_months_required=12)
    return report_mod.render(cf, rules.run(cf, prog), prog)


def test_report_renders_all_ten_sections():
    out = _render()
    for n in range(1, 11):
        assert f">{n} — " in out, f"section {n} missing"


def test_report_marks_unfilled_judgment_slots():
    """An unedited draft must be obviously a draft."""
    out = _render()
    assert "[ANALYST]" in out
    assert out.count("[ANALYST]") >= 5
    assert "DRAFT — NOT FOR RELEASE" in out


def test_report_verdict_carries_the_eligibility_date():
    out = _render()
    assert "Eligible September 2027" in out


def test_report_flags_the_middle_score_row():
    out = _render()
    assert "Middle — qualifying" in out
    assert "Improving it does not affect qualification" in out


def test_action_list_puts_active_delinquency_first_then_free_actions():
    cf = _demo_file()
    actions = report_mod.build_actions(cf, rules.run(cf), ProgramCriteria())
    assert actions[0].cost == 70
    assert "current" in actions[0].text
    free = [i for i, a in enumerate(actions) if a.cost == 0]
    paid = [i for i, a in enumerate(actions) if a.cost and a.cost > 70]
    assert not paid or min(free) < min(paid), "free corrections must precede paid ones"


def test_do_not_list_always_carries_the_standing_rules():
    cf = _demo_file()
    items = " ".join(report_mod.build_do_not(cf, rules.run(cf)))
    assert "Do not close any account" in items
    assert "Do not open new credit" in items


def test_do_not_list_warns_against_disputing_asymmetric_marks():
    cf = _demo_file()
    items = " ".join(report_mod.build_do_not(cf, rules.run(cf)))
    assert "Do not dispute CREDIT ONE" in items


def test_report_escapes_creditor_names():
    """Creditor strings come from an external file and must never render as markup."""
    cf = build(card("experian", '<img src=x onerror=alert(1)>', acct="AAA",
                    balance=100, limit=50))
    out = report_mod.render(cf, rules.run(cf), ProgramCriteria())
    assert "<img src=x" not in out
    assert "&lt;img src=x" in out


def test_report_surfaces_the_merged_source_warning():
    cf = _demo_file()
    cf.merged_source = True
    out = report_mod.render(cf, rules.run(cf), ProgramCriteria())
    assert "property of the input" in out


def test_dti_rows_sort_by_ratio_ascending():
    cf = _demo_file()
    rows = report_mod.dti_rows(cf)
    ratios = [t.balance_to_payment for _, t in rows]
    assert ratios == sorted(ratios)
    assert rows[0][0] == "KOALAFI"


def test_report_is_self_contained():
    out = _render()
    assert "<style>" in out
    for external in ("http://", "https://", "<script"):
        assert external not in out


def test_report_never_contains_a_full_account_number():
    cf = _demo_file()
    out = report_mod.render(cf, rules.run(cf), ProgramCriteria())
    import re as _re
    assert not _re.search(r"\b\d{9,}\b", out)


def test_findings_sort_critical_first():
    cf = build(
        card("experian", "CREDIT ONE", acct="AAA", balance=837, limit=800, past_due=70),
        scores={"experian": 581, "transunion": 576, "equifax": 525},
    )
    sev = [f.severity for f in rules.run(cf)]
    assert sev == sorted(sev, key=lambda s: rules._ORDER[s])
