import os

import psycopg
import pytest

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://mygist:mygist@localhost:5433/mygist_test"
)


@pytest.fixture(autouse=True)
def clean_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import db as db_module

    if db_module._pool is not None:
        db_module._pool.close()  # release the prior test's pool threads
    db_module._pool = None  # force a fresh pool bound to the test database

    conn = psycopg.connect(TEST_DATABASE_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("drop table if exists persona_data;")
        cur.execute("drop table if exists users;")
    conn.close()

    db_module.ensure_schema()
    yield

    if db_module._pool is not None:
        db_module._pool.close()  # close this test's pool so no threads linger
        db_module._pool = None
