"""Parser for consumer-disclosure tri-bureau PDFs.

This is the fallback input path. The preferred path is MISMO XML from the
credit vendor, where payment grids arrive as structured fields instead of
glyphs that have to be reconstructed from extracted text. Anything this module
learns the hard way is a reason to push clients toward XML.

Known limitation, handled explicitly rather than hidden: on multi-year payment
grids the extracted text drops the on-time glyphs, so cell-to-year alignment
cannot always be trusted. Those tradelines get `grid_confident = False` and the
rules engine downgrades any finding that depends on an exact month.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from canonical import (
    BureauReport,
    CreditFile,
    Inquiry,
    Tradeline,
    LATE_CODES,
    DEROG_CODES,
    MARKER_CODES,
    ND,
    OK,
    parse_date,
    parse_money,
)

_MONTHS = {m: i + 1 for i, m in enumerate(
    ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"))}

_BUREAU_PATTERNS = {
    "experian": re.compile(r"(\d{3})\s*Experian data", re.I),
    "equifax": re.compile(r"(\d{3})\s*Equifax data", re.I),
    "transunion": re.compile(r"(\d{3})\s*TransUnion data", re.I),
}

_FIELDS = {
    "creditor": "Account name",
    "account_number": "Account number",
    "original_creditor": "Original creditor",
    "_date_opened": "Date opened",
    "_open_closed": "Open/closed",
    "_status_updated": "Status updated",
    "account_type": "Account type",
    "_balance": "Balance",
    "_credit_limit": "Credit limit",
    "_original_balance": "Original balance",
    "_high_balance": "Highest balance",
    "_monthly_payment": "Monthly payment",
    "_past_due": "Past due amount",
    "terms": "Terms",
    "responsibility": "Responsibility",
}

_GRID_END = re.compile(r"(On Time|Current / Terms met|Data Unavailable|No payment history)")


def extract_text(pdf_path: str | Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def detect_bureau(text: str) -> tuple[Optional[str], Optional[int]]:
    for bureau, pattern in _BUREAU_PATTERNS.items():
        m = pattern.search(text)
        if m:
            return bureau, int(m.group(1))
    return None, None


def _field(block: str, label: str) -> Optional[str]:
    m = re.search(rf"^{re.escape(label)}\s+(.*)$", block, re.M)
    if not m:
        return None
    val = m.group(1).strip()
    return None if val in ("-", "--", "") else val


def _status_text(block: str) -> str:
    """The Status field wraps across lines and collides with 'Status updated'."""
    m = re.search(r"^Status\s+((?!updated)\S.*)$", block, re.M)
    if not m:
        return ""
    parts = [m.group(1).strip()]
    tail = block[m.end():].split("\n")
    for line in tail[:2]:
        line = line.strip()
        if not line or re.match(r"^(Balance|Credit limit|Account type|Past due)", line):
            break
        parts.append(line)
    return " ".join(parts).strip()


def _comments(section: str) -> list[str]:
    m = re.search(r"Comments\s*\n(.*?)(?:\n\s*\n|Prepared For|$)", section, re.S)
    if not m:
        return []
    out = [c.strip() for c in m.group(1).split("\n") if c.strip() and c.strip() != "-"]
    return out


def parse_grid(section: str) -> tuple[dict[str, str], bool]:
    """Reconstruct the payment-history grid.

    Returns ({"YYYY-MM": code}, confident).
    """
    if "Payment history" not in section:
        return {}, True
    region = section.split("Payment history", 1)[1]
    end = _GRID_END.search(region)
    legend = region[end.start(): end.start() + 160] if end else ""
    region = region[: end.start()] if end else region.split("Contact info")[0]

    lines = region.split("\n")
    years: list[int] = []
    idx = 0
    for idx, raw in enumerate(lines):
        s = raw.strip()
        if re.fullmatch(r"(19|20)\d{2}", s):
            years.append(int(s))
        elif years:
            break
    if not years:
        return {}, True

    body = lines[idx:]

    # Single-year grids render as one line of month tokens: "Jan Feb ... Aug30".
    # Multi-year grids render one cell per line under each month name.
    single_line = next(
        (l for l in body if sum(1 for m in _MONTHS if m in l) >= 6), None
    )
    rows: dict[str, list[str]] = {}
    if single_line is not None and len(years) == 1:
        for tok in single_line.split():
            head = tok[:3]
            if head in _MONTHS:
                rows[head] = [tok[3:].strip()]
    else:
        current: Optional[str] = None
        for raw in body:
            s = raw.strip()
            head = s[:3]
            if head in _MONTHS and (len(s) == 3 or not s[3:4].isalpha()):
                current = head
                rows[current] = []
                rest = s[3:].strip()
                if rest:
                    rows[current].append(rest)
                continue
            if current is None:
                continue
            rows[current].append(s)

    # A single-year grid is unambiguous. Multi-year grids lose the on-time
    # glyphs, so positional alignment is a best guess.
    confident = len(years) == 1
    grid: dict[str, str] = {}
    for month, cells in rows.items():
        for pos, cell in enumerate(cells):
            if pos >= len(years):
                break
            code = _cell_code(cell)
            if code is None:
                continue
            grid[f"{years[pos]}-{_MONTHS[month]:02d}"] = code

    # Cross-check against the legend: if it lists no delinquency codes, the grid
    # contains none, whatever the positional guess produced.
    if legend and not any(c in legend for c in LATE_CODES + DEROG_CODES):
        grid = {k: v for k, v in grid.items() if v not in MARKER_CODES}

    return grid, confident


def _cell_code(cell: str) -> Optional[str]:
    s = cell.strip()
    if s == "":
        return OK
    if s in ("-", "--"):
        return ND
    for code in ("120", "150", "180", "90", "60", "30"):
        if s.startswith(code):
            return code
    for code in DEROG_CODES:
        if s.upper().startswith(code):
            return code
    if s.upper().startswith("ND"):
        return ND
    return None


def parse_tradelines(text: str, bureau: str) -> list[Tradeline]:
    out: list[Tradeline] = []
    chunks = text.split("Account info")
    for chunk in chunks[1:]:
        section = chunk.split("Prepared For")[0]
        block = section.split("Payment history")[0]
        creditor = _field(block, _FIELDS["creditor"])
        if not creditor:
            continue
        grid, confident = parse_grid(section)
        open_closed = (_field(block, _FIELDS["_open_closed"]) or "").lower()
        line = Tradeline(
            bureau=bureau,
            creditor=creditor,
            account_number=_field(block, _FIELDS["account_number"]) or "",
            original_creditor=_field(block, _FIELDS["original_creditor"]),
            date_opened=parse_date(_field(block, _FIELDS["_date_opened"])),
            is_open=None if not open_closed else open_closed.startswith("open"),
            account_type=_field(block, _FIELDS["account_type"]) or "",
            status_text=_status_text(block),
            status_updated=parse_date(_field(block, _FIELDS["_status_updated"])),
            balance=parse_money(_field(block, _FIELDS["_balance"])),
            credit_limit=parse_money(_field(block, _FIELDS["_credit_limit"])),
            original_balance=parse_money(_field(block, _FIELDS["_original_balance"])),
            high_balance=parse_money(_field(block, _FIELDS["_high_balance"])),
            monthly_payment=parse_money(_field(block, _FIELDS["_monthly_payment"])),
            past_due=parse_money(_field(block, _FIELDS["_past_due"])),
            terms=_field(block, _FIELDS["terms"]) or "",
            responsibility=_field(block, _FIELDS["responsibility"]) or "",
            comments=_comments(section),
            grid=grid,
            grid_confident=confident,
        )
        out.append(line)
    return out


def parse_inquiries(text: str, bureau: str) -> list[Inquiry]:
    if "Inquiries" not in text:
        return []
    region = text.split("Inquiries", 1)[1].split("Credit scores")[0]
    out: list[Inquiry] = []
    pattern = (r"([A-Z0-9][A-Z0-9 ,./&'-]{2,40})\s*\nInquired on ([A-Za-z]+ \d+, \d{4})"
               r"(?:\s*\nBusiness Type:\s*([^\n]*(?:\n(?!\s*[A-Z0-9]{2})[^\n]*)?))?")
    for m in re.finditer(pattern, region):
        out.append(Inquiry(
            bureau=bureau,
            subscriber=m.group(1).strip(),
            inquired_on=parse_date(m.group(2)),
            business_type=" ".join((m.group(3) or "").split()),
        ))
    return out


def parse_report(pdf_path: str | Path) -> BureauReport:
    text = extract_text(pdf_path)
    bureau, score = detect_bureau(text)
    if bureau is None:
        raise ValueError(f"Could not identify the bureau in {pdf_path}")
    pulled = None
    m = re.search(r"Date generated:\s*([A-Za-z]+ \d+, \d{4})", text)
    if m:
        pulled = parse_date(m.group(1))
    return BureauReport(
        bureau=bureau,
        score=score,
        pulled_on=pulled,
        tradelines=parse_tradelines(text, bureau),
        inquiries=parse_inquiries(text, bureau),
    )


def load_file(paths: list[str | Path]) -> CreditFile:
    cf = CreditFile()
    for p in paths:
        report = parse_report(p)
        cf.reports[report.bureau] = report
    cf.merge()
    return cf
