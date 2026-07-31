"""persona_proposals

Revision ID: 0003_proposals
Revises: 0002_token_expiry
Create Date: 2026-07-31

A pending proposal is not persona data. Filing it in persona_data would drag
it into /api/export, the search index, the pack registry and the editor, all
of which would be wrong -- it is a queue, and it lives in its own table.

Every statement is idempotent, matching the baseline revision's standing rule.
"""
from alembic import op

revision = "0003_proposals"
down_revision = "0002_token_expiry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists persona_proposals (
            id           uuid primary key default gen_random_uuid(),
            user_id      uuid not null references users(id) on delete cascade,
            kind         text not null,
            action       text,
            entity       text,
            data         jsonb,
            note         text,
            section_hint text,
            rationale    text not null,
            evidence     text,
            confidence   real,
            proposed_by  text not null,
            fingerprint  text not null,
            status       text not null default 'pending',
            seen_count   int  not null default 1,
            seen_at      timestamptz,
            created_at   timestamptz not null default now(),
            resolved_at  timestamptz,
            promoted_to  text
        );
    """)
    op.execute(
        "create index if not exists persona_proposals_queue_idx"
        " on persona_proposals (user_id, kind, status, created_at desc);"
    )
    # The tombstone. A claim already pending, already rejected, or already
    # promoted must not be raised a second time -- re-suggesting something the
    # user declined is the single largest cause of abandoned review queues.
    op.execute(
        "create unique index if not exists persona_proposals_fingerprint_idx"
        " on persona_proposals (user_id, fingerprint)"
        " where status in ('pending', 'rejected', 'promoted');"
    )


def downgrade() -> None:
    op.execute("drop index if exists persona_proposals_fingerprint_idx;")
    op.execute("drop index if exists persona_proposals_queue_idx;")
    op.execute("drop table if exists persona_proposals;")
