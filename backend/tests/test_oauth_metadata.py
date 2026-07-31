"""Discovery is the first thing an MCP client does and the first thing that can
silently fail. These pin the four documents and, above all, that they are
reachable -- the MCP app is mounted at "/" and swallows anything registered
after it."""

import os

import pytest
from fastapi.testclient import TestClient


def _reloaded_app():
    import importlib

    import jwt_auth
    import main
    import oauth_metadata

    importlib.reload(jwt_auth)
    importlib.reload(oauth_metadata)
    importlib.reload(main)
    return main.app


@pytest.fixture
def reload_modules(monkeypatch):
    """Hand back `_reloaded_app`, and put the modules back afterwards.

    These tests can only be written with a reload: jwt_auth freezes
    AUTH_MCP_RESOURCE and friends into module globals at import, and
    oauth_metadata.register() decides once, while main is executing, whether
    the discovery routes exist at all. Setting the environment later changes
    nothing.

    The catch is that a reload does not unwind. monkeypatch restores
    os.environ; it knows nothing about the module state a reload built from it.
    Left alone, jwt_auth.MCP_RESOURCE stays set and main.app stays a different
    object for the remainder of the session -- so
    test_scope_enforcement.py's
    test_unauthenticated_mcp_without_oauth_configured_gets_a_plain_401, which
    asserts this deployment has no OAuth configured, fails for every run in
    which it happens to come after this file. It passed alone and failed in the
    full suite, which is the worst way for this to show up.

    So the environment is undone first and the modules are then rebuilt from
    it, in that order -- reloading before the undo would just refreeze the
    patched values. Requesting `monkeypatch` here rather than in each consumer
    is what puts this teardown last: fixtures unwind in reverse setup order,
    and everything below depends on this one.
    """
    yield _reloaded_app
    monkeypatch.undo()  # the environment first...
    _reloaded_app()  # ...then the modules that were frozen from it


@pytest.fixture
def client(monkeypatch, reload_modules):
    monkeypatch.setenv("AUTH_MCP_RESOURCE", "https://mygist.example/mcp")
    monkeypatch.setenv("AUTH_ISSUER", "https://mygist.example/auth")
    # Both halves, because both are needed to verify a token -- see
    # jwt_auth.mcp_resource_configured(), which is what gates these routes.
    monkeypatch.setenv("AUTH_JWKS_URL", "https://mygist.example/auth/jwks")
    return TestClient(reload_modules())


def test_protected_resource_metadata_names_the_resource_and_its_server(client):
    body = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert body["resource"] == "https://mygist.example/mcp"
    assert body["authorization_servers"] == ["https://mygist.example/auth"]


def test_all_three_scopes_are_advertised(client):
    body = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert body["scopes_supported"] == [
        "persona:read",
        "persona:propose",
        "persona:write",
    ]


def test_offline_access_is_not_advertised(client):
    """The spec: refresh tokens are not a resource requirement."""
    body = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert "offline_access" not in body["scopes_supported"]


def test_the_bare_path_serves_the_same_document(client):
    """Clients that fail to parse WWW-Authenticate fall back to this."""
    assert (
        client.get("/.well-known/oauth-protected-resource").json()
        == client.get("/.well-known/oauth-protected-resource/mcp").json()
    )


def test_metadata_needs_no_credential(client):
    """Discovery happens before the client has any token at all."""
    assert client.get("/.well-known/oauth-protected-resource/mcp").status_code == 200


def test_half_configured_mounts_nothing(monkeypatch, reload_modules):
    """AUTH_MCP_RESOURCE set, AUTH_JWKS_URL not: no key, so no token this
    instance can ever verify.

    Advertising discovery here would walk a client all the way through
    registration and consent to a /mcp that rejects the token it just earned --
    a longer, more confusing failure than the 404 it gets instead."""
    monkeypatch.setenv("AUTH_MCP_RESOURCE", "https://mygist.example/mcp")
    monkeypatch.setenv("AUTH_ISSUER", "https://mygist.example/auth")
    monkeypatch.delenv("AUTH_JWKS_URL", raising=False)

    res = TestClient(reload_modules()).get("/.well-known/oauth-protected-resource/mcp")
    assert res.status_code == 404


def test_reloading_main_does_not_stack_scope_middleware(reload_modules):
    """`mcp` lives in server.py and is NOT reloaded when main is, so main's
    module body runs `add_middleware` again over the same long-lived server.

    That is a plain list append. Every reload this file performs was leaving
    another ScopeMiddleware behind, and they never went away -- by the end of a
    full-suite run the one server was filtering each tool listing half a dozen
    times. Counted by class name rather than isinstance because a reload of
    mcp_scopes would make the old instances fail an identity check while still
    being just as stacked."""
    from server import mcp

    reload_modules()
    reload_modules()

    stacked = [type(m).__name__ for m in mcp.middleware]
    assert stacked.count("ScopeMiddleware") == 1, stacked
