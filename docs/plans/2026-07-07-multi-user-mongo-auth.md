# Multi-User MongoDB + Token Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn MyGist from a single-tenant, file-backed, single-shared-token server into a multi-user server backed by MongoDB, where each person registers with just a username and receives a token (no password) that scopes every read/write to their own persona data.

**Architecture:** Introduce two new backend modules — `db.py` (Mongo connection, `users` collection, token hashing, and a `contextvar` holding the current request's `user_id`) and `persona_store.py` (Mongo-backed replacement for the current file-based `load_json`/`save_json`, including the legacy data-normalization logic that already lives in `main.py`). `main.py`'s auth middleware resolves the bearer token to a user once per request and sets the contextvar; `server.py`'s MCP tools and `main.py`'s REST routes both read persona data through the same `persona_store` functions, which look up `current_user_id` internally — so almost none of the ~130 existing call sites inside `server.py`'s 3000-line tool implementation need to change. Registration is self-serve and token-only: `POST /api/auth/register {username}` creates the user and returns a token once.

**Tech Stack:** MongoDB (local via Docker for dev), `pymongo` (sync driver, matching the codebase's existing sync I/O style), `mongomock` + `pytest` for unit tests (no real Mongo needed for those), existing FastAPI + FastMCP stack unchanged otherwise.

**Key facts this plan relies on (verified against the current code):**
- Only 6 MCP tools are registered: `get_context`, `get_raw`, `get_schema`, `persona_modify`, `persona_batch`, `suggest_persona_update` (`backend/server.py:2724-2899`). Everything else in that file is internal helpers reached from these 6 entry points.
- `server.py`'s `load_json`/`save_json` (`backend/server.py:623-638`) are called 39 / 89 times respectively, always with a `"<type>.json"`-style filename. We keep that exact call signature so none of those call sites change.
- `main.py` has its own **duplicate** implementation (`read_json_file`/`write_json_file`/`get_file_path`, `main.py:181-345`) using bare `"<type>"` names (no `.json` suffix), plus important legacy-data-normalization logic in `read_json_file` (`main.py:196-334`) that must be preserved.
- `conversation_context` (`server.py:139`, a process-global `ConversationContext()`) is defined but **never actually passed to `resolve_pronoun_references`** anywhere in the file — it's dead code today. Out of scope for this plan; do not touch it.
- The frontend (`frontend/src/components/ConnectionSettings.jsx`, `frontend/src/lib/api.js`) already stores `{serverUrl, token}` in `localStorage` and sends `Authorization: Bearer <token>` on every request — the "enter your token" UX already exists and needs no rework, only a "create account" addition.

---

### Task 0: Local MongoDB + dependencies

**Files:**
- Modify: `backend/docker-compose.yml`
- Modify: `backend/requirements.txt`
- Create: `backend/requirements-dev.txt`
- Modify: `backend/.env.example`

**Step 1: Add a `mongo` service to docker-compose for local dev**

Edit `backend/docker-compose.yml` to add a Mongo service and wire the app to it:

```yaml
services:
  mongo:
    image: mongo:7
    container_name: mygist-mongo
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    restart: unless-stopped

  mygist:
    build: .
    container_name: mygist-api
    ports:
      - "8000:8000"
    environment:
      - MONGODB_URI=mongodb://mongo:27017
      - MONGODB_DB_NAME=mygist
      - DEBUG=true
    depends_on:
      - mongo
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    restart: unless-stopped

volumes:
  mongo_data:
```

Note this drops `MYGIST_API_TOKEN` and `PERSONA_DATA_DIR` — both are replaced by the Mongo-backed auth/data model built in this plan.

**Step 2: Add `pymongo` to runtime deps**

Append to `backend/requirements.txt`:

```
# MongoDB driver
pymongo>=4.6.0
```

**Step 3: Add a dev-only requirements file for tests**

Create `backend/requirements-dev.txt`:

```
-r requirements.txt
pytest>=7.4.0
mongomock>=4.1.2
httpx>=0.25.0
```

**Step 4: Update `.env.example`**

Replace the `MYGIST_API_TOKEN` / `PERSONA_DATA_DIR` section in `backend/.env.example` with:

```
# REQUIRED - MongoDB connection
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=mygist
```

**Step 5: Bring Mongo up locally and verify**

Run: `cd backend && docker compose up -d mongo`
Expected: container `mygist-mongo` running; `docker compose ps` shows `healthy`/`running`.

Run: `mongosh mongodb://localhost:27017 --eval "db.runCommand({ping: 1})"`
Expected: `{ ok: 1 }`

**Step 6: Install dev deps in the venv**

Run: `cd backend && source venv/bin/activate && pip install -r requirements-dev.txt`
Expected: installs cleanly, no errors.

**Step 7: Commit**

```bash
git add backend/docker-compose.yml backend/requirements.txt backend/requirements-dev.txt backend/.env.example
git commit -m "chore: add MongoDB service and dependencies for multi-user backend"
```

---

### Task 1: De-risk — verify a contextvar set in FastAPI middleware is visible inside FastMCP tool calls

This is the load-bearing assumption of the whole plan: setting a `contextvar` once per request (in middleware) should be readable from inside the 6 MCP tool functions without threading a parameter through every internal call. Prove it before refactoring 3000 lines on top of it.

**Files:**
- Create (temporary, deleted at end of task): `backend/_contextvar_probe.py`
- Modify (temporary edit, reverted at end of task): `backend/main.py`, `backend/server.py`

**Step 1: Add a probe tool and probe middleware**

Create `backend/_contextvar_probe.py`:

```python
from contextvars import ContextVar

probe_var: ContextVar[str] = ContextVar("probe_var", default="UNSET")
```

Temporarily add to `backend/server.py` (near the other `@mcp.tool()` defs, e.g. after `get_schema`):

```python
from _contextvar_probe import probe_var

@mcp.tool()
def _probe() -> str:
    return probe_var.get()
```

Temporarily add to `backend/main.py`'s `auth_middleware`, right before `return await call_next(request)`:

```python
from _contextvar_probe import probe_var
probe_var.set(request.headers.get("X-Probe", "NONE"))
```

**Step 2: Run the server and call the probe tool with two different header values**

Run: `cd backend && source venv/bin/activate && uvicorn main:app --port 8000 &`

Use an MCP client (or `curl` against the MCP HTTP transport, or simplest: a quick Python script using `fastmcp.Client`) to call the `_probe` tool twice, in two separate HTTP requests, with `X-Probe: alice` and `X-Probe: bob` respectively.

Expected: first call returns `"alice"`, second returns `"bob"` — proving the value set in FastAPI middleware for a given request is visible inside that same request's MCP tool call, and that two different requests don't leak into each other.

**If this fails** (returns `"NONE"` or a stale/wrong value): fall back to resolving identity independently inside each of the 6 tool functions via `fastmcp.server.dependencies.get_http_headers()` instead of relying on a middleware-set contextvar. Flag this back before continuing — it changes Task 4 below (6 tool functions would each need 2 lines added instead of zero).

**Step 3: Revert the probe**

```bash
rm backend/_contextvar_probe.py
git checkout -- backend/main.py backend/server.py
```

(No commit for this task — it's a spike, not a shipped change.)

---

### Task 2: `db.py` — Mongo connection, user registry, token auth primitives

**Files:**
- Create: `backend/db.py`
- Create: `backend/tests/test_db.py`
- Create: `backend/tests/__init__.py` (empty)

**Step 1: Write the failing tests**

Create `backend/tests/test_db.py`:

```python
import mongomock
import pytest

import db


@pytest.fixture(autouse=True)
def fake_mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(db, "_client", client)
    db.ensure_indexes()
    yield client


def test_create_user_returns_id_and_token():
    user_id, token = db.create_user("alice")
    assert user_id
    assert len(token) > 20


def test_create_user_rejects_duplicate_username():
    db.create_user("alice")
    with pytest.raises(db.DuplicateUsernameError):
        db.create_user("alice")


def test_resolve_token_finds_matching_user():
    user_id, token = db.create_user("alice")
    user = db.resolve_token(token)
    assert user is not None
    assert str(user["_id"]) == user_id
    assert user["username"] == "alice"


def test_resolve_token_rejects_unknown_token():
    assert db.resolve_token("not-a-real-token") is None


def test_resolve_token_rejects_wrong_token_for_real_user():
    db.create_user("alice")
    assert db.resolve_token("some-other-token") is None


def test_rotate_token_invalidates_old_token():
    user_id, old_token = db.create_user("alice")
    new_token = db.rotate_token(user_id)
    assert db.resolve_token(old_token) is None
    user = db.resolve_token(new_token)
    assert str(user["_id"]) == user_id
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && source venv/bin/activate && pytest tests/test_db.py -v`
Expected: `ModuleNotFoundError: No module named 'db'` (or collection error) — `db.py` doesn't exist yet.

**Step 3: Implement `backend/db.py`**

```python
"""
MongoDB connection, user registry, and token-based auth primitives.

Auth model: a token IS the credential (no password). Registering with a
username generates a token; the plaintext token is returned exactly once
and only its sha256 hash is stored.
"""

import hashlib
import os
import secrets
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Optional

from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError

_client: Optional[MongoClient] = None

# Set once per request by main.py's auth middleware; read by persona_store.py
# (and, transitively, by server.py's MCP tools) to scope data to the caller.
current_user_id: ContextVar[str] = ContextVar("current_user_id")


class DuplicateUsernameError(Exception):
    pass


def get_client() -> MongoClient:
    global _client
    if _client is None:
        uri = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
        _client = MongoClient(uri)
    return _client


def get_db():
    db_name = os.getenv("MONGODB_DB_NAME", "mygist")
    return get_client()[db_name]


def ensure_indexes() -> None:
    db = get_db()
    db.users.create_index("username", unique=True)
    db.users.create_index("token_hash", unique=True)
    db.persona_data.create_index(
        [("user_id", ASCENDING), ("file_type", ASCENDING)], unique=True
    )


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_user(username: str) -> tuple[str, str]:
    """Create a user with a fresh token. Returns (user_id, plaintext_token)."""
    token = secrets.token_urlsafe(32)
    doc = {
        "username": username,
        "token_hash": hash_token(token),
        "created_at": datetime.now(timezone.utc),
        "last_seen_at": None,
    }
    try:
        result = get_db().users.insert_one(doc)
    except DuplicateKeyError:
        raise DuplicateUsernameError(username)
    return str(result.inserted_id), token


def resolve_token(token: str) -> Optional[dict]:
    """Look up the user for a bearer token, touching last_seen_at. None if invalid."""
    users = get_db().users
    user = users.find_one({"token_hash": hash_token(token)})
    if user:
        users.update_one(
            {"_id": user["_id"]},
            {"$set": {"last_seen_at": datetime.now(timezone.utc)}},
        )
    return user


def rotate_token(user_id) -> str:
    """Issue a new token for an existing user, invalidating the old one."""
    from bson import ObjectId

    token = secrets.token_urlsafe(32)
    get_db().users.update_one(
        {"_id": ObjectId(user_id)}, {"$set": {"token_hash": hash_token(token)}}
    )
    return token
```

**Step 4: Run tests to verify they pass**

Run: `pytest tests/test_db.py -v`
Expected: all 6 tests PASS.

**Step 5: Commit**

```bash
git add backend/db.py backend/tests/
git commit -m "feat: add Mongo-backed user registry and token auth"
```

---

### Task 3: `persona_store.py` — Mongo-backed persona data layer

This replaces the storage guts of both `server.py`'s `load_json`/`save_json` and `main.py`'s `read_json_file`/`write_json_file`, unifying the two duplicate implementations into one. It reads `db.current_user_id` internally, so callers don't pass a user around.

**Files:**
- Create: `backend/persona_store.py`
- Create: `backend/tests/test_persona_store.py`

**Step 1: Write the failing tests**

Create `backend/tests/test_persona_store.py`:

```python
import mongomock
import pytest

import db
import persona_store as store


@pytest.fixture(autouse=True)
def fake_mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(db, "_client", client)
    db.ensure_indexes()
    yield client


@pytest.fixture
def as_user():
    token = db.current_user_id.set("user-1")
    yield
    db.current_user_id.reset(token)


def test_load_unknown_file_returns_default(as_user):
    data = store.load("profile")
    assert data == store.DEFAULTS["profile"]


def test_save_then_load_round_trips(as_user):
    store.save("profile", {**store.DEFAULTS["profile"], "name": "Alice"})
    assert store.load("profile")["name"] == "Alice"


def test_data_is_isolated_per_user(monkeypatch):
    token_a = db.current_user_id.set("user-a")
    store.save("profile", {**store.DEFAULTS["profile"], "name": "Alice"})
    db.current_user_id.reset(token_a)

    token_b = db.current_user_id.set("user-b")
    store.save("profile", {**store.DEFAULTS["profile"], "name": "Bob"})
    assert store.load("profile")["name"] == "Bob"
    db.current_user_id.reset(token_b)

    token_a2 = db.current_user_id.set("user-a")
    assert store.load("profile")["name"] == "Alice"
    db.current_user_id.reset(token_a2)


def test_get_all_returns_every_file_type(as_user):
    all_data = store.get_all()
    assert set(all_data.keys()) == set(store.VALID_FILES)
```

**Step 2: Run tests to verify they fail**

Run: `pytest tests/test_persona_store.py -v`
Expected: `ModuleNotFoundError: No module named 'persona_store'`.

**Step 3: Implement `backend/persona_store.py`**

Move `VALID_FILES` and `DEFAULTS` here verbatim from `backend/main.py:100-173` (the canonical copy — `server.py`'s `FILE_MAP` derives from the same set of types). Move the legacy-normalization logic verbatim from `backend/main.py:196-334` (the big `if file_type == "profile": ...` / `"projects"` / `"knowledge"` / `"preferences"` / `"lifestyle"` / `"learning_log"` block) into `_normalize()` below — copy that block's body as-is, it doesn't need to change.

```python
"""
Mongo-backed persona data store, scoped to the current request's user via
db.current_user_id. Replaces the old per-file-on-disk storage in main.py and
server.py; keeps the same "load whole blob / save whole blob" shape those
callers already expect.
"""

from datetime import datetime, timezone

import db

VALID_FILES = ["profile", "knowledge", "preferences", "projects", "lifestyle", "circle", "learning_log"]

FILE_MAP = {name: f"{name}.json" for name in VALID_FILES}

# Paste verbatim from backend/main.py:104-173
DEFAULTS = {
    # ... (copy exactly from main.py)
}


def _normalize(file_type: str, data: dict) -> dict:
    """Legacy-format migration, ported verbatim from main.py's read_json_file.

    Paste the body of the `if file_type == "profile": ...` through
    `if file_type == "learning_log": ...` block from main.py:196-334 here,
    operating on `data` instead of a locally-scoped `data` read from disk.
    """
    # ... (copy exactly from main.py:196-334)
    return data


def load(file_type: str) -> dict:
    """Load one persona file for the current user, or its default."""
    if file_type not in VALID_FILES:
        return {"error": f"{file_type} not found"}
    user_id = db.current_user_id.get()
    doc = db.get_db().persona_data.find_one({"user_id": user_id, "file_type": file_type})
    if doc is None:
        return DEFAULTS.get(file_type, {})
    return _normalize(file_type, doc["data"])


def save(file_type: str, data: dict) -> bool:
    """Save (upsert) one persona file for the current user."""
    user_id = db.current_user_id.get()
    db.get_db().persona_data.update_one(
        {"user_id": user_id, "file_type": file_type},
        {"$set": {"data": data, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return True


def get_all() -> dict:
    """Load every persona file for the current user."""
    return {file_type: load(file_type) for file_type in VALID_FILES}


def reset(file_type: str) -> bool:
    """Reset one file to its default."""
    return save(file_type, DEFAULTS[file_type])
```

**Step 4: Run tests to verify they pass**

Run: `pytest tests/test_persona_store.py -v`
Expected: all 4 tests PASS, including `test_data_is_isolated_per_user` (the one that actually matters for multi-tenancy).

**Step 5: Commit**

```bash
git add backend/persona_store.py backend/tests/test_persona_store.py
git commit -m "feat: add Mongo-backed persona_store, unifying main.py/server.py data access"
```

---

### Task 4: Wire `server.py` to `persona_store` (no changes to the ~130 internal call sites)

**Files:**
- Modify: `backend/server.py`

**Step 1: Remove the file-based data layer**

Delete from `backend/server.py`:
- `resolve_data_dir()` and the `DATA_DIR = resolve_data_dir()` block (`server.py:52-70`)
- The original `load_json`/`save_json` bodies (`server.py:623-638`)
- The local `FILE_MAP` dict (`server.py:74-82`) — replaced by the import below

**Step 2: Replace with thin delegators to `persona_store`**

Add near the top of `server.py` (with the other imports):

```python
import persona_store
from persona_store import FILE_MAP, DEFAULTS, get_all as get_all_persona_data
```

Replace the deleted `load_json`/`save_json` with:

```python
def load_json(filename: str) -> dict:
    """Load JSON data for the current user. `filename` is the historical
    "<type>.json" form used throughout this file; persona_store works in
    bare type names."""
    file_type = filename[:-5] if filename.endswith(".json") else filename
    return persona_store.load(file_type)


def save_json(filename: str, data: dict) -> bool:
    file_type = filename[:-5] if filename.endswith(".json") else filename
    return persona_store.save(file_type, data)
```

Every other call site in `server.py` (39 `load_json(...)` calls, 89 `save_json(...)` calls, 4 `get_all_persona_data()` calls) keeps working unchanged, because the signatures are identical to what they replace.

**Step 3: Sanity-check nothing else referenced `DATA_DIR` directly**

Run: `grep -n "DATA_DIR" backend/server.py`
Expected: no output (only the commented-out archive block below line 2980 may still mention it inside `#` comments — leave those, they're already dead/commented code, not executed).

**Step 4: Run the contextvar probe pattern for real (manual smoke test)**

Run: `cd backend && source venv/bin/activate && MONGODB_URI=mongodb://localhost:27017 uvicorn main:app --port 8000 --reload &`

(main.py isn't wired to Mongo auth yet — Task 5 — so for this step just confirm the app **imports and starts without error**, proving `server.py`'s new imports resolve.)

Expected: server starts, logs `Data directory: ...` line removed/absent, no `ImportError`/`AttributeError` on startup.

**Step 5: Commit**

```bash
git add backend/server.py
git commit -m "refactor: point server.py's load_json/save_json at persona_store"
```

---

### Task 5: Wire `main.py`'s auth middleware and REST routes to Mongo

**Files:**
- Modify: `backend/main.py`

**Step 1: Remove the old file-based data layer and static-token auth**

Delete from `backend/main.py`:
- `resolve_data_dir()` / `DATA_DIR` (`main.py:29-46`)
- `VALID_FILES`, `DEFAULTS` (`main.py:100-173`) — now imported from `persona_store`
- `get_file_path`, `read_json_file`, `write_json_file` (`main.py:181-345`) — replaced by `persona_store.load`/`persona_store.save`, which already have the matching `(file_type)` / `(file_type, data)` signatures, so route bodies below don't change.

**Step 2: Add the imports**

```python
import db
import persona_store
from persona_store import VALID_FILES, DEFAULTS

read_json_file = persona_store.load
write_json_file = persona_store.save
```

(Aliasing keeps every existing route body — `read_json_file(file_type)`, `write_json_file(file_type, update.data)`, etc. — byte-for-byte unchanged.)

**Step 3: Replace the auth middleware**

Replace the body of `auth_middleware` (`main.py:59-76`):

```python
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    if path in ("/health", "/healthz", "/api/health", "/api/auth/register"):
        return await call_next(request)

    if path.startswith("/mcp") or path.startswith("/api"):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        user = db.resolve_token(auth[7:])
        if not user:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        db.current_user_id.set(str(user["_id"]))
        request.state.username = user["username"]

    return await call_next(request)
```

**Step 4: Fix the two routes that referenced `DATA_DIR` directly**

`/health` (`main.py:352-361`) and `/api/files` (`main.py:364-374`) printed filesystem paths — replace with Mongo-appropriate info:

```python
@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "mygist"}


@app.get("/api/files")
async def list_files():
    """List persona file types and whether the current user has data for them."""
    user_id = db.current_user_id.get()
    existing = {
        doc["file_type"]
        for doc in db.get_db().persona_data.find({"user_id": user_id}, {"file_type": 1})
    }
    return {"files": {ft: {"exists": ft in existing} for ft in VALID_FILES}}
```

**Step 5: Call `db.ensure_indexes()` at startup**

Right after `app = FastAPI(...)`, add:

```python
db.ensure_indexes()
```

**Step 6: Manual smoke test — register, then hit an authed route**

Run: `cd backend && MONGODB_URI=mongodb://localhost:27017 uvicorn main:app --port 8000 --reload &`

Run:
```bash
curl -s -X POST localhost:8000/api/auth/register -H 'Content-Type: application/json' -d '{"username":"alice"}'
```
Expected: 404 for now (endpoint added in Task 6) — confirms this task is done and the next one is needed. Instead, verify auth is wired by hitting a protected route with no token:

Run: `curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/files`
Expected: `401`

**Step 7: Commit**

```bash
git add backend/main.py
git commit -m "refactor: replace static-token auth middleware with Mongo user lookup"
```

---

### Task 6: Auth endpoints — register, whoami, rotate

**Files:**
- Modify: `backend/main.py`
- Create: `backend/tests/test_auth_routes.py`

**Step 1: Write the failing tests**

Create `backend/tests/test_auth_routes.py`:

```python
import mongomock
import pytest
from fastapi.testclient import TestClient

import db
import main


@pytest.fixture(autouse=True)
def fake_mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(db, "_client", client)
    db.ensure_indexes()
    yield client


@pytest.fixture
def client():
    return TestClient(main.app)


def test_register_returns_a_token(client):
    resp = client.post("/api/auth/register", json={"username": "alice"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "alice"
    assert len(body["token"]) > 20


def test_register_rejects_duplicate_username(client):
    client.post("/api/auth/register", json={"username": "alice"})
    resp = client.post("/api/auth/register", json={"username": "alice"})
    assert resp.status_code == 409


def test_whoami_identifies_the_caller(client):
    token = client.post("/api/auth/register", json={"username": "alice"}).json()["token"]
    resp = client.get("/api/auth/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"


def test_whoami_rejects_missing_token(client):
    resp = client.get("/api/auth/whoami")
    assert resp.status_code == 401


def test_rotate_issues_a_new_token_and_invalidates_the_old_one(client):
    token = client.post("/api/auth/register", json={"username": "alice"}).json()["token"]
    resp = client.post("/api/auth/rotate", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    new_token = resp.json()["token"]
    assert new_token != token

    old = client.get("/api/auth/whoami", headers={"Authorization": f"Bearer {token}"})
    assert old.status_code == 401
    new = client.get("/api/auth/whoami", headers={"Authorization": f"Bearer {new_token}"})
    assert new.status_code == 200
```

**Step 2: Run tests to verify they fail**

Run: `pytest tests/test_auth_routes.py -v`
Expected: 404s (routes don't exist yet).

**Step 3: Implement the routes**

Add to `backend/main.py`:

```python
class RegisterRequest(BaseModel):
    username: str


@app.post("/api/auth/register")
async def register(body: RegisterRequest):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    try:
        user_id, token = db.create_user(username)
    except db.DuplicateUsernameError:
        raise HTTPException(status_code=409, detail="username already taken")
    return {"user_id": user_id, "username": username, "token": token}


@app.get("/api/auth/whoami")
async def whoami(request: Request):
    return {"user_id": db.current_user_id.get(), "username": request.state.username}


@app.post("/api/auth/rotate")
async def rotate(request: Request):
    new_token = db.rotate_token(db.current_user_id.get())
    return {"token": new_token}
```

**Step 4: Run tests to verify they pass**

Run: `pytest tests/test_auth_routes.py -v`
Expected: all 5 PASS.

**Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_auth_routes.py
git commit -m "feat: add self-serve token registration, whoami, and rotate endpoints"
```

---

### Task 7: Export / import against Mongo

**Files:**
- Modify: `backend/main.py`

The zip file *format* on disk shouldn't change (so old backups still import), only where the bytes come from.

**Step 1: Rewrite `/api/export`** (`main.py:424-449`) to read from `persona_store` instead of globbing `DATA_DIR`:

```python
@app.get("/api/export")
async def export_data():
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        file_names = []
        for file_type in VALID_FILES:
            data = persona_store.load(file_type)
            name = f"{file_type}.json"
            zf.writestr(name, json.dumps(data, indent=2))
            file_names.append(name)
        metadata = {
            "exported_at": datetime.now().isoformat(),
            "version": "2.0.0",
            "files": file_names,
        }
        zf.writestr("_metadata.json", json.dumps(metadata, indent=2))

    zip_buffer.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"mygist_backup_{timestamp}.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
```

**Step 2: Rewrite `/api/import`** (`main.py:486-544`) to upsert into Mongo. Keep the existing `deep_merge` helper (`main.py:452-478`) unchanged — only where data comes from/goes to changes:

```python
@app.post("/api/import")
async def import_data(file: UploadFile = File(...), mode: str = "replace"):
    if mode not in ("replace", "merge"):
        raise HTTPException(status_code=400, detail="Mode must be 'replace' or 'merge'")
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a .zip archive")

    zip_data = await file.read()
    try:
        zip_buffer = io.BytesIO(zip_data)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            for name in zf.namelist():
                if not name.endswith(".json"):
                    continue
                if ".." in name or name.startswith("/"):
                    raise HTTPException(status_code=400, detail=f"Invalid filename: {name}")

            imported_files = []
            for name in zf.namelist():
                if not (name.endswith(".json") and not name.startswith("_")):
                    continue
                file_type = name[:-5]
                if file_type not in VALID_FILES:
                    continue
                incoming_data = json.loads(zf.read(name))
                if mode == "merge":
                    existing_data = persona_store.load(file_type)
                    incoming_data = deep_merge(existing_data, incoming_data)
                persona_store.save(file_type, incoming_data)
                imported_files.append(name)

            return {"status": "success", "mode": mode, "imported_files": imported_files}
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")
```

Note the pre-import on-disk backup (`main.py:513-517`, `shutil.copytree`) is dropped — there's no `DATA_DIR` to copy anymore. If you want a safety net before merge/replace, call the export logic in-process first and write the resulting bytes to `backend/backups/mygist_backup_<user_id>_<timestamp>.zip` before proceeding; skipped here as optional polish, not required for correctness.

**Step 3: Manual test — export then re-import**

Run: `curl -s localhost:8000/api/export -H "Authorization: Bearer $TOKEN" -o /tmp/backup.zip`
Run: `curl -s -X POST localhost:8000/api/import -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/backup.zip" -F "mode=replace"`
Expected: `{"status": "success", ...}` listing all 7 file types.

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "refactor: export/import against Mongo instead of the filesystem"
```

---

### Task 8: Migration script — bring your existing `mygist_data/*.json` into Mongo

**Files:**
- Create: `backend/scripts/migrate_json_to_mongo.py`

**Step 1: Write the script**

```python
#!/usr/bin/env python3
"""
One-off: load existing mygist_data/*.json files into Mongo under a
newly-registered user account.

Usage:
    python scripts/migrate_json_to_mongo.py --username <you> [--data-dir ../../mygist_data]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import db
import persona_store


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--data-dir", default=str(Path(__file__).parent.parent.parent / "mygist_data"))
    args = parser.parse_args()

    db.ensure_indexes()
    user_id, token = db.create_user(args.username)

    reset_token = db.current_user_id.set(user_id)
    data_dir = Path(args.data_dir)
    migrated = []
    for file_type in persona_store.VALID_FILES:
        path = data_dir / f"{file_type}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        persona_store.save(file_type, data)
        migrated.append(file_type)
    db.current_user_id.reset(reset_token)

    print(f"Created user '{args.username}' (id={user_id})")
    print(f"Migrated: {', '.join(migrated) or '(none found)'}")
    print(f"\nYOUR TOKEN (save this now, it will not be shown again):\n{token}\n")


if __name__ == "__main__":
    main()
```

**Step 2: Run it against your real data**

Run: `cd backend && source venv/bin/activate && MONGODB_URI=mongodb://localhost:27017 python scripts/migrate_json_to_mongo.py --username <your-name>`
Expected: prints `Migrated: profile, knowledge, preferences, projects, lifestyle, circle, learning_log` and a token.

Save that token — it's what replaces your old `MYGIST_API_TOKEN` in Claude Desktop's config and in the frontend's connection settings.

**Step 3: Verify via the API**

Run: `curl -s localhost:8000/api/all -H "Authorization: Bearer <token-from-above>" | jq '.data.profile.name'`
Expected: your actual name from the old `mygist_data/profile.json`.

**Step 4: Commit**

```bash
git add backend/scripts/migrate_json_to_mongo.py
git commit -m "feat: add script to migrate existing JSON persona data into Mongo"
```

(Do not commit `mygist_data/` deletion in this task — leave the old files in place as a safety net until you've confirmed the Mongo-backed server works end-to-end.)

---

### Task 9: Two-user isolation end-to-end test

This is the test that actually validates "multi-user" — everything above is plumbing in service of this.

**Files:**
- Create: `backend/tests/test_multi_user_isolation.py`

**Step 1: Write the test**

```python
import mongomock
import pytest
from fastapi.testclient import TestClient

import db
import main


@pytest.fixture(autouse=True)
def fake_mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(db, "_client", client)
    db.ensure_indexes()
    yield client


@pytest.fixture
def client():
    return TestClient(main.app)


def test_two_users_have_completely_isolated_persona_data(client):
    token_a = client.post("/api/auth/register", json={"username": "alice"}).json()["token"]
    token_b = client.post("/api/auth/register", json={"username": "bob"}).json()["token"]

    client.put(
        "/api/files/profile",
        json={"data": {"name": "Alice"}},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    client.put(
        "/api/files/profile",
        json={"data": {"name": "Bob"}},
        headers={"Authorization": f"Bearer {token_b}"},
    )

    resp_a = client.get("/api/files/profile", headers={"Authorization": f"Bearer {token_a}"})
    resp_b = client.get("/api/files/profile", headers={"Authorization": f"Bearer {token_b}"})

    assert resp_a.json()["data"]["name"] == "Alice"
    assert resp_b.json()["data"]["name"] == "Bob"


def test_a_users_token_cannot_read_another_users_data_even_by_guessing_user_id(client):
    token_a = client.post("/api/auth/register", json={"username": "alice"}).json()["token"]
    client.post("/api/auth/register", json={"username": "bob"}).json()["token"]

    # There is no endpoint that takes a user_id from the client at all --
    # identity comes only from the bearer token. Confirm whoami reflects
    # the token owner regardless of what's asked for.
    resp = client.get("/api/auth/whoami", headers={"Authorization": f"Bearer {token_a}"})
    assert resp.json()["username"] == "alice"
```

**Step 2: Run and confirm pass**

Run: `pytest tests/test_multi_user_isolation.py -v`
Expected: both PASS.

**Step 3: Run the full test suite**

Run: `pytest -v`
Expected: all tests across `test_db.py`, `test_persona_store.py`, `test_auth_routes.py`, `test_multi_user_isolation.py` PASS.

**Step 4: Commit**

```bash
git add backend/tests/test_multi_user_isolation.py
git commit -m "test: verify persona data is fully isolated between two users"
```

---

### Task 10: Frontend — self-serve registration + whoami display

**Files:**
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/components/ConnectionSettings.jsx`

**Step 1: Add API client functions**

In `frontend/src/lib/api.js`, add alongside the existing `testConnection`/`exportData` functions:

```javascript
async function registerAccount(serverUrl, username) {
  const res = await fetch(`${serverUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Registration failed");
  }
  return res.json(); // { user_id, username, token }
}

async function whoami() {
  return api("/auth/whoami");
}
```

Add `registerAccount` and `whoami` to the file's exports.

**Step 2: Add a "Create account" mode to `ConnectionSettings.jsx`**

In `frontend/src/components/ConnectionSettings.jsx`, add state and a toggle alongside the existing token input:

```jsx
import { registerAccount, whoami } from "@/lib/api.js";

// inside the component, alongside existing useState calls:
const [mode, setMode] = useState("connect"); // "connect" | "register"
const [username, setUsername] = useState("");
const [connectedAs, setConnectedAs] = useState(null);

const handleRegister = async () => {
  if (!serverUrl || !username) return;
  setTesting(true);
  try {
    const { token: newToken } = await registerAccount(serverUrl, username);
    setToken(newToken);
    setMode("connect");
    setTestResult({ success: true, message: "Account created — token filled in below. Save it, it won't be shown again." });
  } catch (err) {
    setTestResult({ success: false, message: err.message });
  } finally {
    setTesting(false);
  }
};
```

After a successful `handleTest()` connection check, also call `whoami()` and store the username in `connectedAs` so the dialog can show "Connected as {connectedAs}" instead of a bare checkmark. Wire a small text link/button ("Don't have a token? Create an account") that flips `mode` to `"register"` and reveals a username field + a "Create account" button calling `handleRegister`.

**Step 3: Manual browser test**

Run: `cd frontend && npm run dev`

In the browser:
1. Open connection settings, click "Create an account", enter a new username, submit.
2. Confirm a token appears pre-filled and a "save this now" message is shown.
3. Click "Test connection" / save — confirm it shows "Connected as `<username>`".
4. Edit and save a persona field; reload the page; confirm the edit persisted (proves the token round-trips correctly through the UI).
5. Open a private/incognito window, register a *second* username, edit a persona field there, and confirm the first browser's data is untouched on reload.

**Step 4: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/components/ConnectionSettings.jsx
git commit -m "feat: add self-serve account registration and whoami display to frontend"
```

---

### Task 11: Update docs

**Files:**
- Modify: `README.md`
- Modify: `backend/.env.example` (already done in Task 0 — just double check it's consistent)

**Step 1: Update `README.md`**

Replace the "Connect to Claude Desktop" section's token guidance and the Quick Start section to reflect: (a) MongoDB is now required (`MONGODB_URI`), (b) tokens come from `POST /api/auth/register {username}` or the frontend's "Create account" flow, not a single `MYGIST_API_TOKEN` env var. Remove references to `PERSONA_DATA_DIR`.

**Step 2: Commit**

```bash
git add README.md backend/.env.example
git commit -m "docs: update README for multi-user Mongo-backed auth"
```

---

## What's explicitly out of scope (call these out, don't silently build them)

- **Admin UI/endpoint for listing or deleting users** — not needed at "a handful of users" scale; can be done directly via `mongosh` if ever needed.
- **Rate limiting / brute-force protection on `/api/auth/register` or token guessing** — tokens are 256 bits of entropy from `secrets.token_urlsafe(32)`, effectively unguessable; add rate limiting only if this becomes internet-facing at real scale.
- **Fixing the dead `ConversationContext` global** — confirmed unused (nothing calls `resolve_pronoun_references`), so it isn't a multi-user leak today. Leave it alone.
- **Token expiry** — tokens are long-lived by design (like API keys); `POST /api/auth/rotate` covers the "I think mine leaked" case.
