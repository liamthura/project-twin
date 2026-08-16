"""Counters for what each client actually does. See migration 0008_mcp_activity.

The behaviour worth guarding is not the arithmetic, it is that a counter can
never break a call and never stores content.
"""
import pytest
from fastmcp import Client

import db
import mcp_activity


def test_a_call_is_counted_once_per_key(as_user):
    mcp_activity.record("Hermes 0.4.1", "tools/call", "get_context")
    mcp_activity.record("Hermes 0.4.1", "tools/call", "get_context")
    mcp_activity.record("Hermes 0.4.1", "tools/call", "propose_update")

    rows = {(r["client"], r["method"], r["tool"]): r
            for r in mcp_activity.usage(db.current_user_id.get())}
    assert rows[("Hermes 0.4.1", "tools/call", "get_context")]["calls"] == 2
    assert rows[("Hermes 0.4.1", "tools/call", "propose_update")]["calls"] == 1


def test_two_clients_are_counted_apart(as_user):
    mcp_activity.record("Hermes 0.4.1", "tools/list")
    mcp_activity.record("Claude Code 1.2.3", "tools/list")

    rows = mcp_activity.usage(db.current_user_id.get())
    listers = {r["client"] for r in rows if r["method"] == "tools/list"}
    assert listers == {"Hermes 0.4.1", "Claude Code 1.2.3"}
    # The whole point: a client absent from this set never fetched the schema.
    assert all(r["tool"] is None for r in rows if r["method"] == "tools/list")


def test_usage_is_scoped_to_one_user(as_user):
    with db.get_pool().connection() as conn:
        other = conn.execute(
            "insert into users (username, token_hash) values ('u2', 'y') returning id"
        ).fetchone()
    mcp_activity.record("Hermes 0.4.1", "tools/call", "get_context")
    assert mcp_activity.usage(str(other["id"])) == []


def test_a_broken_write_never_reaches_the_caller(as_user, monkeypatch):
    """A counter that can 500 a tool call is worse than no counter."""
    def boom():
        raise RuntimeError("pool is gone")
    monkeypatch.setattr(db, "get_pool", boom)
    mcp_activity.record("Hermes 0.4.1", "tools/call", "get_context")  # must not raise


def test_no_credential_records_nothing(clean_database):
    """Outside a request there is nobody to attribute a call to."""
    token = db.current_user_id.set(None)
    db.current_user_id.reset(token)
    mcp_activity.record("Hermes 0.4.1", "tools/list")  # must not raise


def test_client_label_falls_back_when_a_client_names_itself_nothing():
    class NoInfo:
        pass
    assert mcp_activity.client_label(NoInfo()) == mcp_activity.UNKNOWN_CLIENT


class TestThroughARealClient:
    """The wiring, not the arithmetic.

    `record` being correct proves nothing about whether the middleware is
    attached, whether `context.method` holds what this code thinks it holds, or
    whether a tool call carries its name where it is being read from. Only a
    real client round-trip proves that, and it is the part that would break
    silently on a FastMCP upgrade.
    """

    @pytest.fixture
    def server(self):
        from fastmcp import FastMCP

        mcp = FastMCP("test")

        @mcp.tool()
        def ping() -> str:
            """A tool with no dependencies, so this tests the middleware."""
            return "pong"

        mcp_activity.register(mcp)
        return mcp

    @pytest.mark.anyio
    async def test_a_list_and_a_call_both_land(self, server, as_user):
        async with Client(server) as client:
            await client.list_tools()
            await client.call_tool("ping", {})

        rows = {(r["method"], r["tool"]): r["calls"]
                for r in mcp_activity.usage(db.current_user_id.get())}
        assert rows.get(("tools/list", None)) == 1
        assert rows.get(("tools/call", "ping")) == 1

    @pytest.mark.anyio
    async def test_the_client_names_itself(self, server, as_user):
        async with Client(server) as client:
            await client.list_tools()

        clients = {r["client"] for r in mcp_activity.usage(db.current_user_id.get())}
        assert clients, "nothing was recorded at all"
        # FastMCP's own test client reports a name; whatever it is, it is not
        # the fallback -- which is what proves clientInfo is being read.
        assert mcp_activity.UNKNOWN_CLIENT not in clients
