"""Alembic wiring.

Schema now arrives from migrations/ rather than from application code. These
tests pin the split: what migrations own, what stays runtime, and that the
baseline can be replayed against a populated database -- the assumption that
lets it run against production without a manual `alembic stamp`.
"""
import db


def _tables():
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select table_name from information_schema.tables"
            " where table_schema = 'public'"
        ).fetchall()
    return {r["table_name"] for r in rows}


def test_migrations_created_every_table():
    assert {
        "users",
        "persona_data",
        "tokens",
        "login_attempts",
        "persona_search",
    } <= _tables()


def test_alembic_version_is_recorded_at_head():
    """Derives head from the script directory rather than naming a revision:
    hardcoding it means every new migration breaks this test for no reason."""
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    here = Path(db.__file__).resolve().parent
    cfg = Config(str(here / "alembic.ini"))
    cfg.set_main_option("script_location", str(here / "migrations"))
    head = ScriptDirectory.from_config(cfg).get_current_head()

    with db.get_pool().connection() as conn:
        rows = conn.execute("select version_num from alembic_version").fetchall()
    assert [r["version_num"] for r in rows] == [head]


def test_running_migrations_again_is_a_no_op():
    """The deploy step runs on every start; an up-to-date database must be
    left alone rather than re-executing the baseline."""
    before = _tables()
    db.run_migrations()
    assert _tables() == before


def test_baseline_replays_safely_over_existing_data(rerun_migrations):
    """The baseline is written with IF NOT EXISTS throughout so it is a no-op
    against the production database, which already has every object. If that
    ever stops being true, this fails rather than the live deploy."""
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into users (username, password_hash) values (%s, %s)",
            ("survivor", db.hash_password("some-password")),
        )

    rerun_migrations()

    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select username from users where username = 'survivor'"
        ).fetchone()
    assert row is not None


# --- the runtime/migration boundary ------------------------------------------


def test_persona_search_comes_from_migrations_without_the_embedding_column(fresh_schema):
    """Tables, columns and indexes that do not vary by deployment belong to
    migrations; the embedding column does not, because its width comes from
    EMBEDDING_DIM and pgvector may be absent.

    Takes `fresh_schema` because it deliberately leaves persona_search without
    its embedding column: row-level cleanup cannot put a dropped column back,
    so the next test needs a rebuilt schema rather than a wiped one.
    """
    with db.get_pool().connection() as conn:
        conn.execute("drop table if exists persona_search;")
        conn.execute("delete from alembic_version;")

    db.run_migrations()

    with db.get_pool().connection() as conn:
        cols = {
            r["column_name"]
            for r in conn.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'persona_search'"
            ).fetchall()
        }
    assert "tsv" in cols  # migration owns this
    assert "embedding" not in cols  # ensure_vector_schema owns this


def test_vector_schema_adds_the_embedding_column_when_available():
    if not db.VECTOR_AVAILABLE:
        import pytest

        pytest.skip("pgvector unavailable in this environment")

    with db.get_pool().connection() as conn:
        cols = {
            r["column_name"]
            for r in conn.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'persona_search'"
            ).fetchall()
        }
    assert "embedding" in cols
