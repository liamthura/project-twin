"""
Postgres connection, user registry, and auth primitives.

Auth model: humans sign in with username + password (bcrypt-hashed);
machines authenticate with named, revocable bearer tokens (`tokens` table,
sha256-hashed -- high-entropy secrets, no need for a slow hash). A token's
plaintext is returned exactly once at creation.
"""

import hashlib
import logging
import os
import secrets
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import Optional

import bcrypt
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

import scopes

logger = logging.getLogger(__name__)

_pool: Optional[ConnectionPool] = None

VECTOR_AVAILABLE: bool = False


def _parse_dim(env) -> int:
    """int(EMBEDDING_DIM) with a safe default. docker-compose substitutes an
    unset passthrough var as "" (not absent), which crashes a plain
    `int(env.get(..., "1024"))` -- `or` catches both missing and empty."""
    return int(env.get("EMBEDDING_DIM") or "1024")


EMBEDDING_DIM: int = _parse_dim(os.environ)

# Set once per request by main.py's auth middleware; read by persona_store.py
# (and, transitively, by server.py's MCP tools) to scope data to the caller.
current_user_id: ContextVar[str] = ContextVar("current_user_id")

# The MCP client behind this request, as it named itself on initialize. Set by
# mcp_activity's middleware, which already computes the label for its counters.
# Empty for web-UI writes and scripts, which is the honest answer -- they are
# not a client and should not be attributed to one.
current_client: ContextVar[str] = ContextVar("current_client", default="")

# What the last persona_store.save() did: {"added": [entity_id],
# "changed": {entity_id: {field: previous_value}}}.
#
# A contextvar rather than a return value because the two things that need it
# sit two layers above the only place that can compute it. server.py's tools
# want "what did this update overwrite" for the advisory, and main.py's promote
# route wants the id an add just assigned -- and save() is the single point
# holding both the previous blob and the incoming one. Threading it back
# through execute_modify would mean changing the return type of thirty entity
# branches to carry something twenty-nine of them ignore.
last_write: ContextVar[dict] = ContextVar("last_write", default={})


class DuplicateUsernameError(Exception):
    pass


class PasswordNotSetError(Exception):
    """Login attempted on an account that has no password_hash."""


class InvalidCredentialsError(Exception):
    """current_password missing or wrong when changing an existing password."""


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        dsn = os.environ["DATABASE_URL"]
        _pool = ConnectionPool(dsn, min_size=1, max_size=10, kwargs={"row_factory": dict_row})
    return _pool


def run_migrations() -> None:
    """Apply pending Alembic migrations.

    Used by the test suite and handy in local development. Production runs
    `alembic upgrade head` as a deploy step (see the Dockerfile) rather than
    calling this at import: schema changes should not race application
    startup, and two containers booting together should not both issue DDL.
    """
    from alembic import command
    from alembic.config import Config

    here = Path(__file__).parent
    cfg = Config(str(here / "alembic.ini"))
    cfg.set_main_option("script_location", str(here / "migrations"))
    command.upgrade(cfg, "head")


def ensure_vector_schema() -> None:
    """Schema that cannot be a migration, applied at startup.

    The embedding column's width comes from EMBEDDING_DIM, and pgvector may be
    missing entirely -- neither fits a static, versioned migration, and both
    must degrade to FTS-only rather than fail. Everything that does not vary
    by deployment lives in migrations/ instead.

    Runs in its own connection and swallows psycopg.Error so that an HNSW
    build failure (old pgvector, or an unusual server build) leaves the
    service running in FTS-only mode instead of crashing startup.
    """
    global VECTOR_AVAILABLE
    with get_pool().connection() as conn:
        try:
            VECTOR_AVAILABLE = _apply_vector_ddl(conn)
        except psycopg.Error as exc:
            conn.rollback()
            VECTOR_AVAILABLE = False
            logger.warning("vector DDL failed, running FTS-only: %s", exc)


