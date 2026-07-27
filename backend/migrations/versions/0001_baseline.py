"""baseline: the schema as it stood before Alembic

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-27

Every statement is idempotent (IF NOT EXISTS, or a guarded ALTER). That is
deliberate: the production database already contains all of these objects, so
this revision must be a no-op there while still building the schema from
nothing for a fresh self-hosted install. It removes the need for a manual
`alembic stamp head` against live data, where a mistake is expensive.

Lifted verbatim from db.ensure_schema(), minus the pgvector block -- the
embedding column's dimension comes from EMBEDDING_DIM and the extension may be
absent entirely, so it stays runtime. See db.ensure_vector_schema().
"""
from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists users (
            id uuid primary key default gen_random_uuid(),
            username text unique not null,
            token_hash text unique not null,
            created_at timestamptz not null default now(),
            last_seen_at timestamptz
        );
    """)
    op.execute("""
        create table if not exists persona_data (
            user_id uuid not null references users(id),
            file_type text not null,
            data jsonb not null,
            updated_at timestamptz not null default now(),
            primary key (user_id, file_type)
        );
    """)

    # Password sign-in arrived after the original users table; token_hash
    # became optional at the same time, since credentials moved to `tokens`.
    op.execute("alter table users add column if not exists password_hash text;")
    op.execute("alter table users alter column token_hash drop not null;")

    op.execute("""
        create table if not exists tokens (
            id uuid primary key default gen_random_uuid(),
            user_id uuid not null references users(id),
            token_hash text unique not null,
            label text not null default 'token',
            created_at timestamptz not null default now(),
            last_used_at timestamptz
        );
    """)

    # One-time data migration: move legacy single-token users into `tokens`,
    # then clear users.token_hash. Clearing matters -- if the hash stayed,
    # revoking the migrated token would resurrect it on the next run. This
    # previously executed on every application boot; as a migration it runs
    # once and is then recorded as done.
    op.execute("""
        insert into tokens (user_id, token_hash, label)
        select id, token_hash, 'legacy' from users
        where token_hash is not null
        on conflict (token_hash) do nothing;
    """)
    op.execute("update users set token_hash = null where token_hash is not null;")

    op.execute("""
        create table if not exists login_attempts (
            username text primary key,
            attempt_count integer not null default 0,
            window_start timestamptz not null default now()
        );
    """)

    op.execute("""
        create table if not exists persona_search (
            user_id uuid not null references users(id) on delete cascade,
            file_type text not null,
            entity_id text not null,
            title text not null default '',
            text text not null,
            tsv tsvector generated always as (to_tsvector('english', text)) stored,
            content_hash text not null,
            updated_at timestamptz not null default now(),
            primary key (user_id, file_type, entity_id)
        );
    """)
    op.execute(
        "create index if not exists persona_search_tsv_idx"
        " on persona_search using gin (tsv);"
    )


def downgrade() -> None:
    raise NotImplementedError(
        "0001_baseline has no downgrade: it is the initial schema, so reversing "
        "it would drop every table and destroy all persona data. Restore from a "
        "backup instead."
    )
