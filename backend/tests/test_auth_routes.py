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
