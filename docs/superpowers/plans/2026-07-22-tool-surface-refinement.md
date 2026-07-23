# Tool-Surface Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec: `docs/superpowers/specs/2026-07-22-tool-surface-refinement-design.md` — its Items 1-5b, error table, and testing section are binding.

**Goal:** Make the existing MCP tools search-aware: steering copy on `get_context`, advisory dupe warnings on adds, a dedupe-grounded `suggest_persona_update`, batch `get_entity` (cap 25), `get_context detail="titles"`, and `search_context days=`.

**Architecture:** All changes live in `backend/server.py` plus one small addition to `backend/search_index.py` (the days predicate). One new shared helper (`_find_strong_match`) powers both the modify advisory and the suggestion rewrite. Everything is advisory/additive — no write ever blocks, no existing response shape changes except documented additions.

**Tech Stack:** Python 3.11, pytest against the pgvector test-db on :5433 (must be running), venv at `backend/venv`. Suite baseline: 216 passing.

## Global Constraints

- Spec's error-handling table is binding: advisory/dedupe failures are logged and swallowed; writes and suggestions always proceed.
- Strong-match criteria exact: hybrid → top same-section hit `distance <= 0.4`; FTS-only → top same-section hit with case-insensitive equal flattened title. Constant name: `DUPLICATE_DISTANCE_CUTOFF = 0.4` in server.py.
- `get_entity` single-string behavior must remain byte-compatible (existing tests untouched and green prove it).
- Reconciliation discipline (established in this codebase): where the plan's code sketches assume server.py details, verify against the real file and adapt, reporting each adaptation. Real facts known: `import sections`, `import db`, `import search_index`, `import json` exist in server.py; tools are sync `def` with `@mcp.tool()`; dispatch tests use the `asyncio.run` pattern from `tests/test_search_tools_dispatch.py`; `ENTITY_SCHEMA` is `{file: {entity_name: spec}}` with `identifier` keys at server.py:2276.
- Verify per task: `cd backend && ./venv/bin/python -m pytest tests/ -q` green. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
backend/server.py         all tool changes + _find_strong_match + ADVISORY_ENTITIES
backend/search_index.py   search(..., days=None) predicate only
backend/tests/
  test_tool_docstrings.py     NEW (item 1 regression greps)
  test_dupe_advisory.py       NEW (item 2)
  test_suggest_dedupe.py      NEW (item 3)
  test_get_entity_batch.py    NEW (item 4)
  test_context_titles.py      NEW (item 5a)
  test_search_days.py         NEW (item 5b)
README.md                 days caveat + tool doc touches (item 5b)
```

---

### Task 1: `get_context` docstring boundary + regression test

**Files:**
- Modify: `backend/server.py` (get_context docstring only, ~line 2952)
- Test: `backend/tests/test_tool_docstrings.py`

- [ ] **Step 1: Failing test**

```python
import server


def test_get_context_docstring_steers_to_search():
    doc = server.get_context.fn.__doc__
    assert "search_context" in doc and "get_entity" in doc


def test_full_scope_demoted():
    doc = server.get_context.fn.__doc__
    assert "Complex questions" not in doc


def test_get_raw_docstring_steers():  # locks the earlier steer in place
    assert "search_context" in server.get_raw.fn.__doc__
