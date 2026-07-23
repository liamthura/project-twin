# Hybrid Search Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec: `docs/superpowers/specs/2026-07-21-search-retrieval-design.md` (read it for rationale; this plan is self-contained for execution).

**Goal:** Per-entity hybrid search (Postgres FTS + optional pgvector embeddings) behind two new MCP tools (`search_context`, `get_entity`), with the existing `topic` filter rewired through it.

**Architecture:** A sibling `persona_search` table (one row per id-carrying entity) is synced by content-hash diff inside `persona_store.save`; embeddings are computed by a background worker thread through a provider abstraction (Voyage or any OpenAI-compatible endpoint, e.g. Ollama) and are optional at every level — no key, no pgvector, or a dim mismatch all degrade to FTS-only without ever failing a write or startup.

**Tech Stack:** Python 3.11, FastAPI/fastmcp (sync tools), psycopg 3 (sync pool), pgvector, httpx, pytest against the real Postgres test-db (`pgvector/pg16` image on :5433).

## Global Constraints

- Backend only; frontend untouched. `persona_data` rows are never modified by this feature.
- New env vars (exact names): `EMBEDDING_PROVIDER` (default `voyage`), `VOYAGE_API_KEY`, `EMBEDDING_API_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` (default `voyage-3.5-lite`), `EMBEDDING_DIM` (default `1024`).
- Failure doctrine (spec table, binding): missing key/pgvector/dim-mismatch → FTS-only mode; Voyage/HTTP errors on write → row keeps NULL embedding; on query → that search degrades to FTS-only; index-sync exceptions are logged and never fail the persona write; startup never fails because of this feature.
- Only new runtime dependency: move `httpx` from requirements-dev.txt into requirements.txt pinned as `httpx==0.28.1`.
- Tests: no network. All embedding tests use fakes/`httpx.MockTransport`. Run from `backend/`: `python -m pytest tests/ -q` (needs the test-db: `docker compose up -d test-db`). Full suite must stay green after every task; suite currently passes 159.
- Commit trailer for every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
backend/
  embeddings.py               NEW — provider factory: Voyage / OpenAI-compatible via httpx
  search_index.py             NEW — flatten, hash-diff sync, background embed, hybrid query, lazy heal, prefix map
  db.py                       MODIFY — persona_search schema, VECTOR_AVAILABLE flag, dim check
  persona_store.py            MODIFY — sync hook in save()
  server.py                   MODIFY — search_context + get_entity tools; topic rewire; get_raw docstring
  scripts/backfill_search_index.py  NEW — full rebuild (+ --recreate for dim changes)
  tests/
    conftest.py               MODIFY — drop persona_search in clean_database
    test_embeddings.py        NEW
    test_search_flatten.py    NEW
    test_search_sync.py       NEW
    test_search_query.py      NEW
    test_get_entity.py        NEW
    test_search_tools_dispatch.py  NEW
    test_topic_rewire.py      NEW
    test_vector_unavailable.py NEW
    test_backfill_script.py   NEW
```

---

### Task 1: Schema — `persona_search` table, optional pgvector, conftest

**Files:**
- Modify: `backend/db.py` (ensure_schema, ~line 49; add module globals near line 22)
- Modify: `backend/tests/conftest.py` (clean_database fixture, ~line 27)
- Test: `backend/tests/test_vector_unavailable.py` (schema half), extend `backend/tests/test_db.py`

**Interfaces:**
- Produces: `db.VECTOR_AVAILABLE: bool` (module global, set by `ensure_schema()`); `db.EMBEDDING_DIM: int`; `db._try_create_vector_extension(conn) -> bool` (separated for testability); table `persona_search`.
- Consumes: existing `db.get_pool()`, `db.ensure_schema()`.

- [ ] **Step 1: Update conftest so the new table is dropped between tests**

In `clean_database`, add before `drop table if exists tokens;`:

```python
        cur.execute("drop table if exists persona_search;")  # references users
```

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_db.py`:

```python
def test_persona_search_table_exists():
    import db

    with db.get_pool().connection() as conn:
        cols = {
            r["column_name"]
            for r in conn.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'persona_search'"
            ).fetchall()
        }
    assert {"user_id", "file_type", "entity_id", "title", "text",
            "tsv", "content_hash", "updated_at"} <= cols
    assert db.VECTOR_AVAILABLE is True  # test-db image ships pgvector
    assert "embedding" in cols


def test_persona_search_rows_cascade_on_user_delete():
    import db

    with db.get_pool().connection() as conn:
        row = conn.execute(
            "insert into users (username) values ('cascade_u') returning id"
        ).fetchone()
        conn.execute(
            "insert into persona_search (user_id, file_type, entity_id, title, text, content_hash)"
            " values (%s, 'projects', 'project_x', 't', 'hello world', 'h')",
            (row["id"],),
        )
        conn.execute("delete from persona_search where user_id = %s", (row["id"],))
        conn.execute("delete from users where id = %s", (row["id"],))
```

Create `backend/tests/test_vector_unavailable.py`:

```python
"""FTS-only mode: pgvector missing must never fail startup (spec: self-hosted
vanilla Postgres)."""


def test_schema_without_pgvector(monkeypatch):
    import db

    monkeypatch.setattr(db, "_try_create_vector_extension", lambda conn: False)
    # Rebuild from scratch as ensure_schema would on a vanilla instance
    with db.get_pool().connection() as conn:
        conn.execute("drop table if exists persona_search;")
    db.ensure_schema()
    assert db.VECTOR_AVAILABLE is False
    with db.get_pool().connection() as conn:
        cols = {
            r["column_name"]
            for r in conn.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'persona_search'"
            ).fetchall()
        }
    assert "embedding" not in cols
    assert "tsv" in cols
```

- [ ] **Step 3: Run to verify failure** — `python -m pytest tests/test_db.py tests/test_vector_unavailable.py -q` → FAIL (`persona_search` missing / no `VECTOR_AVAILABLE`).

- [ ] **Step 4: Implement in db.py**

Module globals (near line 22):

```python
VECTOR_AVAILABLE: bool = False
EMBEDDING_DIM: int = int(os.environ.get("EMBEDDING_DIM", "1024"))
```

Helper + additions at the END of `ensure_schema()` (after the token migration statements):

```python
def _try_create_vector_extension(conn) -> bool:
    """True if pgvector is usable. Never raises — a self-hosted vanilla
    Postgres without the extension runs in FTS-only mode (spec)."""
    try:
        conn.execute("create extension if not exists vector;")
        return True
    except psycopg.Error:
        conn.rollback()
        return False
```

