"""Tests for the web layer.

Security properties get the most attention here, because this is the only part
of the system that touches a network and the data it holds is the most damaging
thing anyone could take.

    ANALYZER_PASSWORD=test-password-1234 python -m pytest web/test_web.py -q
"""

import io
import json
import os
import time
from pathlib import Path

import pytest

os.environ.setdefault("ANALYZER_PASSWORD", "test-password-1234")
os.environ.setdefault("ANALYZER_SECURE_COOKIE", "0")

PASSWORD = os.environ["ANALYZER_PASSWORD"]
FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "synthetic_mismo.xml"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYZER_DATA_DIR", str(tmp_path / "data"))
    import storage
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(storage, "AUDIT_LOG", tmp_path / "data" / "audit.log")
    import app as web
    monkeypatch.setattr(web, "_attempts", {})
    web.app.config["TESTING"] = True
    with web.app.test_client() as c:
        yield c


def login(client):
    return client.post("/login", data={"password": PASSWORD}, follow_redirects=True)


def upload(client, path=FIXTURE, **form):
    data = {"reports": (open(path, "rb"), path.name),
            "file_ref": "TEST-1", "prepared_for": "Test Brokerage",
            "min_score": "620", "clean_months": "12"}
    data.update(form)
    return client.post("/analyze", data=data, content_type="multipart/form-data")


# ------------------------------------------------------------------- auth

@pytest.mark.parametrize("path", ["/", "/audit", "/job/anything",
                                  "/job/anything/report", "/job/anything/findings.json"])
def test_every_route_requires_auth(client, path):
    r = client.get(path)
    assert r.status_code == 302
    assert "/login" in r.headers["Location"]


def test_delete_requires_auth(client):
    r = client.post("/job/anything/delete")
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_wrong_password_does_not_authenticate(client):
    client.post("/login", data={"password": "nope"})
    assert client.get("/").status_code == 302


def test_correct_password_authenticates(client):
    r = login(client)
    assert r.status_code == 200 and b"Sign out" in r.data


def test_login_is_throttled(client):
    for _ in range(8):
        client.post("/login", data={"password": "nope"})
    r = client.post("/login", data={"password": "nope"})
    assert r.status_code == 429


def test_throttle_blocks_even_the_correct_password(client):
    """Otherwise the limiter is trivially bypassed by guessing correctly."""
    for _ in range(8):
        client.post("/login", data={"password": "nope"})
    r = client.post("/login", data={"password": PASSWORD})
    assert r.status_code == 429


def test_logout_clears_the_session(client):
    login(client)
    client.post("/logout")
    assert client.get("/").status_code == 302


def test_startup_refuses_a_missing_password(monkeypatch):
    import importlib
    monkeypatch.delenv("ANALYZER_PASSWORD", raising=False)
    monkeypatch.delenv("ANALYZER_PASSWORD_HASH", raising=False)
    import app as web
    with pytest.raises(SystemExit):
        importlib.reload(web)
    monkeypatch.setenv("ANALYZER_PASSWORD", PASSWORD)
    importlib.reload(web)


def test_startup_refuses_a_short_password(monkeypatch):
    import importlib
    monkeypatch.setenv("ANALYZER_PASSWORD", "short")
    import app as web
    with pytest.raises(SystemExit):
        importlib.reload(web)
    monkeypatch.setenv("ANALYZER_PASSWORD", PASSWORD)
    importlib.reload(web)


# ---------------------------------------------------------------- analysis

def test_upload_produces_findings_and_a_report(client):
    login(client)
    r = upload(client)
    assert r.status_code == 302
    page = client.get(r.headers["Location"])
    assert page.status_code == 200
    body = page.data.decode()
    assert "576" in body                      # middle score surfaced
    assert "analyst slots" in body            # draft warning present
    assert 'class="sev' in body               # findings rendered


def test_report_and_json_are_downloadable(client):
    login(client)
    jid = upload(client).headers["Location"].rstrip("/").split("/")[-1]
    assert b"NOT FOR RELEASE" in client.get(f"/job/{jid}/report").data
    findings = json.loads(client.get(f"/job/{jid}/findings.json").data)
    assert any(f["code"] == "MIDDLE_SCORE" for f in findings)


