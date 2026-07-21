import pytest

import db


def test_create_user_returns_id_and_token():
    user_id, token = db.create_user("alice")
    assert user_id
    assert len(token) > 20


def test_create_user_rejects_duplicate_username():
    db.create_user("alice")
    with pytest.raises(db.DuplicateUsernameError):
        db.create_user("alice")


def test_resolve_token_finds_matching_user():
    user_id, token = db.create_user("alice")
    user = db.resolve_token(token)
    assert user is not None
    assert user["id"] == user_id
    assert user["username"] == "alice"


def test_resolve_token_rejects_unknown_token():
    assert db.resolve_token("not-a-real-token") is None


def test_resolve_token_rejects_wrong_token_for_real_user():
    db.create_user("alice")
    assert db.resolve_token("some-other-token") is None


def test_persona_search_table_exists():
    import db

    with db.get_pool().connection() as conn:
        cols = {
            r["column_name"]
            for r in conn.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'persona_search'"
            ).fetchall()
        }
    assert {"user_id", "file_type", "entity_id", "title", "text",
            "tsv", "content_hash", "updated_at"} <= cols
    assert db.VECTOR_AVAILABLE is True  # test-db image ships pgvector
    assert "embedding" in cols


def test_persona_search_rows_cascade_on_user_delete():
    import db

    with db.get_pool().connection() as conn:
        row = conn.execute(
            "insert into users (username) values ('cascade_u') returning id"
        ).fetchone()
        conn.execute(
            "insert into persona_search (user_id, file_type, entity_id, title, text, content_hash)"
            " values (%s, 'projects', 'project_x', 't', 'hello world', 'h')",
            (row["id"],),
        )
        conn.execute("delete from persona_search where user_id = %s", (row["id"],))
        conn.execute("delete from users where id = %s", (row["id"],))