def _try_create_vector_extension(conn) -> bool:
    """True if pgvector is usable. Never raises — a self-hosted vanilla
    Postgres without the extension runs in FTS-only mode (spec)."""
    try:
        conn.execute("create extension if not exists vector;")
        return True
    except psycopg.Error:
        conn.rollback()
        return False


def _apply_vector_ddl(conn) -> bool:
    """Adds persona_search.embedding + its HNSW index if pgvector is usable
    at the configured EMBEDDING_DIM. Returns whether vector search is now
    available. May raise psycopg.Error (e.g. an HNSW build failure); the
    caller catches it and degrades to FTS-only rather than losing the
    persona_search table."""
    if not _try_create_vector_extension(conn):
        return False
    conn.execute(
        f"alter table persona_search add column if not exists embedding vector({EMBEDDING_DIM});"
    )
    # Existing column at a different dim? FTS-only until backfill --recreate.
    row = conn.execute("""
        select atttypmod as dim from pg_attribute
        where attrelid = 'persona_search'::regclass and attname = 'embedding'
    """).fetchone()
    if row and row["dim"] not in (-1, EMBEDDING_DIM):
        print(
            f"WARNING: persona_search.embedding is vector({row['dim']}) but "
            f"EMBEDDING_DIM={EMBEDDING_DIM}. Running FTS-only. To fix: "
            "python scripts/backfill_search_index.py --recreate"
        )
        return False
    conn.execute(
        "create index if not exists persona_search_embedding_idx"
        " on persona_search using hnsw (embedding vector_cosine_ops);"
    )
    return True


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# bcrypt truncates/rejects passwords over 72 bytes (raises in bcrypt >= 4.1).
MAX_PASSWORD_BYTES = 72

# Precomputed hash so bad-credential paths (unknown user, no password set,
# oversized password) still cost one bcrypt op: latency must not reveal
# whether a username exists.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-timing", bcrypt.gensalt())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def check_password(password: str, password_hash: str) -> bool:
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > MAX_PASSWORD_BYTES:
        return False  # can never be a stored password; bcrypt would raise
    return bcrypt.checkpw(password_bytes, password_hash.encode("utf-8"))


# --- login rate limiting ----------------------------------------------------
# Counted in Postgres rather than in-process so the limit survives a restart
# and holds across containers -- a per-process dict resets on every deploy,
# which is exactly when an attacker benefits.
MAX_LOGIN_ATTEMPTS = 10
LOGIN_WINDOW_MINUTES = 15

# How long a browser session token stays valid. Only sign-in mints these:
# the token handed out at registration, and any token created explicitly from
# Account -> API tokens, are machine credentials and never expire. The README
# tells people to paste the registration token into Claude Desktop, so putting
# a clock on it would break MCP clients a month after setup.
SESSION_TOKEN_DAYS = 30


def login_retry_after(username: str) -> Optional[int]:
    """Seconds until `username` may attempt sign-in again, or None if allowed.

    Called before credentials are checked, and deliberately keyed on the
    submitted string whether or not that account exists. Limiting only real
    accounts would turn a 429 into confirmation that a username is valid --
    the same disclosure verify_password's timing mitigation exists to avoid.
    """
    with get_pool().connection() as conn:
        row = conn.execute(
            """
            select attempt_count,
                   ceil(extract(epoch from (
                       window_start + make_interval(mins => %s) - now()
                   )))::int as retry_after
            from login_attempts
            where username = %s
              and window_start > now() - make_interval(mins => %s)
            """,
            (LOGIN_WINDOW_MINUTES, username, LOGIN_WINDOW_MINUTES),
        ).fetchone()
    if row and row["attempt_count"] >= MAX_LOGIN_ATTEMPTS:
        return max(1, row["retry_after"])
    return None


