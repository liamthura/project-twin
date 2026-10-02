"""Deleting an account: only the person, in a browser, and all of it.

The two refusals matter as much as the deletion. A token or a connected app
holding persona:write must not be able to end the account it writes to, and a
username typed wrong must leave everything where it was.
"""

from fastapi.testclient import TestClient

import db
import main
from tests.test_scope_enforcement import _oauth_token, _session_token, jwt_configured  # noqa: F401

# Every table that holds a row for a user, and the column that says whose.
USER_TABLES = {
    "users": "id",
    "persona_data": "user_id",
    "persona_history": "user_id",
    "persona_proposals": "user_id",
    "persona_provenance": "user_id",
    "persona_search": "user_id",
    "feedback": "user_id",
    "mcp_activity": "user_id",
    "tokens": "user_id",
}
AUTH_TABLES = {"user": "id", "session": "userId", "account": "userId"}


def _client():
    return TestClient(main.app)


def _account(username):
    """A user with a persona, a proposal, a token, a Better Auth user, session
    and credential, a waitlist entry and a failed-login count."""
    user_id, token = db.create_user(username, "correcthorse1")
    with db.get_pool().connection() as conn:
        conn.execute(
            """
            insert into better_auth."user"
                ("id", "name", "email", "emailVerified", "username", "displayUsername")
            values (%s, %s, %s, false, %s, %s)
            """,
            (user_id, username, f"{username}@mygist.invalid", username, username),
        )
        conn.execute(
            """
            insert into better_auth."session" ("id", "expiresAt", "token", "updatedAt", "userId")
            values (%s, now() + interval '1 day', %s, now(), %s)
            """,
            (f"s-{username}", f"t-{username}", user_id),
        )
        conn.execute(
            "insert into waitlist (email) values (%s)", (f"{username.upper()}@mygist.invalid",)
        )
        conn.execute(
            "insert into login_attempts (username, attempt_count) values (%s, 1)", (username,)
        )
        conn.execute(
            """
            insert into persona_proposals (user_id, kind, note, rationale, proposed_by, fingerprint)
            values (%s, 'note', 'Reads everything aloud.', 'Said so.', 'Claude', %s)
            """,
            (user_id, f"fp-{username}"),
        )
        conn.execute(
            "insert into feedback (user_id, kind, message) values (%s, 'problem', 'it broke')",
            (user_id,),
        )
    # The credential row, as a Better Auth password writes it.
    db.set_password(user_id, "correcthorse2", "correcthorse1", via_session=True)
    headers = {"Authorization": f"Bearer {token}"}
    # Twice, so the first version is kept in history.
    for name in (username, username.title()):
        res = _client().put(
            "/api/files/profile", json={"data": {"basic_info": {"name": name}}}, headers=headers
        )
        assert res.status_code == 200, res.text
    return user_id, token


def _rows(user_id):
    with db.get_pool().connection() as conn:
        counts = {
            table: conn.execute(
                f"select count(*) as n from {table} where {column} = %s", (user_id,)
            ).fetchone()["n"]
            for table, column in USER_TABLES.items()
        }
        counts.update({
            f"better_auth.{table}": conn.execute(
                f'select count(*) as n from better_auth."{table}" where "{column}" = %s',
                (str(user_id),),
            ).fetchone()["n"]
            for table, column in AUTH_TABLES.items()
        })
    return counts


def _loose_ends(username):
    with db.get_pool().connection() as conn:
        waitlist = conn.execute(
            "select count(*) as n from waitlist where lower(email) = lower(%s)",
            (f"{username}@mygist.invalid",),
        ).fetchone()["n"]
        attempts = conn.execute(
            "select count(*) as n from login_attempts where username = %s", (username,)
        ).fetchone()["n"]
    return waitlist, attempts


def _delete(credential, confirm):
    return _client().post(
        "/api/account/delete",
        json={"confirm": confirm},
        headers={"Authorization": f"Bearer {credential}"},
    )


def test_a_token_cannot_delete_the_account_it_writes_to(jwt_configured):
    user_id, token = _account("maya")
    before = _rows(user_id)

    res = _delete(token, "maya")

    assert res.status_code == 403
    assert "browser" in res.json()["detail"]
    assert _rows(user_id) == before


def test_a_connected_app_cannot_delete_the_account(jwt_configured):
    user_id, _ = _account("maya")
    before = _rows(user_id)

    res = _delete(_oauth_token(user_id), "maya")

    assert res.status_code in (401, 403)
    assert _rows(user_id) == before


def test_a_username_typed_wrong_deletes_nothing(jwt_configured):
    user_id, _ = _account("maya")
    before = _rows(user_id)

    for typed in ("Maya", "maya ", "someone"):
        res = _delete(_session_token(user_id), typed)
        assert res.status_code == 400
    assert _rows(user_id) == before


def test_deleting_removes_every_row_the_account_owns_and_nobody_elses(jwt_configured):
    user_id, _ = _account("maya")
    other_id, other_token = _account("sam")
    others_before = _rows(other_id)
    session = _session_token(user_id)
    # Something to delete in every table the fixture reaches, or "all zero"
    # afterwards would prove nothing.
    seeded = _rows(user_id)
    for table in ("users", "persona_data", "persona_history", "persona_proposals", "tokens",
                  "better_auth.user", "better_auth.session", "better_auth.account"):
        assert seeded[table] > 0, table
    assert _loose_ends("maya") == (1, 1)

    res = _delete(session, "maya")

    assert res.status_code == 200
    assert all(n == 0 for n in _rows(user_id).values()), _rows(user_id)
    assert _loose_ends("maya") == (0, 0)
    # The same sign-in is turned away at once: the API never recreates a user
    # it cannot find.
    assert _client().get(
        "/api/files", headers={"Authorization": f"Bearer {session}"}
    ).status_code == 401
    assert _rows(other_id) == others_before
    assert _loose_ends("sam") == (1, 1)
    assert _client().get(
        "/api/files/profile", headers={"Authorization": f"Bearer {other_token}"}
    ).json()["data"]["basic_info"]["name"] == "Sam"
