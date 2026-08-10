import pytest
from fastapi.testclient import TestClient

import main
import waitlist_store


@pytest.fixture
def client():
    return TestClient(main.app)


def test_anyone_can_join_without_a_credential(client):
    """The whole point: the person asking has no account yet. If this ever
    needs auth, only existing users can join a waitlist."""
    resp = client.post("/api/waitlist", json={"email": "maya@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert waitlist_store.pending_count() == 1


def test_joining_twice_is_not_an_error_and_takes_one_slot(client):
    client.post("/api/waitlist", json={"email": "maya@example.com"})
    resp = client.post("/api/waitlist", json={"email": "maya@example.com"})

    assert resp.status_code == 200
    assert waitlist_store.pending_count() == 1


def test_the_response_does_not_reveal_whether_an_address_is_known(client):
    """Otherwise the form is a membership oracle: type an address, read the
    answer, learn whether that person signed up."""
    first = client.post("/api/waitlist", json={"email": "maya@example.com"})
    second = client.post("/api/waitlist", json={"email": "maya@example.com"})

    assert first.status_code == second.status_code
    assert first.json() == second.json()


def test_case_and_padding_do_not_buy_a_second_slot(client):
    client.post("/api/waitlist", json={"email": "maya@example.com"})
    client.post("/api/waitlist", json={"email": "  MAYA@Example.COM  "})

    assert waitlist_store.pending_count() == 1


@pytest.mark.parametrize(
    "email",
    ["", "   ", "not-an-email", "@example.com", "maya@", "maya@example",
     "maya @example.com", "a" * 250 + "@example.com"],
)
def test_malformed_addresses_are_rejected(client, email):
    resp = client.post("/api/waitlist", json={"email": email})
    assert resp.status_code == 422
    assert waitlist_store.pending_count() == 0


@pytest.mark.parametrize(
    "email",
    ["maya@example.com", "maya.ellis+mygist@example.co.uk", "m@a.io"],
)
def test_deliverable_addresses_are_accepted(client, email):
    """Loose on purpose. A strict grammar rejects addresses that genuinely
    deliver, and the cost of accepting a bad one is a single bounced invite."""
    assert client.post("/api/waitlist", json={"email": email}).status_code == 200


def test_a_missing_body_is_a_422_not_a_500(client):
    assert client.post("/api/waitlist", json={}).status_code == 422


def test_joining_does_not_create_an_account(client):
    """A waitlist entry is not admission. That still runs through invite_codes,
    and nothing here should shortcut it."""
    client.post("/api/waitlist", json={"email": "maya@example.com"})

    resp = client.get("/api/auth/whoami", headers={"Authorization": "Bearer maya@example.com"})
    assert resp.status_code == 401