```python
        # --- persona_search (hybrid retrieval index; derived data) ---
        global VECTOR_AVAILABLE
        VECTOR_AVAILABLE = _try_create_vector_extension(conn)
        conn.execute("""
            create table if not exists persona_search (
                user_id uuid not null references users(id) on delete cascade,
                file_type text not null,
                entity_id text not null,
                title text not null default '',
                text text not null,
                tsv tsvector generated always as (to_tsvector('english', text)) stored,
                content_hash text not null,
                updated_at timestamptz not null default now(),
                primary key (user_id, file_type, entity_id)
            );
        """)
        conn.execute(
            "create index if not exists persona_search_tsv_idx"
            " on persona_search using gin (tsv);"
        )
        if VECTOR_AVAILABLE:
            conn.execute(
                f"alter table persona_search add column if not exists embedding vector({EMBEDDING_DIM});"
            )
            # Existing column at a different dim? FTS-only until backfill --recreate.
            row = conn.execute("""
                select atttypmod as dim from pg_attribute
                where attrelid = 'persona_search'::regclass and attname = 'embedding'
            """).fetchone()
            if row and row["dim"] not in (-1, EMBEDDING_DIM):
                print(
                    f"WARNING: persona_search.embedding is vector({row['dim']}) but "
                    f"EMBEDDING_DIM={EMBEDDING_DIM}. Running FTS-only. To fix: "
                    "python scripts/backfill_search_index.py --recreate"
                )
                VECTOR_AVAILABLE = False
            else:
                conn.execute(
                    "create index if not exists persona_search_embedding_idx"
                    " on persona_search using hnsw (embedding vector_cosine_ops);"
                )
```

(`atttypmod` for pgvector columns stores the dimension directly.)

- [ ] **Step 5: Run** `python -m pytest tests/ -q` → all pass (159 + 3 new). Fix any conftest ordering fallout (the drop added in Step 1 must precede `tokens`/`users` drops).

- [ ] **Step 6: Commit** — `git commit -m "feat: persona_search schema with optional pgvector"`

---

### Task 2: `embeddings.py` — provider abstraction (Voyage + OpenAI-compatible)

**Files:**
- Create: `backend/embeddings.py`
- Modify: `backend/requirements.txt` (add `httpx==0.28.1` under a `# Embedding providers` comment), `backend/requirements-dev.txt` (remove its `httpx>=0.25.0` line — now a runtime dep)
- Test: `backend/tests/test_embeddings.py`

**Interfaces:**
- Produces: `embeddings.get_provider() -> Provider | None` (None = not configured → FTS-only); `Provider.embed(texts: list[str], input_type: str) -> list[list[float]]` (input_type `"document"` or `"query"`; raises `EmbeddingError` on any HTTP/parse failure); `embeddings.EmbeddingError(Exception)`; `embeddings._build_provider(env: dict, client: httpx.Client | None) -> Provider | None` (test seam).
- Consumes: nothing project-internal.

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_embeddings.py`)

```python
import httpx
import pytest

import embeddings


def _mock_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_unconfigured_returns_none():
    assert embeddings._build_provider({}, client=None) is None
    assert embeddings._build_provider({"EMBEDDING_PROVIDER": "voyage"}, client=None) is None
    # openai provider needs a URL; key alone is not enough
    assert embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "openai", "EMBEDDING_API_KEY": "k"}, client=None
    ) is None


def test_voyage_request_shape_and_parse():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        import json
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [
            {"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]})

    p = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "voyage", "VOYAGE_API_KEY": "vk",
         "EMBEDDING_MODEL": "voyage-3.5-lite"},
        client=_mock_client(handler),
    )
    out = p.embed(["a", "b"], input_type="query")
    assert out == [[0.1, 0.2], [0.3, 0.4]]
    assert seen["url"] == "https://api.voyageai.com/v1/embeddings"
    assert seen["auth"] == "Bearer vk"
    assert seen["body"]["model"] == "voyage-3.5-lite"
    assert seen["body"]["input"] == ["a", "b"]
    assert seen["body"]["input_type"] == "query"


def test_openai_compatible_local_no_key():
    def handler(request):
        assert "authorization" not in request.headers
        assert str(request.url) == "http://localhost:11434/v1/embeddings"
        return httpx.Response(200, json={"data": [{"embedding": [1.0]}]})

    p = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "openai",
         "EMBEDDING_API_URL": "http://localhost:11434/v1",
         "EMBEDDING_MODEL": "nomic-embed-text"},
        client=_mock_client(handler),
    )
    assert p.embed(["x"], input_type="document") == [[1.0]]


def test_http_error_raises_embedding_error():
    p = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "voyage", "VOYAGE_API_KEY": "vk"},
        client=_mock_client(lambda r: httpx.Response(500, text="boom")),
    )
    with pytest.raises(embeddings.EmbeddingError):
        p.embed(["a"], input_type="document")


def test_get_provider_reads_environ(monkeypatch):
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
    monkeypatch.delenv("EMBEDDING_API_URL", raising=False)
    assert embeddings.get_provider() is None
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_embeddings.py -q` → FAIL (no module `embeddings`).

- [ ] **Step 3: Implement `backend/embeddings.py`**

```python
"""Embedding providers for the search index (spec: search-retrieval design).

Two providers behind one interface:
  - voyage: hosted Voyage AI (VOYAGE_API_KEY)
  - openai: any OpenAI-compatible /v1/embeddings endpoint — Ollama, LM Studio,
    llama.cpp server, vLLM, LocalAI, or OpenAI itself (EMBEDDING_API_URL,
    EMBEDDING_API_KEY optional for local servers)

get_provider() returns None when unconfigured; callers treat None as
FTS-only mode. embed() raises EmbeddingError on any transport/parse problem;
callers catch it and degrade (never propagate to a persona write).
"""

import os

import httpx

TIMEOUT_SECONDS = 8.0  # document batches (background thread)
QUERY_TIMEOUT_SECONDS = 2.0  # per-search query embedding (user-facing path)
VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
DEFAULT_MODEL = "voyage-3.5-lite"


class EmbeddingError(Exception):
    pass


