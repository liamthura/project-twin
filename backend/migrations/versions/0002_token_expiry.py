"""tokens.expires_at

Revision ID: 0002_token_expiry
Revises: 0001_baseline
Create Date: 2026-07-27

Nullable, and every existing row keeps NULL, which means "never expires".
Nobody is signed out by this deploy and no machine token stops working --
the change only affects tokens minted afterwards.
"""
from alembic import op

revision = "0002_token_expiry"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("alter table tokens add column if not exists expires_at timestamptz;")
    # resolve_token filters on this for every authenticated request.
    op.execute(
        "create index if not exists tokens_expires_at_idx"
        " on tokens (expires_at) where expires_at is not null;"
    )


def downgrade() -> None:
    op.execute("drop index if exists tokens_expires_at_idx;")
    op.execute("alter table tokens drop column if exists expires_at;")
