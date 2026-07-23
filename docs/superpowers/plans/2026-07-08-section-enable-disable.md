# Per-User Section Enable/Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user disable individual persona sections (`knowledge`/`projects`/`lifestyle`/`circle`) so they vanish from the entire MCP/AI surface and the frontend tabs, while data is preserved; controlled per-user from the frontend, persisted in Postgres.

**Architecture:** A per-user settings jsonb blob stored in `persona_data` under a reserved `_settings` key (via a new `settings_store` module that bypasses the registry-validated `persona_store`). One `settings_store.enabled_sections()` helper is consulted by every surface — `get_context`, `get_raw`, `get_schema`, `persona_modify`/`batch` — and by the frontend (via a new `/api/settings` endpoint). Always-on sections (`profile`, `preferences`, `learning_log`) can never be disabled.

**Tech Stack:** Python 3.11, FastAPI + FastMCP (`fastmcp==2.14.2`), Postgres via `psycopg` v3 (dict_row pool), pytest. React (Vite) frontend in `frontend/src/App.jsx`.

## Global Constraints

- Run backend from `backend/`: `cd backend && source venv/bin/activate`; tests `python -m pytest`. Local test Postgres is up; `tests/conftest.py` provides `clean_database` (autouse) + `as_user`. MCP tools are FastMCP `FunctionTool`s — call `.fn` for the raw function.
- `sections.py` stays **stdlib-only** (no `db`/`persona_store`/`server` imports). `settings_store.py` may import `db` and `sections`, never `server`. Import direction: `sections ← settings_store ← server`; `settings_store ← main`.
- **Always-on sections** = `profile`, `preferences`, `learning_log` — never disableable anywhere. **Toggleable** = the other registry sections (`knowledge`, `projects`, `lifestyle`, `circle`), derived, never hardcoded as a second list.
- The `_settings` blob must never leak into persona content: `VALID_FILES`/`persona_store.get_all`/`/api/all`/export all iterate registry sections, which exclude `_settings`. Any new all-rows iteration must filter it out.
- Opt-out default: absent/empty blob ⇒ all sections enabled.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Do not push; the controller handles pushing.

## Reference (current code)

- `db.py`: `get_pool()` (dict_row, autocommit via `with ... connection()`), `current_user_id` ContextVar, `ensure_schema()` (persona_data: `(user_id uuid, file_type text, data jsonb, primary key (user_id, file_type))`).
- `persona_store.py`: `load`/`save`/`_assign_ids` (registry-validated; **settings must NOT use these**).
- `sections.py`: `SECTION_REGISTRY` (7 sections), `SCOPES`, `ALWAYS_ON`, `all_scope_names()`.
- `server.py`: `get_scoped_context` (~732), `_resolve_scope_fields`/`_resolve_scope_fields_multi`/`_merge_fields`, `get_context` tool (~2894), `get_raw` tool (~2956), `ENTITY_SCHEMA` (~2239, keyed `file -> {entity -> spec}`), `get_entity_schema`/`_digest` (~2399), `execute_modify` (~1050), `persona_modify`/`persona_batch` tools.
- `main.py`: auth middleware sets `db.current_user_id`; endpoints `GET/PUT /api/files/{file_type}`, `/api/all`, etc.
- `frontend/src/App.jsx`: `loadAllData()` (~5647, `api("/all")`), hardcoded `<TabsTrigger>`/`<TabsContent>` for profile/knowledge/projects/lifestyle/circle/preferences (~5827).

---

## Task 1: `settings_store` module (per-user `_settings` blob)

**Files:**
- Create: `backend/settings_store.py`
- Test: `backend/tests/test_settings_store.py`

> ORDERING: `enabled_sections()` (which needs `sections.ALWAYS_ON_SECTIONS`) is intentionally added in **Task 2**, alongside that constant. This task adds only the storage primitives, which have no registry dependency.

**Interfaces:**
- Produces:
  - `get_settings() -> dict` — the current user's settings blob (`{}` if absent).
  - `set_settings(blob: dict) -> None` — upsert the blob.
  - `get_disabled_sections() -> set[str]` — `set(blob.get("disabled_sections", []))`.
  - `set_disabled_sections(keys: list[str]) -> None` — write `disabled_sections` into the blob (preserving other keys).
  - `SETTINGS_KEY = "_settings"`.