class _HttpProvider:
    def __init__(self, url, model, api_key, send_input_type, client):
        self._url = url
        self._model = model
        self._api_key = api_key
        self._send_input_type = send_input_type  # Voyage extension; OpenAI-compat servers reject unknown fields
        self._client = client or httpx.Client()

    def embed(self, texts, input_type="document"):
        headers = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        body = {"model": self._model, "input": texts}
        if self._send_input_type:
            body["input_type"] = input_type
        timeout = QUERY_TIMEOUT_SECONDS if input_type == "query" else TIMEOUT_SECONDS
        try:
            resp = self._client.post(self._url, json=body, headers=headers, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()["data"]
            return [item["embedding"] for item in data]
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise EmbeddingError(str(exc)) from exc


def _build_provider(env, client=None):
    provider = env.get("EMBEDDING_PROVIDER", "voyage")
    model = env.get("EMBEDDING_MODEL", DEFAULT_MODEL)
    if provider == "voyage":
        key = env.get("VOYAGE_API_KEY")
        if not key:
            return None
        return _HttpProvider(VOYAGE_URL, model, key, send_input_type=True, client=client)
    if provider == "openai":
        base = env.get("EMBEDDING_API_URL")
        if not base:
            return None
        url = base.rstrip("/") + "/embeddings"
        return _HttpProvider(url, model, env.get("EMBEDDING_API_KEY"), send_input_type=False, client=client)
    return None


def get_provider():
    return _build_provider(os.environ)
```

- [ ] **Step 4: Run** `python -m pytest tests/test_embeddings.py -q` → PASS. Then full suite → green.

- [ ] **Step 5: Update requirements** as listed in Files, and `pip install httpx==0.28.1` into the venv if not present (`./venv/bin/pip install httpx==0.28.1`).

- [ ] **Step 6: Commit** — `git commit -m "feat: embedding provider abstraction (Voyage + OpenAI-compatible)"`

---

### Task 3: `search_index.py` part 1 — flattening + prefix map (pure functions)

**Files:**
- Create: `backend/search_index.py` (flattening + prefix map only; sync/query land in Tasks 4–5)
- Test: `backend/tests/test_search_flatten.py`

**Interfaces:**
- Produces: `search_index.flatten_entity(entity: dict) -> tuple[str, str]` (returns `(title, text)`; text starts with title line); `search_index.flatten_section(file_type: str, data: dict) -> list[tuple[str, str, str]]` (`(entity_id, title, text)`, entities without an id skipped); `search_index.entity_location(entity_id: str) -> tuple[str, str] | None` (`(file_type, list_key)` by LONGEST-prefix match, None if no prefix matches).
- Consumes: `sections.SECTION_REGISTRY` (id_lists `((list_key, prefix), ...)`).

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_search_flatten.py`)

```python
import search_index


def test_flatten_entity_title_priority_and_fields():
    title, text = search_index.flatten_entity({
        "id": "project_ab12cd34",
        "name": "MyGist",
        "description": "Personal context for AI",
        "status": "active",
        "tags": ["mcp", "postgres"],
        "references": [{"name": "Neon docs", "url": "https://neon.com"}],
        "highlights": ["Shipped auth"],
        "count": 7,          # non-str scalar: skipped
        "nested": {"x": 1},  # unknown dict: skipped
    })
    assert title == "MyGist"
    assert text.splitlines()[0] == "MyGist"
    for expected in ("Personal context for AI", "active", "mcp", "postgres",
                     "Neon docs", "https://neon.com", "Shipped auth"):
        assert expected in text


def test_flatten_entity_title_fallbacks():
    assert search_index.flatten_entity({"topic": "FastAPI DI"})[0] == "FastAPI DI"
    assert search_index.flatten_entity({"title": "T"})[0] == "T"
    assert search_index.flatten_entity({"institution": "Northumbria"})[0] == "Northumbria"
    assert search_index.flatten_entity({"details": "only details"})[0] == ""


def test_flatten_section_skips_entities_without_id():
    rows = search_index.flatten_section("projects", {
        "projects": [{"id": "project_a1b2c3d4", "name": "P1"}, {"name": "no id yet"}],
        "current_learning": [{"id": "learning_a1b2c3d4", "topic": "Rust"}],
        "top_of_mind": [],
    })
    ids = [r[0] for r in rows]
    assert ids == ["project_a1b2c3d4", "learning_a1b2c3d4"]


def test_flatten_section_no_id_lists_is_empty():
    assert search_index.flatten_section("preferences", {"dislikes": ["x"]}) == []


def test_entity_location_longest_prefix_wins():
    assert search_index.entity_location("learn_20260721_ab12cd") == ("learning_log", "entries")
    assert search_index.entity_location("learning_ab12cd34") == ("projects", "current_learning")
    assert search_index.entity_location("hobby_ab12cd34") == ("lifestyle", "hobbies")
    assert search_index.entity_location("nope_123") is None
```

- [ ] **Step 2: Run to verify failure** → FAIL (no module).

- [ ] **Step 3: Implement** (top of new `backend/search_index.py`)

```python
"""Search index for persona entities: flattening, hash-diff sync, hybrid
query (FTS + optional pgvector), lazy heal. Derived data — every failure
here is logged and swallowed so persona writes/reads never break (spec)."""

import hashlib
import logging

import sections

logger = logging.getLogger(__name__)

TITLE_FIELDS = ("name", "title", "topic", "institution", "language", "degree")
TEXT_FIELDS = ("description", "notes", "content", "details", "role", "status",
               "relationship", "source", "level", "category", "url")
NESTED_LIST_FIELDS = ("references", "highlights", "specifics", "coursework",
                      "clubs", "tags")


def flatten_entity(entity):
    title = next(
        (entity[f] for f in TITLE_FIELDS
         if isinstance(entity.get(f), str) and entity[f].strip()), "")
    parts = [title] if title else []
    for f in TEXT_FIELDS:
        v = entity.get(f)
        if isinstance(v, str) and v.strip() and v != title:
            parts.append(v)
    for f in NESTED_LIST_FIELDS:
        for item in entity.get(f) or []:
            if isinstance(item, str) and item.strip():
                parts.append(item)
            elif isinstance(item, dict):
                for sub in ("name", "title", "url", "description"):
                    sv = item.get(sub)
                    if isinstance(sv, str) and sv.strip():
                        parts.append(sv)
    return title, "\n".join(parts)


def flatten_section(file_type, data):
    spec = sections.SECTION_REGISTRY.get(file_type)
    if spec is None:
        return []
    rows = []
    for list_key, _prefix in spec.id_lists:
        for entity in data.get(list_key) or []:
            if not isinstance(entity, dict) or not entity.get("id"):
                continue
            title, text = flatten_entity(entity)
            if text:
                rows.append((entity["id"], title, text))
    return rows


def _prefix_map():
    m = {}
    for spec in sections.SECTION_REGISTRY.values():
        for list_key, prefix in spec.id_lists:
            m[prefix + "_"] = (spec.key, list_key)
    return m


_PREFIXES = sorted(_prefix_map().items(), key=lambda kv: len(kv[0]), reverse=True)


def entity_location(entity_id):
    for prefix, loc in _PREFIXES:
        if isinstance(entity_id, str) and entity_id.startswith(prefix):
            return loc
    return None


def content_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Run** — flatten tests PASS, full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: search index flattening and entity-id prefix map"`

---

### Task 4: `search_index.py` part 2 — hash-diff sync + save hook + background embed

**Files:**
- Modify: `backend/search_index.py` (append), `backend/persona_store.py:207-221` (save hook)
- Test: `backend/tests/test_search_sync.py`