def record_failed_login(username: str) -> None:
    """Count one failed attempt, starting a fresh window if the last has expired."""
    with get_pool().connection() as conn:
        conn.execute(
            """
            insert into login_attempts (username, attempt_count, window_start)
            values (%s, 1, now())
            on conflict (username) do update set
                attempt_count = case
                    when login_attempts.window_start
                         > now() - make_interval(mins => %s)
                    then login_attempts.attempt_count + 1
                    else 1
                end,
                window_start = case
                    when login_attempts.window_start
                         > now() - make_interval(mins => %s)
                    then login_attempts.window_start
                    else now()
                end
            """,
            (username, LOGIN_WINDOW_MINUTES, LOGIN_WINDOW_MINUTES),
        )
        # Keep the table from growing without bound on sprayed usernames.
        conn.execute(
            "delete from login_attempts where window_start < now() - make_interval(mins => %s)",
            (LOGIN_WINDOW_MINUTES * 2,),
        )


def clear_login_attempts(username: str) -> None:
    """Drop the counter after a successful sign-in."""
    with get_pool().connection() as conn:
        conn.execute("delete from login_attempts where username = %s", (username,))


def create_user(username: str, password: Optional[str] = None) -> tuple[str, str]:
    """Create a user with a fresh 'web' token (and optional password).

    Returns (user_id, plaintext_token).
    """
    token = secrets.token_urlsafe(32)
    password_hash = hash_password(password) if password else None
    try:
        with get_pool().connection() as conn:
            # users.token_hash stays null: the tokens row is the only
            # credential record (a value here would be re-migrated -- and
            # resurrected after revocation -- on the next startup).
            row = conn.execute(
                "insert into users (username, password_hash) values (%s, %s) returning id",
                (username, password_hash),
            ).fetchone()
            conn.execute(
                "insert into tokens (user_id, token_hash, label) values (%s, %s, 'web')",
                (row["id"], hash_token(token)),
            )
    except psycopg.errors.UniqueViolation:
        raise DuplicateUsernameError(username)
    return str(row["id"]), token


def resolve_token(token: str) -> Optional[dict]:
    """Look up the user for a bearer token, touching tokens.last_used_at and
    users.last_seen_at in a single round-trip. None if invalid.

    Lookup stays hash-based with no prefix requirement: bare, unprefixed
    legacy tokens hash and resolve exactly like a new `mg_`-prefixed one, so
    credentials already deployed on machines this project cannot reach keep
    working forever.
    """
    with get_pool().connection() as conn:
        user = conn.execute(
            """
            with t as (
                update tokens set last_used_at = now()
                where token_hash = %s
                  and (expires_at is null or expires_at > now())
                returning user_id, scopes
            )
            update users set last_seen_at = now()
            from t where users.id = t.user_id
            returning users.id, users.username, t.scopes
            """,
            (hash_token(token),),
        ).fetchone()
    if user:
        user["id"] = str(user["id"])
    return user


def resolve_user_by_id(user_id: str) -> Optional[dict]:
    """Look up a user by id, for a credential that has already been verified
    cryptographically rather than by database lookup -- i.e. a Better Auth JWT,
    whose `sub` is this id by design (see the integration design doc).

    Deliberately does NOT create a missing user. A token can only be signed for
    an account the auth service knows about, so an id with no row here means the
    two stores have drifted, and inventing a row would paper over exactly the
    bug worth hearing about.
    """
    try:
        uuid.UUID(user_id)
    except (ValueError, AttributeError, TypeError):
        # `sub` is attacker-influenced only in the sense that a valid signature
        # is required to reach here, but a non-UUID would raise inside psycopg
        # rather than simply not matching.
        return None

    with get_pool().connection() as conn:
        user = conn.execute(
            """
            update users set last_seen_at = now()
            where id = %s
            returning id, username
            """,
            (user_id,),
        ).fetchone()
    if user:
        user["id"] = str(user["id"])
    return user