def test_upload_with_no_file_is_rejected(client):
    login(client)
    r = client.post("/analyze", data={}, content_type="multipart/form-data",
                    follow_redirects=True)
    assert b"Choose at least one" in r.data


@pytest.mark.parametrize("name", ["evil.exe", "script.sh", "notes.txt", "x.pdf.exe"])
def test_disallowed_extensions_are_rejected(client, name):
    login(client)
    r = client.post("/analyze", data={"reports": (io.BytesIO(b"x"), name)},
                    content_type="multipart/form-data", follow_redirects=True)
    assert b"only .pdf and .xml" in r.data


def test_a_parse_failure_is_reported_not_crashed(client):
    login(client)
    r = client.post("/analyze",
                    data={"reports": (io.BytesIO(b"not xml at all"), "junk.xml"),
                          "file_ref": "BAD-1"},
                    content_type="multipart/form-data")
    page = client.get(r.headers["Location"])
    assert page.status_code == 200
    assert b"Analysis failed" in page.data


# ---------------------------------------------------------------- security

@pytest.mark.parametrize("bad", ["..", "../..", ".hidden", "..%2f..", "a/b"])
def test_job_id_traversal_is_refused(client, bad):
    login(client)
    assert client.get(f"/job/{bad}").status_code in (404, 308)


def test_job_ids_are_unguessable(client):
    login(client)
    jid = upload(client).headers["Location"].rstrip("/").split("/")[-1]
    assert len(jid) >= 20
    assert "TEST-1" not in jid  # the reference must not leak into the URL


def test_unknown_job_is_404_not_500(client):
    login(client)
    assert client.get("/job/doesnotexist000000000").status_code == 404


def test_uploaded_files_are_owner_only(client, tmp_path):
    login(client)
    jid = upload(client).headers["Location"].rstrip("/").split("/")[-1]
    job_dir = tmp_path / "data" / jid
    assert oct(job_dir.stat().st_mode)[-3:] == "700"
    for child in job_dir.iterdir():
        assert oct(child.stat().st_mode)[-3:] == "600"


# --------------------------------------------------------------- retention

def test_delete_removes_the_files_from_disk(client, tmp_path):
    login(client)
    jid = upload(client).headers["Location"].rstrip("/").split("/")[-1]
    job_dir = tmp_path / "data" / jid
    assert job_dir.exists()
    client.post(f"/job/{jid}/delete", follow_redirects=True)
    assert not job_dir.exists()


def test_expired_jobs_are_purged_and_unreachable(client, tmp_path, monkeypatch):
    login(client)
    jid = upload(client).headers["Location"].rstrip("/").split("/")[-1]
    job_dir = tmp_path / "data" / jid

    import storage
    monkeypatch.setattr(storage, "TTL_HOURS", 0)
    assert storage.purge_expired() >= 1
    assert not job_dir.exists()
    assert client.get(f"/job/{jid}").status_code == 404


def test_purge_runs_on_every_request(client, tmp_path, monkeypatch):
    """Retention that depends on a cron nobody runs is a policy, not a control."""
    login(client)
    jid = upload(client).headers["Location"].rstrip("/").split("/")[-1]
    import storage
    monkeypatch.setattr(storage, "TTL_HOURS", 0)
    client.get("/")                      # any request at all
    assert not (tmp_path / "data" / jid).exists()


# ------------------------------------------------------------------ audit

def test_actions_are_audited(client, tmp_path):
    login(client)
    client.post("/login", data={"password": "nope"})
    jid = upload(client).headers["Location"].rstrip("/").split("/")[-1]
    client.get(f"/job/{jid}/report")
    client.post(f"/job/{jid}/delete")

    entries = [json.loads(l) for l in (tmp_path / "data" / "audit.log").read_text().splitlines()]
    actions = {e["action"] for e in entries}
    for expected in ("login", "login_failed", "upload", "analyzed",
                     "download_report", "delete"):
        assert expected in actions, f"{expected} not audited"


def test_audit_log_is_owner_only(client, tmp_path):
    login(client)
    assert oct((tmp_path / "data" / "audit.log").stat().st_mode)[-3:] == "600"