**Interfaces:**
- Produces: `search_index.sync_index(user_id: str, file_type: str, data: dict, embed_sync: bool = False) -> None` (upserts changed rows — embedding NULLed on change — deletes gone ids, schedules background embed of changed rows; `embed_sync=True` embeds inline — used by tests and the backfill script); `search_index._embed_rows(user_id, file_type, rows: list[tuple[str, str]]) -> None` (best-effort; catches `EmbeddingError`).
- Consumes: `db.get_pool()`, `db.VECTOR_AVAILABLE`, `embeddings.get_provider()`, Task 3 functions.

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_search_sync.py`)

```python
"""sync_index diffing + the persona_store.save hook. as_user fixture binds
db.current_user_id (see conftest)."""

import db
import embeddings
import persona_store
import search_index


def _rows(user_id, file_type="projects"):
    with db.get_pool().connection() as conn:
        return {
            r["entity_id"]: r
            for r in conn.execute(
                "select entity_id, title, text, content_hash, embedding is null as no_emb"
                " from persona_search where user_id = %s and file_type = %s",
                (user_id, file_type),
            ).fetchall()
        }


class FakeProvider:
    def __init__(self):
        self.calls = []

    def embed(self, texts, input_type="document"):
        self.calls.append((tuple(texts), input_type))
        return [[1.0] * db.EMBEDDING_DIM for _ in texts]


def test_sync_add_update_remove(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)  # FTS-only
    uid = db.current_user_id.get()
    data = {"projects": [{"id": "project_aaaa1111", "name": "Alpha",
                          "description": "first"}],
            "current_learning": [], "top_of_mind": []}
    search_index.sync_index(uid, "projects", data)
    rows = _rows(uid)
    assert rows["project_aaaa1111"]["title"] == "Alpha"
    first_hash = rows["project_aaaa1111"]["content_hash"]

    # unchanged: hash stays, no rewrite (updated_at equality is flaky; hash is the contract)
    search_index.sync_index(uid, "projects", data)
    assert _rows(uid)["project_aaaa1111"]["content_hash"] == first_hash

    # update
    data["projects"][0]["description"] = "second"
    search_index.sync_index(uid, "projects", data)
    assert _rows(uid)["project_aaaa1111"]["content_hash"] != first_hash

    # remove
    data["projects"] = []
    search_index.sync_index(uid, "projects", data)
    assert "project_aaaa1111" not in _rows(uid)


