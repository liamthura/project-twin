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

    landing = tmp_path / "landing"
    landing.mkdir()
    (landing / "edge-strip-light.webp").write_bytes(b"RIFF____WEBP")

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


def test_both_health_paths_are_public_and_agree(client):
    """/health and /api/health must answer identically.

    Nothing covered bare /health, which is how a second `@app.get("/health")`
    survived above the real handler: FastAPI keeps the first route it matches,
    so /health returned {"status": "ok"} while /api/health returned that plus
    "service". Both Dockerfiles probe /health, so the stub was the one
    orchestration saw. Asserting the bodies match is what makes a duplicate
    registration fail here instead of shipping.
    """
    bare = client.get("/health")
    prefixed = client.get("/api/health")

    assert bare.status_code == 200
    assert prefixed.status_code == 200
    assert bare.json() == prefixed.json()
    assert bare.json() == {"status": "ok", "service": "mygist"}


def test_no_route_is_registered_twice(client):
    """A path bound to two handlers is always a bug, and a silent one.

    The second registration is unreachable, so the behaviour you get is
    whichever decorator ran first -- which is source order, not intent.
    """
    from collections import Counter

    import main

    seen = Counter(
        (route.path, method)
        for route in main.app.routes
        for method in getattr(route, "methods", None) or ()
    )
    duplicates = [pair for pair, n in seen.items() if n > 1]
    assert not duplicates, f"these path/method pairs are registered twice: {duplicates}"


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


def test_bare_docs_path_redirects_to_the_index(static_app):
    """`/docs` without the trailing slash must reach the docs, not a 404.

    A mount at "/docs" serves everything UNDER /docs/ and does not match the
    bare path, so it fell through to the MCP mount at "/" and 404'd. Easy to
    miss, because StaticFiles issues its own redirect for sub-directories
    (/docs/use -> /docs/use/) -- only the mount root was affected.

    It is also the form every human types and every link in the README uses,
    so this is the common case, not an edge one.
    """
    resp = TestClient(static_app).get("/docs", follow_redirects=False)
    assert resp.status_code == 308
    assert resp.headers["location"] == "/docs/"


def test_bare_docs_path_follows_through_to_content(static_app):
    resp = TestClient(static_app).get("/docs")
    assert resp.status_code == 200
    assert "Docs" in resp.text


def test_docs_mount_is_optional(tmp_path):
    """Phase 1 ships without docs-site/; /docs simply is not mounted."""
    (tmp_path / "index.html").write_text("<!doctype html>")
    app = _bare_app()
    assert main.register_static_routes(app, tmp_path) is True
    assert not any(getattr(r, "path", "") == "/docs" for r in app.routes)


# --- marketing-page artwork -------------------------------------------------
#
# These 404'd in a built image while working perfectly under `vite dev`, which
# serves the whole of public/ and so hides a missing route entirely. The bug is
# only reachable through the container, which is why it is pinned here.


def test_landing_artwork_is_served(static_app):
    client = TestClient(static_app)
    resp = client.get("/landing/edge-strip-light.webp")
    assert resp.status_code == 200
    assert resp.content == b"RIFF____WEBP"


def test_landing_artwork_is_typed_as_an_image(static_app):
    """Python 3.11's mimetypes has no .webp and the runtime image carries no
    /etc/mime.types, so StaticFiles typed these `text/plain`. Combined with the
    X-Content-Type-Options: nosniff this app sends, a browser then refuses to
    render them -- invisible artwork behind a 200, with nothing in any log."""
    resp = TestClient(static_app).get("/landing/edge-strip-light.webp")
    assert resp.headers["content-type"] == "image/webp"


def test_landing_artwork_is_revalidated_not_immutable(static_app):
    """Stable filenames, unlike the content-hashed /assets. Marking them
    immutable would pin a gradient that had since been regenerated."""
    resp = TestClient(static_app).get("/landing/edge-strip-light.webp")
    assert "immutable" not in resp.headers.get("cache-control", "")
    assert resp.headers.get("etag")


def test_a_missing_landing_file_404s_rather_than_serving_the_spa(static_app):
    """The SPA shell is returned for app routes, not for a missing asset --
    an <img> that silently receives HTML is a broken image with a 200."""
    resp = TestClient(static_app).get("/landing/not-here.webp")
    assert resp.status_code == 404


def test_registration_survives_a_build_without_the_landing_folder(tmp_path):
    """An older build, or a frontend that has dropped the folder. The mount is
    conditional, so this must not throw at import time."""
    (tmp_path / "index.html").write_text("<!doctype html>")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    (tmp_path / "logo.svg").write_text("<svg/>")

    app = _bare_app()
    assert main.register_static_routes(app, tmp_path) is True
    assert TestClient(app).get("/landing/edge-strip-light.webp").status_code == 404