def create_token(
    user_id: str,
    label: str = "token",
    expires_in_days: Optional[int] = None,
    token_scopes: Optional[list[str]] = None,
) -> tuple[str, str]:
    """Issue a new named token. Returns (token_id, plaintext_token) --
    the plaintext is shown exactly once.

    expires_in_days=None stores NULL, meaning the token never expires. That is
    the right default for machine credentials: an MCP client configured once
    should not stop working on a timer. Browser sessions pass a finite value --
    see SESSION_TOKEN_DAYS.

    token_scopes=None means every scope, which is what a token has always had.
    `persona:read` is forced in regardless: a credential that cannot read has
    nothing to authorise.

    The `mg_` prefix makes the credential identifiable in a log and lets secret
    scanners match a pattern. It is hashed along with the rest of the string, so
    older unprefixed tokens keep resolving with no special case.
    """
    granted = list(scopes.ALL_SCOPES) if token_scopes is None else list(token_scopes)
    if scopes.READ not in granted:
        granted.append(scopes.READ)

    token = "mg_" + secrets.token_urlsafe(32)
    with get_pool().connection() as conn:
        row = conn.execute(
            """
            insert into tokens (user_id, token_hash, label, expires_at, scopes)
            values (
                %s, %s, %s,
                -- The cast is required: a bare parameter used only in an
                -- `is null` test leaves Postgres unable to infer its type.
                case when %s::int is null then null
                     else now() + make_interval(days => %s::int) end,
                %s
            )
            returning id
            """,
            (user_id, hash_token(token), label, expires_in_days, expires_in_days, granted),
        ).fetchone()
    return str(row["id"]), token


def list_tokens(user_id: str) -> list[dict]:
    """The user's tokens: id, label, created_at, last_used_at, expires_at, scopes.
    Never the hash. A null expires_at means the token does not expire."""
    with get_pool().connection() as conn:
        rows = conn.execute(
            "select id, label, created_at, last_used_at, expires_at, scopes from tokens"
            " where user_id = %s order by created_at",
            (user_id,),
        ).fetchall()
    for row in rows:
        row["id"] = str(row["id"])
    return rows


def revoke_token(user_id: str, token_id: str) -> bool:
    """Delete one of the user's tokens. False if it doesn't exist or isn't theirs."""
    try:
        uuid.UUID(token_id)
    except (ValueError, AttributeError, TypeError):
        return False  # malformed id can't match anything
    with get_pool().connection() as conn:
        row = conn.execute(
            "delete from tokens where id = %s and user_id = %s returning id",
            (token_id, user_id),
        ).fetchone()
    return row is not None


# Better Auth 1.7 keys an account on (issuer, accountId); migration 0010
# backfilled every credential row with this issuer and made it NOT NULL, so a
# row set_password inserts must match. Mirrors scripts/seed_better_auth.py,
# which is the existing precedent for writing this table from Python.
_CREDENTIAL_PROVIDER = "credential"
_CREDENTIAL_ISSUER = "local:credential"


