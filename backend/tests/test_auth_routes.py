import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client():
    return TestClient(main.app)


def test_register_returns_a_token(client):
    resp = client.post("/api/auth/register", json={"username": "alice"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "alice"
    assert len(body["token"]) > 20


def test_register_rejects_duplicate_username(client):
    client.post("/api/auth/register", json={"username": "alice"})
    resp = client.post("/api/auth/register", json={"username": "alice"})
    assert resp.status_code == 409


def test_whoami_identifies_the_caller(client):
    token = client.post("/api/auth/register", json={"username": "alice"}).json()["token"]
    resp = client.get("/api/auth/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"


def test_whoami_rejects_missing_token(client):
    resp = client.get("/api/auth/whoami")
    assert resp.status_code == 401


def test_login_is_closed_when_sso_is_configured(client, monkeypatch):
    # The legacy endpoint is a SECOND password path: it verifies a bcrypt hash
    # in Python and mints an opaque token, reachable by curl whatever the SPA
    # renders. On an instance whose identity provider is Authentik, that is a
    # way around the gateway.
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    response = client.post(
        "/api/auth/login", json={"username": "someone", "password": "whatever"}
    )
    assert response.status_code == 403
    assert "single sign-on" in response.json()["detail"]


def test_register_is_closed_when_sso_is_configured(client, monkeypatch):
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    response = client.post(
        "/api/auth/register", json={"username": "someone", "password": "whatever123"}
    )
    assert response.status_code == 403


def test_login_is_refused_before_the_password_is_checked(client, monkeypatch):
    # The refusal must not double as an oracle: an unknown username and a real
    # one have to answer identically, and neither may cost a rate-limit slot.
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    import db

    calls = []
    monkeypatch.setattr(db, "verify_password", lambda *a: calls.append(a))
    monkeypatch.setattr(db, "login_retry_after", lambda *a: calls.append(a))

    client.post("/api/auth/login", json={"username": "someone", "password": "x"})
    assert calls == []


def test_both_endpoints_still_work_without_sso(client, monkeypatch):
    monkeypatch.delenv("AUTH_OIDC_DISCOVERY_URL", raising=False)
    response = client.post(
        "/api/auth/register", json={"username": "openinstance", "password": "hunter22"}
    )
    assert response.status_code == 200
