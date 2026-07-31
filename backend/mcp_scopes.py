"""Scope enforcement at the MCP layer.

The HTTP middleware knows the request; only this layer knows which tool is being
called. Both are needed, and they do different jobs: the middleware decides
whether the credential may touch /mcp at all, and this decides which of the
eight tools it may see and use.

Filtering rather than failing is deliberate. A client shown persona_modify will
call it, and a mid-conversation error is a worse experience than a tool that was
never offered -- and the tool list then honestly describes what the connection
can do. It does mean protocol-level scope step-up can never fire, which is a
trade this design makes knowingly: step-up is an HTTP mechanism, and a per-tool
refusal lives inside a JSON-RPC response that cannot carry a WWW-Authenticate
header.
"""

from typing import Iterable, Optional

from fastmcp.exceptions import ToolError
from fastmcp.server.middleware import Middleware, MiddlewareContext

import scopes


def tools_for_scopes(
    granted: Iterable[str], names: Optional[Iterable[str]] = None
) -> set[str]:
    """Which tool names an already-expanded grant may see.

    A tool absent from TOOL_SCOPES is visible. That is not laxity: an
    unclassified tool is one somebody forgot to add, and hiding it would make a
    newly added tool silently vanish for every client, which is far harder to
    notice than the reverse.

    Visible, and -- unlike every other tool here -- not callable. See
    ScopeMiddleware.on_call_tool for why the two halves differ.
    """
    candidates = set(names) if names is not None else set(scopes.TOOL_SCOPES)
    return {
        name
        for name in candidates
        if name not in scopes.TOOL_SCOPES
        or scopes.has(granted, scopes.TOOL_SCOPES[name])
    }


class ScopeMiddleware(Middleware):
    """Hides out-of-scope tools, and refuses them if called anyway."""

    async def on_list_tools(self, context: MiddlewareContext, call_next):
        tools = await call_next(context)
        try:
            granted = scopes.current_scopes.get()
        except LookupError:
            # No grant on this request. The HTTP middleware refuses before we
            # get here, so this only happens on a path that never authenticated
            # -- showing nothing is the fail-closed answer.
            return []
        allowed = tools_for_scopes(granted, names=[tool.name for tool in tools])
        return [tool for tool in tools if tool.name in allowed]

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        """Refuse a call the grant does not cover -- and refuse an unclassified
        tool outright.

        The two halves of "unclassified" are decided differently on purpose.
        Listing it is a loudness choice: a tool that vanishes from every
        client's tool list is a bug nobody reports for weeks, whereas one that
        appears and then refuses names itself the moment anyone tries it.
        Running it is a different question, and answering it "anyone may" was
        a fail-open nobody argued for: it let a persona:read grant invoke a
        tool that might write, purely because a line was missing from a dict.

        test_mcp_scopes.py now asserts TOOL_SCOPES covers every tool the server
        registers, so this branch should be unreachable in any build that ran
        the suite. It exists for the build that did not, and the message says
        what is actually wrong rather than blaming the caller's scopes.
        """
        name = context.message.name
        try:
            granted = scopes.current_scopes.get()
        except LookupError:
            # No grant on this request at all. The HTTP middleware refuses
            # before we get here, so this is a path that never authenticated
            # -- an empty grant satisfies nothing, which is the fail-closed
            # answer and matches on_list_tools returning nothing.
            granted = frozenset()

        # ToolError's message survives even if mask_error_details is ever
        # turned on -- a bare exception would be swallowed into a generic
        # "error calling tool" in that mode, and these refusals are exactly the
        # detail a client (or whoever forgot the dict entry) needs to see.
        required = scopes.TOOL_SCOPES.get(name)
        if required is None:
            raise ToolError(
                f"{name} has no scope classification on this server, so MyGist "
                f"cannot tell what authorising it would permit. This is a "
                f"server-side omission, not a problem with your connection."
            )
        if not scopes.has(granted, required):
            raise ToolError(
                f"This connection is not authorised to use {name}. It needs "
                f"the {required} scope; reconnect from MyGist's settings to "
                f"grant it."
            )
        return await call_next(context)
