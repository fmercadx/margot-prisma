"""Canonical model for a multi-bureau credit file.

Everything downstream — parsers, rules, report generation — speaks this schema.
Adding a new input format (MISMO XML, a different vendor's PDF) means writing a
parser that emits `BureauReport` objects and nothing else changes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable, Optional

BUREAUS = ("experian", "equifax", "transunion")

# Payment-grid cell codes. OK/ND are inferred, the rest are read from the report.
OK = "OK"          # current / terms met
ND = "ND"          # no data for this period
LATE_CODES = ("30", "60", "90", "120", "150", "180")
DEROG_CODES = ("CO", "R", "FC", "CL")  # charge-off, repossession, foreclosure, collection
MARKER_CODES = LATE_CODES + DEROG_CODES

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

_COLLECTION_HINTS = ("collection", "debt buyer", "placed for collection")
_CHARGEOFF_HINTS = ("charge", "charged off", "written off", "profit and loss")
_DISPUTE_HINTS = ("dispute", "consumer disagrees", "fcra")


def parse_money(raw: Optional[str]) -> Optional[int]:
    """'$1,234' -> 1234. '-', '', None -> None. Returns whole dollars."""
    if not raw:
        return None
    cleaned = raw.strip()
    if cleaned in ("-", "--", "N/A", ""):
        return None
    m = re.search(r"-?\$?\s*([\d,]+)", cleaned)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def parse_pct(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    m = re.search(r"(\d+)\s*%", raw)
    return int(m.group(1)) if m else None


def parse_date(raw: Optional[str]) -> Optional[date]:
    """Handles 'Jan 12, 2026', 'Jun 2026', '2026-01-12'."""
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %Y", "%B %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def norm_creditor(name: Optional[str]) -> str:
    """Collapse bureau-specific creditor spellings toward a comparable form.

    'CREDIT ONE BANK NA', 'CREDIT ONE BANK', 'CREDITONEBNK' -> 'creditone'
    Deliberately lossy: this is only a fallback join key when the account
    number is unusable.
    """
    if not name:
        return ""
    s = name.lower()
    s = re.sub(r"[^a-z]", "", s)
    for noise in ("bankusa", "banknа", "bankna", "bank", "inc", "llc", "na",
                  "corp", "company", "financial", "fncl", "fnl", "svc",
                  "services", "cu", "creditunion"):
        s = s.replace(noise, "")
    return s[:12]


def acct_digits(masked: Optional[str]) -> str:
    """Leading digits of a masked account number — the strongest join key.

    Bureaus mask differently ('470793XXXXXX' vs '470793XXXXXXXXXX') but the
    visible prefix is the same issuer/account identifier.
    """
    if not masked:
        return ""
    m = re.match(r"[^\dA-Za-z]*([0-9]{4,})", masked.strip())
    return m.group(1)[:6] if m else ""


@dataclass
class Tradeline:
    bureau: str
    creditor: str
    account_number: str = ""
    original_creditor: Optional[str] = None
    date_opened: Optional[date] = None
    is_open: Optional[bool] = None
    account_type: str = ""
    status_text: str = ""
    status_updated: Optional[date] = None
    balance: Optional[int] = None
    credit_limit: Optional[int] = None
    original_balance: Optional[int] = None
    high_balance: Optional[int] = None
    monthly_payment: Optional[int] = None
    past_due: Optional[int] = None
    terms: str = ""
    responsibility: str = ""
    comments: list[str] = field(default_factory=list)
    # "YYYY-MM" -> marker code
    grid: dict[str, str] = field(default_factory=dict)
    grid_confident: bool = True

    # ---- derived ----

    @property
    def join_key(self) -> str:
        digits = acct_digits(self.account_number)
        opened = self.date_opened.isoformat() if self.date_opened else "?"
        if digits:
            return f"{digits}|{opened}"
        return f"{norm_creditor(self.creditor)}|{opened}"

    @property
    def is_revolving(self) -> bool:
        t = self.account_type.lower()
        return any(k in t for k in ("revolving", "credit card", "charge", "line of credit"))

    @property
    def is_collection(self) -> bool:
        blob = f"{self.account_type} {self.status_text} {' '.join(self.comments)}".lower()
        if self.original_creditor:
            return True
        return any(h in blob for h in _COLLECTION_HINTS)

    @property
    def is_chargeoff(self) -> bool:
        blob = f"{self.status_text} {' '.join(self.comments)}".lower()
        return any(h in blob for h in _CHARGEOFF_HINTS)

    @property
    def previously_disputed(self) -> bool:
        blob = " ".join(self.comments).lower()
        return any(h in blob for h in _DISPUTE_HINTS)

    @property
    def utilization(self) -> Optional[float]:
        if not self.credit_limit or self.balance is None:
            return None
        return self.balance / self.credit_limit

    @property
    def is_over_limit(self) -> bool:
        u = self.utilization
        return u is not None and u > 1.0

    @property
    def balance_to_payment(self) -> Optional[float]:
        """Months of payments to clear the balance. Low = expensive DTI per dollar."""
        if not self.monthly_payment or not self.balance:
            return None
        return self.balance / self.monthly_payment

    def late_cells(self) -> list[tuple[str, str]]:
        """[(YYYY-MM, code)] for every delinquency marker, chronological."""
        return sorted(
            (k, v) for k, v in self.grid.items() if v in MARKER_CODES
        )

    def grid_signature(self) -> str:
        """Fingerprint of the delinquency pattern, for systemic-cause detection."""
        return ";".join(f"{k}:{v}" for k, v in self.late_cells())


@dataclass
class Inquiry:
    bureau: str
    subscriber: str
    inquired_on: Optional[date] = None
    business_type: str = ""


@dataclass
class BureauReport:
    bureau: str
    score: Optional[int] = None
    pulled_on: Optional[date] = None
    tradelines: list[Tradeline] = field(default_factory=list)
    inquiries: list[Inquiry] = field(default_factory=list)

    def revolving(self) -> list[Tradeline]:
        return [t for t in self.tradelines if t.is_revolving and t.is_open]

    def utilization(self) -> Optional[float]:
        """Aggregate revolving utilization as this bureau would compute it."""
        lines = [t for t in self.revolving() if t.credit_limit and t.balance is not None]
        limit = sum(t.credit_limit for t in lines)
        bal = sum(t.balance for t in lines)
        return (bal / limit) if limit else None


@dataclass
class MergedAccount:
    """One real-world account, as seen by each bureau that reports it."""
    key: str
    by_bureau: dict[str, Tradeline] = field(default_factory=dict)

    @property
    def any_line(self) -> Tradeline:
        return next(iter(self.by_bureau.values()))

    @property
    def creditor(self) -> str:
        # Longest name is usually the most complete spelling.
        return max((t.creditor for t in self.by_bureau.values()), key=len)

    @property
    def missing_from(self) -> list[str]:
        return [b for b in BUREAUS if b not in self.by_bureau]

    def field_spread(self, attr: str) -> dict[str, object]:
        return {b: getattr(t, attr) for b, t in self.by_bureau.items()}


@dataclass
class CreditFile:
    reports: dict[str, BureauReport] = field(default_factory=dict)
    accounts: list[MergedAccount] = field(default_factory=list)

    @property
    def scores(self) -> dict[str, int]:
        return {b: r.score for b, r in self.reports.items() if r.score is not None}

    def middle_score(self) -> Optional[tuple[str, int]]:
        """(bureau, score) of the middle score — the only one underwriting uses.

        With three scores it is the median. With two, lenders use the lower.
        With one, that one.
        """
        s = self.scores
        if not s:
            return None
        ranked = sorted(s.items(), key=lambda kv: kv[1])
        if len(ranked) >= 3:
            return ranked[len(ranked) // 2]
        return ranked[0]

    def merge(self) -> None:
        """Group tradelines across bureaus into MergedAccounts.

        Two passes. The first keys on the visible account-number prefix plus the
        open date, which is the strongest signal available — bureaus mask to
        different lengths but the visible prefix is the same account.

        The second pass reconciles the leftovers, where bureaus abbreviate the
        creditor differently ('UPWARDLI' / 'UPWARD FINANCIAL INC') and mask the
        account number so differently that the prefixes don't match. Those merge
        only on the open date *plus* a corroborating signal, and never when both
        groups already claim the same bureau — that guard is what stops two
        genuinely different accounts opened the same day from collapsing.
        """
        buckets: dict[str, MergedAccount] = {}
        for report in self.reports.values():
            for line in report.tradelines:
                acct = buckets.setdefault(line.join_key, MergedAccount(key=line.join_key))
                existing = acct.by_bureau.get(line.bureau)
                if existing is None or _richness(line) > _richness(existing):
                    acct.by_bureau[line.bureau] = line

        groups = list(buckets.values())
        merged: list[MergedAccount] = []
        while groups:
            head = groups.pop(0)
            absorbed = True
            while absorbed:
                absorbed = False
                for other in list(groups):
                    if _same_account(head, other):
                        head.by_bureau.update(other.by_bureau)
                        groups.remove(other)
                        absorbed = True
            merged.append(head)

        self.accounts = sorted(
            merged,
            key=lambda a: (a.any_line.date_opened or date.min),
            reverse=True,
        )

    def all_lines(self) -> Iterable[Tradeline]:
        for report in self.reports.values():
            yield from report.tradelines


def _same_account(a: MergedAccount, b: MergedAccount) -> bool:
    """Second-pass reconciliation for groups the account-number key missed."""
    if set(a.by_bureau) & set(b.by_bureau):
        return False  # both already claim a bureau — different accounts
    la, lb = a.any_line, b.any_line
    if not la.date_opened or la.date_opened != lb.date_opened:
        return False

    na, nb = norm_creditor(la.creditor), norm_creditor(lb.creditor)
    if na and nb and (na.startswith(nb[:8]) or nb.startswith(na[:8])):
        return True

    # Same open date plus an identical, non-trivial dollar figure.
    for attr in ("high_balance", "original_balance"):
        va, vb = getattr(la, attr), getattr(lb, attr)
        if va and vb and va == vb:
            return True
    return False


def _richness(t: Tradeline) -> int:
    """How many meaningful fields a tradeline carries — used to break ties."""
    fields = (t.balance, t.credit_limit, t.original_balance, t.monthly_payment,
              t.past_due, t.date_opened)
    return sum(1 for f in fields if f is not None) + len(t.grid)


@dataclass
class ProgramCriteria:
    """Underwriting criteria for the program being placed.

    These are lender overlays, not program rules — they change per investor and
    must come from the intake form, never be hardcoded as universal truth.
    """
    name: str = "VA — manual underwrite"
    min_middle_score: int = 580
    clean_months_required: int = 12
    collections_payoff_required: bool = False
    max_dti: float = 0.41
    notes: str = ""
