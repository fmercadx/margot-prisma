"""Entry point the browser page calls.

The analyzer modules are imported unchanged. Everything here is glue: take
files the page has already written into the Pyodide virtual filesystem, run
the same `load_file` → `rules.run` → `report.render` path the CLI runs, and
hand back one JSON blob.

Nothing in this module talks to the network. The whole point of the browser
build is that a consumer credit file is read, parsed and reported on inside
the tab and never leaves the machine — so there is no upload, no session, no
retention window, and no server that could be breached. If you ever find
yourself adding a fetch() here, you have changed what this product is.
"""

from __future__ import annotations

import json
import traceback
from dataclasses import asdict
from pathlib import Path

from canonical import BUREAUS, ProgramCriteria
import parse_mismo
import parse_pdf
import report as report_mod
from rules import CRITICAL, HIGH, INFO, MEDIUM, run as run_rules

UPLOADS = Path("/uploads")

_ORDER = {CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3}


def _load(paths: list[Path]):
    """Same precedence as the CLI: MISMO XML preferred, PDFs as fallback."""
    xml = [p for p in paths if p.suffix.lower() == ".xml"]
    pdf = [p for p in paths if p.suffix.lower() == ".pdf"]
    if xml and pdf:
        raise ValueError("Provide either MISMO XML or PDFs, not both.")
    if xml:
        if len(xml) > 1:
            raise ValueError(
                "A MISMO CREDIT_RESPONSE already covers every repository — "
                "load one XML file.")
        return parse_mismo.load_file(xml[0])
    if not pdf:
        raise ValueError("No .pdf or .xml file was provided.")
    return parse_pdf.load_file(pdf)


def _file_summary(cf) -> list[dict]:
    rows = []
    for b in BUREAUS:
        r = cf.reports.get(b)
        if not r:
            rows.append({"bureau": b, "present": False})
            continue
        util = r.utilization()
        rows.append({
            "bureau": b,
            "present": True,
            "score": r.score,
            "tradelines": len(r.tradelines),
            "inquiries": len(r.inquiries),
            "utilization": round(util, 4) if util is not None else None,
            "pulled_on": r.pulled_on.isoformat() if r.pulled_on else None,
        })
    return rows


def analyze(config_json: str) -> str:
    """Run the analysis. Returns JSON — never raises into JavaScript.

    A traceback crossing the FFI boundary arrives in the console as an opaque
    PythonError, which is useless to whoever is standing at the page. Failures
    come back as data instead, with the message the parser actually produced.
    """
    try:
        cfg = json.loads(config_json)
        names = cfg.get("files") or []
        paths = [UPLOADS / n for n in names]
        missing = [str(p) for p in paths if not p.exists()]
        if missing:
            raise ValueError(f"File not staged: {', '.join(missing)}")

        cf = _load(paths)
        prog = ProgramCriteria(
            name=cfg.get("program") or "VA — manual underwrite",
            min_middle_score=int(cfg.get("min_score") or 620),
            clean_months_required=int(cfg.get("clean_months") or 12),
            collections_payoff_required=bool(cfg.get("collections_payoff")),
        )
        findings = run_rules(cf, prog)

        eng = report_mod.Engagement(
            file_ref=cfg.get("file_ref") or "[FILE REF]",
            prepared_for=cfg.get("prepared_for") or "[LOAN OFFICER / COMPANY]",
        )
        html = report_mod.render(cf, findings, prog, eng)

        rows = [asdict(f) for f in findings]
        rows.sort(key=lambda f: _ORDER.get(f.get("severity"), 9))
        counts: dict[str, int] = {}
        for f in rows:
            counts[f["severity"]] = counts.get(f["severity"], 0) + 1

        mid = cf.middle_score()
        return json.dumps({
            "ok": True,
            "summary": _file_summary(cf),
            "middle": list(mid) if mid else None,
            "accounts": len(cf.accounts),
            "matched": sum(1 for a in cf.accounts if len(a.by_bureau) > 1),
            "merged_source": cf.merged_source,
            "as_of": cf.as_of.isoformat(),
            "counts": counts,
            "findings": rows,
            "report_html": html,
            "findings_json": json.dumps(rows, indent=2, default=str),
            "analyst_slots": html.count("[ANALYST]"),
        }, default=str)
    except Exception as exc:  # noqa: BLE001 — reported, not swallowed
        return json.dumps({
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
        })


def stage(name: str, data: bytes) -> str:
    """Write one uploaded file into the virtual filesystem."""
    UPLOADS.mkdir(parents=True, exist_ok=True)
    dest = UPLOADS / Path(name).name
    dest.write_bytes(bytes(data))
    return dest.name


def clear() -> int:
    """Drop every staged file. Called on reset and before each new run."""
    if not UPLOADS.exists():
        return 0
    n = 0
    for p in UPLOADS.iterdir():
        if p.is_file():
            p.unlink()
            n += 1
    return n
