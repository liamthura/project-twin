"""
Postgres connection, user registry, and token-based auth primitives.

Auth model: a token IS the credential (no password). Registering with a
username generates a token; the plaintext token is returned exactly once
and only its sha256 hash is stored.
"""

import hashlib
import os
import secrets
from contextvars import ContextVar
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: Optional[ConnectionPool] = None

# Set once per request by main.py's auth middleware; read by persona_store.py
# (and, transitively, by server.py's MCP tools) to scope data to the caller.
current_user_id: ContextVar[str] = ContextVar("current_user_id")


class DuplicateUsernameError(Exception):
    pass


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


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_user(username: str) -> tuple[str, str]:
    """Create a user with a fresh token. Returns (user_id, plaintext_token)."""
    token = secrets.token_urlsafe(32)
    try:
        with get_pool().connection() as conn:
            row = conn.execute(
                "insert into users (username, token_hash) values (%s, %s) returning id",
                (username, hash_token(token)),
            ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise DuplicateUsernameError(username)
    return str(row["id"]), token


def resolve_token(token: str) -> Optional[dict]:
    """Look up the user for a bearer token, touching last_seen_at. None if invalid."""
    with get_pool().connection() as conn:
        user = conn.execute(
            "update users set last_seen_at = now() where token_hash = %s returning id, username",
            (hash_token(token),),
        ).fetchone()
    if user:
        user["id"] = str(user["id"])
    return user


def rotate_token(user_id: str) -> str:
    """Issue a new token for an existing user, invalidating the old one."""
    token = secrets.token_urlsafe(32)
    with get_pool().connection() as conn:
        conn.execute(
            "update users set token_hash = %s where id = %s", (hash_token(token), user_id)
        )
    return token
