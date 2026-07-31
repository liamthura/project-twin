"""A connection that cannot write should not be shown the write tools.

Filtering is better than failing: a client that can see persona_modify will try
it, and an error mid-conversation is a worse experience than a tool that was
never offered. It also means the tool list is an honest description of what the
connection can do."""

import pytest

import scopes
from mcp_scopes import tools_for_scopes


def test_a_read_only_grant_sees_only_read_tools():
    visible = tools_for_scopes(scopes.expand([scopes.READ]))
    assert visible == {
        "get_context",
        "get_raw",
        "search_context",
        "get_entity",
        "get_schema",
    }


def test_a_propose_grant_adds_propose_update():
    visible = tools_for_scopes(scopes.expand([scopes.PROPOSE]))
    assert "propose_update" in visible
    assert "persona_modify" not in visible


def test_a_write_grant_sees_everything():
    visible = tools_for_scopes(scopes.expand([scopes.WRITE]))
    assert visible == set(scopes.TOOL_SCOPES)


def test_an_unknown_tool_is_visible_by_default():
    """A tool with no entry in TOOL_SCOPES is one someone forgot to classify.
    Hiding it silently would make a new tool vanish for every client; showing
    it makes the omission obvious in review instead."""
    visible = tools_for_scopes(scopes.expand([scopes.READ]), names=["brand_new_tool"])
    assert "brand_new_tool" in visible
