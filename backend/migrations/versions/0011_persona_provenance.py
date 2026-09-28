"""persona_provenance: who added and last changed each entry, and when it was kept

Revision ID: 0011_persona_provenance
Revises: 0010_better_auth_17
Create Date: 2026-09-28

The editor shows where an entry came from and how old it is. Review already
knew the first half for the entries it approved (persona_proposals.promoted_to),
but nothing recorded an assistant writing directly or the reader typing one in:
persona_history names the client per whole-section version and keeps twenty.

One row per entry, written by persona_store.save() from the diff it already
computes, so every write path -- editor, MCP, Review, restore, import -- is
covered by one statement. The entries themselves are untouched: provenance kept
inside them would round-trip through the editor's whole-section PUT, where
anything could overwrite it.

`kept_at` is the reader's "Keep" on a stale entry. Staleness counts from the
later of it and the entry's last content change (persona_search.updated_at).

Rows outlive a removed entry on purpose: a History restore that brings it back
then reads as a change, and the entry keeps its origin.
"""
from alembic import op

revision = "0011_persona_provenance"
down_revision = "0010_better_auth_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists persona_provenance (
            user_id      uuid not null references users(id) on delete cascade,
            entity_id    text not null,
            -- via: 'editor' | 'assistant' | 'review'. by: the client's name, or
            -- '' for the reader themself.
            added_by     text,
            added_via    text,
            added_at     timestamptz,
            changed_by   text,
            changed_via  text,
            changed_at   timestamptz,
            -- The Review suggestion that added it, when one did.
            proposal_id  uuid,
            kept_at      timestamptz,
            primary key (user_id, entity_id)
        )
    """)
    # Entries Review already linked. Anything older has no record, and says so
    # by showing only its last-changed date.
    op.execute("""
        insert into persona_provenance
            (user_id, entity_id, added_by, added_via, added_at, proposal_id)
        select distinct on (p.user_id, p.promoted_to)
               p.user_id, p.promoted_to, p.proposed_by, 'review',
               coalesce(p.resolved_at, p.created_at), p.id
          from persona_proposals p
          join persona_search s
            on s.user_id = p.user_id and s.entity_id = p.promoted_to
         where p.status in ('approved', 'promoted')
         order by p.user_id, p.promoted_to, p.resolved_at nulls last
        on conflict do nothing
    """)


def downgrade() -> None:
    op.execute("drop table if exists persona_provenance")
