"""What is connected, and what it has done: the rules behind GET /api/watchtower."""
import pytest
from fastapi.testclient import TestClient

import db
import main
import mcp_activity
import watchtower

ROW = {"client": "claude-code 2.0.14", "method": "initialize", "tool": None,
       "calls": 1, "first_seen": "2026-10-01T10:00:00+00:00", "last_seen": "2026-10-01T10:00:00+00:00"}


def call(tool, last="2026-10-01T10:05:00+00:00"):
    return {**ROW, "method": "tools/call", "tool": tool, "last_seen": last}


@pytest.mark.nodb
def test_nothing_connected_is_none_whatever_the_activity_says():
    # Activity rows outlive a revoked token, so they alone are not a connection.
    assert watchtower.connection([], [], [ROW]) == {
        "state": "none", "name": None, "kind": None, "can_propose": False, "total": 0}


@pytest.mark.nodb
def test_a_token_is_waiting_until_a_call_is_seen():
    token = {"label": "my assistant", "scopes": ["persona:propose"], "last_used_at": None}
    assert watchtower.connection([], [token], [])["state"] == "waiting"
    assert watchtower.connection([], [token], [ROW])["state"] == "connected"
    # last_used_at moves on any REST call with the token too, so it is not
    # evidence that an assistant called. Only MCP activity is.
    used = {**token, "last_used_at": "2026-09-01T00:00:00+00:00"}
    assert watchtower.connection([], [used], [])["state"] == "waiting"


@pytest.mark.nodb
def test_a_grant_is_named_and_says_what_it_may_do():
    grant = {"name": "Claude Code", "scopes": ["persona:read", "persona:propose"]}
    assert watchtower.connection([grant], [], [ROW]) == {
        "state": "connected", "name": "Claude Code", "kind": "grant", "can_propose": True, "total": 1}
    reader = {"name": "Reader", "scopes": ["persona:read"]}
    assert watchtower.connection([reader], [], [ROW])["can_propose"] is False


@pytest.mark.nodb
def test_a_nameless_grant_falls_back():
    nameless = {"name": None, "scopes": ["persona:propose"]}
    assert watchtower.connection([nameless], [], [ROW])["name"] == "claude-code"
    token = {"label": "laptop", "scopes": [], "last_used_at": None}
    assert watchtower.connection([nameless], [token], [ROW])["name"] == "laptop"
    assert watchtower.connection([nameless], [], [])["name"] is None


@pytest.mark.nodb
def test_summary_reads_what_the_assistant_did():
    assert watchtower.summary([]) == {"called": False, "read": False, "suggested": False, "last_seen": None}
    s = watchtower.summary([ROW, call("get_context"), call("propose_update", "2026-10-01T10:09:00+00:00")])
    assert s == {"called": True, "read": True, "suggested": True, "last_seen": "2026-10-01T10:09:00+00:00"}
    assert watchtower.summary([ROW, call("whoami")])["read"] is False


def _better_auth_user(conn, user_id):
    handle = f"u-{user_id[:8]}"
    conn.execute(
        'insert into better_auth."user" ("id", "name", "email", "emailVerified", "username", "displayUsername")'
        " values (%s, 'u', %s, false, %s, %s)",
        (user_id, f"{handle}@example.test", handle, handle),
    )


def test_list_grants_reads_consents_with_their_client_name(as_user):
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        _better_auth_user(conn, user_id)
        conn.execute('insert into better_auth."oauthClient" ("id", "clientId", "name", "redirectUris")'
                     " values ('c1', 'cid-1', 'Claude Code', '[]')")
        conn.execute('insert into better_auth."oauthConsent"'
                     ' ("id", "clientId", "userId", "scopes", "createdAt", "updatedAt")'
                     """ values ('k1', 'cid-1', %s, '["persona:read", "persona:propose"]', now(), now())""",
                     (user_id,))
    [grant] = db.list_grants(user_id)
    assert grant["name"] == "Claude Code"
    assert grant["scopes"] == ["persona:read", "persona:propose"]


def test_the_endpoint_and_its_old_name(clean_database):
    client = TestClient(main.app)
    token = client.post("/api/auth/register", json={"username": "watch-test"}).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    body = client.get("/api/watchtower", headers=auth).json()
    # Registering mints a token and talks REST, not MCP, so nothing has called.
    assert body["connection"]["state"] == "waiting"
    assert body["assistant"]["called"] is False
    assert body["pending"] == {"entity": 0, "note": 0, "total": 0}
    db.current_user_id.set(client.get("/api/auth/whoami", headers=auth).json()["user_id"])
    mcp_activity.record("claude-code 2.0.14", "tools/call", "get_context")
    body = client.get("/api/watchtower", headers=auth).json()
    assert body["connection"]["state"] == "connected"
    assert body["assistant"]["read"] is True
    assert client.get("/api/usage", headers=auth).json()["connection"] == body["connection"]


@pytest.mark.nodb
def test_since_counts_only_what_happened_after_it():
    # Onboarding asks about the assistant being connected now, not one that
    # called last week: the screen passes the latest call it had already seen.
    old = call("get_context", "2026-09-01T10:00:00+00:00")
    new = call("propose_update", "2026-10-01T10:09:00+00:00")
    after = watchtower.after([old, new], "2026-09-01T10:00:00+00:00")
    assert after == [new]
    assert watchtower.summary(after)["read"] is False
    assert watchtower.after([old, new], None) == [old, new]


def test_the_endpoint_takes_since(clean_database):
    client = TestClient(main.app)
    token = client.post("/api/auth/register", json={"username": "watch-since"}).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    db.current_user_id.set(client.get("/api/auth/whoami", headers=auth).json()["user_id"])
    mcp_activity.record("cursor 1.0", "tools/call", "get_context")
    seen = client.get("/api/watchtower", headers=auth).json()["assistant"]["last_seen"]
    body = client.get("/api/watchtower", headers=auth, params={"since": seen}).json()
    assert body["assistant"]["called"] is False
    assert body["connection"]["state"] == "connected"  # the account is still connected
