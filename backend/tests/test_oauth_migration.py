"""The OAuth tables and tokens.scopes, and the grandfathering that protects
credentials already sitting in other people's config files."""

import db


def _columns(table, schema="public"):
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select column_name from information_schema.columns"
            " where table_schema = %s and table_name = %s",
            (schema, table),
        ).fetchall()
    return {row["column_name"] for row in rows}


def test_oauth_tables_exist_in_the_better_auth_schema():
    for table in ("oauthClient", "oauthAccessToken", "oauthRefreshToken", "oauthConsent"):
        assert _columns(table, "better_auth"), f"{table} missing"


def test_tokens_has_a_scopes_column():
    assert "scopes" in _columns("tokens")


def test_existing_rows_grandfather_to_every_scope(as_user):
    """A token minted before this migration must keep working unchanged."""
    import scopes as scopes_module

    # `as_user` registers a throwaway user and binds db.current_user_id to it
    # (see conftest.py) but, matching every other test in this suite, yields
    # no value itself -- the id comes from the ContextVar it set.
    user_id = db.current_user_id.get()

    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into tokens (user_id, token_hash, label) values (%s, %s, 'legacy')",
            (user_id, "legacy-hash-for-grandfathering-test"),
        )
        row = conn.execute(
            "select scopes from tokens where token_hash = %s",
            ("legacy-hash-for-grandfathering-test",),
        ).fetchone()

    assert set(row["scopes"]) == set(scopes_module.ALL_SCOPES)


def test_migration_is_idempotent(rerun_migrations):
    """Replay every migration over a database that already has the data."""
    rerun_migrations()
    assert "scopes" in _columns("tokens")
