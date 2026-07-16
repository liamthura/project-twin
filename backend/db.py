"""
Postgres connection, user registry, and auth primitives.

Auth model: humans sign in with username + password (bcrypt-hashed);
machines authenticate with named, revocable bearer tokens (`tokens` table,
sha256-hashed -- high-entropy secrets, no need for a slow hash). A token's
plaintext is returned exactly once at creation.
"""

import hashlib
import os
import secrets
import uuid
from contextvars import ContextVar
from typing import Optional

import bcrypt
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: Optional[ConnectionPool] = None

# Set once per request by main.py's auth middleware; read by persona_store.py
# (and, transitively, by server.py's MCP tools) to scope data to the caller.
current_user_id: ContextVar[str] = ContextVar("current_user_id")


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


def ensure_schema() -> None:
    with get_pool().connection() as conn:
        conn.execute("""
            create table if not exists users (
                id uuid primary key default gen_random_uuid(),
                username text unique not null,
                token_hash text unique not null,
                created_at timestamptz not null default now(),
                last_seen_at timestamptz
            );
        """)
        conn.execute("""
            create table if not exists persona_data (
                user_id uuid not null references users(id),
                file_type text not null,
                data jsonb not null,
                updated_at timestamptz not null default now(),
                primary key (user_id, file_type)
            );
        """)
        conn.execute("alter table users add column if not exists password_hash text;")
        conn.execute("alter table users alter column token_hash drop not null;")
        conn.execute("""
            create table if not exists tokens (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id),
                token_hash text unique not null,
                label text not null default 'token',
                created_at timestamptz not null default now(),
                last_used_at timestamptz
            );
        """)
        # Migration: backfill legacy single-token users into the tokens table,
        # then CLEAR users.token_hash. Clearing matters: if the hash stayed,
        # revoking the migrated token and restarting would re-insert it here
        # and resurrect the revoked credential. Idempotent and cheap, so it is
        # safe to run on every startup.
        conn.execute("""
            insert into tokens (user_id, token_hash, label)
            select id, token_hash, 'legacy' from users
            where token_hash is not null
            on conflict (token_hash) do nothing;
        """)
        conn.execute("update users set token_hash = null where token_hash is not null;")


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
    users.last_seen_at in a single round-trip. None if invalid."""
    with get_pool().connection() as conn:
        user = conn.execute(
            """
            with t as (
                update tokens set last_used_at = now()
                where token_hash = %s
                returning user_id
            )
            update users set last_seen_at = now()
            from t where users.id = t.user_id
            returning users.id, users.username
            """,
            (hash_token(token),),
        ).fetchone()
    if user:
        user["id"] = str(user["id"])
    return user


def create_token(user_id: str, label: str = "token") -> tuple[str, str]:
    """Issue a new named token. Returns (token_id, plaintext_token) --
    the plaintext is shown exactly once."""
    token = secrets.token_urlsafe(32)
    with get_pool().connection() as conn:
        row = conn.execute(
            "insert into tokens (user_id, token_hash, label) values (%s, %s, %s)"
            " returning id",
            (user_id, hash_token(token), label),
        ).fetchone()
    return str(row["id"]), token


def list_tokens(user_id: str) -> list[dict]:
    """The user's tokens: id, label, created_at, last_used_at. Never the hash."""
    with get_pool().connection() as conn:
        rows = conn.execute(
            "select id, label, created_at, last_used_at from tokens"
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


def set_password(
    user_id: str, password: str, current_password: Optional[str] = None
) -> None:
    """Set (or change) the user's password.

    Accounts that already have a password must supply the correct
    current_password (InvalidCredentialsError otherwise); legacy/no-password
    accounts may set one without it.
    """
    with get_pool().connection() as conn:
        row = conn.execute(
            "select password_hash from users where id = %s", (user_id,)
        ).fetchone()
        existing = row["password_hash"] if row else None
        if existing is not None:
            if not current_password or not check_password(current_password, existing):
                raise InvalidCredentialsError()
        conn.execute(
            "update users set password_hash = %s where id = %s",
            (hash_password(password), user_id),
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
