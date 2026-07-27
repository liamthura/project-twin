"""Token expiry.

A leaked token used to stay valid until someone noticed and revoked it.
Sign-in now mints a session that ages out, while machine credentials keep
working indefinitely -- an MCP client configured once must not stop on a
timer, and the README tells people to paste the registration token into
Claude Desktop.
"""
import pytest
from fastapi.testclient import TestClient

import db
import main


@pytest.fixture
def client():
    return TestClient(main.app)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def expire(token_plaintext, days_ago=1):
    """Backdate a token's expiry so it is already past."""
    with db.get_pool().connection() as conn:
        conn.execute(
            "update tokens set expires_at = now() - make_interval(days => %s)"
            " where token_hash = %s",
            (days_ago, db.hash_token(token_plaintext)),
        )


# --- what expires, and what does not -----------------------------------------


def test_sign_in_token_carries_an_expiry(client):
    client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    )
    token = client.post(
        "/api/auth/login", json={"username": "alice", "password": "a-good-password"}
    ).json()["token"]

    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select expires_at from tokens where token_hash = %s",
            (db.hash_token(token),),
        ).fetchone()
    assert row["expires_at"] is not None


def test_registration_token_never_expires(client):
    """The README points people at this token for Claude Desktop; a clock on
    it would break MCP clients a month after setup."""
    token = client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    ).json()["token"]

    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select expires_at from tokens where token_hash = %s",
            (db.hash_token(token),),
        ).fetchone()
    assert row["expires_at"] is None


def test_explicitly_created_tokens_never_expire(client):
    """Account -> API tokens issues machine credentials."""
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    ).json()
    created = client.post(
        "/api/auth/tokens", json={"label": "claude-desktop"}, headers=auth(reg["token"])
    ).json()

    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select expires_at from tokens where token_hash = %s",
            (db.hash_token(created["token"]),),
        ).fetchone()
    assert row["expires_at"] is None


# --- enforcement --------------------------------------------------------------


def test_expired_token_is_rejected(client):
    client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    )
    token = client.post(
        "/api/auth/login", json={"username": "alice", "password": "a-good-password"}
    ).json()["token"]

    assert client.get("/api/auth/whoami", headers=auth(token)).status_code == 200
    expire(token)
    assert client.get("/api/auth/whoami", headers=auth(token)).status_code == 401


def test_expired_token_does_not_resolve(client):
    client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    )
    token = client.post(
        "/api/auth/login", json={"username": "alice", "password": "a-good-password"}
    ).json()["token"]

    expire(token)
    assert db.resolve_token(token) is None


def test_expiring_one_token_leaves_others_working(client):
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    ).json()
    session = client.post(
        "/api/auth/login", json={"username": "alice", "password": "a-good-password"}
    ).json()["token"]

    expire(session)

    assert client.get("/api/auth/whoami", headers=auth(session)).status_code == 401
    assert client.get("/api/auth/whoami", headers=auth(reg["token"])).status_code == 200


def test_a_token_expiring_in_future_still_works(client):
    """Guard against an off-by-one that would treat any expiry as expired."""
    client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    )
    token = client.post(
        "/api/auth/login", json={"username": "alice", "password": "a-good-password"}
    ).json()["token"]

    assert db.resolve_token(token) is not None


# --- migration safety ---------------------------------------------------------


def test_pre_existing_tokens_keep_working(client):
    """0002 adds a nullable column, so every token minted before the deploy
    keeps NULL and nobody is signed out by shipping this."""
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    ).json()

    with db.get_pool().connection() as conn:
        conn.execute("update tokens set expires_at = null")

    assert client.get("/api/auth/whoami", headers=auth(reg["token"])).status_code == 200


def test_token_list_exposes_expiry(client):
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "a-good-password"}
    ).json()
    client.post(
        "/api/auth/login", json={"username": "alice", "password": "a-good-password"}
    )

    tokens = client.get("/api/auth/tokens", headers=auth(reg["token"])).json()["tokens"]
    by_label = {t["label"]: t for t in tokens}
    assert by_label["web"]["expires_at"] is not None  # the session
    assert len(tokens) == 2
