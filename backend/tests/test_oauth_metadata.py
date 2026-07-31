"""Discovery is the first thing an MCP client does and the first thing that can
silently fail. These pin the four documents and, above all, that they are
reachable -- the MCP app is mounted at "/" and swallows anything registered
after it."""

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_MCP_RESOURCE", "https://mygist.example/mcp")
    monkeypatch.setenv("AUTH_ISSUER", "https://mygist.example/auth")
    import importlib

    import jwt_auth
    import main
    import oauth_metadata

    importlib.reload(jwt_auth)
    importlib.reload(oauth_metadata)
    importlib.reload(main)
    return TestClient(main.app)


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
