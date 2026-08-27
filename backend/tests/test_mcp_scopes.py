"""A connection that cannot write should not be shown the write tools.

Filtering is better than failing: a client that can see persona_modify will try
it, and an error mid-conversation is a worse experience than a tool that was
never offered. It also means the tool list is an honest description of what the
connection can do."""

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

import scopes
from mcp_scopes import tools_for_scopes


def _grant(*names):
    """Bind a grant for the current test, the way the auth middleware would.

    Called from inside the async test body rather than from a fixture, and not
    unbound afterwards. Both follow from the same fact: anyio runs each async
    test in its own copied context, so a binding made in a (synchronous)
    fixture would be invisible in here, and one made in here cannot outlive the
    test. `test_no_grant_at_all_lists_nothing` asserts LookupError before it
    does anything else, and so stands as the running proof of the second half.
    """
    scopes.current_scopes.set(scopes.expand(names))


def test_a_read_only_grant_sees_only_read_tools():
    visible = tools_for_scopes(scopes.expand([scopes.READ]))
    assert visible == {
        "get_context",
        "get_raw",
        "search_context",
        "get_entity",
        "get_schema",
        "whoami",
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
    it makes the omission obvious in review instead. Visible is as far as that
    argument goes -- calling it is refused, see below."""
    visible = tools_for_scopes(scopes.expand([scopes.READ]), names=["brand_new_tool"])
    assert "brand_new_tool" in visible


@pytest.mark.anyio
async def test_every_registered_tool_has_a_scope():
    """The guard that makes the rest of this file complete.

    Everything above reasons about TOOL_SCOPES; nothing above notices a tool
    that exists on the server and is missing from it. That tool would ship
    visible to every grant, and the omission would show up as a permissions
    bug in production rather than as a failure here.
    """
    import server

    registered = set(await server.mcp.get_tools())
    assert registered - set(scopes.TOOL_SCOPES) == set(), (
        "a tool is registered with no entry in scopes.TOOL_SCOPES -- add one, "
        "choosing the narrowest scope it can honestly run under"
    )


# ---------------------------------------------------------------------------
# ScopeMiddleware itself, over a real MCP session.
#
# Everything above calls the helper. The helper being right and the middleware
# being wired to it are separate facts, and only the second one protects a
# persona: an on_list_tools that forgot to filter, or an on_call_tool that
# returned early, would pass every test above. fastmcp.Client speaks the real
# protocol to the real server object in-process, which is the cheapest way to
# exercise the middleware as it actually runs.
# ---------------------------------------------------------------------------


def _with_scope_middleware():
    """Make sure the middleware is attached to server.mcp.

    server.py defines the tools; main.py is what calls
    `mcp.add_middleware(ScopeMiddleware())`, before building the HTTP app. So a
    test that imported only `server` would drive a server with no middleware on
    it and pass by seeing everything. Importing main is the wiring under test.
    """
    import main  # noqa: F401


@pytest.mark.anyio
async def test_list_tools_hides_what_the_grant_does_not_cover():
    import server

    _with_scope_middleware()
    _grant(scopes.READ)
    async with Client(server.mcp) as client:
        names = {tool.name for tool in await client.list_tools()}

    assert "get_context" in names
    assert "persona_modify" not in names
    assert "propose_update" not in names


@pytest.mark.anyio
async def test_calling_an_out_of_scope_tool_is_refused():
    """Filtering is not enforcement. A client that ignores the tool list, or
    one holding a list from before the grant narrowed, still gets refused."""
    import server

    _with_scope_middleware()
    _grant(scopes.READ)
    async with Client(server.mcp) as client:
        with pytest.raises(ToolError) as excinfo:
            await client.call_tool("persona_modify", {})

    # The refusal has to name the scope: an MCP tool error cannot carry a
    # WWW-Authenticate header, so this message is the only thing that tells
    # anyone what to grant.
    assert scopes.WRITE in str(excinfo.value)


@pytest.mark.anyio
async def test_no_grant_at_all_lists_nothing():
    """The LookupError branch. current_scopes has no default, so a request
    that reached here without authenticating raises rather than reading as an
    empty grant -- and the answer to that is to show nothing, not everything."""
    import server

    _with_scope_middleware()
    with pytest.raises(LookupError):
        scopes.current_scopes.get()

    async with Client(server.mcp) as client:
        assert await client.list_tools() == []


@pytest.mark.anyio
async def test_no_grant_at_all_cannot_call_anything():
    """The same branch on the call path, which is the one that touches data."""
    import server

    _with_scope_middleware()
    async with Client(server.mcp) as client:
        with pytest.raises(ToolError):
            await client.call_tool("get_context", {"scope": "minimal"})