- Consumes: `db.get_pool`, `db.current_user_id` only. (No `sections` import in this task.)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_settings_store.py`:

```python
import persona_store as store
import settings_store as ss


def test_get_settings_empty_by_default(as_user):
    assert ss.get_settings() == {}


def test_set_and_get_settings_roundtrip(as_user):
    ss.set_settings({"disabled_sections": ["circle"], "future": {"x": 1}})
    assert ss.get_settings() == {"disabled_sections": ["circle"], "future": {"x": 1}}


def test_disabled_sections_helpers(as_user):
    assert ss.get_disabled_sections() == set()
    ss.set_disabled_sections(["knowledge", "circle"])
    assert ss.get_disabled_sections() == {"knowledge", "circle"}


def test_set_disabled_preserves_other_settings_keys(as_user):
    ss.set_settings({"future": {"x": 1}})
    ss.set_disabled_sections(["lifestyle"])
    blob = ss.get_settings()
    assert blob["future"] == {"x": 1}
    assert set(blob["disabled_sections"]) == {"lifestyle"}


def test_settings_blob_is_invisible_to_persona_get_all(as_user):
    ss.set_disabled_sections(["circle"])
    # get_all iterates the registry (VALID_FILES); _settings must not appear.
    assert ss.SETTINGS_KEY not in store.get_all()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_settings_store.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'settings_store'`.

- [ ] **Step 3: Create `backend/settings_store.py`**

Reads/writes the reserved `_settings` row in `persona_data` directly (NOT via `persona_store`, whose `save` runs `_assign_ids` and whose `load` validates `VALID_FILES`).

```python
"""Per-user settings blob, stored as a reserved `_settings` row in persona_data.

Kept separate from persona_store (which is registry-validated and id-assigns):
settings are user config, not persona content, and must never appear in
VALID_FILES / get_all / exports. Scoped to the current request's user via
db.current_user_id.
"""
import json

import db

SETTINGS_KEY = "_settings"


def get_settings() -> dict:
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from persona_data where user_id = %s and file_type = %s",
            (user_id, SETTINGS_KEY),
        ).fetchone()
    return row["data"] if row else {}


def set_settings(blob: dict) -> None:
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        conn.execute(
            """
            insert into persona_data (user_id, file_type, data, updated_at)
            values (%s, %s, %s, now())
            on conflict (user_id, file_type)
            do update set data = excluded.data, updated_at = now()
            """,
            (user_id, SETTINGS_KEY, json.dumps(blob)),
        )


def get_disabled_sections() -> set:
    return set(get_settings().get("disabled_sections", []))


def set_disabled_sections(keys) -> None:
    blob = get_settings()
    blob["disabled_sections"] = list(keys)
    set_settings(blob)
```

(`enabled_sections()` is added in Task 2, where `sections.ALWAYS_ON_SECTIONS` exists.)

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_settings_store.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/settings_store.py backend/tests/test_settings_store.py
git commit -m "feat: settings_store — per-user _settings blob isolated from persona content

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Registry always-on set + `enabled_sections()` helper

**Files:**
- Modify: `backend/sections.py`, `backend/settings_store.py`
- Test: `backend/tests/test_sections_registry.py` (append), `backend/tests/test_settings_store.py` (append)

**Interfaces:**
- Produces: `sections.ALWAYS_ON_SECTIONS: frozenset[str]`, `sections.toggleable_sections() -> set[str]`, and `settings_store.enabled_sections() -> set[str]`.
- Consumes: `SECTION_REGISTRY` (sections), `settings_store.get_disabled_sections` + `sections` (settings_store).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_sections_registry.py`:

```python
from sections import ALWAYS_ON_SECTIONS, toggleable_sections, SECTION_REGISTRY


def test_always_on_sections_are_the_core_three():
    assert ALWAYS_ON_SECTIONS == frozenset({"profile", "preferences", "learning_log"})


def test_always_on_are_real_registry_sections():
    assert ALWAYS_ON_SECTIONS <= set(SECTION_REGISTRY)


def test_toggleable_is_registry_minus_always_on():
    assert toggleable_sections() == set(SECTION_REGISTRY) - ALWAYS_ON_SECTIONS
    assert toggleable_sections() == {"knowledge", "projects", "lifestyle", "circle"}
```

