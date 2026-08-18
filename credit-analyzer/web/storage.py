"""Job storage with a working delete path.

Consumer credit files are the most sensitive thing this system will ever hold,
so retention is designed in rather than bolted on:

  · every job lives in its own directory named by an unguessable token
  · uploads land outside any static-served path and are never linked directly
  · jobs expire on a TTL and are purged on every request, not by a cron nobody
    remembers to run
  · delete is a first-class action, available from the UI, and removes the
    uploads and the derived report together
  · every access is written to an append-only audit log

The FTC Safeguards Rule expects a documented retention schedule and the ability
to dispose of customer information. This is that ability, in code.
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DATA_DIR = Path(os.environ.get("ANALYZER_DATA_DIR", "/tmp/credit-analyzer-data"))
TTL_HOURS = int(os.environ.get("ANALYZER_TTL_HOURS", "24"))
AUDIT_LOG = DATA_DIR / "audit.log"


def _now() -> float:
    return time.time()


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def init() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Owner-only. Anything less is a finding waiting to happen.
    os.chmod(DATA_DIR, 0o700)


def audit(action: str, *, job_id: str = "-", actor: str = "-", detail: str = "") -> None:
    init()
    line = json.dumps({
        "at": _iso(_now()),
        "action": action,
        "job": job_id,
        "actor": actor,
        "detail": detail,
    })
    with AUDIT_LOG.open("a") as fh:
        fh.write(line + "\n")
    os.chmod(AUDIT_LOG, 0o600)


@dataclass
class Job:
    id: str
    created: float
    file_ref: str
    prepared_for: str
    program: str
    min_score: int
    clean_months: int
    collections_payoff: bool
    source_names: list[str] = field(default_factory=list)
    finding_counts: dict[str, int] = field(default_factory=dict)
    middle: Optional[list] = None
    scores: dict[str, int] = field(default_factory=dict)
    analyst_slots: int = 0
    error: str = ""

    @property
    def dir(self) -> Path:
        return DATA_DIR / self.id

    @property
    def expires(self) -> float:
        return self.created + TTL_HOURS * 3600

    @property
    def expired(self) -> bool:
        return _now() > self.expires

    @property
    def hours_left(self) -> float:
        return max(0.0, (self.expires - _now()) / 3600)

    @property
    def created_iso(self) -> str:
        return _iso(self.created)


def _meta_path(job_id: str) -> Path:
    return DATA_DIR / job_id / "job.json"


def create(file_ref: str, prepared_for: str, program: str, min_score: int,
           clean_months: int, collections_payoff: bool) -> Job:
    init()
    job = Job(
        id=secrets.token_urlsafe(16),
        created=_now(),
        file_ref=file_ref or "(unlabelled)",
        prepared_for=prepared_for or "(unspecified)",
        program=program,
        min_score=min_score,
        clean_months=clean_months,
        collections_payoff=collections_payoff,
    )
    job.dir.mkdir(parents=True, exist_ok=True)
    os.chmod(job.dir, 0o700)
    save(job)
    return job


def save(job: Job) -> None:
    path = _meta_path(job.id)
    path.write_text(json.dumps(asdict(job), indent=2))
    os.chmod(path, 0o600)


def get(job_id: str) -> Optional[Job]:
    # Reject anything that isn't a bare token — no traversal into the data dir.
    if not job_id or "/" in job_id or "\\" in job_id or job_id.startswith("."):
        return None
    path = _meta_path(job_id)
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    job = Job(**data)
    if job.expired:
        delete(job_id, actor="system", reason="expired")
        return None
    return job


def list_jobs() -> list[Job]:
    init()
    out: list[Job] = []
    for child in DATA_DIR.iterdir():
        if not child.is_dir():
            continue
        job = get(child.name)
        if job:
            out.append(job)
    return sorted(out, key=lambda j: j.created, reverse=True)


def delete(job_id: str, *, actor: str = "-", reason: str = "manual") -> bool:
    if not job_id or "/" in job_id or "\\" in job_id or job_id.startswith("."):
        return False
    target = DATA_DIR / job_id
    if not target.exists():
        return False
    shutil.rmtree(target, ignore_errors=True)
    audit("delete", job_id=job_id, actor=actor, detail=reason)
    return True


def purge_expired() -> int:
    """Called on every request. Retention that depends on a cron job is a policy,
    not a control."""
    init()
    removed = 0
    for child in DATA_DIR.iterdir():
        if not child.is_dir():
            continue
        meta = child / "job.json"
        if not meta.exists():
            shutil.rmtree(child, ignore_errors=True)
            removed += 1
            continue
        try:
            data = json.loads(meta.read_text())
        except (json.JSONDecodeError, OSError):
            shutil.rmtree(child, ignore_errors=True)
            removed += 1
            continue
        if _now() > data.get("created", 0) + TTL_HOURS * 3600:
            shutil.rmtree(child, ignore_errors=True)
            audit("purge", job_id=child.name, actor="system", detail="ttl")
            removed += 1
    return removed


def recent_audit(limit: int = 50) -> list[dict]:
    if not AUDIT_LOG.exists():
        return []
    lines = AUDIT_LOG.read_text().strip().split("\n")
    out = []
    for line in reversed(lines[-limit * 2:]):
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(out) >= limit:
            break
    return out
