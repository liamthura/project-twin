"""Security headers.

The CSP is only worth having if script-src stays hash-based: 'unsafe-inline'
would permit exactly the injection the policy exists to stop. These tests pin
that, and that the hashes are derived from the HTML actually served rather
than hardcoded -- a stale hash would block the theme script while the page
still rendered, which is a silent regression.
"""
import base64
import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def built_static(tmp_path):
    """A static tree with an inline script, as the real build produces."""
    (tmp_path / "index.html").write_text(
        "<!doctype html><html><head>"
        "<script>document.documentElement.classList.add('dark')</script>"
        '<script type="module" src="/assets/index-ABC.js"></script>'
        "</head><body></body></html>"
    )
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.html").write_text(
        "<!doctype html><html><body><script>console.log('docs')</script></body></html>"
    )
    return tmp_path


# --- baseline headers on every response --------------------------------------


def test_baseline_headers_on_api_responses(client):
    resp = client.get("/api/health")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert resp.headers["x-frame-options"] == "DENY"


def test_headers_reach_short_circuited_401s(client):
    """The auth middleware returns its own response without calling through,
    so the header middleware has to be outermost to see it."""
    resp = client.get("/api/files")
    assert resp.status_code == 401
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_csp_is_not_sent_on_json(client):
    """CSP governs documents; on an API response it is noise."""
    resp = client.get("/api/health")
    assert "content-security-policy" not in resp.headers


# --- the policy itself --------------------------------------------------------


def test_script_src_has_no_unsafe_inline(built_static):
    csp = main._build_csp(built_static)
    directives = dict(
        d.strip().split(" ", 1) for d in csp.split(";") if " " in d.strip()
    )
    assert "'unsafe-inline'" not in directives["script-src"]
    assert "'unsafe-inline'" not in directives.get("default-src", "")


def test_inline_scripts_are_hashed_from_the_served_html(built_static):
    """Hashes come from the HTML on disk, so editing the theme script cannot
    silently leave a stale hash behind."""
    body = "document.documentElement.classList.add('dark')"
    expected = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    assert f"'sha256-{expected}'" in main._build_csp(built_static)


def test_docs_pages_are_scanned_too(built_static):
    """The docs site ships its own inline scripts; missing them would break
    those pages once Phase 2 lands."""
    body = "console.log('docs')"
    expected = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    assert f"'sha256-{expected}'" in main._build_csp(built_static)


def test_scripts_with_src_are_not_hashed(built_static):
    """Only inline bodies need hashing; 'self' already covers /assets."""
    assert len(main._inline_script_hashes(built_static)) == 2


def test_connect_src_allows_other_hosts(built_static):
    """The connection settings let this UI point at a different MyGist server,
    so connect-src 'self' would break the self-hosted preset."""
    csp = main._build_csp(built_static)
    assert "connect-src 'self' https:" in csp


def test_fonts_and_frames(built_static):
    csp = main._build_csp(built_static)
    assert "https://fonts.gstatic.com" in csp
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp


def test_missing_static_dir_yields_a_policy_without_hashes(tmp_path):
    """Backend-only development has no build; the policy must still be valid."""
    csp = main._build_csp(tmp_path / "nope")
    assert "script-src 'self'" in csp
    assert "sha256-" not in csp


# --- applied to real documents ------------------------------------------------


def test_csp_is_sent_on_html(built_static, monkeypatch):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    monkeypatch.setattr(main, "CONTENT_SECURITY_POLICY", main._build_csp(built_static))
    app.middleware("http")(main.security_headers)
    main.register_static_routes(app, built_static)

    resp = TestClient(app).get("/")
    assert resp.status_code == 200
    assert "sha256-" in resp.headers["content-security-policy"]
