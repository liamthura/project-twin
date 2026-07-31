"""Two users, interleaved. Nobody sees anybody else's persona.

db.current_user_id is a ContextVar set per request and never reset, so
isolation rests entirely on each request running in its own copied context --
a property of the ASGI stack (Starlette/anyio's per-task context copy), not of
this codebase's own code. backend/requirements.txt pins Starlette specifically
for "contextvar/request.state propagation" behaviour, so this has bitten once
already. OAuth turns what used to be one person's traffic into several real
users sharing one server process, and FastMCP's streamable HTTP holds session
state across requests -- exactly the seam where a context could leak from one
request (or one session) into another with no symptom besides a stranger's
data in the response body.

Concurrency note: `client = TestClient(main.app)` is used WITHOUT the `with
client:` context manager on purpose. Starlette's TestClient only reuses a
single shared portal (one background thread, one event loop) when entered as
a context manager; used bare, `_TestClientTransport.handle_request` calls
`self.portal_factory()` fresh on every single request, and that factory spins
up a brand-new `anyio.from_thread.start_blocking_portal` -- a new OS thread
running its own event loop -- per call (see
`starlette/testclient.py::TestClient._portal_factory` /
`_TestClientTransport.handle_request`). Firing many `client.get()` calls from
a ThreadPoolExecutor therefore lands on genuinely independent OS threads and
event loops, not on one shared loop being cooperatively multiplexed. That is
real concurrency, not an illusion of it -- see task-9-report.md for the full
reasoning and the source excerpt that supports it.
"""

import concurrent.futures

import db
import persona_store
from fastapi.testclient import TestClient


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


def test_interleaved_requests_never_cross_personas():
    import main

    # Deliberately NOT `with TestClient(main.app) as client:` -- see module
    # docstring. That form pins every request to one shared portal/event loop;
    # this bare form gives each request its own thread and event loop.
    client = TestClient(main.app)

    alice = _make_user("isolation-alice")
    bob = _make_user("isolation-bob")

    _, alice_token = db.create_token(alice, "alice")
    _, bob_token = db.create_token(bob, "bob")

    _seed_persona(alice, "alice-only")
    _seed_persona(bob, "bob-only")

    def fetch(token: str) -> str:
        res = client.get(
            "/api/files/profile", headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code == 200, res.text
        body = res.json()
        return body["data"].get("basic_info", {}).get("name")

    # Interleaved and concurrent: a context leaking between requests shows up
    # here and essentially nowhere else.
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        futures = [
            pool.submit(fetch, alice_token if index % 2 == 0 else bob_token)
            for index in range(60)
        ]
        results = [
            (index, future.result()) for index, future in enumerate(futures)
        ]

    for index, name in results:
        expected = "alice-only" if index % 2 == 0 else "bob-only"
        assert name == expected, f"request {index} saw {name!r}, expected {expected!r}"