Append to `backend/tests/test_settings_store.py`:

```python
def test_enabled_sections_all_by_default(as_user):
    import sections
    assert ss.enabled_sections() == set(sections.SECTION_REGISTRY)


def test_enabled_sections_drops_disabled(as_user):
    ss.set_disabled_sections(["circle"])
    assert "circle" not in ss.enabled_sections()
    assert "knowledge" in ss.enabled_sections()


def test_enabled_sections_force_includes_always_on(as_user):
    import sections
    # a hand-crafted blob disabling a core section must have no effect
    ss.set_disabled_sections(["profile", "circle"])
    enabled = ss.enabled_sections()
    assert sections.ALWAYS_ON_SECTIONS <= enabled
    assert "circle" not in enabled
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_sections_registry.py tests/test_settings_store.py -q`
Expected: FAIL — `ImportError: cannot import name 'ALWAYS_ON_SECTIONS'` / `AttributeError: module 'settings_store' has no attribute 'enabled_sections'`.

- [ ] **Step 3: Add to `backend/sections.py`**

Add near `ALWAYS_ON` (the field bundle — do not confuse the two):

```python
# Sections that can never be disabled by a user (always loaded / always visible).
# Distinct from ALWAYS_ON (the always-included preferences *field* bundle above).
ALWAYS_ON_SECTIONS = frozenset({"profile", "preferences", "learning_log"})


def toggleable_sections() -> set:
    """Registry sections a user may enable/disable (everything not always-on)."""
    return set(SECTION_REGISTRY) - ALWAYS_ON_SECTIONS
```

Then add `import sections` and this function to `backend/settings_store.py`:

```python
def enabled_sections() -> set:
    """Registry sections visible to the current user: all minus their disabled
    set, with always-on sections force-included (a stale/hand-edited blob can
    never hide a core section)."""
    disabled = get_disabled_sections() - sections.ALWAYS_ON_SECTIONS
    return set(sections.SECTION_REGISTRY) - disabled
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_sections_registry.py tests/test_settings_store.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sections.py backend/settings_store.py backend/tests/test_sections_registry.py backend/tests/test_settings_store.py
git commit -m "feat: registry always-on set + toggleable derivation + enabled_sections helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Settings API (`GET`/`PUT /api/settings`)

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_settings_api.py`

**Interfaces:**
- Consumes: `settings_store` (Task 1), `sections.toggleable_sections`/`ALWAYS_ON_SECTIONS` (Task 2).
- Produces: `GET /api/settings` → `{disabled_sections, toggleable, always_on}`; `PUT /api/settings` (body `{disabled_sections: [...]}`) validates + persists.

The API tests exercise the FastAPI routes with a real token. Use `fastapi.testclient.TestClient` and register a user via `/api/auth/register` for a valid Bearer token (the auth middleware runs in-process). Follow the pattern in `backend/tests/test_auth_routes.py` if present; otherwise the test below is self-contained.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_settings_api.py`:

```python
from fastapi.testclient import TestClient

import main


def _client_and_auth():
    client = TestClient(main.app)
    r = client.post("/api/auth/register", json={"username": "settings-test-user"})
    token = r.json()["token"]
    return client, {"Authorization": f"Bearer {token}"}


def test_get_settings_defaults(clean_database):
    client, auth = _client_and_auth()
    body = client.get("/api/settings", headers=auth).json()
    assert body["disabled_sections"] == []
    assert set(body["toggleable"]) == {"knowledge", "projects", "lifestyle", "circle"}
    assert set(body["always_on"]) == {"profile", "preferences", "learning_log"}


