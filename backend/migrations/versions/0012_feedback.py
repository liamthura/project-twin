"""feedback: what people send from the feedback island

Revision ID: 0012_feedback
Revises: 0011_persona_provenance
Create Date: 2026-10-02

One row per report. The account id is the only thing about the person kept
here: their username and email are read from the account when the report is
emailed or listed, so a report never holds a second copy of who sent it.

`on delete cascade` is what deletes a person's reports, screenshots included,
with their account. db.delete_account deletes the users row; nothing else has
to know this table exists.

`handled_at` is the owner's "done" (scripts/feedback.py), so the list shows
what is still open.
"""
from alembic import op

revision = "0012_feedback"
down_revision = "0011_persona_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists feedback (
            id               bigserial primary key,
            user_id          uuid not null references users(id) on delete cascade,
            kind             text not null check (kind in ('problem', 'idea', 'other')),
            message          text not null,
            context          jsonb not null default '{}',
            screenshot       bytea,
            screenshot_type  text,
            created_at       timestamptz not null default now(),
            handled_at       timestamptz
        )
    """)
    # The hourly limit counts one account's recent rows.
    op.execute(
        "create index if not exists feedback_user_created on feedback (user_id, created_at desc)"
    )


def downgrade() -> None:
    op.execute("drop table if exists feedback")
