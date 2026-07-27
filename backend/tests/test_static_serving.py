"""Static asset serving, and the route-ordering it depends on.

The SPA, the docs site, the REST API and the MCP endpoint all share one
origin now. main.py registers concrete static routes *before* mounting the
MCP app at "/", because a mount at "/" matches everything. These tests pin
that ordering, the cache headers, and the /docs -> /api/docs move that
serving documentation at /docs forced.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def static_app(tmp_path):
    """A throwaway app with static routes registered over a fake build.

    Mirrors what the Dockerfile produces: index.html, hashed assets, icons,
    and an exported docs site.
    """
    (tmp_path / "index.html").write_text("<!doctype html><title>MyGist</title>")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    (tmp_path / "logo.svg").write_text("<svg/>")

    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index-ABC123.js").write_text("console.log(1)")

    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.html").write_text("<!doctype html><title>Docs</title>")

    app = _bare_app()
    mounted = main.register_static_routes(app, tmp_path)
    assert mounted is True
    return app


def _bare_app() -> FastAPI:
    """A FastAPI with its built-in docs routes disabled.

    A default FastAPI() already registers /docs, /redoc and /openapi.json,
    which would mask what these tests are asserting about static mounts.
    """
    return FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


# --- the app still does what it did before ---------------------------------


def test_mcp_endpoint_still_resolves(client):
    """Regression guard on the root mount: /mcp must not 404 or redirect.

    It is mounted at "/" precisely so that "/mcp" resolves exactly, with no
    307 to "/mcp/". Adding static routes must not disturb that.
    """
    resp = client.post("/mcp", headers={"Authorization": "Bearer nope"})
    assert resp.status_code != 404
    assert resp.status_code not in (307, 308)


def test_api_health_is_public(client):
    assert client.get("/api/health").status_code == 200


def test_api_routes_still_require_a_token(client):
    assert client.get("/api/files").status_code == 401


# --- the Swagger UI moved out of the way of the docs site -------------------


def test_openapi_schema_moved_under_api(client):
    resp = client.get("/api/openapi.json")
    assert resp.status_code == 200
    assert resp.json()["info"]["title"] == "MyGist API"


def test_interactive_docs_moved_under_api(client):
    assert client.get("/api/docs").status_code == 200


def test_root_openapi_path_is_gone(client):
    """/openapi.json must not be served: /docs belongs to the docs site now,
    and leaving the schema at the root would be a second surface to keep in
    step."""
    assert client.get("/openapi.json").status_code != 200


# --- static serving ---------------------------------------------------------


def test_no_static_routes_without_a_build(tmp_path):
    """A source checkout has no backend/static; the app must still boot and
    simply not register these routes."""
    app = _bare_app()
    assert main.register_static_routes(app, tmp_path / "does-not-exist") is False
    assert [r.path for r in app.routes] == []


def test_index_is_served_at_root(static_app):
    resp = TestClient(static_app).get("/")
    assert resp.status_code == 200
    assert "MyGist" in resp.text


def test_index_is_not_cached(static_app):
    """The shell names the content-hashed asset files, so caching it would
    pin clients to a stale build."""
    resp = TestClient(static_app).get("/")
    assert resp.headers["cache-control"] == "no-cache"


def test_hashed_assets_are_immutable(static_app):
    resp = TestClient(static_app).get("/assets/index-ABC123.js")
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_icons_are_served(static_app):
    client = TestClient(static_app)
    assert client.get("/favicon.svg").status_code == 200
    assert client.get("/logo.svg").status_code == 200


def test_docs_site_is_served(static_app):
    resp = TestClient(static_app).get("/docs/")
    assert resp.status_code == 200
    assert "Docs" in resp.text


def test_docs_mount_is_optional(tmp_path):
    """Phase 1 ships without docs-site/; /docs simply is not mounted."""
    (tmp_path / "index.html").write_text("<!doctype html>")
    app = _bare_app()
    assert main.register_static_routes(app, tmp_path) is True
    assert not any(getattr(r, "path", "") == "/docs" for r in app.routes)
