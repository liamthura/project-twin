"""Two users, interleaved. Nobody sees anybody else's persona.

db.current_user_id is a ContextVar set per request and never reset, so
isolation rests entirely on each request running in its own copied context --
a property of the ASGI stack (Starlette/anyio's per-Task context copy), not of
this codebase's own code. backend/requirements.txt pins Starlette specifically
for "contextvar/request.state propagation" behaviour, so this has bitten once
already. OAuth turns what used to be one person's traffic into several real
users sharing one server process, and FastMCP's streamable HTTP holds session
state across requests -- exactly the seam where a context could leak from one
request (or one session) into another with no symptom besides a stranger's
data in the response body.

Concurrency model -- read this before changing it. An earlier version of this
test drove requests through `TestClient` from a `ThreadPoolExecutor`. That was
wrong: Starlette's `TestClient`, used without `with client:` (no shared
portal), spins up a *brand-new OS thread with its own event loop* for every
single request (`starlette.testclient.TestClient._portal_factory`). A fresh
thread starts with an empty, unshared `contextvars.Context` no matter what any
other thread holds -- so every request was isolated by Python's threading
model *before* Starlette, anyio or FastMCP got any chance to do (or fail) their
job. The one seam this test exists to guard -- a contextvar failing to be
copied per `asyncio.Task` when many requests are multiplexed concurrently on
ONE shared event loop, which is how uvicorn actually serves production
traffic -- was never exercised. A regression there would have sailed straight
through.

This version instead drives every request as a concurrent `asyncio.Task` on a
single event loop, via `httpx.AsyncClient(transport=httpx.ASGITransport(...))`
and `asyncio.gather`. `ASGITransport.handle_async_request` awaits
`self.app(scope, receive, send)` directly, in the calling task's own context,
with no thread and no portal in between -- so `asyncio.gather` over many
`fetch()` calls is many real Tasks contending for one loop, which is exactly
the shape a bug in per-Task context copying would show up in. Confirmed by
reading `httpx._transports.asgi.ASGITransport.handle_async_request`, and by
the deliberate-break experiment recorded in task-9-report.md, which
reproduces a cross-user leak on this harness -- proving this harness is not
passing merely because nothing could interleave.

MCP coverage. The first version of this test named FastMCP's streamable HTTP
session handling as the danger zone in its docstring but only ever called
`/api/files/profile` -- the one component the brief singled out went
untested. `httpx.ASGITransport` does not run ASGI lifespan on its own, and
`main.app`'s lifespan (`mcp_app.lifespan`) is what starts FastMCP's streamable
HTTP session manager; without it, `/mcp` calls fail outright. `asgi-lifespan`
is not a project dependency, so `_run_lifespan` below hand-rolls the same
minimal protocol it provides (send `lifespan.startup`, wait for
`.complete`, hold the app running via an anyio task group, then send
`lifespan.shutdown` on teardown) -- there is no other moving part to it.
`test_interleaved_mcp_tool_calls_never_cross_personas` uses `fastmcp.Client`
(already a project dependency, and the thing that actually knows how to speak
streamable HTTP -- session id extraction, SSE framing, JSON-RPC) pointed at
`main.app` in-process via that same `ASGITransport`, so two real per-user MCP
sessions run real `get_context` tool calls concurrently on one event loop,
through the real auth middleware and the real FastMCP session manager, same
as production.
"""

import asyncio
import contextlib
import json

import anyio
import db
import httpx
import persona_store
import pytest
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport


def _make_user(username: str) -> str:
    user_id, _ = db.create_user(username, password="correct horse battery")
    return user_id


def _seed_persona(user_id: str, marker: str) -> None:
    """Write a distinguishable persona for user_id without touching any
    request context -- set current_user_id just long enough to save, then
    reset it so nothing leaks into the requests made afterwards."""
    token = db.current_user_id.set(user_id)
    try:
        persona_store.save("profile", {"basic_info": {"name": marker}})
    finally:
        db.current_user_id.reset(token)


