"""mcp_activity

Revision ID: 0008_mcp_activity
Revises: 0007_waitlist
Create Date: 2026-08-16

What each connected client actually does, per user.

This exists because of a question the server could not answer. MyGist's tools
are under-called -- an assistant with the server connected answers from general
knowledge and nobody notices, because a fluent wrong answer draws no correction.
Every claim about whether a change improved that was a judgement, since
triggering is invisible from here: you see the calls that happened, never the
ones that should have.

It cannot make the absent calls visible -- nothing can, from this side. What it
does make visible is the two things that were being guessed at:

  - whether a client ever fetched `tools/list` at all, and under what name.
    A client serving a cached tool schema never asks again, and that is
    indistinguishable from a well-behaved one until you look here.
  - how often each tool is reached for, so "propose_update is the least-used
    tool" becomes a number that can be watched across a deploy.

Counters, not an event log. The question is "does this client ever do X, and how
much", which an aggregate answers in one row; a row per call would grow without
bound and answer nothing extra. There is no request payload here and no
persona content -- only which method was called, and when.

Every statement is idempotent, matching the baseline revision's standing rule.
"""
from alembic import op

revision = "0008_mcp_activity"
down_revision = "0007_waitlist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists mcp_activity (
            user_id      uuid not null references users(id) on delete cascade,

            -- The client's self-reported name and version from initialize,
            -- e.g. "Claude Code 1.2.3". Self-reported, so it identifies a
            -- product rather than authenticating one -- which is all this is
            -- for. "unknown" when a client sends no clientInfo.
            client       text not null,

            -- The JSON-RPC method: tools/list, tools/call, resources/read, and
            -- so on. tools/list is the interesting one, because a client that
            -- never asks is a client running on a cached schema.
            method       text not null,

            -- The tool, for tools/call. Empty string rather than null for
            -- everything else: this is in the primary key, and a null there
            -- would make the upsert below insert a new row every time.
            tool         text not null default '',

            calls        bigint not null default 0,
            first_seen   timestamptz not null default now(),
            last_seen    timestamptz not null default now(),

            primary key (user_id, client, method, tool)
        )
    """)


def downgrade() -> None:
    op.execute("drop table if exists mcp_activity")
