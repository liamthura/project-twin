"""What is connected to an account, and what it has done: GET /api/watchtower.

The one place the app answers "is an assistant connected". Onboarding's live
status, the Getting started card and Review's empty state all read this, so
they cannot disagree, which they did while each worked it out in the browser.

Connected means a call was seen. A grant exists from the moment it is approved,
before its client calls, and the web app's own requests look like any other
signed-in traffic, so neither is evidence. mcp_activity is: only MCP requests
reach it. Its rows outlive a revoked token, which is why a connection also needs
a grant or a token that still exists.
"""
import db
import mcp_activity
import proposals_store

PROPOSE = frozenset({"persona:propose", "persona:write"})  # write implies propose (scopes.py)
READ_TOOLS = frozenset({"get_context", "search_context", "get_entity", "get_raw"})


def _bare(label):
    """'claude-code 2.0.14' -> 'claude-code': a client's own name without its version."""
    head, _, tail = (label or "").rpartition(" ")
    return head if head and tail[:1].isdigit() else (label or None)


def summary(rows):
    calls = [r for r in rows if r["method"] == "tools/call"]
    return {
        "called": bool(rows),
        "read": any(r["tool"] in READ_TOOLS for r in calls),
        "suggested": any(r["tool"] == "propose_update" for r in calls),
        "last_seen": max((r["last_seen"] for r in rows), default=None),
    }


def connection(grants, tokens, rows):
    """`grants` and `tokens` newest first, as report() passes them."""
    total = len(grants) + len(tokens)
    if not total:
        return {"state": "none", "name": None, "kind": None, "can_propose": False, "total": 0}
    newest = max(rows, key=lambda r: r["last_seen"], default=None)
    name = ((grants[0]["name"] if grants else None)
            or (tokens[0]["label"] if tokens else None)
            or _bare(newest["client"] if newest else None))
    return {
        "state": "connected" if rows else "waiting",
        "name": name,
        "kind": "grant" if grants else "token",
        "can_propose": any(PROPOSE & set(c.get("scopes") or []) for c in [*grants, *tokens]),
        "total": total,
    }


def report(user_id):
    rows = mcp_activity.usage(user_id)
    tokens = sorted(db.list_tokens(user_id), key=lambda t: t["created_at"], reverse=True)
    return {
        "activity": rows,
        "connection": connection(db.list_grants(user_id), tokens, rows),
        "assistant": summary(rows),
        "pending": proposals_store.pending_counts(),
    }
