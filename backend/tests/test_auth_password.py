"""
Password sign-in + multi-token auth.

Covers: register w/ password -> login, wrong-password / passwordless-login
401 semantics, set-password (legacy vs normal vs wrong-current), token CRUD
(create/list/revoke, revoked token stops resolving, cross-user revoke 404),
and the startup migration that backfills tokens.token_hash from legacy
users.token_hash rows.
"""

import pytest
from fastapi.testclient import TestClient

import db
import main


@pytest.fixture
def client():
    return TestClient(main.app)


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Register + login
# ---------------------------------------------------------------------------


def test_register_with_password_then_login_succeeds(client):
    resp = client.post(
        "/api/auth/register", json={"username": "alice", "password": "correcthorse"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"user_id", "username", "token"}

    login = client.post(
        "/api/auth/login", json={"username": "alice", "password": "correcthorse"}
    )
    assert login.status_code == 200
    login_body = login.json()
    assert login_body["username"] == "alice"
    assert login_body["user_id"] == body["user_id"]
    assert len(login_body["token"]) > 20
    # login issues a fresh token, distinct from the register-time one
    assert login_body["token"] != body["token"]


def test_register_without_password_still_works(client):
    resp = client.post("/api/auth/register", json={"username": "bob"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "bob"
    assert len(body["token"]) > 20

    whoami = client.get("/api/auth/whoami", headers=auth_headers(body["token"]))
    assert whoami.status_code == 200
    assert whoami.json()["username"] == "bob"


def test_login_wrong_password_is_401(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "correcthorse"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "wrongpass"})
    assert resp.status_code == 401


def test_login_unknown_user_is_401_with_same_body_as_wrong_password(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "correcthorse"})
    wrong_password = client.post(
        "/api/auth/login", json={"username": "alice", "password": "wrongpass"}
    )
    unknown_user = client.post(
        "/api/auth/login", json={"username": "nobody", "password": "whatever"}
    )
    assert wrong_password.status_code == 401
    assert unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()


def test_login_on_passwordless_account_is_401_with_specific_detail(client):
    client.post("/api/auth/register", json={"username": "bob"})
    resp = client.post("/api/auth/login", json={"username": "bob", "password": "anything"})
    assert resp.status_code == 401
    assert "not set up" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# set-password
# ---------------------------------------------------------------------------


def test_set_password_on_legacy_account_without_current_password(client):
    reg = client.post("/api/auth/register", json={"username": "bob"}).json()
    resp = client.post(
        "/api/auth/set-password",
        json={"password": "newpassword1"},
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 200

    login = client.post("/api/auth/login", json={"username": "bob", "password": "newpassword1"})
    assert login.status_code == 200


def test_set_password_on_account_with_password_requires_current_password(client):
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "correcthorse"}
    ).json()
    resp = client.post(
        "/api/auth/set-password",
        json={"password": "newpassword1"},
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 403


def test_set_password_with_wrong_current_password_is_rejected(client):
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "correcthorse"}
    ).json()
    resp = client.post(
        "/api/auth/set-password",
        json={"password": "newpassword1", "current_password": "notright"},
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 403


def test_set_password_with_correct_current_password_succeeds(client):
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "correcthorse"}
    ).json()
    resp = client.post(
        "/api/auth/set-password",
        json={"password": "newpassword1", "current_password": "correcthorse"},
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 200

    old_login = client.post(
        "/api/auth/login", json={"username": "alice", "password": "correcthorse"}
    )
    assert old_login.status_code == 401
    new_login = client.post(
        "/api/auth/login", json={"username": "alice", "password": "newpassword1"}
    )
    assert new_login.status_code == 200


def test_set_password_rejects_too_short_password(client):
    reg = client.post("/api/auth/register", json={"username": "bob"}).json()
    resp = client.post(
        "/api/auth/set-password",
        json={"password": "short"},
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 400


def test_set_password_requires_auth(client):
    resp = client.post("/api/auth/set-password", json={"password": "newpassword1"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# bcrypt's 72-byte limit must never surface as a 500
# ---------------------------------------------------------------------------


def test_register_rejects_over_72_byte_password(client):
    resp = client.post(
        "/api/auth/register", json={"username": "alice", "password": "x" * 100}
    )
    assert resp.status_code == 400


def test_set_password_rejects_over_72_byte_password(client):
    reg = client.post("/api/auth/register", json={"username": "bob"}).json()
    resp = client.post(
        "/api/auth/set-password",
        json={"password": "x" * 100},
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 400


def test_login_with_over_72_byte_password_is_ordinary_401(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "correcthorse"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "x" * 100})
    assert resp.status_code == 401
    # same body as any other bad-credential failure (no oracle)
    wrong = client.post("/api/auth/login", json={"username": "alice", "password": "wrongpass"})
    assert resp.json() == wrong.json()


def test_set_password_with_over_72_byte_current_password_is_403_not_500(client):
    reg = client.post(
        "/api/auth/register", json={"username": "alice", "password": "correcthorse"}
    ).json()
    resp = client.post(
        "/api/auth/set-password",
        json={"password": "newpassword1", "current_password": "x" * 100},
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Token CRUD
# ---------------------------------------------------------------------------


def test_create_list_and_revoke_token(client):
    reg = client.post("/api/auth/register", json={"username": "alice"}).json()
    headers = auth_headers(reg["token"])

    create = client.post("/api/auth/tokens", json={"label": "mcp"}, headers=headers)
    assert create.status_code == 200
    created = create.json()
    assert created["label"] == "mcp"
    assert "id" in created
    assert len(created["token"]) > 20

    listing = client.get("/api/auth/tokens", headers=headers)
    assert listing.status_code == 200
    tokens = listing.json()["tokens"]
    labels = {t["label"] for t in tokens}
    # the register-time 'web' token plus the newly created 'mcp' token
    assert labels == {"web", "mcp"}
    for t in tokens:
        assert "token" not in t
        assert "token_hash" not in t
        assert set(t.keys()) >= {"id", "label", "created_at", "last_used_at"}

    # the new token authenticates
    whoami = client.get("/api/auth/whoami", headers=auth_headers(created["token"]))
    assert whoami.status_code == 200

    revoke = client.delete(f"/api/auth/tokens/{created['id']}", headers=headers)
    assert revoke.status_code == 200

    whoami_after_revoke = client.get(
        "/api/auth/whoami", headers=auth_headers(created["token"])
    )
    assert whoami_after_revoke.status_code == 401


def test_cannot_revoke_another_users_token(client):
    alice = client.post("/api/auth/register", json={"username": "alice"}).json()
    bob = client.post("/api/auth/register", json={"username": "bob"}).json()

    alice_token = client.post(
        "/api/auth/tokens", json={"label": "mcp"}, headers=auth_headers(alice["token"])
    ).json()

    resp = client.delete(
        f"/api/auth/tokens/{alice_token['id']}", headers=auth_headers(bob["token"])
    )
    assert resp.status_code == 404

    # alice's token is untouched
    whoami = client.get("/api/auth/whoami", headers=auth_headers(alice_token["token"]))
    assert whoami.status_code == 200


def test_revoke_nonexistent_token_is_404(client):
    reg = client.post("/api/auth/register", json={"username": "alice"}).json()
    resp = client.delete(
        "/api/auth/tokens/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(reg["token"]),
    )
    assert resp.status_code == 404


def test_revoke_malformed_token_id_is_404(client):
    reg = client.post("/api/auth/register", json={"username": "alice"}).json()
    resp = client.delete("/api/auth/tokens/not-a-uuid", headers=auth_headers(reg["token"]))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Startup migration: legacy users.token_hash rows get backfilled into tokens
# ---------------------------------------------------------------------------


def test_ensure_schema_backfills_legacy_token_hash_into_tokens_table():
    plaintext = "legacy-plaintext-token-value"
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into users (username, token_hash) values (%s, %s)",
            ("legacyuser", db.hash_token(plaintext)),
        )

    db.ensure_schema()

    user = db.resolve_token(plaintext)
    assert user is not None
    assert user["username"] == "legacyuser"


def test_revoked_token_does_not_resurrect_after_ensure_schema(client):
    """users.token_hash must be cleared by the migration: otherwise revoking
    a migrated/initial token and restarting re-inserts it as 'legacy'."""
    reg = client.post("/api/auth/register", json={"username": "alice"}).json()
    headers = auth_headers(reg["token"])

    tokens = client.get("/api/auth/tokens", headers=headers).json()["tokens"]
    assert len(tokens) == 1  # the initial 'web' token
    revoke = client.delete(f"/api/auth/tokens/{tokens[0]['id']}", headers=headers)
    assert revoke.status_code == 200

    db.ensure_schema()  # simulates a server restart re-running the migration

    resp = client.get("/api/auth/whoami", headers=headers)
    assert resp.status_code == 401
    assert db.resolve_token(reg["token"]) is None


def test_migration_clears_users_token_hash():
    plaintext = "legacy-plaintext-token-value-3"
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into users (username, token_hash) values (%s, %s)",
            ("legacyuser3", db.hash_token(plaintext)),
        )

    db.ensure_schema()

    assert db.resolve_token(plaintext) is not None  # migrated into tokens
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select token_hash from users where username = 'legacyuser3'"
        ).fetchone()
    assert row["token_hash"] is None  # and cleared at the source


def test_ensure_schema_migration_is_idempotent():
    plaintext = "legacy-plaintext-token-value-2"
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into users (username, token_hash) values (%s, %s)",
            ("legacyuser2", db.hash_token(plaintext)),
        )

    db.ensure_schema()
    db.ensure_schema()
    db.ensure_schema()

    with db.get_pool().connection() as conn:
        count = conn.execute(
            "select count(*) as n from tokens where token_hash = %s",
            (db.hash_token(plaintext),),
        ).fetchone()["n"]
    assert count == 1