def set_password(
    user_id: str, password: str, current_password: Optional[str] = None
) -> None:
    """Set (or change) the user's password.

    Accounts that already have a password must supply the correct
    current_password (InvalidCredentialsError otherwise); legacy/no-password
    accounts may set one without it.

    Writes the new hash to two places in one transaction: `users.password_hash`
    (read by /api/auth/login, still live for detached/non-SSO use) and
    better_auth."account".password for the user's "credential" row (read by
    Better Auth's web sign-in). Before this, only the first was written -- a
    password change returned 200 and updated nothing a web sign-in checks, so
    the account went on accepting the OLD password there indefinitely.

    Pointing this at Better Auth's own change-password endpoint instead would
    be architecturally cleaner (Better Auth owns human credentials), but it
    creates the mirror bug: users.password_hash goes stale and
    /api/auth/login, live on every non-SSO instance, keeps accepting the
    superseded password. One write updating both readers is smaller and
    leaves no path anywhere that still accepts a password that has been
    changed.

    This does reach into the better_auth schema from Python, which is
    normally exactly the drift db.resolve_user_by_id exists to keep visible.
    It is safe here for the same reason scripts/seed_better_auth.py is safe:
    the two hashes are interchangeable by construction -- both are bcrypt at
    cost 12 (auth/src/auth.js's verifier; this module's hash_password via
    bcrypt.gensalt()'s default) -- and that interchangeability is the entire
    premise the seed script already relies on. Do not "clean this up" into a
    single write; that reintroduces the bug this fixes.

    Skipped entirely when better_auth."user" has no row for this id: a
    detached-mode account created straight through /api/auth/register (the
    only door when there is no same-origin Better Auth to sign up through)
    has never touched Better Auth at all, so there is no web sign-in reading
    a stale value to fix. It is also not optional -- account."userId" has a
    NOT NULL foreign key onto better_auth."user", so inserting a credential
    row for an id with no user row would fail outright, taking this
    endpoint's 200 down with it. Once such an account IS seeded or signs in
    through Better Auth, the next password change picks up the credential
    row like any other.
    """
    with get_pool().connection() as conn:
        row = conn.execute(
            "select password_hash from users where id = %s", (user_id,)
        ).fetchone()
        existing = row["password_hash"] if row else None
        if existing is not None:
            if not current_password or not check_password(current_password, existing):
                raise InvalidCredentialsError()

        new_hash = hash_password(password)

        conn.execute(
            "update users set password_hash = %s where id = %s",
            (new_hash, user_id),
        )

        has_better_auth_user = conn.execute(
            'select 1 from better_auth."user" where "id" = %s', (user_id,)
        ).fetchone()
        if not has_better_auth_user:
            return

        credential = conn.execute(
            """
            select "id" from better_auth."account"
             where "userId" = %s and "providerId" = %s
            """,
            (user_id, _CREDENTIAL_PROVIDER),
        ).fetchone()

        if credential:
            conn.execute(
                """
                update better_auth."account"
                   set "password" = %s, "updatedAt" = now()
                 where "id" = %s
                """,
                (new_hash, credential["id"]),
            )
        else:
            conn.execute(
                """
                insert into better_auth."account"
                    ("id", "accountId", "providerId", "userId",
                     "password", "createdAt", "updatedAt", "issuer")
                values (%s, %s, %s, %s, %s, now(), now(), %s)
                """,
                (
                    str(uuid.uuid4()),
                    user_id,
                    _CREDENTIAL_PROVIDER,
                    user_id,
                    new_hash,
                    _CREDENTIAL_ISSUER,
                ),
            )


def verify_password(username: str, password: str) -> Optional[dict]:
    """Check username + password. Returns {id, username} on success, None on
    bad credentials (indistinguishable for unknown user vs wrong password).
    Raises PasswordNotSetError when the account exists but has no password."""
    password_bytes = password.encode("utf-8")
    with get_pool().connection() as conn:
        row = conn.execute(
            "select id, username, password_hash from users where username = %s",
            (username,),
        ).fetchone()
    # Every failure branch performs exactly one bcrypt op so response timing
    # doesn't reveal whether the username exists or has a password.
    if row is None:
        bcrypt.checkpw(b"dummy-password-for-timing", _DUMMY_HASH)
        return None
    if row["password_hash"] is None:
        bcrypt.checkpw(b"dummy-password-for-timing", _DUMMY_HASH)
        raise PasswordNotSetError()
    if len(password_bytes) > MAX_PASSWORD_BYTES:
        bcrypt.checkpw(b"dummy-password-for-timing", _DUMMY_HASH)
        return None  # bcrypt would raise; ordinary failed login instead
    if not bcrypt.checkpw(password_bytes, row["password_hash"].encode("utf-8")):
        return None
    return {"id": str(row["id"]), "username": row["username"]}
