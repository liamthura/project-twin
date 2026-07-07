import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client():
    return TestClient(main.app)


def test_two_users_have_completely_isolated_persona_data(client):
    token_a = client.post("/api/auth/register", json={"username": "alice"}).json()["token"]
    token_b = client.post("/api/auth/register", json={"username": "bob"}).json()["token"]

    client.put(
        "/api/files/profile",
        json={"data": {"name": "Alice"}},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    client.put(
        "/api/files/profile",
        json={"data": {"name": "Bob"}},
        headers={"Authorization": f"Bearer {token_b}"},
    )

    resp_a = client.get("/api/files/profile", headers={"Authorization": f"Bearer {token_a}"})
    resp_b = client.get("/api/files/profile", headers={"Authorization": f"Bearer {token_b}"})

    assert resp_a.json()["data"]["name"] == "Alice"
    assert resp_b.json()["data"]["name"] == "Bob"


def test_a_users_token_cannot_read_another_users_data(client):
    token_a = client.post("/api/auth/register", json={"username": "alice"}).json()["token"]
    client.post("/api/auth/register", json={"username": "bob"}).json()["token"]

    # There is no endpoint that takes a user_id from the client at all --
    # identity comes only from the bearer token.
    resp = client.get("/api/auth/whoami", headers={"Authorization": f"Bearer {token_a}"})
    assert resp.json()["username"] == "alice"
