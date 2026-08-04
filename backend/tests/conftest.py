import os

import psycopg
import pytest

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://mygist:mygist@localhost:5433/mygist_test"
)

# Set before any test module runs `import main`, which touches the database at
# import time and would otherwise KeyError on a missing DATABASE_URL.
os.environ.setdefault("DATABASE_URL", TEST_DATABASE_URL)


# --------------------------------------------------------------------------
# Why this file is shaped the way it is.
#
# clean_database used to drop every table and replay all six migrations for
# EVERY test. That is ~0.54s of DDL against 800 tests -- seven minutes of the
# suite spent rebuilding a schema that almost nothing modifies, and it showed
# up as `setup` filling the whole of `pytest --durations`.
#
# The schema is now built once per session and each test only clears the ROWS,
# which measures at ~7ms. TRUNCATE is not the tool for that job: it takes an
# ACCESS EXCLUSIVE lock and fsyncs a file per table, costing 0.30s where the
# equivalent DELETE costs 0.007s. On tables that are empty or hold a handful
# of fixture rows, DELETE wins by two orders of magnitude.
#
# The isolation guarantee is unchanged for every test that only writes rows.
# Tests that change the SCHEMA are the exception, and they mark it dirty (see
# _mark_schema_dirty) so the next test gets a genuinely rebuilt database.
# --------------------------------------------------------------------------

_schema_state = {"built": False, "delete_order": [], "vector_available": None}


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "nodb: test reads no database rows -- skips the per-test wipe. Purely "
        "an optimisation: forgetting it costs milliseconds, it never makes a "
        "test wrong.",
    )


def _connect():
    conn = psycopg.connect(TEST_DATABASE_URL)
    conn.autocommit = True
    return conn


def _drop_everything(conn):
    """Remove every object the migrations own, so they rebuild from nothing.

    Discovered from the catalogue rather than listed by hand: the old hardcoded
    list had fallen behind the migrations and never dropped `invite_codes`
    (0005), so that table -- and any rows in it -- silently survived what
    claimed to be a clean database. The oauth tables (0006) escaped the same
    fate only by living in the better_auth schema, which is dropped wholesale.
    """
    with conn.cursor() as cur:
        # Better Auth's tables live in their own schema (migration 0003), so a
        # public-only sweep leaves them behind and rows collide on the unique
        # username.
        cur.execute("drop schema if exists better_auth cascade;")
        cur.execute(
            "select string_agg(format('%I.%I', schemaname, tablename), ', ')"
            " from pg_tables where schemaname = 'public'"
        )
        tables = cur.fetchone()[0]
        if tables:
            # This sweeps up alembic_version too, which is required: left
            # behind, it would report the (now empty) database as already at
            # head and run_migrations() would rebuild nothing.
            cur.execute(f"drop table if exists {tables} cascade;")