```

(If `.fn` isn't how tool docstrings are reachable, reconcile with how existing tests access tool internals.)

- [ ] **Step 2: RED** — run the new file, expect 2 failures.
- [ ] **Step 3: Edit the docstring**: in WHEN TO USE add `- To FIND specific entries (a project, a note, a person), do NOT pull a large scope — use search_context, then get_entity.` Change the full-scope line to `- full: complete dump — prefer targeted scopes plus search_context`.
- [ ] **Step 4: GREEN + full suite.**
- [ ] **Step 5: Commit** — `docs: get_context steers lookups to search_context`

---

### Task 2: `_find_strong_match` helper + add advisory in modify/batch

**Files:**
- Modify: `backend/server.py`
- Test: `backend/tests/test_dupe_advisory.py`

**Interfaces (later tasks consume):**
- `ADVISORY_ENTITIES: dict[str, tuple[str, str]]` — entity name → `(file_type, list_key)` for the TOP-LEVEL id-list entity types only. Build it by cross-referencing `ENTITY_SCHEMA` entity names with `sections.SECTION_REGISTRY[file].id_lists` list keys, verifying each against its `execute_modify` branch (the names differ: e.g. entity `work_experience` → list `work_experience`; entity `mental_tab` → list `mental_tabs`; entity `learning_entry`-style name → list `entries` — RECONCILE against the real branch names; sub-entities like `email`, `link`, `work_highlight`, `*_reference`, `coursework` are EXCLUDED).
- `_find_strong_match(file_type: str, entity_data: dict) -> dict | None` — flattens `entity_data` via `search_index.flatten_entity`, returns `{"entity_id", "title", "distance"}` for the top same-section hit meeting the spec criteria (hybrid: `distance is not None and distance <= DUPLICATE_DISTANCE_CUTOFF`; FTS-only: `hit["title"].lower() == flattened_title.lower()` and flattened_title non-empty), else None. Empty flattened text → None. ANY exception → log + None.

- [ ] **Step 1: Failing tests** (fixtures follow `tests/test_search_query.py` conventions: `as_user`, fake providers, `embed_sync=True` seeding; import `VocabProvider` where useful)

```python
import json

import db
import embeddings
import persona_store
import search_index
import server
from tests.test_search_query import VocabProvider


def _seed_project(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [{"name": "Ledger", "description": "A JavaScript dashboard"}],
        "current_learning": [], "top_of_mind": [],
    })
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "projects", persona_store.load("projects"),
                            embed_sync=True)


def test_add_near_dupe_gets_advisory_but_still_writes(as_user, monkeypatch):
    _seed_project(monkeypatch, VocabProvider())
    out = server.persona_modify.fn(
        "add", "project",
        {"name": "Ledger 2", "description": "javascript dashboard app"})
    assert "resembles existing" in out and "project_" in out
    assert len(persona_store.load("projects")["projects"]) == 2  # write happened


def test_add_unrelated_no_advisory(as_user, monkeypatch):
    _seed_project(monkeypatch, VocabProvider())
    out = server.persona_modify.fn(
        "add", "project", {"name": "GardenBot", "description": "watering robot"})
    assert "resembles existing" not in out


