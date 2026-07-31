import db
import scopes


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
