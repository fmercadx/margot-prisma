"""MISMO credit-report XML parser — the preferred input path.

Credit vendors (Xactus, MeridianLink/Credit Plus, Factual Data, CBCInnovis)
deliver MISMO v2.4 `CREDIT_RESPONSE` XML alongside the PDF they show the loan
officer. Everything the PDF parser reconstructs from lost glyphs arrives here as
a real field — in particular `_PAYMENT_PATTERN`, which encodes payment history
as one character per month with an explicit start date. No alignment guessing,
no confidence caveats.

One structural caveat this module surfaces rather than hides: some vendors emit
a *merged* view where a single CREDIT_LIABILITY carries one set of values plus a
list of the repositories that report it. In that shape the per-bureau variance
is already collapsed upstream, so discrepancy findings (missing credit limits,
late marks on one bureau only) cannot be derived. `CreditFile.merged_source` is
set so the caller can say so out loud instead of reporting a clean file.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Iterable, Optional
from xml.etree import ElementTree as ET

from canonical import (
    BureauReport,
    CreditFile,
    Inquiry,
    Tradeline,
    parse_date,
)

# Repository payment-pattern codes. One character per month.
_PATTERN_CODES = {
    "C": "OK", "*": "OK",
    "1": "30", "2": "60", "3": "90", "4": "120", "5": "150", "6": "180",
    "7": "CL",   # wage-earner plan / included in bankruptcy
    "8": "R",    # repossession
    "9": "CO",   # charge-off or collection
}
_NO_DATA = {"0", "-", "X", " ", "", "N"}

_BUREAU_ALIASES = {
    "experian": "experian", "xpn": "experian", "tuc": "transunion",
    "equifax": "equifax", "efx": "equifax", "eqfx": "equifax",
    "transunion": "transunion", "trans union": "transunion", "tu": "transunion",
}


def _strip_ns(root: ET.Element) -> ET.Element:
    """MISMO files ship with and without namespaces. Normalize to without."""
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
        for key in list(el.attrib):
            if "}" in key:
                el.attrib[key.split("}", 1)[1]] = el.attrib.pop(key)
    return root


def _norm_bureau(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    return _BUREAU_ALIASES.get(raw.strip().lower())


def _attr(el: ET.Element, *names: str) -> Optional[str]:
    """First matching attribute. Vendors differ on the leading underscore."""
    for name in names:
        for candidate in (name, f"_{name}", name.lstrip("_")):
            if candidate in el.attrib:
                val = el.attrib[candidate].strip()
                if val:
                    return val
    return None


def _money(el: ET.Element, *names: str) -> Optional[int]:
    raw = _attr(el, *names)
    if raw is None:
        return None
    m = re.search(r"-?[\d.]+", raw.replace(",", ""))
    if not m:
        return None
    try:
        return int(round(float(m.group())))
    except ValueError:
        return None


def _shift_months(d: date, back: int) -> date:
    total = (d.year * 12 + d.month - 1) - back
    return date(total // 12, total % 12 + 1, 1)


def decode_payment_pattern(data: str, start: Optional[date],
                           most_recent_first: bool = True) -> dict[str, str]:
    """Turn a payment-pattern string into {"YYYY-MM": code}.

    MISMO defines `_StartDate` as the month of the first character. The
    repositories conventionally write the string most-recent-first, so position
    *i* is *i* months before the start date.
    """
    if not data or start is None:
        return {}
    grid: dict[str, str] = {}
    for i, ch in enumerate(data.strip()):
        if ch in _NO_DATA:
            continue
        code = _PATTERN_CODES.get(ch.upper())
        if code is None:
            continue
        month = _shift_months(start, i) if most_recent_first else _shift_months(start, -i)
        grid[f"{month.year}-{month.month:02d}"] = code
    return grid


def _repositories(liab: ET.Element) -> list[str]:
    """Which bureaus report this tradeline."""
    found: list[str] = []
    for repo in liab.iter("CREDIT_REPOSITORY"):
        b = _norm_bureau(_attr(repo, "SourceType", "CreditRepositorySourceType"))
        if b and b not in found:
            found.append(b)
    if found:
        return found
    # Older files use indicator attributes on the liability itself.
    for attr, bureau in (("EquifaxIndicator", "equifax"),
                         ("ExperianIndicator", "experian"),
                         ("TransUnionIndicator", "transunion")):
        if (_attr(liab, attr) or "").upper().startswith("Y"):
            found.append(bureau)
    return found


def _status_text(liab: ET.Element) -> str:
    bits = []
    for tag in ("_CURRENT_RATING", "CURRENT_RATING",
                "_HIGHEST_ADVERSE_RATING", "HIGHEST_ADVERSE_RATING"):
        for el in liab.iter(tag):
            t = _attr(el, "Type", "Code")
            if t:
                bits.append(re.sub(r"(?<!^)(?=[A-Z])", " ", t))
            break
    direct = _attr(liab, "AccountStatusType", "AccountCurrentRatingType")
    if direct:
        bits.append(re.sub(r"(?<!^)(?=[A-Z])", " ", direct))
    seen, out = set(), []
    for b in bits:
        if b.lower() not in seen:
            seen.add(b.lower())
            out.append(b)
    return ". ".join(out)


def _comments(liab: ET.Element) -> list[str]:
    out = []
    for tag in ("CREDIT_COMMENT", "_CREDIT_COMMENT"):
        for el in liab.iter(tag):
            txt = _attr(el, "Text", "TypeOtherDescription", "Type") or (el.text or "").strip()
            if txt:
                out.append(txt)
    return out


def _creditor_name(liab: ET.Element) -> str:
    for tag in ("_CREDITOR", "CREDITOR"):
        for el in liab.iter(tag):
            name = _attr(el, "Name", "FullName")
            if name:
                return name
    return _attr(liab, "CreditorName", "SubscriberName") or "UNKNOWN"


def _liability_to_tradelines(liab: ET.Element) -> list[Tradeline]:
    bureaus = _repositories(liab)
    if not bureaus:
        return []

    opened = parse_date(_attr(liab, "AccountOpenedDate", "AccountOpenedDateTime") or "")
    status_type = (_attr(liab, "AccountStatusType") or "").lower()
    is_open = None
    if status_type:
        is_open = status_type.startswith("open") or status_type.startswith("current")

    pattern_grid: dict[str, str] = {}
    for tag in ("_PAYMENT_PATTERN", "PAYMENT_PATTERN"):
        for el in liab.iter(tag):
            pattern_grid = decode_payment_pattern(
                _attr(el, "Data", "PaymentPatternData") or "",
                parse_date(_attr(el, "StartDate", "PaymentPatternStartDate") or ""),
            )
            break
        if pattern_grid:
            break

    base = dict(
        creditor=_creditor_name(liab),
        account_number=_attr(liab, "AccountIdentifier", "AccountNumberIdentifier") or "",
        original_creditor=_attr(liab, "OriginalCreditorName",
                                "CreditLoanOriginalCreditorName"),
        date_opened=opened,
        is_open=is_open,
        account_type=_attr(liab, "AccountType", "CreditLoanType") or "",
        status_text=_status_text(liab),
        status_updated=parse_date(_attr(liab, "AccountStatusDate",
                                        "AccountReportedDate") or ""),
        balance=_money(liab, "UnpaidBalanceAmount", "CurrentBalanceAmount"),
        credit_limit=_money(liab, "CreditLimitAmount", "CreditLimitAmt"),
        original_balance=_money(liab, "OriginalBalanceAmount", "HighestAdverseRatingAmount"),
        high_balance=_money(liab, "HighBalanceAmount", "HighCreditAmount"),
        monthly_payment=_money(liab, "MonthlyPaymentAmount"),
        past_due=_money(liab, "PastDueAmount"),
        terms=_attr(liab, "TermsMonthsCount", "TermsDescription") or "",
        responsibility=_attr(liab, "AccountOwnershipType") or "",
        comments=_comments(liab),
    )

    out: list[Tradeline] = []
    for bureau in bureaus:
        fields = dict(base)
        # Per-repository overrides, where the vendor provides them. This is what
        # makes cross-bureau discrepancy detection possible at all.
        for repo in liab.iter("CREDIT_REPOSITORY"):
            if _norm_bureau(_attr(repo, "SourceType", "CreditRepositorySourceType")) != bureau:
                continue
            for key, names in (
                ("account_number", ("AccountIdentifier",)),
                ("credit_limit", ("CreditLimitAmount",)),
                ("balance", ("UnpaidBalanceAmount",)),
                ("past_due", ("PastDueAmount",)),
                ("high_balance", ("HighBalanceAmount",)),
            ):
                val = _money(repo, *names) if key != "account_number" else _attr(repo, *names)
                if val is not None:
                    fields[key] = val
            break
        out.append(Tradeline(bureau=bureau, grid=dict(pattern_grid),
                             grid_confident=True, **fields))
    return out


def _scores(root: ET.Element) -> dict[str, int]:
    out: dict[str, int] = {}
    for tag in ("CREDIT_SCORE", "_CREDIT_SCORE"):
        for el in root.iter(tag):
            bureau = _norm_bureau(
                _attr(el, "CreditRepositorySourceType", "SourceType", "RepositoryType"))
            raw = _attr(el, "Value", "ScoreValue", "CreditScoreValue")
            if not bureau or not raw:
                continue
            m = re.search(r"\d{3}", raw)
            if m:
                out[bureau] = int(m.group())
    return out


def _inquiries(root: ET.Element) -> list[Inquiry]:
    out: list[Inquiry] = []
    for tag in ("CREDIT_INQUIRY", "_CREDIT_INQUIRY"):
        for el in root.iter(tag):
            bureau = _norm_bureau(_attr(el, "CreditRepositorySourceType", "SourceType"))
            for repo in el.iter("CREDIT_REPOSITORY"):
                bureau = bureau or _norm_bureau(_attr(repo, "SourceType"))
            out.append(Inquiry(
                bureau=bureau or "unknown",
                subscriber=_attr(el, "Name", "CreditBusinessType", "InquiryName") or "",
                inquired_on=parse_date(_attr(el, "Date", "InquiryDate") or ""),
                business_type=_attr(el, "CreditBusinessType") or "",
            ))
    return out


def load_file(path: str | Path) -> CreditFile:
    """Parse one MISMO CREDIT_RESPONSE into a CreditFile."""
    root = _strip_ns(ET.parse(str(path)).getroot())

    pulled = parse_date(
        _attr(root, "CreditReportFirstIssuedDate") or "")
    for el in root.iter("CREDIT_RESPONSE"):
        pulled = pulled or parse_date(_attr(el, "CreditReportFirstIssuedDate") or "")
        break

    scores = _scores(root)
    cf = CreditFile()
    per_bureau_variance = False

    for tag in ("CREDIT_LIABILITY", "_CREDIT_LIABILITY"):
        for liab in root.iter(tag):
            lines = _liability_to_tradelines(liab)
            if len(lines) > 1:
                distinct = {(t.credit_limit, t.balance, t.past_due) for t in lines}
                if len(distinct) > 1:
                    per_bureau_variance = True
            for line in lines:
                report = cf.reports.setdefault(
                    line.bureau, BureauReport(bureau=line.bureau, pulled_on=pulled))
                report.tradelines.append(line)

    for bureau, score in scores.items():
        report = cf.reports.setdefault(
            bureau, BureauReport(bureau=bureau, pulled_on=pulled))
        report.score = score

    for inq in _inquiries(root):
        if inq.bureau in cf.reports:
            cf.reports[inq.bureau].inquiries.append(inq)

    cf.merged_source = len(cf.reports) > 1 and not per_bureau_variance
    cf.merge()
    return cf
