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
        required = scopes.TOOL_SCOPES.get(context.message.name)
        if required is not None:
            try:
                granted = scopes.current_scopes.get()
            except LookupError:
                granted = frozenset()
            if not scopes.has(granted, required):
                # ToolError's message survives even if mask_error_details is
                # ever turned on -- a bare exception would be swallowed into a
                # generic "error calling tool" message in that mode, and this
                # refusal is exactly the detail a client needs to see.
                raise ToolError(
                    f"This connection is not authorised to use "
                    f"{context.message.name}. It needs the {required} scope; "
                    f"reconnect from MyGist's settings to grant it."
                )
        return await call_next(context)