def _delete_order(conn):
    """Tables ordered children-first, so plain DELETEs never trip a foreign key.

    Computed once per session. The shortcut -- disabling triggers with
    `session_replication_role` -- needs superuser, which happens to be true of
    the CI image but is not something the suite should quietly depend on.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select format('%I.%I', schemaname, tablename)"
            " from pg_tables"
            " where schemaname in ('public', 'better_auth')"
            "   and tablename <> 'alembic_version'"
        )
        tables = [r[0] for r in cur.fetchall()]

        cur.execute(
            "select format('%I.%I', cn.nspname, c.relname),"
            "       format('%I.%I', pn.nspname, p.relname)"
            " from pg_constraint con"
            " join pg_class c on c.oid = con.conrelid"
            " join pg_namespace cn on cn.oid = c.relnamespace"
            " join pg_class p on p.oid = con.confrelid"
            " join pg_namespace pn on pn.oid = p.relnamespace"
            " where con.contype = 'f'"
        )
        parents = {t: set() for t in tables}
        for child, parent in cur.fetchall():
            if child in parents and parent in parents and child != parent:
                parents[child].add(parent)

    # Topological sort: schedule a table only once everything it references is
    # already scheduled, then reverse so children are deleted before parents.
    ordered, remaining = [], dict(parents)
    while remaining:
        free = sorted(t for t, deps in remaining.items() if not deps & remaining.keys())
        if not free:  # circular FKs -- fall back to name order for what is left
            free = sorted(remaining)
        ordered.extend(free)
        for table in free:
            del remaining[table]
    ordered.reverse()
    return ordered


def _build_schema():
    import db as db_module

    # The wipe connection prepares its DELETEs after a few repeats (psycopg's
    # prepare_threshold), and those plans name table OIDs that are about to
    # stop existing. Drop the connection with the schema rather than find out.
    stale = _schema_state.get("wipe_conn")
    if stale is not None and not stale.closed:
        stale.close()
    _schema_state["wipe_conn"] = None

    conn = _connect()
    try:
        _drop_everything(conn)
    finally:
        conn.close()

    db_module.run_migrations()
    # Not a migration: the embedding column's width comes from EMBEDDING_DIM and
    # pgvector may be absent entirely. It is also the only thing that sets
    # db.VECTOR_AVAILABLE, which is why a test that degrades that flag has to
    # mark the schema dirty rather than leave it false for everything after it.
    db_module.ensure_vector_schema()

    conn = _connect()
    try:
        _schema_state["delete_order"] = _delete_order(conn)
    finally:
        conn.close()
    _schema_state["vector_available"] = db_module.VECTOR_AVAILABLE
    _schema_state["built"] = True


def _wipe_conn():
    """One long-lived autocommit connection, reused for every wipe.

    Reconnecting per test costs more than the DELETEs themselves once the
    schema rebuild is gone -- at ~900 tests a few milliseconds of handshake is
    most of what is left. Deliberately not the application pool: cleanup must
    not depend on, or disturb, whatever state a test left the pool in.
    """
    conn = _schema_state.get("wipe_conn")
    if conn is None or conn.closed:
        conn = _connect()
        _schema_state["wipe_conn"] = conn
    return conn


def _wipe_rows():
    with _wipe_conn().cursor() as cur:
        for table in _schema_state["delete_order"]:
            cur.execute(f"delete from {table};")


def _mark_schema_dirty():
    """Force a full rebuild before the next test.

    For tests that alter the schema itself rather than its contents -- dropping
    a table, replaying migrations over existing data, or leaving
    db.VECTOR_AVAILABLE flipped. Row-level cleanup undoes none of those.
    """
    _schema_state["built"] = False


@pytest.fixture(scope="session", autouse=True)
def _database():
    """Owns the schema, and the connection pool, for the whole session."""
    _build_schema()
    yield
    import db as db_module

    if db_module._pool is not None:
        db_module._pool.close()  # no pool threads left running at exit
        db_module._pool = None
    conn = _schema_state.get("wipe_conn")
    if conn is not None and not conn.closed:
        conn.close()
    _schema_state["wipe_conn"] = None


@pytest.fixture(autouse=True)
def clean_database(request, monkeypatch, _database):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    # Tests must never see a real embedding provider: scripts/ modules call
    # load_dotenv() at import (pytest collection), which can leak a real
    # VOYAGE_API_KEY from backend/.env into os.environ — turning unpatched
    # tests into live API callers and clogging the shared embed executor
    # with slow network tasks (observed as order-dependent hybrid-search
    # failures). Providers are always injected via monkeypatch in tests.
    for var in ("VOYAGE_API_KEY", "EMBEDDING_API_URL", "EMBEDDING_API_KEY"):
        monkeypatch.delenv(var, raising=False)

    if not _schema_state["built"]:
        # The previous test rewrote the schema. Rebuild it, and drop the pool
        # with it so nothing holds a connection to objects that no longer exist.
        import db as db_module

        if db_module._pool is not None:
            db_module._pool.close()
            db_module._pool = None
        _build_schema()
    elif not request.node.get_closest_marker("nodb"):
        _wipe_rows()

    # db.VECTOR_AVAILABLE is a module global, and two tests deliberately drive
    # it to False (a simulated HNSW failure, and a build with pgvector absent).
    # The old fixture reset it for free by calling ensure_vector_schema() every
    # time; restoring it here keeps that guarantee without the DDL. Left to
    # leak, it silently downgrades every later hybrid-search test to FTS-only.
    import db as db_module

    db_module.VECTOR_AVAILABLE = _schema_state["vector_available"]

    yield


@pytest.fixture
def rerun_migrations():
    """Replay every migration against the database as it currently stands.

    Stamps back to base and upgrades again, so the real migration code runs
    over data that already exists. That is exactly the assumption the baseline
    revision is built on -- every statement idempotent, safe against the live
    production database -- so exercising it here keeps that honest.

    Anything asking for this is by definition rewriting the schema, so the
    schema is marked dirty and the next test starts from a genuine rebuild.
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

    yield _rerun
    _mark_schema_dirty()


@pytest.fixture
def fresh_schema():
    """Opt in to a genuinely rebuilt schema after this test.

    For a test that issues its own DDL without going through
    `rerun_migrations`. Row cleanup cannot undo a dropped column.
    """
    yield
    _mark_schema_dirty()


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
