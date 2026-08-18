"""persona_history and persona_search.read_count

Revision ID: 0009_history_and_reads
Revises: 0008_mcp_activity
Create Date: 2026-08-18

Two additions, both feeding the same question: is what the persona says still
true?

`persona_history` makes a write reversible. Until now `persona_data` held one
row per section with a single `updated_at`, so an agent that overwrote a
project's notes with something wrong destroyed the old value outright. Whole-
section snapshots rather than per-entity diffs because `persona_store.save()`
already writes at exactly that granularity -- a snapshot restores by being
written back, where a diff would need replaying.

`read_count` is the second signal a retirement proposal needs. Age alone is a
weak reason to suggest dropping something: a preference set two years ago and
read every week is settled, not stale. Age plus never-once-fetched is a real
candidate. Incremented only by `get_entity`, a deliberate fetch of one entry,
never by scope reads that pull whole sections and would say nothing about which
entries earned their place.

Every statement is idempotent, matching the baseline revision's standing rule.
"""
from alembic import op

revision = "0009_history_and_reads"
down_revision = "0008_mcp_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists persona_history (
            id          bigserial primary key,
            user_id     uuid not null references users(id) on delete cascade,
            file_type   text not null,

            -- The section as it was BEFORE the write that displaced it. So the
            -- newest row is the previous state, not the current one -- the
            -- current one is in persona_data.
            data        jsonb not null,

            -- The MCP client that caused the write, as it named itself on
            -- initialize. Empty for web-UI writes and migrations, which is the
            -- honest answer rather than a guess.
            written_by  text not null default '',

            replaced_at timestamptz not null default now()
        )
    """)
    op.execute(
        "create index if not exists persona_history_lookup_idx"
        " on persona_history (user_id, file_type, replaced_at desc)"
    )
    op.execute(
        "alter table persona_search"
        " add column if not exists read_count bigint not null default 0"
    )


def downgrade() -> None:
    op.execute("drop table if exists persona_history")
    op.execute("alter table persona_search drop column if exists read_count")