def test_fts_only_exact_title_advisory(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = server.persona_modify.fn(
        "add", "project", {"name": "Ledger", "description": "different words"})
    assert "resembles existing" in out


def test_fts_only_overlap_but_different_title_no_advisory(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = server.persona_modify.fn(
        "add", "project", {"name": "Dashboard Two", "description": "A JavaScript dashboard"})
    assert "resembles existing" not in out


def test_advisory_failure_never_breaks_write(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    monkeypatch.setattr(search_index, "search",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    out = server.persona_modify.fn("add", "project", {"name": "Solo"})
    assert "resembles existing" not in out
    assert any(p["name"] == "Solo" for p in persona_store.load("projects")["projects"])


def test_update_and_remove_never_checked(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    calls = []
    real = search_index.search
    monkeypatch.setattr(search_index, "search",
                        lambda *a, **k: calls.append(1) or real(*a, **k))
    server.persona_modify.fn("update", "project",
                             {"name": "Ledger", "status": "paused"})
    assert calls == []


def test_batch_per_op_advisories(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = server.persona_batch.fn([
        {"action": "add", "entity": "project", "data": {"name": "Ledger"}},
        {"action": "add", "entity": "project", "data": {"name": "Fresh"}},
    ])
    # advisory attached to op 1's result line only
    assert out.count("resembles existing") == 1
```

(Adapt `.fn` invocation and `persona_modify` arg order to the real signatures; the update-contract for `project` uses identifier `name` — reconcile with ENTITY_SCHEMA.)

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — `DUPLICATE_DISTANCE_CUTOFF = 0.4`, `ADVISORY_ENTITIES`, `_find_strong_match` per the interface block; in `persona_modify`: when `action == "add"` and `entity in ADVISORY_ENTITIES`, compute the match BEFORE `execute_modify`, then append the spec's advisory line to the success message. In `persona_batch`, same per-op (compute before each op executes). The advisory line format is the spec's, verbatim.
- [ ] **Step 4: GREEN + full suite.**
- [ ] **Step 5: Commit** — `feat: advisory duplicate warning on persona adds`

---

### Task 3: `suggest_persona_update` dedupe grounding

**Files:**
- Modify: `backend/server.py` (suggest_persona_update body + docstring, ~line 3209)
- Test: `backend/tests/test_suggest_dedupe.py`

**Consumes:** `_find_strong_match`, `ADVISORY_ENTITIES` (Task 2).

- [ ] **Step 1: Failing tests**

```python
import json

import embeddings
import persona_store
import server
from tests.test_dupe_advisory import _seed_project  # reuse fixture helper


def test_suggestion_for_existing_rewritten_to_update(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = json.loads(server.suggest_persona_update.fn(
        "I finished building Ledger, my JavaScript dashboard"))
    assert out["dedupe_checked"] is True
    rewritten = [s for s in out["suggestions"] if s.get("existing_entity")]
    for s in rewritten:
        assert s["action"] == "update"
        assert s["existing_entity"]["entity_id"].startswith("project_")


def test_novel_suggestion_stays_add(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = json.loads(server.suggest_persona_update.fn(
        "I started a brand new hobby: woodworking"))
    assert out["dedupe_checked"] is True
    assert all(not s.get("existing_entity") for s in out["suggestions"])


def test_dedupe_failure_falls_back_cleanly(as_user, monkeypatch):
    import search_index
    _seed_project(monkeypatch, None)
    monkeypatch.setattr(search_index, "search",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    out = json.loads(server.suggest_persona_update.fn("I built Ledger today"))
    assert "suggestions" in out  # tool still works, suggestions unmodified
```

**Test-fidelity note:** these tests depend on `analyze_message_for_capture` actually producing an add-suggestion for the phrasing used. Before finalizing the test strings, run the CURRENT tool with them and pick phrasings that reliably yield a `project`-entity add suggestion (adjust wording, not the assertions). If the analyzer can't reliably produce one, monkeypatch `analyze_message_for_capture` to return a fixed suggestion set — testing the dedupe rewrite, not the heuristics.

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — after `analysis` is computed: for each suggestion with `action == "add"` and `entity in ADVISORY_ENTITIES`, run `_find_strong_match(file_type, suggestion_data)`; on a hit, set `action = "update"`, merge the existing entity's identifier into `data` per that entity's `ENTITY_SCHEMA` `identifier` (RECONCILE: update ops locate by identifier value — use the matched hit's title as the identifier value where identifier is a name/title field; if the identifier value can't be derived from the hit, keep the suggestion as `add` and only attach `existing_entity` — never emit an un-executable update), and attach `existing_entity = {"entity_id", "title"}`. Add `"dedupe_checked": True` top-level. Rewrite the docstring per the spec (analysis + dedupe framing; keep confidence docs).
- [ ] **Step 4: GREEN + full suite.**
- [ ] **Step 5: Commit** — `feat: suggest_persona_update grounds suggestions in search dedupe`

---

### Task 4: `get_entity` batch (cap 25)

**Files:**
- Modify: `backend/server.py` (get_entity, ~line 3071)
- Test: `backend/tests/test_get_entity_batch.py`

- [ ] **Step 1: Failing tests** — list happy path (2 valid ids → `{"entities": [...]}` with both success shapes); mixed (1 valid + 1 unknown-prefix + 1 not-found → inline `{"entity_id", "error"}` elements, call succeeds); 26 ids → error string containing "25" and "split"; empty list → error string; single-string call still returns the ORIGINAL non-wrapped shape (assert no `"entities"` key); dispatch-path test (asyncio.run pattern from `tests/test_search_tools_dispatch.py`) passing a JSON list through the real tool schema (`entity_id: Union[str, List[str]]`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — signature `entity_id: Union[str, List[str]]`; extract the existing single-id resolution into `_resolve_entity(entity_id) -> str` (returns the current JSON/error string unchanged); string input → return `_resolve_entity(entity_id)` directly; list input → validate (non-empty, `len <= 25` else `"Error: at most 25 ids per call — split into multiple calls"`), build `{"entities": [json.loads-or-error per id]}` where a `_resolve_entity` result that isn't valid JSON success becomes `{"entity_id": eid, "error": <the string>}`. Docstring documents both forms.
- [ ] **Step 4: GREEN + full suite** (existing `test_get_entity.py` untouched and green = byte-compat proof).
- [ ] **Step 5: Commit** — `feat: get_entity accepts up to 25 ids per call`

---

### Task 5: `get_context detail="titles"`

**Files:**
- Modify: `backend/server.py` (`get_context` signature + `get_scoped_context`)
- Test: `backend/tests/test_context_titles.py`

- [ ] **Step 1: Failing tests** — seed projects + a profile with non-entity scalars; `get_scoped_context("professional", detail="titles")` (reconcile call convention with `tests/test_topic_rewire.py`): every id-list entity reduced to exactly `{"id", "title"}`; profile scalars (name/bio) untouched; `token_estimate` strictly smaller than the same call with `detail="full"`; `detail="bogus"` → error string listing `full`, `titles`; titles compose with `topic=` (filter first, then stub). Dispatch-path test passing `detail` through the real schema.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — thread `detail: str = "full"` through `get_context` → `get_scoped_context`; validate early; in `"titles"` mode, after all existing filters and before `token_estimate`, walk `sections.SECTION_REGISTRY[ft].id_lists` for each section in the result and map each entity dict to `{"id": e.get("id"), "title": search_index.flatten_entity(e)[0]}`. Docstring: the spec's titles-mode line.
- [ ] **Step 4: GREEN + full suite.**
- [ ] **Step 5: Commit** — `feat: get_context detail=titles returns id+title stubs`

---

### Task 6: `search_context days=` + README + verification gate

**Files:**
- Modify: `backend/search_index.py` (`search` signature), `backend/server.py` (`search_context` signature + docstring), `README.md`
- Test: `backend/tests/test_search_days.py`

- [ ] **Step 1: Failing tests** — seed 2 entities, backdate one via SQL (`update persona_search set updated_at = now() - interval '3 days' where entity_id = %s`); `search(uid, q, None, 10, days=1)` excludes the backdated one, `days=7` includes both; works in FTS-only AND hybrid (VocabProvider) modes; `server.search_context.fn(query=..., days=0)` and `days=-2` → error string; dispatch-path test with `days` through the real schema; docstring test asserting "per-entity" appears in `search_context`'s docstring.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — `search(..., days: int | None = None)`: both CTE WHERE clauses gain `and (%(days)s::int is null or updated_at >= now() - make_interval(days => %(days)s))` (single named param; verify the FTS-only branch too). `search_context` gains `days: Optional[int] = None`, validates positive int, passes through. Docstring: the spec's per-entity semantics paragraph + the reindex caveat, condensed. README: one sentence in the search section documenting `days` and the `--recreate`-resets-updated_at caveat.
- [ ] **Step 4: GREEN + full suite (expect ~250).**
- [ ] **Step 5: Verification gate** — full suite twice; then a live-style dispatch sweep in one script: search→get_entity(list)→modify-with-advisory→suggest→titles-mode, all through the asyncio.run dispatch path against the test-db.
- [ ] **Step 6: Commit** — `feat: search_context recency filter (days)`