@contextlib.asynccontextmanager
async def _run_lifespan(app):
    """Drive an ASGI app's lifespan protocol by hand.

    httpx.ASGITransport calls `app(scope, receive, send)` per request but
    never sends a `type: "lifespan"` scope, so nothing in this app's startup
    (in particular, FastMCP's streamable HTTP session manager, wired in via
    `main.app`'s `lifespan=mcp_app.lifespan`) ever runs. This is the entire
    ASGI lifespan protocol and nothing more: request `lifespan.startup`, wait
    for `lifespan.startup.complete`, keep the app's lifespan coroutine alive
    in a task group for the duration of the `with` block, then request
    `lifespan.shutdown` and wait for it to finish.
    """
    startup_complete = anyio.Event()
    shutdown_requested = anyio.Event()
    shutdown_complete = anyio.Event()
    calls = {"n": 0}

    async def receive():
        calls["n"] += 1
        if calls["n"] == 1:
            return {"type": "lifespan.startup"}
        await shutdown_requested.wait()
        return {"type": "lifespan.shutdown"}

    async def send(message):
        if message["type"] == "lifespan.startup.complete":
            startup_complete.set()
        elif message["type"] in ("lifespan.shutdown.complete", "lifespan.shutdown.failed"):
            shutdown_complete.set()

    async with anyio.create_task_group() as tg:
        tg.start_soon(app, {"type": "lifespan"}, receive, send)
        await startup_complete.wait()
        try:
            yield
        finally:
            shutdown_requested.set()
            await shutdown_complete.wait()


@pytest.mark.anyio
async def test_interleaved_http_requests_never_cross_personas():
    """Concurrent GET /api/files/profile calls, two users, one event loop."""
    import main

    transport = httpx.ASGITransport(app=main.app)

    alice = _make_user("isolation-alice")
    bob = _make_user("isolation-bob")

    _, alice_token = db.create_token(alice, "alice")
    _, bob_token = db.create_token(bob, "bob")

    _seed_persona(alice, "alice-only")
    _seed_persona(bob, "bob-only")

    async def fetch(token: str) -> str:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            res = await client.get(
                "/api/files/profile", headers={"Authorization": f"Bearer {token}"}
            )
        assert res.status_code == 200, res.text
        body = res.json()
        return body["data"].get("basic_info", {}).get("name")

    # Interleaved and concurrent: many asyncio Tasks on ONE event loop, the
    # production shape. A context leaking between requests shows up here and
    # essentially nowhere else.
    tasks = [
        fetch(alice_token if index % 2 == 0 else bob_token) for index in range(60)
    ]
    results = await asyncio.gather(*tasks)

    for index, name in enumerate(results):
        expected = "alice-only" if index % 2 == 0 else "bob-only"
        assert name == expected, f"request {index} saw {name!r}, expected {expected!r}"


@pytest.mark.anyio
async def test_interleaved_mcp_tool_calls_never_cross_personas():
    """Concurrent MCP get_context tool calls over real streamable-HTTP
    sessions, two users, one event loop -- the seam the brief names by name:
    FastMCP's session handling holding state across requests."""
    import main

    transport = httpx.ASGITransport(app=main.app)

    def http_client_factory(**kwargs):
        # StreamableHttpTransport hands this a "timeout" kwarg that
        # httpx.AsyncClient(transport=...) doesn't need here; drop it rather
        # than let it collide with the ASGI transport's own request lifecycle.
        kwargs.pop("timeout", None)
        return httpx.AsyncClient(
            transport=transport, base_url="http://testserver", **kwargs
        )

    alice = _make_user("mcp-isolation-alice")
    bob = _make_user("mcp-isolation-bob")

    _, alice_token = db.create_token(alice, "alice")
    _, bob_token = db.create_token(bob, "bob")

    _seed_persona(alice, "alice-only")
    _seed_persona(bob, "bob-only")

    async def call_as(token: str) -> str:
        mcp_transport = StreamableHttpTransport(
            url="http://testserver/mcp",
            headers={"Authorization": f"Bearer {token}"},
            httpx_client_factory=http_client_factory,
        )
        # Each call is its own real session: initialize handshake, then one
        # tool call, then teardown -- same as a real MCP client, just many of
        # them racing on one event loop instead of one at a time.
        async with Client(mcp_transport) as client:
            result = await client.call_tool("get_context", {"scope": "full"})
        payload = json.loads(result.data)
        return payload["context"]["profile"]["basic_info"].get("name")

    async with _run_lifespan(main.app):
        tasks = [
            call_as(alice_token if index % 2 == 0 else bob_token)
            for index in range(20)
        ]
        results = await asyncio.gather(*tasks)

    for index, name in enumerate(results):
        expected = "alice-only" if index % 2 == 0 else "bob-only"
        assert name == expected, (
            f"mcp tool call {index} saw {name!r}, expected {expected!r}"
        )
