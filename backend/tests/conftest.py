import os

import psycopg
import pytest

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://mygist:mygist@localhost:5433/mygist_test"
)

# Set before any test module runs `import main`, which touches the database at
# import time and would otherwise KeyError on a missing DATABASE_URL.
os.environ.setdefault("DATABASE_URL", TEST_DATABASE_URL)


@pytest.fixture(autouse=True)
def clean_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    # Tests must never see a real embedding provider: scripts/ modules call
    # load_dotenv() at import (pytest collection), which can leak a real
    # VOYAGE_API_KEY from backend/.env into os.environ — turning unpatched
    # tests into live API callers and clogging the shared embed executor
    # with slow network tasks (observed as order-dependent hybrid-search
    # failures). Providers are always injected via monkeypatch in tests.
    for var in ("VOYAGE_API_KEY", "EMBEDDING_API_URL", "EMBEDDING_API_KEY"):
        monkeypatch.delenv(var, raising=False)

    import db as db_module

    if db_module._pool is not None:
        db_module._pool.close()  # release the prior test's pool threads
    db_module._pool = None  # force a fresh pool bound to the test database

    conn = psycopg.connect(TEST_DATABASE_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("drop table if exists persona_proposals;")  # references users
        cur.execute("drop table if exists persona_search;")  # references users
        cur.execute("drop table if exists tokens;")  # references users
        cur.execute("drop table if exists persona_data;")
        cur.execute("drop table if exists login_attempts;")  # keyed by username, no FK
        cur.execute("drop table if exists users;")
        # Alembic's bookkeeping must go with the tables it describes. Left
        # behind, it would report the (now empty) database as already at head
        # and run_migrations() would rebuild nothing.
        cur.execute("drop table if exists alembic_version;")
    conn.close()

    db_module.run_migrations()
    db_module.ensure_vector_schema()
    yield

    if db_module._pool is not None:
        db_module._pool.close()  # close this test's pool so no threads linger
        db_module._pool = None


@pytest.fixture
def rerun_migrations():
    """Replay every migration against the database as it currently stands.

    Stamps back to base and upgrades again, so the real migration code runs
    over data that already exists. That is exactly the assumption the baseline
    revision is built on -- every statement idempotent, safe against the live
    production database -- so exercising it here keeps that honest.
    """
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    def _rerun():
        here = Path(__file__).resolve().parent.parent
        cfg = Config(str(here / "alembic.ini"))
        cfg.set_main_option("script_location", str(here / "migrations"))
        command.stamp(cfg, "base")
        command.upgrade(cfg, "head")

    return _rerun


@pytest.fixture
def as_user():
    """Register a throwaway user and bind current_user_id to it for the test."""
    import db

    with db.get_pool().connection() as conn:
        row = conn.execute(
            "insert into users (username, token_hash) values ('u1', 'x') returning id"
        ).fetchone()
    token = db.current_user_id.set(str(row["id"]))
    yield
    db.current_user_id.reset(token)
