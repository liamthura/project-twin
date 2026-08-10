"""invite_codes

Revision ID: 0005_invite_codes
Revises: 0004_proposals
Create Date: 2026-07-31

Codes that admit someone to a closed test. Minted by hand from
`scripts/access.py`; the rule that decides whether one admits lives in the auth
service (auth/src/invite.js), and only ever reads what this creates.

Alembic owns this table for the same reason it owns the better_auth schema: one
tool creates tables, so there is one place to look when they are not there --
even though the process that reads them most is a Node one.

Every statement is idempotent, matching the baseline revision's standing rule.
"""
from alembic import op

revision = "0005_invite_codes"
down_revision = "0004_proposals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists invite_codes (
            -- 'XXXX-XXXX', stored uppercase. The separator is kept: it is how
            -- the code is written down, read aloud and typed, and normalising
            -- it away here would mean every reader had to re-add it.
            code        text primary key,

            -- Not nullable on purpose. A code with no label is a code you
            -- cannot revoke with any confidence six weeks later, because you
            -- no longer know who has it.
            label       text        not null,

            max_uses    integer     not null default 1,

            -- Authoritative for admission. `users.invited_with` records who
            -- actually came in, and the two can differ by one when two people
            -- race the last use of a code -- a trade taken deliberately, see
            -- the design doc.
            uses        integer     not null default 0,

            expires_at  timestamptz,
            revoked_at  timestamptz,
            created_at  timestamptz not null default now(),

            constraint invite_codes_uses_non_negative check (uses >= 0),
            constraint invite_codes_max_uses_positive check (max_uses >= 1)
        );
    """)

    # Attribution. Nullable because every account that predates the closed test
    # arrived without a code, and always will have.
    op.execute("""
        alter table users
            add column if not exists invited_with text
            references invite_codes(code) on delete set null;
    """)

    # `list` reads by recency; nothing reads by label.
    op.execute("""
        create index if not exists idx_invite_codes_created
            on invite_codes (created_at desc);
    """)


def downgrade() -> None:
    op.execute("drop index if exists idx_invite_codes_created;")
    op.execute("alter table users drop column if exists invited_with;")
    op.execute("drop table if exists invite_codes;")
