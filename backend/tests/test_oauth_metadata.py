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
def client(monkeypatch):
    monkeypatch.setenv("AUTH_MCP_RESOURCE", "https://mygist.example/mcp")
    monkeypatch.setenv("AUTH_ISSUER", "https://mygist.example/auth")
    # Both halves, because both are needed to verify a token -- see
    # jwt_auth.mcp_resource_configured(), which is what gates these routes.
    monkeypatch.setenv("AUTH_JWKS_URL", "https://mygist.example/auth/jwks")
    return TestClient(_reloaded_app())


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


def test_half_configured_mounts_nothing(monkeypatch):
    """AUTH_MCP_RESOURCE set, AUTH_JWKS_URL not: no key, so no token this
    instance can ever verify.

    Advertising discovery here would walk a client all the way through
    registration and consent to a /mcp that rejects the token it just earned --
    a longer, more confusing failure than the 404 it gets instead. Restored to
    the fully-configured state afterwards, since these modules are reloaded
    into the shared process."""
    monkeypatch.setenv("AUTH_MCP_RESOURCE", "https://mygist.example/mcp")
    monkeypatch.setenv("AUTH_ISSUER", "https://mygist.example/auth")
    monkeypatch.delenv("AUTH_JWKS_URL", raising=False)

    res = TestClient(_reloaded_app()).get("/.well-known/oauth-protected-resource/mcp")
    assert res.status_code == 404

    # Put the modules back. monkeypatch restores the environment but not the
    # module state a reload froze from it, and leaving jwt_auth de-configured
    # would silently change what every later test in this process sees.
    monkeypatch.setenv("AUTH_JWKS_URL", "https://mygist.example/auth/jwks")
    _reloaded_app()
