# MCP Efficiency + Section Registry + Learning Log Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the MyGist MCP server cheaper to call and far easier to extend by (a) landing concrete efficiency wins in the read path, (b) collapsing the ~9 hand-synced per-section tables into **one internal section registry** that the write/read/schema paths consume generically, (c) adding a per-user enable/disable toggle for context loading, and (d) giving the learning log efficient MCP loading, full CRUD, and a real frontend view/edit/delete panel.

**Architecture:** A **strangler-fig refactor**, not a rewrite. We introduce `backend/sections.py` — a declarative registry where each persona section (profile, knowledge, lifestyle, projects, circle, preferences, learning_log) is one `SectionSpec` describing its default shape, its entities (list key, id prefix, identifier field, required/optional fields, valid values, aliases), and which fields it contributes to each context scope. Existing hardcoded structures (`ENTITY_SCHEMA`, `CONTEXT_SCOPES`, `FIELD_ALIASES`, `normalize_data`'s if/elif, `persona_store.DEFAULTS`/`ID_LISTS`) are migrated one at a time to **derive from the registry**, with characterization tests locking current behavior before each migration so outputs stay byte-identical. Once reads and simple-list writes are registry-driven, per-user enable/disable and learning-log CRUD become small additions rather than new special cases.

**Tech Stack:** Existing FastAPI + FastMCP (`fastmcp==2.14.2`) + Postgres (`psycopg`) backend, `pytest` suite, React/Vite frontend. No new runtime dependencies. Plugin **packaging** (dynamically-loaded / third-party modules) is explicitly out of scope — this builds the internal registry that a future packaging layer *could* sit on, but does not build that layer.

**Key facts this plan relies on (verified against current code, post-commit `8aaf6aa`):**
- `persona_modify` → `execute_modify` (`backend/server.py:1050-2186`) is a single flat `if/elif` over **36 entity types**, each re-implementing `load_json → mutate list/dict → save_json` (36 `load_json`, 88 `save_json` calls). Fallback `❌ Unknown entity type` at `server.py:2186`.
- There are **three drifting sources of truth** for "what fields exist": `persona_store.DEFAULTS` (plural keys), `CONTEXT_SCOPES` (`server.py:679-721`, plural subset), and `ENTITY_SCHEMA` (`server.py:2193-2271`, singular entity names). Real drift exists: `organisation`, `nationality`, `languages_spoken`, `goals_and_careers` are in `DEFAULTS` but in **no** context scope.
- Section knowledge is *also* smeared across `FIELD_ALIASES` (`server.py:970-987`), `normalize_data`'s if/elif (`server.py:996-1029`), `find_in_persona.search_paths` (`server.py:412-421`, only 8 entities), and `persona_store.ID_LISTS` (`persona_store.py:15-46`).
- `get_scoped_context` (`server.py:723-778`) calls `get_all_persona_data()` (`server.py:735`) **unconditionally loading all 7 files (7 DB round-trips) regardless of scope**, then discards unused ones. No caching anywhere. Token estimate is `len(json.dumps(result)) // 4` computed on the compact form while the tool returns `indent=2` (`server.py:2723`), so the estimate understates the real payload.
- `_normalize` (`persona_store.py:138-281`) runs the full legacy-migration pass on **every read** even though data is already migrated.
- Learning log: entries created only via the `learning_entry` branch (`server.py:1641-1687`, id at `:1651`); `update` can **only** modify `followup_items` (`server.py:1668-1677`); `_filter_learning_log_by_time` (`server.py:780-822`) **fails open** on unparseable timestamps and `limit` returns the **oldest** N (`server.py:807-808`); real data has two incompatible timestamp formats. **No frontend surface at all** — `App.jsx:5652-5657` fetches `/api/all` but drops `learning_log`; tabs are hardcoded (`App.jsx:5827-5890`).
- The MCP tool signatures freeze the section/scope sets: `get_raw`'s `file: Literal[...]` (`server.py:2729`) and `get_context`'s `scope: Literal[...]` (`server.py:2693`).
- Full suite is green (25 tests) on pinned deps. `as_user` fixture lives in `backend/tests/conftest.py`; MCP tools are `FunctionTool`s — call the raw fn via `.fn`.

---

## Phase 0 — Efficiency quick wins (no architecture change; ship first)

Standalone. Each task is independently shippable and does not depend on the registry.

### Task 0.1: Characterize then scope-target context loading

**Files:**
- Test: `backend/tests/test_context_efficiency.py` (create)
- Modify: `backend/server.py` (`get_scoped_context` ~723-778)

**Step 1: Write a characterization test that locks current `get_context` output per scope**

```python
# backend/tests/test_context_efficiency.py
import json
import server
import persona_store as store

get_context = server.get_context.fn


def _seed(as_user):
    # minimal but non-empty data across sections
    store.save("profile", {**store.DEFAULTS["profile"], "name": "A", "preferred_name": "B"})
    store.save("projects", {**store.DEFAULTS["projects"], "top_of_mind": [{"topic": "x"}]})


def test_scopes_return_stable_shape(as_user):
    _seed(as_user)
    for scope in ("minimal", "professional", "personal", "learning", "full"):
        out = json.loads(get_context(scope=scope))
        assert set(out.keys()) == {"scope", "scope_description", "topic_filter", "token_estimate", "context"}
        assert out["scope"] == scope
```

**Step 2: Run it — verify it passes against current code** (this is a lock, not a red test)

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_context_efficiency.py -v`
Expected: PASS (captures today's behavior).

**Step 3: Add a `_files_for_scope` helper and load only those files**

In `get_scoped_context`, replace the unconditional `all_data = get_all_persona_data()` (`server.py:735`) with scope-targeted loading:

```python
def _files_for_scope(scope_config) -> list[str]:
    fields = scope_config["fields"]
    if fields == "all":
        return list(persona_store.VALID_FILES)
    return list(fields.keys())

# inside get_scoped_context, after resolving scope_config:
needed = _files_for_scope(scope_config)
all_data = {ft: load_json(FILE_MAP[ft]) for ft in needed}
```

Leave the rest of the function untouched — the field-selection loop already only reads `file_key`s present in `scope_config["fields"]`, so restricting `all_data` to those keys changes nothing about the output for non-`full` scopes, and `full` still loads everything.

**Step 4: Run the characterization test + full suite**

Run: `python -m pytest tests/test_context_efficiency.py tests/ -q`
Expected: all PASS (output identical; `minimal` now does 3 DB reads instead of 7).

**Step 5: Add an assertion that non-full scopes don't load every file**

```python
def test_minimal_scope_only_touches_its_files(as_user, monkeypatch):
    loaded = []
    orig = server.load_json
    monkeypatch.setattr(server, "load_json", lambda fn: loaded.append(fn) or orig(fn))
    server.get_context.fn(scope="minimal")
    # minimal scope config lists preferences, profile, projects only
    assert set(loaded) <= {"preferences.json", "profile.json", "projects.json"}
```

Run: `python -m pytest tests/test_context_efficiency.py -v` → PASS.

**Step 6: Commit**

```bash
git add backend/server.py backend/tests/test_context_efficiency.py
git commit -m "perf: load only the files a context scope needs, not all seven"
```

### Task 0.2: Accurate token estimate + single serialization

**Files:**
- Modify: `backend/server.py` (`get_scoped_context` token estimate ~769-770; `get_context` return ~2723)

**Step 1: Write a test that the reported token_estimate matches the actual returned payload**

```python
def test_token_estimate_matches_returned_payload(as_user):
    raw = server.get_context.fn(scope="full")          # the exact string the tool returns
    out = json.loads(raw)
    # estimate should be within 5% of len(returned_string)//4, not the compact form
    assert abs(out["token_estimate"] - len(raw() if callable(raw) else raw)//4) <= max(5, out["token_estimate"]*0.05)
```

(Adjust to compare against the real returned string; the point is the estimate must reflect the `indent=2` payload the caller actually receives.)

**Step 2: Run → observe it FAIL** (today's estimate uses the compact form, undercounting the indented return).

**Step 3: Serialize once, estimate on that string**

Refactor so `get_context` builds the return string once and estimates on it:
- Move the final `json.dumps(result, indent=2)` decision into `get_scoped_context` (or have `get_context` compute `token_estimate = len(returned_str)//4` after serializing). Eliminate the separate compact `json.dumps` at `server.py:769` — reuse the single serialized string for both the estimate and the return value.

**Step 4: Run the test + full suite** → PASS.

**Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_context_efficiency.py
git commit -m "perf: base token estimate on the actual returned payload; serialize once"
```

### Task 0.3: Learning-log load correctness (newest-N + robust timestamps)

**Files:**
- Modify: `backend/server.py` (`_filter_learning_log_by_time` ~780-822)
- Test: `backend/tests/test_learning_log_load.py` (create)

**Step 1: Write failing tests for the three defects**

```python
# backend/tests/test_learning_log_load.py
import server

_filt = server._filter_learning_log_by_time


def _entries():
    return {"entries": [
        {"id": "learn_1", "timestamp": "2025-01-01T00:00:00Z"},          # oldest
        {"id": "learn_2", "timestamp": "2026-03-21T03:32:26.410768"},    # naive micros
        {"id": "learn_3", "timestamp": "2026-07-01T00:00:00Z"},          # newest
        {"id": "learn_4"},                                               # missing ts
    ]}


def test_limit_returns_newest_not_oldest():
    out = _filt(_entries(), days=None, limit=2)
    ids = [e["id"] for e in out["entries"]]
    assert ids == ["learn_3", "learn_2"]  # newest first, not learn_1/learn_2


def test_mixed_timestamp_formats_parse():
    out = _filt(_entries(), days=3650, limit=None)   # ~10y window keeps all dated
    assert {e["id"] for e in out["entries"]} >= {"learn_1", "learn_2", "learn_3"}


def test_missing_timestamp_is_not_silently_kept_as_recent():
    # entries without a timestamp should sort last / be clearly flagged, not jump the window
    out = _filt(_entries(), days=30, limit=None)
    # learn_4 (no ts) must not appear ahead of dated entries in a recency-bounded view
    assert "learn_4" not in [e["id"] for e in out["entries"][:1]]
```

**Step 2: Run → FAIL** (today `limit` slices oldest-first and missing timestamps fail open).

**Step 3: Rewrite `_filter_learning_log_by_time`**

- Parse both `Z`-suffixed and naive-microsecond timestamps (normalize to timezone-aware UTC; treat missing/unparseable as `datetime.min`/UTC so they sort last, not first).
- Sort entries newest-first before applying `limit`, so `limit` returns the most recent N.
- Keep the `_filter` breadcrumb string but make it state "newest N".

**Step 4: Run tests + full suite** → PASS.

**Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_learning_log_load.py
git commit -m "fix: learning-log context returns newest N with robust timestamp parsing"
```

---

## Phase 1 — The section registry (the keystone refactor)

Strangler migration. **Characterization tests first**, then migrate each consumer to the registry, keeping outputs identical. Order: build registry → migrate schema (read) → migrate context fields (read) → migrate simple-list writes → migrate normalization/ids/defaults.

### Task 1.0: Golden characterization tests for all entity operations

**Files:**
- Test: `backend/tests/test_execute_modify_golden.py` (create)

**Step 1: Write parametrized add/update/remove tests covering every one of the 36 entities**

For each entity, assert the post-`execute_modify` file content matches an expected snapshot (the current behavior). Use `server.persona_modify.fn(action=..., entity=..., data=...)` then `server.load_json(...)`. Cover at least: the simple-list entities (`hobby, domain, project, connection, mental_tab, passion, curiosity, personality_trait, value, dislike, current_learning, top_of_mind, career_aspiration, language, work_experience, education, learning_entry`) and the nested ones (`work_highlight, education_highlight, coursework, coursework_topic, hobby_reference, hobby_specific, domain_reference, mental_tab_reference, project_tag, project_reference, project_highlight, email, link, sleep, energy_peak, communication_default, mood_override, preference, knowledge`).

Keep these tests **behavior-locking**: they must pass against today's code and continue to pass unchanged through the entire registry migration.

**Step 2: Run → all PASS against current code.**

**Step 3: Commit**

```bash
git add backend/tests/test_execute_modify_golden.py
git commit -m "test: golden characterization tests for all 36 persona_modify entities"
```

### Task 1.1: Introduce `sections.py` registry (data only, parity-checked)

**Files:**
- Create: `backend/sections.py`
- Test: `backend/tests/test_sections_registry.py` (create)

**Step 1: Define the registry types and populate all 7 sections**

```python
# backend/sections.py
from dataclasses import dataclass, field
from typing import Callable, Optional

@dataclass
class EntitySpec:
    name: str                      # singular, e.g. "hobby"
    list_key: str                  # plural key in the file blob, e.g. "hobbies"
    id_prefix: Optional[str] = None
    identifier: str = "name"       # field used to find/remove (e.g. "topic" for learning_entry)
    required: list = field(default_factory=list)
    optional: list = field(default_factory=list)
    valid_values: dict = field(default_factory=dict)
    aliases: dict = field(default_factory=dict)   # field -> [accepted names]
    kind: str = "list"             # "list" (generic) | "custom"
    handler: Optional[Callable] = None            # required when kind == "custom"

@dataclass
class SectionSpec:
    key: str                       # file_type, e.g. "lifestyle"
    default: dict                  # the DEFAULTS[key] skeleton
    entities: list                 # list[EntitySpec]
    context_fields: dict = field(default_factory=dict)   # scope -> [field names]
    normalize: Optional[Callable] = None                  # per-section legacy normalizer

SECTION_REGISTRY: dict = {}   # key -> SectionSpec, populated below
```

Populate `SECTION_REGISTRY` by transcribing today's data: `default` from `persona_store.DEFAULTS`; `entities` from `ENTITY_SCHEMA` (`server.py:2193-2271`) merged with `ID_LISTS` (`persona_store.py:15-46`) for `id_prefix`, `FIELD_ALIASES` (`server.py:970-987`) for `aliases`, and identifier defaults (`name`, except `learning_entry`→`topic`/`id`, `top_of_mind`/`current_learning`→`topic`, `mental_tab`→`name`); `context_fields` from `CONTEXT_SCOPES` (`server.py:679-721`). Mark nested entities (`work_highlight`, `education_highlight`, `coursework`, `coursework_topic`, `*_reference`, `hobby_specific`, `project_tag`, `project_highlight`, `email`, `link`, `sleep`, `energy_peak`, `communication_default`, `mood_override`, `preference`, `knowledge`) as `kind="custom"` (handlers wired in Task 1.4).

**Step 2: Write parity tests proving the registry equals today's tables**

```python
# backend/tests/test_sections_registry.py
import persona_store as store
import server
from sections import SECTION_REGISTRY

def test_defaults_match():
    assert {k: s.default for k, s in SECTION_REGISTRY.items()} == store.DEFAULTS

def test_valid_files_match():
    assert set(SECTION_REGISTRY) == set(store.VALID_FILES)

def test_every_entity_schema_entry_is_represented():
    reg_entities = {e.name for s in SECTION_REGISTRY.values() for e in s.entities}
    schema_entities = {e for f in server.ENTITY_SCHEMA.values() for e in f}
    assert schema_entities <= reg_entities

def test_context_fields_match_scopes():
    for scope, cfg in server.CONTEXT_SCOPES.items():
        if cfg["fields"] == "all":
            continue
        for fkey, fields in cfg["fields"].items():
            assert SECTION_REGISTRY[fkey].context_fields.get(scope, []) == fields
```

**Step 3: Run → PASS** (registry is a faithful transcription).

**Step 4: Commit**

```bash
git add backend/sections.py backend/tests/test_sections_registry.py
git commit -m "feat: add declarative section registry (parity-checked against existing tables)"
```

### Task 1.2: Derive `get_schema` from the registry; delete `ENTITY_SCHEMA`

**Files:** Modify `backend/server.py` (`get_entity_schema` ~2273-2290; remove `ENTITY_SCHEMA` ~2193-2271).

**Steps:** Rewrite `get_entity_schema` to build its `{entity, file, schema}` / `{file, entities}` / full-catalog responses from `SECTION_REGISTRY`. Keep the exact output shape. Run the golden schema tests (add a characterization test capturing today's `get_schema` output for a few entities/files first, then refactor, then confirm identical). Delete `ENTITY_SCHEMA`. Commit: `refactor: build get_schema from the section registry`.

### Task 1.3: Derive context field-selection from the registry; delete `CONTEXT_SCOPES` field tables

**Files:** Modify `backend/server.py` (`get_scoped_context` field loop; `CONTEXT_SCOPES` ~679-721).

**Steps:** Replace the per-scope hardcoded field dict with a registry lookup: for a given scope, a section contributes `spec.context_fields.get(scope, [])`. Keep `CONTEXT_SCOPES` only as `{scope: {"description": ...}}` metadata (or move descriptions into the registry). `_files_for_scope` (from Task 0.1) becomes "sections whose `context_fields[scope]` is non-empty." Run Task 0.1's characterization tests — output must stay identical. Commit: `refactor: select context fields from the registry`.

### Task 1.4: Generic write handler for simple-list entities

**Files:** Modify `backend/server.py` (`execute_modify` ~1050-2186).

**Step 1:** Write a generic `_modify_list_entity(action, spec, entity_spec, data)` that does load → `setdefault(list_key)` → dedupe/find by `identifier` → add/update/remove → assign id via `entity_spec.id_prefix` → save, producing the same success/error strings as today (the golden tests pin these).

**Step 2:** In `execute_modify`, before the big if/elif, look up the entity in the registry; if `kind == "list"`, delegate to `_modify_list_entity` and return. Leave the `kind == "custom"` entities in their existing branches (unchanged).

**Step 3:** Run `test_execute_modify_golden.py` — **all must still pass**. Iterate on `_modify_list_entity` until the simple-list entities produce byte-identical results, then delete their now-dead if/elif branches.

**Step 4:** Commit: `refactor: route simple-list entities through one generic handler`.

> This is the highest-risk task. Do it entity-by-entity: migrate one simple-list entity, run golden tests, commit; repeat. Do **not** batch.

### Task 1.5: Move id assignment, aliases, and normalization onto the registry

**Files:** Modify `backend/persona_store.py` (`ID_LISTS`, `_assign_ids`), `backend/server.py` (`FIELD_ALIASES`, `normalize_data`).

**Steps:** Have `persona_store._assign_ids` derive its `(list_key, prefix)` pairs from `SECTION_REGISTRY` instead of the local `ID_LISTS`. Have `normalize_data` (`server.py:989-1043`) resolve alias lists from `entity_spec.aliases` instead of the hardcoded if/elif. Move each section's legacy `_normalize` branch (`persona_store.py:138-281`) into that section's `spec.normalize` callable; `persona_store.load` calls `spec.normalize` if present. Run full suite — identical behavior. Commit: `refactor: drive ids/aliases/normalization from the registry`.

> **Note (perf):** once `spec.normalize` is per-section, guard it so it only runs its heavy migration when a legacy shape is actually detected (cheap `isinstance`/key checks first) — addressing the "normalize on every read" cost the analysis flagged. Add a test that a fully-migrated blob passes through `spec.normalize` without mutation.

### Task 1.6: Single source of truth — derive `DEFAULTS`/`VALID_FILES` from the registry

**Files:** Modify `backend/persona_store.py` (top-level `VALID_FILES`, `DEFAULTS`, `FILE_MAP`).

**Steps:** Replace the literal `DEFAULTS`/`VALID_FILES` with derivations from `SECTION_REGISTRY` (import order: `sections.py` must not import `persona_store` to avoid a cycle — keep `sections.py` dependency-free of `db`/`persona_store`; `persona_store` imports `sections`). Run full suite. Fix the known drift as a deliberate, tested change: decide per field whether `organisation`/`nationality`/`languages_spoken`/`goals_and_careers` should now appear in a scope (they were silently absent) — add them to `professional`/`personal` `context_fields` with a test. Commit: `refactor: single source of truth for section defaults + close context-scope drift`.

**Phase 1 exit criteria:** adding a new *simple* section is one `SectionSpec` in `sections.py` + nothing else; `ENTITY_SCHEMA`, `ID_LISTS`, `FIELD_ALIASES`'s dispatch, and the per-scope field tables no longer exist as independent structures; all golden + suite tests green.

---

## Phase 2 — Per-user enable/disable for context loading

> Task-level breakdown; expand to bite-sized steps once Phase 1's registry API is concrete.

### Task 2.1: `enabled_sections` preference (backend)
- Add `enabled_sections` to the `preferences` section default (registry) — default = all section keys.
- In `get_scoped_context`, after scope-targeting, drop any section not in the caller's `enabled_sections` (read from the user's `preferences` blob). Add MCP/REST coverage: it's read/written through the existing generic preferences path — verify via a test that disabling `lifestyle` removes it from `personal`-scope output.
- Test: two users, one with `lifestyle` disabled, get different `personal` context; token_estimate drops accordingly.
- Commit: `feat: per-user enabled_sections filter for context loading`.

### Task 2.2: Registry-driven tabs + honor toggles (frontend)
- Break the 5,964-line `App.jsx` section editors into a registry-like map `{ sectionKey: Component }` and render tabs by iterating that map ∩ `enabled_sections`, replacing the hardcoded `TabsTrigger`/`TabsContent` block (`App.jsx:5827-5890`).
- Add a settings surface (in `ConnectionSettings` or a new panel) to toggle sections, persisting to `preferences.enabled_sections` via the existing save path.
- Manual browser verification: disable a section → its tab disappears and it stops loading into agent context.
- Commit: `feat: registry-driven section tabs with per-user enable/disable`.

---

## Phase 3 — Learning log: efficient load, full CRUD, frontend panel

> Task-level breakdown; Phase 1 makes learning_log a normal registry section, so most CRUD falls out generically. Phase 0.3 already fixed load efficiency.

### Task 3.1: Full CRUD for learning entries via MCP
- With `learning_entry` registered (Task 1.1) as a `custom` entity (it keeps its `learn_<date>_<hex6>` id + dual identifier `id`/`topic`), extend its handler so `update` can edit **any** field (topic, details, tags, source, key_decisions, followup_items), not just `followup_items` (today's limit at `server.py:1668-1677`); `remove` by `id` (preferred) or `topic`.
- Add golden tests: update `details` of an existing entry by id; delete by id; confirm id/timestamp preserved on update.
- Commit: `feat: full edit/delete of learning-log entries via persona_modify`.

### Task 3.2: (Optional, cheap) link entries to entities by id
- Allow `related_entries` to hold `{type, id}` refs (domains/projects/hobbies now have stable ids from the earlier work). Validate ids exist at write time. Surface them in `learning`-scope context.
- Commit: `feat: structured id links from learning entries to persona entities`.

### Task 3.3: Frontend learning-log view/edit/delete panel
- Add a `LearningLogEditor` component and register it as a section (Phase 2's map), adding the missing tab.
- Fix `loadAllData` (`App.jsx:5652-5657`) to stop dropping `learning_log`; wire save via the existing per-file PUT path.
- Panel capabilities: list newest-first, search/filter by tag & date range, expand entry, edit fields, delete with confirm, add new entry.
- Add `frontend/src/lib/api.js` helpers if needed (or reuse the generic file GET/PUT).
- Manual browser verification: view existing 33 entries, edit one, delete one, add one, filter by tag — all persist to Neon.
- Commit: `feat: learning-log panel (view/edit/delete/filter) in the frontend`.

---

## What's explicitly out of scope (call out, don't silently build)

- **Dynamically-loaded / third-party packaged plugins** — deferred deliberately. This plan builds the *internal* registry that a future packaging layer could consume (discovery, loading, isolation, per-plugin frontend loading), but none of that infrastructure is built here.
- **Semantic/embedding topic filtering** — topic filter stays keyword/substring (the `pgvector`-based search is a separate future feature; entities already carry stable ids for it).
- **Learning-log auto-summarization / rollup** — noted in the roadmap as a later option; not built now. Phase 0.3 keeps load bounded via newest-N.
- **Rewriting the capture engine** (`analyze_message_for_capture`) — its naive topic extraction and hardcoded confidence are real limitations, but out of scope here; only its learning_entry *output* benefits from Phase 3's richer CRUD.
- **A real tokenizer** — Phase 0.2 keeps the `chars/4` heuristic but makes it honest about the returned payload; swapping in `tiktoken`/an Anthropic counter is a later nicety.