def test_sync_embeds_changed_rows_inline_with_provider(as_user, monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(embeddings, "get_provider", lambda: fake)
    uid = db.current_user_id.get()
    data = {"projects": [{"id": "project_bbbb2222", "name": "Beta"}],
            "current_learning": [], "top_of_mind": []}
    search_index.sync_index(uid, "projects", data, embed_sync=True)
    assert fake.calls and fake.calls[0][1] == "document"
    assert _rows(uid)["project_bbbb2222"]["no_emb"] is False


def test_embed_failure_leaves_null_embedding(as_user, monkeypatch):
    class Boom:
        def embed(self, texts, input_type="document"):
            raise embeddings.EmbeddingError("down")

    monkeypatch.setattr(embeddings, "get_provider", lambda: Boom())
    uid = db.current_user_id.get()
    data = {"projects": [{"id": "project_cccc3333", "name": "Gamma"}],
            "current_learning": [], "top_of_mind": []}
    search_index.sync_index(uid, "projects", data, embed_sync=True)  # must not raise
    assert _rows(uid)["project_cccc3333"]["no_emb"] is True


def test_persona_store_save_hooks_sync(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("projects", {"projects": [{"name": "Hooked"}],
                                    "current_learning": [], "top_of_mind": []})
    uid = db.current_user_id.get()
    rows = _rows(uid)
    assert len(rows) == 1  # id was assigned by save, then indexed
    assert list(rows.values())[0]["title"] == "Hooked"


def test_sync_failure_never_fails_save(as_user, monkeypatch):
    monkeypatch.setattr(search_index, "sync_index",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("index boom")))
    assert persona_store.save("projects", {"projects": [], "current_learning": [],
                                           "top_of_mind": []}) is True


def test_settings_row_not_indexed(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    import settings_store
    settings_store.set_disabled_sections([])
    uid = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        n = conn.execute(
            "select count(*) as n from persona_search where user_id = %s"
            " and file_type = '_settings'", (uid,),
        ).fetchone()["n"]
    assert n == 0
```

- [ ] **Step 2: Run to verify failure** → FAIL (`sync_index` not defined).

- [ ] **Step 3: Implement** (append to `search_index.py`)

```python
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress

import db
import embeddings

# One background worker: embedding batches are small and ordering per user
# doesn't matter (rows are keyed; a stale worker just overwrites NULL).
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")


def sync_index(user_id, file_type, data, embed_sync=False):
    rows = flatten_section(file_type, data)
    desired = {eid: (title, text, content_hash(text)) for eid, title, text in rows}
    with db.get_pool().connection() as conn:
        existing = {
            r["entity_id"]: r["content_hash"]
            for r in conn.execute(
                "select entity_id, content_hash from persona_search"
                " where user_id = %s and file_type = %s",
                (user_id, file_type),
            ).fetchall()
        }
        changed = []
        for eid, (title, text, h) in desired.items():
            if existing.get(eid) == h:
                continue
            changed.append((eid, text))
            if db.VECTOR_AVAILABLE:
                conn.execute(
                    """
                    insert into persona_search (user_id, file_type, entity_id, title, text, content_hash, updated_at)
                    values (%s, %s, %s, %s, %s, %s, now())
                    on conflict (user_id, file_type, entity_id) do update
                      set title = excluded.title, text = excluded.text,
                          content_hash = excluded.content_hash,
                          embedding = null, updated_at = now()
                    """,
                    (user_id, file_type, eid, title, text, h),
                )
            else:
                conn.execute(
                    """
                    insert into persona_search (user_id, file_type, entity_id, title, text, content_hash, updated_at)
                    values (%s, %s, %s, %s, %s, %s, now())
                    on conflict (user_id, file_type, entity_id) do update
                      set title = excluded.title, text = excluded.text,
                          content_hash = excluded.content_hash, updated_at = now()
                    """,
                    (user_id, file_type, eid, title, text, h),
                )
        gone = set(existing) - set(desired)
        if gone:
            conn.execute(
                "delete from persona_search where user_id = %s and file_type = %s"
                " and entity_id = any(%s)",
                (user_id, file_type, list(gone)),
            )
    if changed and db.VECTOR_AVAILABLE and embeddings.get_provider() is not None:
        if embed_sync:
            _embed_rows(user_id, file_type, changed)
        else:
            _EXECUTOR.submit(_embed_rows, user_id, file_type, changed)


def _embed_rows(user_id, file_type, rows):
    """Best-effort: failures leave embedding NULL (FTS ranks alone; retried
    on next content change or via the backfill script)."""
    provider = embeddings.get_provider()
    if provider is None or not db.VECTOR_AVAILABLE:
        return
    try:
        vectors = provider.embed([text for _eid, text in rows], input_type="document")
    except embeddings.EmbeddingError as exc:
        logger.warning("embedding batch failed (%s rows): %s", len(rows), exc)
        return
    with suppress(Exception):
        with db.get_pool().connection() as conn:
            for (eid, _text), vec in zip(rows, vectors):
                conn.execute(
                    "update persona_search set embedding = %s"
                    " where user_id = %s and file_type = %s and entity_id = %s",
                    (str(vec), user_id, file_type, eid),
                )
```

(pgvector accepts the `[0.1,0.2,...]` string literal form — `str(list)` matches it.)

Hook in `persona_store.save` (after the upsert `with` block, before `return True`):

```python
    try:
        import search_index
        search_index.sync_index(user_id, file_type, data)
    except Exception:
        logging.getLogger(__name__).exception(
            "search index sync failed for %s (persona write succeeded)", file_type
        )
```

(`import logging` at top of persona_store.py if not present. `_settings` is naturally excluded: settings_store writes directly to persona_data with its own SQL, not through `persona_store.save` — the test locks that in.)

- [ ] **Step 4: Run** — sync tests PASS; full suite green (watch `test_multi_user_isolation.py` — sync must scope by the passed user_id only).
- [ ] **Step 5: Commit** — `git commit -m "feat: hash-diff search index sync hooked into persona_store.save"`

---

### Task 5: `search_index.py` part 3 — hybrid query + lazy heal

**Files:**
- Modify: `backend/search_index.py` (append)
- Test: `backend/tests/test_search_query.py`

**Interfaces:**
- Produces: `search_index.search(user_id: str, query: str, section_filter: list[str] | None, limit: int, exclude_sections: list[str] | None = None) -> dict` returning `{"mode": "hybrid"|"fts", "results": [{"entity_id", "section", "title", "snippet", "score"}]}`; `search_index.lazy_heal(user_id) -> None`.
- Consumes: Tasks 1–4; `persona_store.load`, `sections.SECTION_REGISTRY` (for heal).

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_search_query.py`)

```python
import db
import embeddings
import persona_store
import search_index


class VocabProvider:
    """Deterministic fake with a tiny synonym vocabulary: 'js' and
    'javascript' embed to the same vector so hybrid search can rank a
    semantic match FTS misses (parity with the deleted alias dict)."""

    GROUPS = {"js": 0, "javascript": 0, "rust": 1, "postgres": 2}

    def embed(self, texts, input_type="document"):
        out = []
        for t in texts:
            v = [0.0] * db.EMBEDDING_DIM
            for word, dim in self.GROUPS.items():
                if word in t.lower():
                    v[dim] = 1.0
            if not any(v):
                v[3] = 1.0
            out.append(v)
        return out


def _seed(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [
            {"name": "Ledger", "description": "A JavaScript dashboard", "tags": []},
            {"name": "Ferris", "description": "Rust CLI tool", "tags": []},
        ],
        "current_learning": [], "top_of_mind": [],
    })
    persona_store.save("knowledge", {
        "domains": [{"name": "Databases", "notes": "postgres tuning"}],
        "mental_tabs": [],
    })
    # embed synchronously for determinism
    uid = db.current_user_id.get()
    for ft in ("projects", "knowledge"):
        data = persona_store.load(ft)
        search_index.sync_index(uid, ft, data, embed_sync=True)


def test_fts_only_search(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    _seed(monkeypatch, None)
    uid = db.current_user_id.get()
    out = search_index.search(uid, "rust cli", None, 10)
    assert out["mode"] == "fts"
    assert out["results"][0]["title"] == "Ferris"
    assert "snippet" in out["results"][0] and out["results"][0]["section"] == "projects"


def test_hybrid_finds_semantic_match(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())
    uid = db.current_user_id.get()
    out = search_index.search(uid, "js", None, 10)  # FTS alone can't match 'JavaScript'
    assert out["mode"] == "hybrid"
    assert out["results"][0]["title"] == "Ledger"


def test_section_filter_and_exclusion(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())
    uid = db.current_user_id.get()
    only_knowledge = search_index.search(uid, "postgres", ["knowledge"], 10)
    assert {r["section"] for r in only_knowledge["results"]} == {"knowledge"}
    excluded = search_index.search(uid, "postgres", None, 10,
                                   exclude_sections=["knowledge"])
    assert all(r["section"] != "knowledge" for r in excluded["results"])


def test_query_embed_failure_degrades_to_fts(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())

    class Boom:
        def embed(self, texts, input_type="document"):
            raise embeddings.EmbeddingError("down")

    monkeypatch.setattr(embeddings, "get_provider", lambda: Boom())
    uid = db.current_user_id.get()
    out = search_index.search(uid, "rust", None, 10)
    assert out["mode"] == "fts"
    assert out["results"][0]["title"] == "Ferris"


def test_lazy_heal_builds_missing_index(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("circle", {"connections": [{"name": "Ada",
                                                   "relationship": "mentor"}]})
    uid = db.current_user_id.get()
    with db.get_pool().connection() as conn:  # simulate pre-feature user
        conn.execute("delete from persona_search where user_id = %s", (uid,))
    out = search_index.search(uid, "mentor", None, 10)
    assert out["results"] and out["results"][0]["title"] == "Ada"
```

- [ ] **Step 2: Run to verify failure** → FAIL (`search` not defined).

- [ ] **Step 3: Implement** (append to `search_index.py`)

```python
RRF_K = 60
CANDIDATES = 40


def lazy_heal(user_id):
    """Build FTS rows for a user whose persona predates the index (spec:
    self-healing; embeddings follow in the background)."""
    import persona_store
    for file_type in sections.SECTION_REGISTRY:
        with suppress(Exception):
            data = persona_store.load(file_type)
            if isinstance(data, dict) and "error" not in data:
                sync_index(user_id, file_type, data)


def search(user_id, query, section_filter, limit, exclude_sections=None):
    with db.get_pool().connection() as conn:
        have_rows = conn.execute(
            "select exists(select 1 from persona_search where user_id = %s) as e",
            (user_id,),
        ).fetchone()["e"]
        if not have_rows:
            have_data = conn.execute(
                "select exists(select 1 from persona_data where user_id = %s"
                " and file_type != '_settings') as e",
                (user_id,),
            ).fetchone()["e"]
            if have_data:
                lazy_heal(user_id)

    sections_pred = list(section_filter) if section_filter else [
        s for s in sections.SECTION_REGISTRY]
    if exclude_sections:
        sections_pred = [s for s in sections_pred if s not in exclude_sections]

    qvec = None
    provider = embeddings.get_provider()
    if provider is not None and db.VECTOR_AVAILABLE:
        try:
            qvec = provider.embed([query], input_type="query")[0]
        except embeddings.EmbeddingError as exc:
            logger.warning("query embedding failed, FTS-only for this call: %s", exc)

    with db.get_pool().connection() as conn:
        if qvec is None:
            rows = conn.execute(
                """
                with fts as (
                    select user_id, file_type, entity_id,
                           row_number() over (order by ts_rank_cd(tsv, q) desc) as r
                    from persona_search, websearch_to_tsquery('english', %(query)s) q
                    where user_id = %(uid)s and file_type = any(%(sections)s)
                      and tsv @@ q
                    limit %(cand)s
                )
                select p.entity_id, p.file_type, p.title,
                       ts_headline('english', p.text,
                                   websearch_to_tsquery('english', %(query)s)) as snippet,
                       1.0 / (%(k)s + fts.r) as score
                from fts join persona_search p using (user_id, file_type, entity_id)
                order by score desc limit %(limit)s
                """,
                {"query": query, "uid": user_id, "sections": sections_pred,
                 "cand": CANDIDATES, "k": RRF_K, "limit": limit},
            ).fetchall()
            mode = "fts"
        else:
            rows = conn.execute(
                """
                with fts as (
                    select user_id, file_type, entity_id,
                           row_number() over (order by ts_rank_cd(tsv, q) desc) as r
                    from persona_search, websearch_to_tsquery('english', %(query)s) q
                    where user_id = %(uid)s and file_type = any(%(sections)s)
                      and tsv @@ q
                    limit %(cand)s
                ), vec as (
                    select user_id, file_type, entity_id,
                           row_number() over (order by embedding <=> %(qvec)s) as r
                    from persona_search
                    where user_id = %(uid)s and file_type = any(%(sections)s)
                      and embedding is not null
                    order by embedding <=> %(qvec)s
                    limit %(cand)s
                ), merged as (
                    select coalesce(fts.user_id, vec.user_id) as user_id,
                           coalesce(fts.file_type, vec.file_type) as file_type,
                           coalesce(fts.entity_id, vec.entity_id) as entity_id,
                           coalesce(1.0 / (%(k)s + fts.r), 0)
                         + coalesce(1.0 / (%(k)s + vec.r), 0) as score,
                           fts.r is not null as fts_hit
                    from fts full outer join vec
                      using (user_id, file_type, entity_id)
                )
                select p.entity_id, p.file_type, p.title, m.score,
                       case when m.fts_hit then
                           ts_headline('english', p.text,
                                       websearch_to_tsquery('english', %(query)s))
                       else left(p.text, 160) end as snippet
                from merged m join persona_search p using (user_id, file_type, entity_id)
                order by m.score desc limit %(limit)s
                """,
                {"query": query, "uid": user_id, "sections": sections_pred,
                 "cand": CANDIDATES, "k": RRF_K, "limit": limit,
                 "qvec": str(qvec)},
            ).fetchall()
            mode = "hybrid"

    return {
        "mode": mode,
        "results": [
            {"entity_id": r["entity_id"], "section": r["file_type"],
             "title": r["title"], "snippet": r["snippet"],
             "score": float(r["score"])}
            for r in rows
        ],
    }
```

- [ ] **Step 4: Run** — query tests PASS; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: hybrid RRF search query with lazy index heal"`

---

### Task 6: MCP tools — `search_context` + `get_entity` (+ `get_raw` docstring)

**Files:**
- Modify: `backend/server.py` (add two `@mcp.tool()` functions near the existing read tools ~line 3015-3126, matching their def style — check whether existing tools are `def` or `async def` and mirror it; update `get_raw`'s docstring)
- Test: `backend/tests/test_get_entity.py`, `backend/tests/test_search_tools_dispatch.py`

**Interfaces:**
- Consumes: `search_index.search`, `search_index.entity_location`; `settings_store.get_disabled_sections()`; `load_json` (server.py alias for persona_store.load); `db.current_user_id`.
- Produces: MCP tools `search_context(query, sections=None, limit=10)` and `get_entity(entity_id)`, both returning JSON strings.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_get_entity.py`:

```python
import json

import embeddings
import persona_store
import server


def _get_entity(entity_id):
    return json.loads(server.get_entity.fn(entity_id))


def test_get_entity_roundtrip(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("lifestyle", {"hobbies": [{"name": "Climbing",
                                                  "level": "casual"}],
                                     "passions": [], "curiosities": [],
                                     "personality_traits": [], "values": [],
                                     "wellness": {}})
    hobby_id = persona_store.load("lifestyle")["hobbies"][0]["id"]
    out = _get_entity(hobby_id)
    assert out["section"] == "lifestyle"
    assert out["entity"]["name"] == "Climbing"


def test_get_entity_unknown_prefix_lists_valid(as_user):
    out = server.get_entity.fn("bogus_12345678")
    assert "Unknown entity id prefix" in out
    assert "project_" in out and "learn_" in out


def test_get_entity_not_found(as_user):
    out = server.get_entity.fn("project_deadbeef")
    assert "not found" in out.lower()


def test_get_entity_disabled_section_blocked(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    import settings_store
    persona_store.save("circle", {"connections": [{"name": "Ada"}]})
    cid = persona_store.load("circle")["connections"][0]["id"]
    settings_store.set_disabled_sections(["circle"])
    out = server.get_entity.fn(cid)
    assert "disabled" in out.lower()
```

`backend/tests/test_search_tools_dispatch.py` — real FastMCP dispatch path (established precedent: `.fn` bypasses schema validation; these tests catch Literal/signature mismatches). Copy the invocation style used in `tests/test_section_scopes.py` for `get_context` (async `mcp.get_tool(...).run({...})` or the equivalent helper already present there — reuse whatever that file uses):

```python
import json

import embeddings
import persona_store
import pytest


@pytest.fixture
def seeded(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("projects", {
        "projects": [{"name": "Ledger", "description": "JavaScript dashboard"}],
        "current_learning": [], "top_of_mind": [],
    })
    return as_user


@pytest.mark.anyio
async def test_search_context_via_dispatch(seeded):
    import server
    tool = await server.mcp.get_tool("search_context")
    result = await tool.run({"query": "dashboard", "limit": 5})
    payload = json.loads(result.content[0].text)
    assert payload["mode"] == "fts"
    assert payload["results"][0]["title"] == "Ledger"
    assert set(payload["results"][0]) == {"entity_id", "section", "title",
                                          "snippet", "score"}


@pytest.mark.anyio
async def test_search_context_bad_section_errors(seeded):
    import server
    tool = await server.mcp.get_tool("search_context")
    result = await tool.run({"query": "x", "sections": "not_a_section"})
    assert "Unknown section" in result.content[0].text


@pytest.mark.anyio
async def test_get_entity_via_dispatch(seeded):
    import server
    pid = persona_store.load("projects")["projects"][0]["id"]
    tool = await server.mcp.get_tool("get_entity")
    result = await tool.run({"entity_id": pid})
    assert json.loads(result.content[0].text)["entity"]["name"] == "Ledger"
```

(If `test_section_scopes.py` uses a different async invocation helper or marker than `@pytest.mark.anyio`, mirror that file exactly — its pattern is known-green in this suite.)

- [ ] **Step 2: Run to verify failure** → FAIL (tools don't exist).

- [ ] **Step 3: Implement in server.py** (match the existing tools' sync/async style; shown sync):

```python
@mcp.tool()
def search_context(query: str, sections: Union[str, List[str], None] = None,
                   limit: int = 10) -> str:
    """Search the persona for relevant entries by meaning and keywords.

    PREFERRED way to find specific persona content — returns small ranked
    snippets instead of whole sections. Follow up with get_entity(entity_id)
    for full detail on a hit. Modes: "hybrid" (FTS + embeddings) or "fts"
    (no embedding provider configured).

    Args:
        query: What to look for (natural language or keywords).
        sections: Optional section name or list to restrict the search
            (e.g. "projects" or ["knowledge", "learning_log"]).
        limit: Max results, 1-25 (default 10).
    """
    if not query or not query.strip():
        return "Error: query must be a non-empty string"
    if isinstance(sections, str):
        sections = [sections]
    valid = set(sections_module.SECTION_REGISTRY)
    if sections:
        unknown = [s for s in sections if s not in valid]
        if unknown:
            return (f"Unknown section(s): {', '.join(unknown)}. "
                    f"Valid: {', '.join(sorted(valid))}")
    limit = max(1, min(int(limit), 25))
    user_id = db.current_user_id.get()
    disabled = settings_store.get_disabled_sections()
    out = search_index.search(user_id, query.strip(), sections, limit,
                              exclude_sections=list(disabled))
    out["query"] = query.strip()
    return json.dumps(out, indent=2)


@mcp.tool()
def get_entity(entity_id: str) -> str:
    """Fetch one persona entity in full by its id (as returned by
    search_context results or embedded in get_context output).

    Args:
        entity_id: Prefixed id, e.g. "project_ab12cd34", "learn_20260721_x1y2z3".
    """
    loc = search_index.entity_location(entity_id)
    if loc is None:
        prefixes = sorted({p for p, _ in search_index._PREFIXES})
        return ("Unknown entity id prefix. Valid prefixes: "
                + ", ".join(prefixes))
    file_type, list_key = loc
    disabled = settings_store.get_disabled_sections()
    if file_type in disabled:
        return (f"Error: the '{file_type}' section is disabled. "
                "Enable it in settings to access this entity.")
    data = load_json(file_type)
    for entity in data.get(list_key) or []:
        if isinstance(entity, dict) and entity.get("id") == entity_id:
            return json.dumps({"section": file_type, "entity_id": entity_id,
                               "entity": entity}, indent=2)
    return f"Entity {entity_id} not found in {file_type}.{list_key}"
```

Imports at top of server.py (match existing style): `import search_index`, `import sections as sections_module` (server.py already imports sections — reuse its existing alias; do NOT double-import), `settings_store` (already imported for the disable gates), `db` (already imported). Match the disabled-section error wording used by `get_context`'s section gate — read it and reuse the same phrasing if it differs from the above.

Also: replace `get_raw`'s docstring first line with wording that steers AI callers:
"""Raw dump of persona file(s) — export/debug use. For finding specific
content, prefer search_context (ranked snippets) + get_entity (full detail)."""
(keep the rest of the docstring's arg documentation).

- [ ] **Step 4: Run** — new tests PASS; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: search_context and get_entity MCP tools"`

---

### Task 7: Topic filter rewire (delete the alias dict)

**Files:**
- Modify: `backend/server.py` — replace `_filter_by_topic` internals (~line 989); DELETE `KEYWORD_ALIASES` (~903-925), `_extract_keywords` (~927), `_item_matches_topic` (~959). Locate by name, lines have shifted.
- Test: `backend/tests/test_topic_rewire.py`; existing `tests/test_context_efficiency.py` may assert old topic behavior — update ONLY assertions that encode alias/substring specifics, preserving the test's intent (topic filtering reduces output).

**Interfaces:**
- Consumes: `search_index.search`; existing `_filter_by_topic(data: dict, topic: str) -> dict` call site inside `get_scoped_context` (~server.py:742-821) — keep the function name and signature so the call site is untouched.
- Produces: same public behavior contract for `get_context(topic=...)`: id-list fields filtered to search hits; non-id-list fields untouched.

**Behavior note (intentional, from spec):** the 22 hardcoded aliases are deleted. In hybrid mode semantic matching replaces them (better); in FTS-only mode alias-style queries ("js" → JavaScript) lose that specific mapping while gaining stemming and multi-word ranking. This trade-off is accepted in the spec — do not re-add an alias table.

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_topic_rewire.py`)

```python
import embeddings
import persona_store
import server
from tests.test_search_query import VocabProvider  # reuse the synonym fake


def _seed(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [
            {"name": "Ledger", "description": "A JavaScript dashboard"},
            {"name": "Ferris", "description": "Rust CLI tool"},
        ],
        "current_learning": [], "top_of_mind": [{"idea": "ship it"}],
    })


def test_topic_filters_id_lists_keeps_other_fields(as_user, monkeypatch):
    _seed(monkeypatch, None)
    out = server.get_scoped_context("professional", topic="rust")
    projects = out["projects"]["projects"]
    assert [p["name"] for p in projects] == ["Ferris"]
    # non-matching id-list content is filtered, non-list fields survive untouched
    assert "top_of_mind" in out["projects"]


def test_topic_semantic_match_in_hybrid_mode(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())
    import db, search_index
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "projects", persona_store.load("projects"),
                            embed_sync=True)
    out = server.get_scoped_context("professional", topic="js")
    assert [p["name"] for p in out["projects"]["projects"]] == ["Ledger"]


def test_alias_dict_is_gone():
    assert not hasattr(server, "KEYWORD_ALIASES")
    assert not hasattr(server, "_extract_keywords")
    assert not hasattr(server, "_item_matches_topic")
```

(If `get_scoped_context`'s signature differs — e.g. topic passed positionally or the return shape nests differently — mirror how `tests/test_context_efficiency.py` invokes it; that file is the known-green reference for calling it.)

- [ ] **Step 2: Run to verify failure** → `test_alias_dict_is_gone` FAILS (aliases still exist), semantic test FAILS.

- [ ] **Step 3: Reimplement `_filter_by_topic`** (same name/signature; delete the three old helpers):

```python
def _filter_by_topic(data, topic):
    """Keep only id-list items relevant to `topic`, via the search index
    (hybrid when embeddings are configured, FTS otherwise). Non-id-list
    fields pass through untouched."""
    import search_index

    present_sections = [ft for ft in data if ft in sections.SECTION_REGISTRY]
    id_sections = [ft for ft in present_sections
                   if sections.SECTION_REGISTRY[ft].id_lists]
    if not id_sections:
        return data
    user_id = db.current_user_id.get()
    hits = search_index.search(user_id, topic, id_sections, 100)
    matched = {r["entity_id"] for r in hits["results"]}
    for ft in id_sections:
        spec = sections.SECTION_REGISTRY[ft]
        section_data = data.get(ft)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            if list_key in section_data and isinstance(section_data[list_key], list):
                section_data[list_key] = [
                    item for item in section_data[list_key]
                    if isinstance(item, dict) and item.get("id") in matched
                ]
    return data
```

Adapt names to the real call site: if the current `_filter_by_topic` operates per-section or takes different args, keep ITS exact signature and apply the same logic (search once across the id-list sections in scope, then filter id-lists by membership). The `sections` module alias and `db` import already exist in server.py.

- [ ] **Step 4: Run** — new tests PASS; fix any `test_context_efficiency.py` assertions that encoded alias behavior (update minimally, preserve intent); full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat: topic filter rewired through search index, alias dict removed"`

---

### Task 8: Backfill script + deploy docs

**Files:**
- Create: `backend/scripts/backfill_search_index.py`
- Modify: `README.md` (env-var table/section for the six embedding vars; one line on `search_context`/`get_entity`), `backend/docker-compose.yml` only if it documents env passthrough for the server service (add the new vars as `${VAR}` passthroughs alongside `DATABASE_URL`).
- Test: `backend/tests/test_backfill_script.py`

**Interfaces:**
- Consumes: `search_index.sync_index`, `db.get_pool()`, `db.EMBEDDING_DIM`.
- Produces: CLI `python scripts/backfill_search_index.py [--recreate]`; importable `backfill(recreate: bool = False) -> int` (returns rows indexed) for tests.

- [ ] **Step 1: Write the failing test** (`backend/tests/test_backfill_script.py`)

```python
import db
import embeddings
import persona_store


def test_backfill_indexes_all_users(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("projects", {
        "projects": [{"name": "Alpha"}], "current_learning": [], "top_of_mind": []})
    uid = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        conn.execute("delete from persona_search where user_id = %s", (uid,))

    from scripts.backfill_search_index import backfill
    n = backfill()
    assert n >= 1
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select entity_id from persona_search where user_id = %s", (uid,)
        ).fetchall()
    assert len(rows) == 1


def test_backfill_recreate_resets_embedding_column(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    from scripts.backfill_search_index import backfill
    backfill(recreate=True)  # must not raise; column recreated at db.EMBEDDING_DIM
    with db.get_pool().connection() as conn:
        row = conn.execute("""
            select atttypmod as dim from pg_attribute
            where attrelid = 'persona_search'::regclass and attname = 'embedding'
        """).fetchone()
    assert row["dim"] == db.EMBEDDING_DIM
```

(`scripts/` needs an `__init__.py` if it lacks one, or import via path manipulation matching how existing script tests do it — check `scripts/` for precedent; if no precedent, add `backend/scripts/__init__.py`.)

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `backend/scripts/backfill_search_index.py`**

```python
"""Rebuild the persona_search index for every user.

Usage:
    python scripts/backfill_search_index.py             # index missing/changed
    python scripts/backfill_search_index.py --recreate  # drop + recreate the
        embedding column at the configured EMBEDDING_DIM, then re-embed all

Reads DATABASE_URL and the EMBEDDING_* env vars (.env supported via
python-dotenv, matching main.py).
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

import db  # noqa: E402
import search_index  # noqa: E402


def backfill(recreate=False):
    db.ensure_schema()
    if recreate and (db.VECTOR_AVAILABLE or _has_embedding_column()):
        with db.get_pool().connection() as conn:
            conn.execute("alter table persona_search drop column if exists embedding;")
            conn.execute(
                f"alter table persona_search add column embedding vector({db.EMBEDDING_DIM});"
            )
            conn.execute(
                "create index if not exists persona_search_embedding_idx"
                " on persona_search using hnsw (embedding vector_cosine_ops);"
            )
            conn.execute("update persona_search set content_hash = '';")  # force re-embed
        db.VECTOR_AVAILABLE = True
    with db.get_pool().connection() as conn:
        users = [r["id"] for r in conn.execute("select id from users").fetchall()]
    total = 0
    for user_id in users:
        token = db.current_user_id.set(str(user_id))
        try:
            import persona_store
            for file_type in persona_store.VALID_FILES:
                data = persona_store.load(file_type)
                if isinstance(data, dict) and "error" not in data:
                    search_index.sync_index(str(user_id), file_type, data,
                                            embed_sync=True)
            with db.get_pool().connection() as conn:
                total += conn.execute(
                    "select count(*) as n from persona_search where user_id = %s",
                    (user_id,),
                ).fetchone()["n"]
        finally:
            db.current_user_id.reset(token)
    return total


def _has_embedding_column():
    with db.get_pool().connection() as conn:
        return conn.execute("""
            select 1 from information_schema.columns
            where table_name = 'persona_search' and column_name = 'embedding'
        """).fetchone() is not None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--recreate", action="store_true",
                        help="drop + recreate the embedding column at EMBEDDING_DIM")
    args = parser.parse_args()
    n = backfill(recreate=args.recreate)
    print(f"Indexed {n} entities.")
```

- [ ] **Step 4: Run** — backfill tests PASS; full suite green.
- [ ] **Step 5: README** — add an "Embedding search (optional)" subsection documenting the six env vars (exact table from the spec) and the two new MCP tools, plus the vanilla-Postgres FTS-only note.
- [ ] **Step 6: Commit** — `git commit -m "feat: search index backfill script + docs"`

---

### Task 9: Verification gate

**Files:** none (verification only; fix regressions found).

- [ ] **Step 1:** `cd backend && python -m pytest tests/ -q` — full suite green (expect ~185+).
- [ ] **Step 2:** Live FTS-only smoke against the local stack (test-db running, no embedding env): start `uvicorn main:app --port 8000` with `.env`, then with a valid bearer token exercise via curl or a short script: `search_context` through the MCP HTTP endpoint returning `mode: "fts"` with a seeded entry, and `get_entity` returning it in full. (Precedent: prior verification tasks scripted MCP HTTP calls — reuse that approach from the ledger's earlier phases if a helper exists.)
- [ ] **Step 3:** Optional local-embedding smoke ONLY if an Ollama server happens to be running (`curl -s localhost:11434/api/tags`); skip silently otherwise — do not install anything.
- [ ] **Step 4:** Verify startup resilience: unset `DATABASE_URL`-adjacent embedding vars, boot the server, confirm no crash and a clean health check.
- [ ] **Step 5:** Commit any fixes as `fix:`/`polish:`; report results.
