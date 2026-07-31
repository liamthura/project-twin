"""What a credential may do, as opposed to who it is.

The escalation test is the one that matters: a read-only token that can mint a
full-scope token is not a read-only token."""

import db
import scopes
from fastapi.testclient import TestClient


def _client():
    import main

    return TestClient(main.app)


def test_a_read_only_token_can_read(as_user):
    _, token = db.create_token(
        db.current_user_id.get(), "ro", token_scopes=[scopes.READ]
    )
    res = _client().get("/api/files", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


def test_a_read_only_token_cannot_write(as_user):
    _, token = db.create_token(
        db.current_user_id.get(), "ro", token_scopes=[scopes.READ]
    )
    res = _client().put(
        "/api/settings",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_a_read_only_token_cannot_mint_a_token(as_user):
    """The escalation hole. Without this, scoping is decorative."""
    _, token = db.create_token(
        db.current_user_id.get(), "ro", token_scopes=[scopes.READ]
    )
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "escalated"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_a_full_token_can_still_mint_a_token(as_user):
    """Detached mode and pre-Better-Auth accounts both depend on this."""
    _, token = db.create_token(db.current_user_id.get(), "full")
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "second"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200


def test_unauthenticated_mcp_gets_a_challenge_naming_the_metadata(as_user):
    res = _client().post("/mcp", json={})
    assert res.status_code == 401
    challenge = res.headers["www-authenticate"]
    assert "resource_metadata=" in challenge
    assert "persona:read" in challenge


def test_unauthenticated_api_gets_no_challenge_header(as_user):
    """The SPA's fetch path has always seen a plain 401 here; leave it alone."""
    res = _client().get("/api/files")
    assert res.status_code == 401
    assert "www-authenticate" not in {k.lower() for k in res.headers}
