#!/usr/bin/env python3
"""CLI: parse a tri-merge and print ranked findings.

    python analyze.py fixtures/*.PDF
    python analyze.py fixtures/*.PDF --score 620 --clean-months 12 --json out.json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from canonical import BUREAUS, CreditFile, ProgramCriteria
from parse_pdf import load_file
from rules import CRITICAL, HIGH, INFO, MEDIUM, run

_BADGE = {CRITICAL: "CRITICAL", HIGH: "HIGH", MEDIUM: "MEDIUM", INFO: "INFO"}


def summarize(cf: CreditFile) -> str:
    lines = ["FILE SUMMARY", "=" * 68]
    for b in BUREAUS:
        r = cf.reports.get(b)
        if not r:
            lines.append(f"  {b.title():<12} not provided")
            continue
        util = r.utilization()
        lines.append(
            f"  {b.title():<12} score {r.score or '—':<5} "
            f"{len(r.tradelines):>3} tradelines  "
            f"util {f'{util:.0%}' if util is not None else '—':>5}  "
            f"{len(r.inquiries):>2} inquiries"
        )
    mid = cf.middle_score()
    if mid:
        lines.append(f"\n  Qualifying (middle) score: {mid[1]} — {mid[0].title()}")
    lines.append(f"  Unique accounts after merge: {len(cf.accounts)}")
    multi = sum(1 for a in cf.accounts if len(a.by_bureau) > 1)
    lines.append(f"  Matched across 2+ bureaus:   {multi}")
    return "\n".join(lines)


def render(findings, show_info: bool) -> str:
    out = ["", "FINDINGS", "=" * 68]
    shown = [f for f in findings if show_info or f.severity != INFO]
    if not shown:
        out.append("  (none)")
    for f in shown:
        flag = "" if f.confident else "  [low confidence — grid alignment]"
        out.append(f"\n[{_BADGE[f.severity]}] {f.title}{flag}")
        out.append(f"  {f.detail}")
        for e in f.evidence:
            out.append(f"    · {e}")
    counts = {}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    out.append("\n" + "-" * 68)
    out.append("  " + "   ".join(f"{_BADGE[k]}: {v}" for k, v in sorted(
        counts.items(), key=lambda kv: kv[0])))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Tri-merge credit analysis")
    ap.add_argument("reports", nargs="+", help="Credit report PDFs (one per bureau)")
    ap.add_argument("--program", default="VA — manual underwrite")
    ap.add_argument("--score", type=int, default=580, help="Lender minimum middle score")
    ap.add_argument("--clean-months", type=int, default=12)
    ap.add_argument("--collections-payoff", action="store_true",
                    help="Lender requires collections satisfied")
    ap.add_argument("--json", help="Write findings to this path")
    ap.add_argument("--all", action="store_true", help="Include INFO findings")
    args = ap.parse_args(argv)

    paths = [Path(p) for p in args.reports]
    missing = [p for p in paths if not p.exists()]
    if missing:
        print(f"Not found: {', '.join(str(p) for p in missing)}", file=sys.stderr)
        return 2

    cf = load_file(paths)
    prog = ProgramCriteria(
        name=args.program,
        min_middle_score=args.score,
        clean_months_required=args.clean_months,
        collections_payoff_required=args.collections_payoff,
    )
    findings = run(cf, prog)

    print(summarize(cf))
    print(render(findings, args.all))

    if args.json:
        Path(args.json).write_text(json.dumps(
            {"program": asdict(prog),
             "scores": cf.scores,
             "middle": cf.middle_score(),
             "findings": [asdict(f) for f in findings]},
            indent=2, default=str))
        print(f"\nWrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
