"""Per-client MCP traffic counters. See migration 0008_mcp_activity for why.

Two rules govern everything here:

  Never break a call. Every write is wrapped, because a counter that can 500 a
  tool call is worse than no counter at all. A failure here is logged at debug
  and discarded.

  Never store content. Method names, tool names and the client's own label --
  nothing from arguments, and no persona data. This table is safe to read over
  someone's shoulder, which is what makes it safe to expose on /api/usage.
"""
import logging

import db

logger = logging.getLogger(__name__)

UNKNOWN_CLIENT = "unknown"


def client_label(context) -> str:
    """The client's self-reported "<name> <version>", or "unknown".

    Two sources, in this order, because one of them is empty at the one moment
    that matters most:

      the request itself -- on `initialize` the session has not stored
        client_params yet, since this request is what establishes them. Reading
        the message directly is what stops every connection being logged as
        "unknown", which is the row most worth being able to name: it is the
        one that says a client connected at all. Both shapes are checked
        because the middleware sees `initialize` as a whole InitializeRequest
        (clientInfo under `.params`) and a tool call as the bare params object.

      the session -- every request after that. Taken from the SDK's own stored
        params rather than tracked in a dict here, which would be a second copy
        that a restart or a second worker would silently disagree with.
    """
    message = getattr(context, "message", None)
    info = getattr(message, "clientInfo", None)
    if info is None:
        info = getattr(getattr(message, "params", None), "clientInfo", None)
    if info is None:
        try:
            info = context.fastmcp_context.session.client_params.clientInfo
        except Exception:
            return UNKNOWN_CLIENT
    name = (getattr(info, "name", "") or "").strip()
    if not name:
        return UNKNOWN_CLIENT
    version = (getattr(info, "version", "") or "").strip()
    return f"{name} {version}".strip()


def record(client: str, method: str, tool: str = "") -> None:
    """Add one to (user, client, method, tool). Silent on any failure."""
    try:
        user_id = db.current_user_id.get()
    except LookupError:
        # No credential resolved yet -- nothing to attribute this to.
        return
    try:
        with db.get_pool().connection() as conn:
            conn.execute(
                """
                insert into mcp_activity
                    (user_id, client, method, tool, calls, first_seen, last_seen)
                values (%s, %s, %s, %s, 1, now(), now())
                on conflict (user_id, client, method, tool) do update
                  set calls = mcp_activity.calls + 1, last_seen = now()
                """,
                (user_id, client, method, tool),
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("mcp_activity write failed: %s", exc)


def usage(user_id) -> list[dict]:
    """Every row for one user, busiest first. Powers GET /api/usage."""
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select client, method, tool, calls, first_seen, last_seen"
            " from mcp_activity where user_id = %s"
            " order by calls desc, client, method, tool",
            (user_id,),
        ).fetchall()
    return [
        {
            "client": r["client"],
            "method": r["method"],
            "tool": r["tool"] or None,
            "calls": r["calls"],
            "first_seen": r["first_seen"].isoformat(),
            "last_seen": r["last_seen"].isoformat(),
        }
        for r in rows
    ]


def register(mcp) -> None:
    """Attach the counter to a FastMCP server."""
    from fastmcp.server.middleware import Middleware

    class ActivityMiddleware(Middleware):
        async def on_request(self, context, call_next):
            # Recorded BEFORE dispatch, deliberately. The question this answers
            # is "did the client ask", and a tools/list that the server then
            # failed to serve is still a client that asked.
            client = client_label(context)
            record(
                client,
                getattr(context, "method", "") or "",
                getattr(getattr(context, "message", None), "name", "") or "",
            )
            # Published for persona_history's written_by. Set here because this
            # is already the one place that works the label out, and every MCP
            # request passes through it.
            db.current_client.set(client)
            return await call_next(context)

    mcp.add_middleware(ActivityMiddleware())
