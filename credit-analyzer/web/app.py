"""Web front end for the credit analyzer.

Deliberately an *internal analyst tool*, not a consumer product. The operator
uploads a file a loan officer sent them, reviews the findings, and downloads a
draft report. Borrowers never log in, never upload, and never pay — which is
what keeps this outside the Credit Repair Organizations Act. Changing that one
fact changes the entire legal posture of the business, so it is enforced here
by there being no consumer-facing route at all.

Run:
    export ANALYZER_PASSWORD='something long'
    python web/app.py

Environment:
    ANALYZER_PASSWORD       plaintext password, hashed at startup
    ANALYZER_PASSWORD_HASH  pre-hashed password (preferred in deployment)
    ANALYZER_SECRET_KEY     session signing key; generated if unset (dev only)
    ANALYZER_DATA_DIR       where jobs live (default /tmp/credit-analyzer-data)
    ANALYZER_TTL_HOURS      retention window (default 24)
    ANALYZER_SECURE_COOKIE  set to 0 only for local http testing
"""

from __future__ import annotations

import os
import secrets
import sys
import time
from dataclasses import asdict
from functools import wraps
from pathlib import Path

from flask import (
    Flask, abort, flash, redirect, render_template, request,
    send_file, session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import parse_mismo  # noqa: E402
import parse_pdf  # noqa: E402
import report as report_mod  # noqa: E402
import storage  # noqa: E402  (web/storage.py — web dir is on the path)
from canonical import ProgramCriteria  # noqa: E402
from rules import CRITICAL, HIGH, INFO, MEDIUM, run as run_rules  # noqa: E402

ALLOWED = {".pdf", ".xml"}
MAX_UPLOAD_MB = 40
LOGIN_WINDOW_S = 300
LOGIN_MAX_ATTEMPTS = 8

app = Flask(__name__)
app.config.update(
    MAX_CONTENT_LENGTH=MAX_UPLOAD_MB * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("ANALYZER_SECURE_COOKIE", "1") != "0",
)


def _password_hash() -> str:
    pre = os.environ.get("ANALYZER_PASSWORD_HASH")
    if pre:
        return pre
    plain = os.environ.get("ANALYZER_PASSWORD")
    if not plain:
        raise SystemExit(
            "Refusing to start without a password.\n"
            "Set ANALYZER_PASSWORD (or ANALYZER_PASSWORD_HASH).\n"
            "There is no default — a default password on a service holding "
            "credit reports is a breach with a countdown on it."
        )
    if len(plain) < 12:
        raise SystemExit("ANALYZER_PASSWORD must be at least 12 characters.")
    return generate_password_hash(plain)


PASSWORD_HASH = _password_hash()
app.secret_key = os.environ.get("ANALYZER_SECRET_KEY") or secrets.token_hex(32)

# IP -> [timestamps]. Single-password services get scanned; make it expensive.
_attempts: dict[str, list[float]] = {}


def _throttled(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _attempts.get(ip, []) if now - t < LOGIN_WINDOW_S]
    _attempts[ip] = hits
    return len(hits) >= LOGIN_MAX_ATTEMPTS


def _record_attempt(ip: str) -> None:
    _attempts.setdefault(ip, []).append(time.time())


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("auth"):
            return redirect(url_for("login", next=request.path))
        return fn(*args, **kwargs)
    return wrapper


@app.before_request
def _housekeeping():
    # Retention enforced on every request rather than by a scheduler.
    storage.purge_expired()


@app.route("/login", methods=["GET", "POST"])
def login():
    ip = request.remote_addr or "-"
    if request.method == "POST":
        if _throttled(ip):
            storage.audit("login_throttled", actor=ip)
            flash("Too many attempts. Wait five minutes.", "error")
            return render_template("login.html"), 429
        supplied = request.form.get("password", "")
        if check_password_hash(PASSWORD_HASH, supplied):
            session.clear()
            session["auth"] = True
            storage.audit("login", actor=ip)
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") else url_for("index"))
        _record_attempt(ip)
        storage.audit("login_failed", actor=ip)
        flash("Incorrect password.", "error")
    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    storage.audit("logout", actor=request.remote_addr or "-")
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("upload.html", jobs=storage.list_jobs(),
                           ttl=storage.TTL_HOURS)


@app.route("/analyze", methods=["POST"])
@login_required
def analyze():
    files = [f for f in request.files.getlist("reports") if f and f.filename]
    if not files:
        flash("Choose at least one credit report.", "error")
        return redirect(url_for("index"))

    for f in files:
        if Path(secure_filename(f.filename)).suffix.lower() not in ALLOWED:
            flash(f"{f.filename}: only .pdf and .xml are accepted.", "error")
            return redirect(url_for("index"))

    def _int(name, default):
        try:
            return int(request.form.get(name) or default)
        except ValueError:
            return default

    job = storage.create(
        file_ref=request.form.get("file_ref", "").strip(),
        prepared_for=request.form.get("prepared_for", "").strip(),
        program=request.form.get("program", "VA — manual underwrite").strip(),
        min_score=_int("min_score", 620),
        clean_months=_int("clean_months", 12),
        collections_payoff=bool(request.form.get("collections_payoff")),
    )
    actor = request.remote_addr or "-"
    storage.audit("upload", job_id=job.id, actor=actor,
                  detail=f"{len(files)} file(s)")

    saved: list[Path] = []
    for f in files:
        name = secure_filename(f.filename) or secrets.token_hex(8)
        dest = job.dir / name
        f.save(dest)
        os.chmod(dest, 0o600)
        saved.append(dest)
    job.source_names = [p.name for p in saved]

    try:
        xml = [p for p in saved if p.suffix.lower() == ".xml"]
        pdf = [p for p in saved if p.suffix.lower() == ".pdf"]
        if xml and pdf:
            raise ValueError("Provide either MISMO XML or PDFs, not both.")
        if xml:
            if len(xml) > 1:
                raise ValueError(
                    "A MISMO CREDIT_RESPONSE already covers every repository — "
                    "upload one XML file.")
            cf = parse_mismo.load_file(xml[0])
        else:
            cf = parse_pdf.load_file(pdf)

        prog = ProgramCriteria(
            name=job.program,
            min_middle_score=job.min_score,
            clean_months_required=job.clean_months,
            collections_payoff_required=job.collections_payoff,
        )
        findings = run_rules(cf, prog)

        eng = report_mod.Engagement(
            file_ref=job.file_ref,
            prepared_for=job.prepared_for,
        )
        html = report_mod.render(cf, findings, prog, eng)
        (job.dir / "report.html").write_text(html)
        os.chmod(job.dir / "report.html", 0o600)

        import json
        (job.dir / "findings.json").write_text(json.dumps(
            [asdict(f) for f in findings], indent=2, default=str))
        os.chmod(job.dir / "findings.json", 0o600)

        counts: dict[str, int] = {}
        for f in findings:
            counts[f.severity] = counts.get(f.severity, 0) + 1
        job.finding_counts = counts
        job.scores = cf.scores
        job.middle = list(cf.middle_score()) if cf.middle_score() else None
        job.analyst_slots = html.count("[ANALYST]")
        storage.audit("analyzed", job_id=job.id, actor=actor,
                      detail=f"{len(findings)} findings")
    except Exception as exc:
        job.error = f"{type(exc).__name__}: {exc}"
        storage.audit("analyze_failed", job_id=job.id, actor=actor,
                      detail=job.error)

    storage.save(job)
    return redirect(url_for("job_view", job_id=job.id))


@app.route("/job/<job_id>")
@login_required
def job_view(job_id: str):
    job = storage.get(job_id)
    if not job:
        abort(404)
    import json
    findings = []
    fp = job.dir / "findings.json"
    if fp.exists():
        findings = json.loads(fp.read_text())
    order = {CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3}
    findings.sort(key=lambda f: order.get(f.get("severity"), 9))
    return render_template("result.html", job=job, findings=findings,
                           ttl=storage.TTL_HOURS)


@app.route("/job/<job_id>/report")
@login_required
def job_report(job_id: str):
    job = storage.get(job_id)
    if not job:
        abort(404)
    path = job.dir / "report.html"
    if not path.exists():
        abort(404)
    storage.audit("download_report", job_id=job.id,
                  actor=request.remote_addr or "-")
    return send_file(path, mimetype="text/html")


@app.route("/job/<job_id>/findings.json")
@login_required
def job_findings(job_id: str):
    job = storage.get(job_id)
    if not job:
        abort(404)
    path = job.dir / "findings.json"
    if not path.exists():
        abort(404)
    storage.audit("download_json", job_id=job.id,
                  actor=request.remote_addr or "-")
    return send_file(path, mimetype="application/json")


@app.route("/job/<job_id>/delete", methods=["POST"])
@login_required
def job_delete(job_id: str):
    if storage.delete(job_id, actor=request.remote_addr or "-"):
        flash("File and report deleted.", "ok")
    return redirect(url_for("index"))


@app.route("/audit")
@login_required
def audit_view():
    return render_template("audit.html", entries=storage.recent_audit(80),
                           ttl=storage.TTL_HOURS,
                           data_dir=str(storage.DATA_DIR))


@app.errorhandler(413)
def too_large(_):
    return render_template("login.html" if not session.get("auth") else "upload.html",
                           jobs=storage.list_jobs(), ttl=storage.TTL_HOURS,
                           oversize=MAX_UPLOAD_MB), 413


if __name__ == "__main__":
    storage.init()
    port = int(os.environ.get("PORT", "5000"))
    # Debug stays off: tracebacks on a service holding credit files would leak
    # file paths and job tokens to anyone who triggers an error.
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=False)
