"""waitlist

Revision ID: 0007_waitlist
Revises: 0006_oauth_and_token_scopes
Create Date: 2026-08-09

Addresses left on the marketing page while the instance is invite-only. This is
not an account and never becomes one on its own -- admission still runs through
`invite_codes`, and someone on this list has been told nothing except that an
email will arrive.

Deliberately thin. A waitlist that collects a name, a company and a use case is
a form people abandon; one field is one decision. Anything richer belongs in the
conversation that follows the invite.

Every statement is idempotent, matching the baseline revision's standing rule.
"""
from alembic import op

revision = "0007_waitlist"
down_revision = "0006_oauth_and_token_scopes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists waitlist (
            -- Stored lowercase and unique, so a second signup from the same
            -- person is not a second slot. Case-folding at write time rather
            -- than with a functional index: the address is only ever compared
            -- to itself here, and a plain unique constraint is what makes the
            -- upsert below a one-liner.
            email        text primary key,

            created_at   timestamptz not null default now(),

            -- When the invite actually went out. Null means still waiting, and
            -- it is what makes "who has not heard from us" a query rather than
            -- a spreadsheet.
            invited_at   timestamptz,

            -- Free-text note for whoever works the list -- where they came
            -- from, whether they were promised anything. Not collected from
            -- the form.
            note         text
        )
    """)
    op.execute("""
        create index if not exists waitlist_pending_idx
            on waitlist (created_at)
            where invited_at is null
    """)


def downgrade() -> None:
    op.execute("drop index if exists waitlist_pending_idx")
    op.execute("drop table if exists waitlist")
