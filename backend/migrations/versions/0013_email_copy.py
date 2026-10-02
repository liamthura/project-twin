"""email_copy: edits to the emails' wording, made without a deploy

Revision ID: 0013_email_copy
Revises: 0012_feedback
Create Date: 2026-10-02

One row per edited slot of one email (backend/scripts/emails.py writes them).
Everything not here is the default in emails/copy.json, so an empty table is a
complete, working set of emails. Both the auth service and the backend read it
at send time, so an edit applies to the next email.
"""
from alembic import op

revision = "0013_email_copy"
down_revision = "0012_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists email_copy (
            email       text not null,
            slot        text not null,
            value       text not null,
            updated_at  timestamptz not null default now(),
            primary key (email, slot)
        )
    """)


def downgrade() -> None:
    op.execute("drop table if exists email_copy")
