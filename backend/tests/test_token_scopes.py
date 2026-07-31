from fastapi.testclient import TestClient

import db
import main
import scopes


def _client():
    return TestClient(main.app)


def test_new_tokens_carry_the_mg_prefix(as_user):
    user_id = db.current_user_id.get()
    _, token = db.create_token(user_id, "cli")
    assert token.startswith("mg_")


def test_new_tokens_default_to_every_scope(as_user):
    user_id = db.current_user_id.get()
    _, token = db.create_token(user_id, "cli")
    assert set(db.resolve_token(token)["scopes"]) == set(scopes.ALL_SCOPES)


def test_a_token_can_be_minted_read_only(as_user):
    user_id = db.current_user_id.get()
    _, token = db.create_token(user_id, "readonly", token_scopes=[scopes.READ])
    assert db.resolve_token(token)["scopes"] == [scopes.READ]


def test_read_is_the_floor_even_if_omitted(as_user):
    """A token with no scopes is not narrower, it is broken."""
    user_id = db.current_user_id.get()
    _, token = db.create_token(user_id, "empty", token_scopes=[])
    assert scopes.READ in db.resolve_token(token)["scopes"]


def test_unprefixed_legacy_tokens_still_resolve(as_user):
    """The whole migration rests on this: credentials we cannot reach keep working."""
    import secrets

    user_id = db.current_user_id.get()
    legacy = secrets.token_urlsafe(32)
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into tokens (user_id, token_hash, label) values (%s, %s, 'legacy')",
            (user_id, db.hash_token(legacy)),
        )

    resolved = db.resolve_token(legacy)
    assert resolved is not None
    assert set(resolved["scopes"]) == set(scopes.ALL_SCOPES)


def test_list_tokens_reports_scopes_but_never_the_hash(as_user):
    user_id = db.current_user_id.get()
    db.create_token(user_id, "cli", token_scopes=[scopes.READ])
    row = db.list_tokens(user_id)[-1]
    assert row["scopes"] == [scopes.READ]
    assert "token_hash" not in row


# ---------------------------------------------------------------------------
# The scope-forwarding chain, through the actual HTTP endpoint.
#
# Task 11's mint-a-token UI builds a scope array from three toggles and hands
# it to POST /api/auth/tokens. Everything above this line proves
# db.create_token(token_scopes=...) works in isolation -- these prove the
# request body it's called from actually reaches it unmodified (propose-only
# still gets the read floor added back) and that the FastAPI handler's
# ALL_SCOPES filter drops anything it doesn't recognise rather than storing
# it. A silent break anywhere in that chain would mint a full-scope token
# while the UI told the caller it minted a narrower one -- read the result
# back from storage (db.list_tokens) rather than trusting the response body,
# since the response would look identical either way.
# ---------------------------------------------------------------------------


def test_create_token_endpoint_stores_exactly_the_requested_scopes(as_user):
    uid = db.current_user_id.get()
    # A caller needs persona:write to reach this endpoint at all (it's
    # account management, not persona access -- see
    # test_scope_enforcement.py); a default, full-scope token has it.
    _, caller_token = db.create_token(uid, "caller")

    res = _client().post(
        "/api/auth/tokens",
        json={"label": "narrow", "scopes": [scopes.PROPOSE]},
        headers={"Authorization": f"Bearer {caller_token}"},
    )
    assert res.status_code == 200
    token_id = res.json()["id"]

    stored = next(r for r in db.list_tokens(uid) if r["id"] == token_id)
    # persona:read is the floor and is added back in even though the request
    # never asked for it -- db.create_token's contract, exercised here
    # through the endpoint rather than called directly.
    assert set(stored["scopes"]) == {scopes.READ, scopes.PROPOSE}
    assert scopes.WRITE not in stored["scopes"]


def test_create_token_endpoint_drops_an_unrecognised_scope(as_user):
    uid = db.current_user_id.get()
    _, caller_token = db.create_token(uid, "caller")

    res = _client().post(
        "/api/auth/tokens",
        json={"label": "garbage", "scopes": [scopes.READ, "persona:admin"]},
        headers={"Authorization": f"Bearer {caller_token}"},
    )
    assert res.status_code == 200
    token_id = res.json()["id"]

    stored = next(r for r in db.list_tokens(uid) if r["id"] == token_id)
    assert set(stored["scopes"]) == {scopes.READ}
    assert "persona:admin" not in stored["scopes"]