def test_put_settings_persists(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings", json={"disabled_sections": ["circle", "knowledge"]}, headers=auth)
    assert r.status_code == 200
    body = client.get("/api/settings", headers=auth).json()
    assert set(body["disabled_sections"]) == {"circle", "knowledge"}


def test_put_rejects_always_on_section(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings", json={"disabled_sections": ["profile"]}, headers=auth)
    assert r.status_code == 400


def test_put_rejects_unknown_section(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings", json={"disabled_sections": ["bogus"]}, headers=auth)
    assert r.status_code == 400
```

> If the suite has no `TestClient`-based tests yet and the auth middleware needs `db.current_user_id` set per-request, `TestClient` drives the real middleware so the contextvar is set from the Bearer token exactly as in production. `clean_database` (autouse) resets the schema; no `as_user` needed since the client registers its own user.

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_settings_api.py -q`
Expected: FAIL — 404 on `/api/settings`.

- [ ] **Step 3: Add the endpoints to `backend/main.py`**

Add `import settings_store` near the other imports (`import sections` already present). Add after the `/api/files` routes:

```python
class SettingsUpdate(BaseModel):
    disabled_sections: list[str]


@app.get("/api/settings")
async def get_settings():
    return {
        "disabled_sections": sorted(settings_store.get_disabled_sections()),
        "toggleable": sorted(sections.toggleable_sections()),
        "always_on": sorted(sections.ALWAYS_ON_SECTIONS),
    }


@app.put("/api/settings")
async def update_settings(update: SettingsUpdate):
    requested = set(update.disabled_sections)
    invalid = requested - sections.toggleable_sections()
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot disable: {sorted(invalid)}. "
                   f"Toggleable: {sorted(sections.toggleable_sections())}",
        )
    settings_store.set_disabled_sections(sorted(requested))
    return {"status": "saved", "disabled_sections": sorted(requested)}
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests/test_settings_api.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_settings_api.py
git commit -m "feat: GET/PUT /api/settings for per-user section disable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Enforce disable in `get_context`

**Files:**
- Modify: `backend/server.py` (`get_scoped_context` ~732, `_resolve_scope_fields_multi`)
- Test: `backend/tests/test_disable_context.py`

**Interfaces:**
- Consumes: `settings_store.enabled_sections()`.
- Produces: disabled sections omitted from context; a section scope naming a disabled section errors.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_disable_context.py`:

```python
import json

import server
import settings_store as ss
import persona_store as store


def _seed(as_user):
    c = store.load("circle"); c["connections"] = [{"name": "Sam"}]; store.save("circle", c)
    k = store.load("knowledge"); k["domains"] = [{"name": "Rust"}]; store.save("knowledge", k)


def test_disabled_section_omitted_from_full_context(as_user):
    _seed(as_user)
    ss.set_disabled_sections(["circle"])
    ctx = json.loads(server.get_context.fn(scope="full"))["context"]
    assert "circle" not in ctx
    assert "knowledge" in ctx  # not disabled


def test_disabled_section_omitted_from_personal_scope(as_user):
    _seed(as_user)
    ss.set_disabled_sections(["circle"])
    ctx = json.loads(server.get_context.fn(scope="personal"))["context"]
    assert "circle" not in ctx


def test_section_scope_of_disabled_section_errors(as_user):
    ss.set_disabled_sections(["circle"])
    out = json.loads(server.get_context.fn(scope="circle"))
    assert "error" in out
    assert "circle" in out["error"]


def test_always_on_section_never_omitted_even_if_in_disabled_blob(as_user):
    ss.set_disabled_sections(["profile"])  # bypasses API validation on purpose
    ctx = json.loads(server.get_context.fn(scope="full"))["context"]
    assert "profile" in ctx
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_disable_context.py -q`
Expected: FAIL — disabled sections still present.

- [ ] **Step 3: Filter in `get_scoped_context`**

Add `import settings_store` near the top of `server.py`. The current head of `get_scoped_context` is:

```python
    try:
        fields = _resolve_scope_fields_multi(scope)
    except ValueError as e:
        return {"error": f"Unknown scope '{e.args[0]}'. Valid: {sections.all_scope_names()}"}
    needed = _files_for_scope(fields)
    all_data = {ft: load_json(FILE_MAP[ft]) for ft in needed}
```

Replace exactly that head with the version below (it inserts the `enabled` gate; leave the rest of the function — the `if fields == "all": result = all_data` / `else:` field-selection loop — unchanged):

```python
    try:
        fields = _resolve_scope_fields_multi(scope)
    except ValueError as e:
        return {"error": f"Unknown scope '{e.args[0]}'. Valid: {sections.all_scope_names()}"}

    enabled = settings_store.enabled_sections()
    # A section scope that names a disabled section is an explicit error.
    for tok in ([scope] if isinstance(scope, str) else scope):
        if tok in sections.SECTION_REGISTRY and tok not in enabled:
            return {"error": f"Section '{tok}' is disabled. Enable it in settings."}

    if fields == "all":
        needed = [ft for ft in persona_store.VALID_FILES if ft in enabled]
    else:
        # Global/list scopes silently omit disabled sections.
        fields = {fk: fl for fk, fl in fields.items() if fk in enabled}
        needed = _files_for_scope(fields)

    all_data = {ft: load_json(FILE_MAP[ft]) for ft in needed}
```

Net effect: (a) a disabled section scope → error; (b) global/list scopes omit disabled sections; (c) `full` loads only enabled files. Always-on sections are always in `enabled`, so they are never dropped. The `if fields == "all": result = all_data` / `else: <loop over fields>` block below is unchanged: for `full` it now reflects only enabled files (via `needed`), and for other scopes the loop iterates the pre-filtered `fields`.

> Caveat to verify while implementing: confirm `all_data` for the `full` path is built from `needed` (the enabled-filtered list) — if the existing `result = all_data` branch references `all_data` built above, the filter flows through. Do not filter `result` separately.

- [ ] **Step 4: Run to verify pass, and the Phase-1 context suite still green**

Run: `python -m pytest tests/test_disable_context.py tests/test_context_efficiency.py tests/test_section_scopes.py tests/test_multi_scope.py -q`
Expected: PASS. (With no disabled sections, `enabled` is every section, so existing behavior is unchanged — the Phase-1 characterization tests must stay green.)

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_disable_context.py
git commit -m "feat: get_context hides disabled sections; section scope of a disabled section errors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Enforce disable in `get_raw` and `get_schema`

**Files:**
- Modify: `backend/server.py` (`get_raw` ~2956; `get_all_persona_data` usage; `get_entity_schema`/`_digest` ~2399)
- Test: `backend/tests/test_disable_reads.py`

**Interfaces:**
- Consumes: `settings_store.enabled_sections()`.
- Produces: `get_raw` excludes disabled sections (from `"all"` and by name); `get_schema` omits disabled sections' entities.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_disable_reads.py`:

```python
import json

import server
import settings_store as ss


def test_get_raw_disabled_file_errors(as_user):
    ss.set_disabled_sections(["circle"])
    out = server.get_raw.fn(file="circle")
    assert out.startswith("❌")
    assert "disabled" in out.lower()


def test_get_raw_all_excludes_disabled(as_user):
    ss.set_disabled_sections(["circle"])
    data = json.loads(server.get_raw.fn(file="all"))
    assert "circle" not in data
    assert "knowledge" in data


def test_get_raw_always_on_still_readable(as_user):
    ss.set_disabled_sections(["profile"])  # bypasses validation on purpose
    data = json.loads(server.get_raw.fn(file="profile"))
    assert isinstance(data, dict)  # not an error string


def test_get_schema_omits_disabled_section_entities(as_user):
    ss.set_disabled_sections(["circle"])
    digest = json.loads(server.get_schema.fn())
    assert "circle" not in digest["files"]
    assert "knowledge" in digest["files"]


def test_get_schema_entity_lookup_of_disabled_section_errors(as_user):
    ss.set_disabled_sections(["circle"])
    out = json.loads(server.get_schema.fn(entity="connection"))  # connection lives in circle
    assert "error" in out
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_disable_reads.py -q`
Expected: FAIL — disabled data/entities still returned.

- [ ] **Step 3: Filter `get_raw` and `get_schema`**

**get_raw** (body currently: `all` → `get_all_persona_data()`; `elif file in FILE_MAP` → load; else error). Change to consult `enabled_sections()`:

```python
    enabled = settings_store.enabled_sections()
    if file == "all":
        data = get_all_persona_data()
        return json.dumps({k: v for k, v in data.items() if k in enabled}, indent=2)
    elif file in FILE_MAP and file in enabled:
        return json.dumps(load_json(FILE_MAP[file]), indent=2)
    elif file in FILE_MAP:  # exists but disabled
        return f"❌ Section '{file}' is disabled. Enable it in settings."
    else:
        return f"❌ Unknown file: {file}. Valid: all, {', '.join(persona_store.VALID_FILES)}"
```

**get_schema** — `get_entity_schema` (the helper behind the tool) resolves `entity`/`file`/no-arg from `ENTITY_SCHEMA`. Filter by enabled sections. In `get_entity_schema`:
- No-arg digest: pass only enabled files to `_digest`.
- `file=X`: if `X` not in enabled → return `{"error": f"Section '{X}' is disabled."}`.
- `entity=X`: resolve its file (via the existing `for file_name, entities in ENTITY_SCHEMA.items()` loop); if that file is not in enabled → `{"error": f"Section '{file_name}' is disabled; enable it in settings."}`.

Concretely, at the top of `get_entity_schema` compute `enabled = settings_store.enabled_sections()`, and:
- for the no-arg path, replace the file list handed to `_digest`/the catalog with `[f for f in ENTITY_SCHEMA if f in enabled]`;
- in the entity-found branch, before returning, check `if file_name not in enabled: return {"error": ...}`;
- in the `file` branch, check `if file.lower() not in enabled: return {"error": ...}` (only for real-but-disabled files; keep the existing unknown-file error otherwise).

(Read the current `get_entity_schema` body and thread `enabled` through its three branches; keep every existing shape otherwise.)

- [ ] **Step 4: Run to verify pass + schema suite green**

Run: `python -m pytest tests/test_disable_reads.py tests/test_get_schema.py tests/test_get_raw.py -q`
Expected: PASS. (No disabled sections ⇒ `enabled` is all sections ⇒ existing `get_schema`/`get_raw` tests unchanged.)

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_disable_reads.py
git commit -m "feat: get_raw + get_schema hide disabled sections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Reject writes to disabled sections in `persona_modify`/`persona_batch`

**Files:**
- Modify: `backend/server.py` (`execute_modify` ~1050, or the `persona_modify`/`persona_batch` tool bodies)
- Test: `backend/tests/test_disable_writes.py`

**Interfaces:**
- Consumes: `settings_store.enabled_sections()`, `ENTITY_SCHEMA` (entity→section).
- Produces: a modify/batch op whose entity belongs to a disabled section is rejected with a clear message; entities in enabled/always-on sections work normally.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_disable_writes.py`:

```python
import server
import settings_store as ss
import persona_store as store

modify = server.persona_modify.fn


def test_write_to_disabled_section_rejected(as_user):
    ss.set_disabled_sections(["circle"])
    out = modify(action="add", entity="connection", data={"name": "Sam"})
    assert "❌" in out and "disabled" in out.lower()
    # and nothing was written
    assert store.load("circle").get("connections", []) == []


def test_write_to_enabled_section_still_works(as_user):
    ss.set_disabled_sections(["circle"])  # circle off, knowledge on
    out = modify(action="add", entity="domain", data={"name": "Rust"})
    assert "❌" not in out
    assert any(d["name"] == "Rust" for d in store.load("knowledge")["domains"])


def test_write_to_always_on_section_never_blocked(as_user):
    ss.set_disabled_sections(["preferences"])  # bypasses validation on purpose
    out = modify(action="add", entity="dislike", data={"dislike": "spam"})
    assert "❌" not in out
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_disable_writes.py -q`
Expected: FAIL — writes to disabled sections still succeed.

- [ ] **Step 3: Add an entity→section guard**

Add a helper near `ENTITY_SCHEMA`:

```python
def _section_for_entity(entity: str):
    """The registry section (file_type) an entity writes to, or None if unknown."""
    entity = entity.lower()
    for file_name, entities in ENTITY_SCHEMA.items():
        if entity in entities:
            return file_name
    return None
```

At the very top of `execute_modify(action, entity, data)` (so both `persona_modify` and `persona_batch` — which route through it — are covered), add:

```python
    section = _section_for_entity(entity)
    if section is not None and section not in settings_store.enabled_sections():
        return f"❌ Section '{section}' is disabled; enable it in settings to modify it."
```

(If `section is None`, leave it to the existing unknown-entity handling downstream — do not change that.)

Verify `persona_batch` calls `execute_modify` per op (read it); if it has its own pre-validation path that bypasses `execute_modify`, add the same guard there. The test uses `persona_modify` only, but confirm batch shares the path.

- [ ] **Step 4: Run to verify pass + write suites green**

Run: `python -m pytest tests/test_disable_writes.py tests/test_entity_ids.py tests/test_execute_modify_golden.py -q`
(If `test_execute_modify_golden.py` does not exist, run the modify-related tests that do.)
Expected: PASS. (No disabled sections ⇒ guard never triggers ⇒ existing modify behavior unchanged.)

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_disable_writes.py
git commit -m "feat: reject persona_modify/batch writes to disabled sections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — settings panel + tab filtering

**Files:**
- Modify: `frontend/src/App.jsx`
- (Verification: `superpowers`/`webapp-testing` or manual — the frontend has no unit-test harness.)

**Interfaces:**
- Consumes: `GET /api/settings`, `PUT /api/settings` (Task 3).
- Produces: disabled toggleable tabs hidden; a settings control to toggle them; always-on tabs always shown.

- [ ] **Step 1: Fetch settings on load**

In `App`, add state and fetch alongside `loadAllData` (~5647). After `const response = await api("/all");` block, also load settings:

```javascript
  const [disabledSections, setDisabledSections] = useState([]);
  const [toggleable, setToggleable] = useState([]);

  const loadSettings = async () => {
    try {
      const s = await api("/settings");
      setDisabledSections(s.disabled_sections || []);
      setToggleable(s.toggleable || []);
    } catch (_) { /* non-fatal: default to all enabled */ }
  };
```

Call `loadSettings()` inside the existing `useEffect(() => { loadAllData(); }, [])` (add `loadSettings();`).

- [ ] **Step 2: Gate the toggleable tabs**

Wrap each toggleable section's `<TabsTrigger>` and its matching `<TabsContent>` (knowledge, projects, lifestyle, circle) in a guard `!disabledSections.includes("<key>") && (...)`. Leave `profile` and `preferences` triggers/content unconditional. Example for knowledge:

```jsx
{!disabledSections.includes("knowledge") && (
  <TabsTrigger value="knowledge" className="gap-2">
    <Brain className="h-4 w-4" />
    <span className="hidden sm:inline">Knowledge</span>
  </TabsTrigger>
)}
```

and likewise wrap `<TabsContent value="knowledge">…</TabsContent>`. Repeat for projects/lifestyle/circle.

- [ ] **Step 3: Add a Sections settings control**

Add a small "Manage sections" panel — a lightweight component near the header (or a dedicated `<TabsTrigger value="settings">`/`<TabsContent value="settings">` pair). It lists each key in `toggleable` with a toggle (use the project's existing UI kit — a `Switch` from `@/components/ui/switch` if present, else a checkbox), reflecting `!disabledSections.includes(key)`. On toggle, compute the next disabled array and persist:

```javascript
  const toggleSection = async (key) => {
    const next = disabledSections.includes(key)
      ? disabledSections.filter((k) => k !== key)
      : [...disabledSections, key];
    setDisabledSections(next);                       // optimistic
    try {
      await api("/settings", { method: "PUT", body: { disabled_sections: next } });
    } catch (e) {
      setDisabledSections(disabledSections);          // rollback on failure
    }
  };
```

(Match the existing `api()` helper's calling convention — inspect how PUTs are issued elsewhere in `App.jsx`, e.g. saves, and mirror the method/body shape.)

- [ ] **Step 4: Verify in the running app**

Use the `superpowers`/`webapp-testing` (Playwright) skill or manual steps: start the frontend, toggle a section off in the settings panel, confirm its tab disappears and `PUT /api/settings` fires; reload and confirm it stays hidden (persisted); toggle back on and confirm the tab + its data return. Confirm `profile`/`preferences` have no toggle and never hide.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: frontend section enable/disable — settings panel + tab filtering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after Task 7)

- [ ] Backend suite green: `cd backend && source venv/bin/activate && python -m pytest -q`.
- [ ] End-to-end sanity: as a user, `PUT /api/settings {disabled_sections:["circle"]}` → `get_context(scope="full")`, `get_raw("all")`, `get_schema()` all omit `circle`; `persona_modify(entity="connection")` is rejected; `profile`/`preferences`/`learning_log` always present.
- [ ] `_settings` never appears in `/api/all`, `get_context`, or export output.
- [ ] Frontend: disabled section's tab hidden, data preserved, re-enable restores it.
