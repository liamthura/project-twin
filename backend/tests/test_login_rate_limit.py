"""Sign-in rate limiting.

The property that matters most here is not the limit itself but that it
leaks nothing: an unknown username and a real one must be throttled
identically, or a 429 becomes confirmation that an account exists -- the
disclosure db.verify_password's timing mitigation exists to prevent.
"""
import pytest
from fastapi.testclient import TestClient

import db
import main


@pytest.fixture
def client():
    return TestClient(main.app)


def register(client, username="alice", password="correct-horse"):
    resp = client.post(
        "/api/auth/register", json={"username": username, "password": password}
    )
    assert resp.status_code == 200
    return resp.json()


def fail_login(client, username, times, password="wrong-password"):
    """Attempt sign-in `times` times, returning the final response."""
    resp = None
    for _ in range(times):
        resp = client.post(
            "/api/auth/login", json={"username": username, "password": password}
        )
    return resp


# --- the limit ---------------------------------------------------------------


def test_wrong_password_is_rejected_below_the_limit(client):
    register(client)
    resp = fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS - 1)
    assert resp.status_code == 401


def test_too_many_failures_are_throttled(client):
    register(client)
    resp = fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS + 1)
    assert resp.status_code == 429


def test_throttled_response_carries_retry_after(client):
    register(client)
    resp = fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS + 1)
    retry_after = int(resp.headers["retry-after"])
    assert 0 < retry_after <= db.LOGIN_WINDOW_MINUTES * 60


def test_correct_password_is_refused_once_throttled(client):
    """The limit gates on the username, not on whether this attempt is right --
    otherwise an attacker learns the password by being let through."""
    register(client)
    fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS + 1)
    resp = client.post(
        "/api/auth/login", json={"username": "alice", "password": "correct-horse"}
    )
    assert resp.status_code == 429


# --- no disclosure -----------------------------------------------------------


def test_unknown_username_is_throttled_identically(client):
    """A 429 must not distinguish a real account from a made-up one."""
    register(client, username="alice")

    real = fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS + 1)
    fake = fail_login(client, "nobody-here", db.MAX_LOGIN_ATTEMPTS + 1)

    assert real.status_code == fake.status_code == 429
    assert real.json() == fake.json()


def test_counters_are_independent_per_username(client):
    """One account being throttled must not lock out another."""
    register(client, username="alice")
    register(client, username="bob", password="bobs-password")

    fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS + 1)

    resp = client.post(
        "/api/auth/login", json={"username": "bob", "password": "bobs-password"}
    )
    assert resp.status_code == 200


# --- recovery ----------------------------------------------------------------


def test_success_clears_the_counter(client):
    """Someone who mistypes then gets it right must not stay throttled."""
    register(client)
    fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS - 1)

    ok = client.post(
        "/api/auth/login", json={"username": "alice", "password": "correct-horse"}
    )
    assert ok.status_code == 200

    # The budget is fresh: another near-limit run still is not throttled.
    resp = fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS - 1)
    assert resp.status_code == 401


def test_expired_window_starts_a_fresh_count(client):
    """Attempts older than the window must not count."""
    register(client)
    fail_login(client, "alice", db.MAX_LOGIN_ATTEMPTS)

    with db.get_pool().connection() as conn:
        conn.execute(
            "update login_attempts set window_start = now() - make_interval(mins => %s)",
            (db.LOGIN_WINDOW_MINUTES + 1,),
        )

    assert db.login_retry_after("alice") is None
    resp = client.post(
        "/api/auth/login", json={"username": "alice", "password": "correct-horse"}
    )
    assert resp.status_code == 200


def test_stale_rows_are_reaped(client):
    """Sprayed usernames must not accumulate rows for ever."""
    fail_login(client, "spray-target", 1)
    with db.get_pool().connection() as conn:
        conn.execute(
            "update login_attempts set window_start = now() - make_interval(mins => %s)",
            (db.LOGIN_WINDOW_MINUTES * 3,),
        )

    fail_login(client, "someone-else", 1)  # any write triggers the reap

    with db.get_pool().connection() as conn:
        remaining = conn.execute(
            "select username from login_attempts order by username"
        ).fetchall()
    assert [r["username"] for r in remaining] == ["someone-else"]
