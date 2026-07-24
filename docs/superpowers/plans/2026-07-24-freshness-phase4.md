# Freshness (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each entity's last-change time where it's cheap and useful (`get_entity`, `detail="titles"` stubs) and add the one-line top-of-mind staleness advisory to context reads.

**Architecture:** `persona_search.updated_at` (already maintained on every write for the `days` filter) becomes the single freshness source. A new `search_index.entity_update_times()` batch helper feeds three consumers in server.py: `_resolve_entity` (adds `updated_at` to get_entity payloads), `_stub_titles` (adds `updated_at` to `{id,title}` stubs), and a top-of-mind check in `get_scoped_context` that appends an `advisories` line when entries have sat unchanged >30 days. No schema changes, no new tools.

**Tech Stack:** Python 3.11+, existing psycopg pool, pytest + docker test Postgres.

## Global Constraints

- Spec Part 3 (lean v2): `docs/superpowers/specs/2026-07-23-modular-section-packs-design.md` — `updated_at` in `get_entity` results and titles stubs, NOT in full scope payloads (token cost). Advisory: one line, only when triggered, no new tools, no auto-delete.
- Dates day-precision ISO (`"2026-07-24"`) — freshness signal, not a timestamp; saves tokens.
- Entities missing from the search index (edge: pre-backfill rows) simply omit `updated_at` — never null, never an error.
- The `advisories` key appears on the get_context payload ONLY when at least one stale top-of-mind item exists; the token_estimate must include it when present.
- Full suite green per task (317 expected baseline is 316 + new tests; run to confirm). Golden fixture untouched (no registry/schema changes this phase).
- Branch `feature/section-packs`; exact commit messages; no Co-Authored-By; backend commands from `backend/` via `./venv/bin/python`; test DB on localhost:5433.

## File Structure

```
backend/
  search_index.py     # MODIFIED (Task 1) — entity_update_times() helper
  server.py           # MODIFIED (Task 1) — _resolve_entity, _stub_titles, get_scoped_context advisory
  tests/test_freshness.py  # NEW (Task 1)
README.md             # MODIFIED (Task 2)
```

---

### Task 1: Freshness plumbing — helper, get_entity, titles stubs, top-of-mind advisory

**Files:**
- Modify: `backend/search_index.py` (append helper)
- Modify: `backend/server.py` — `_resolve_entity` (~line 3199), `_stub_titles` (~line 954), `get_scoped_context` payload assembly (~line 823-840)
- Test: `backend/tests/test_freshness.py`

**Interfaces:**
- Produces: `search_index.entity_update_times(user_id, entity_ids: list) -> dict[str, str]` (id → "YYYY-MM-DD", missing ids absent); `get_entity` payloads gain optional top-level `"updated_at"`; titles stubs become `{id, title, updated_at?}`; get_context payload gains optional `"advisories": [str]`.

- [ ] **Step 1: Write failing tests**

`backend/tests/test_freshness.py`:

```python
"""Phase 4 freshness: updated_at surfacing + top-of-mind staleness advisory."""
import json

import psycopg

import db
import server
from tests.conftest import TEST_DATABASE_URL


def _backdate(entity_id, days):
    """Age an entity's search-index row by `days` days."""
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        conn.execute(
            "update persona_search set updated_at = now() - make_interval(days => %s)"
            " where entity_id = %s",
            (days, entity_id),
        )


def _first_id(file_type, list_key):
    return server.load_json(f"{file_type}.json")[list_key][0]["id"]


def test_get_entity_includes_updated_at(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Bouldering", "skill_level": "beginner"})
    hid = _first_id("lifestyle", "hobbies")
    payload = json.loads(server.get_entity.fn(hid))
    assert payload["entity_id"] == hid
    assert "updated_at" in payload
    assert len(payload["updated_at"]) == 10  # YYYY-MM-DD


def test_get_entity_batch_includes_updated_at(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Bouldering"})
    server.execute_modify("add", "domain", {"name": "Rust", "level": "learning"})
    ids = [_first_id("lifestyle", "hobbies"), _first_id("knowledge", "domains")]
    payload = json.loads(server.get_entity.fn(ids))
    assert all("updated_at" in e for e in payload["entities"])


def test_titles_stubs_carry_updated_at(clean_database, as_user):
    server.execute_modify("add", "goal", {"title": "Ship phase 4"})
    ctx = server.get_scoped_context("goals", detail="titles")["context"]
    [stub] = ctx["goals"]["goals"]
    assert set(stub) == {"id", "title", "updated_at"}


def test_stale_top_of_mind_triggers_advisory(clean_database, as_user):
    server.execute_modify("add", "top_of_mind", {"item": "Old thought"})
    server.execute_modify("add", "top_of_mind", {"item": "Fresh thought"})
    old_id = next(t["id"] for t in server.load_json("projects.json")["top_of_mind"]
                  if t["item"] == "Old thought")
    _backdate(old_id, 40)
    payload = server.get_scoped_context("minimal")
    assert payload["advisories"] == [
        "1 top-of-mind item(s) unchanged for over 30 days — consider reviewing or removing them"
    ]


def test_fresh_top_of_mind_no_advisory(clean_database, as_user):
    server.execute_modify("add", "top_of_mind", {"item": "Fresh thought"})
    payload = server.get_scoped_context("minimal")
    assert "advisories" not in payload
```

NOTE: `server.get_entity` is an `@mcp.tool()` — check how existing tests call it (some call `.fn`, some the underlying function; mirror `tests/test_get_entity.py`'s convention exactly and adjust the two `.fn` usages above to match).

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_freshness.py -v`
Expected: FAIL — `AttributeError: ... 'entity_update_times'` is NOT the failure (nothing imports it yet); the actual failures are missing `updated_at` keys / missing `advisories`. Confirm all 5 fail for the right reason.

- [ ] **Step 3: Implement**

(a) Append to `backend/search_index.py`:

```python
def entity_update_times(user_id, entity_ids) -> dict:
    """{entity_id: 'YYYY-MM-DD'} for the given ids, from the same
    persona_search.updated_at the `days` recency filter uses. Ids missing
    from the index (e.g. rows predating a backfill) are simply absent."""
    ids = [i for i in entity_ids if i]
    if not ids:
        return {}
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select entity_id, updated_at from persona_search"
            " where user_id = %s and entity_id = any(%s)",
            (user_id, ids),
        ).fetchall()
    return {r["entity_id"]: r["updated_at"].date().isoformat() for r in rows}
```

(b) `_resolve_entity` in server.py — replace the success return:

```python
    for entity in data.get(list_key) or []:
        if isinstance(entity, dict) and entity.get("id") == entity_id:
            payload = {"section": file_type, "entity_id": entity_id, "entity": entity}
            times = search_index.entity_update_times(db.current_user_id.get(), [entity_id])
            if entity_id in times:
                payload["updated_at"] = times[entity_id]
            return json.dumps(payload, indent=2)
```

(server.py imports `search_index` and `db` at module scope already — verify, don't re-import.)

(c) `_stub_titles` — annotate stubs with a single batch query. Restructure the function: first pass builds stubs exactly as today AND collects every stub id; then one `entity_update_times` call; second pass adds `updated_at` where known:

```python
def _stub_titles(data: dict) -> dict:
    """Reduce every id-list entity in `data` to a `{"id", "title",
    "updated_at"}` stub (updated_at day-precision, omitted for entries the
    search index doesn't know). Applied after all other filters so stubbing
    operates on the already-filtered result."""
    stub_lists = []  # (section_data, list_key)
    for ft in [k for k in data if k in sections.SECTION_REGISTRY]:
        spec = sections.SECTION_REGISTRY[ft]
        section_data = data.get(ft)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            if list_key in section_data and isinstance(section_data[list_key], list):
                section_data[list_key] = [
                    {"id": e.get("id"), "title": search_index.flatten_entity(e)[0]}
                    if isinstance(e, dict) else e
                    for e in section_data[list_key]
                ]
                stub_lists.append((section_data, list_key))
    all_ids = [s["id"] for sd, lk in stub_lists for s in sd[lk]
               if isinstance(s, dict) and s.get("id")]
    times = search_index.entity_update_times(db.current_user_id.get(), all_ids)
    for sd, lk in stub_lists:
        for s in sd[lk]:
            if isinstance(s, dict) and s.get("id") in times:
                s["updated_at"] = times[s["id"]]
    return data
```

(Preserve whatever import style the current function body uses for search_index.)

(d) `get_scoped_context` — after the payload dict is built but BEFORE the token_estimate line, add:

```python
    # Freshness advisory: top-of-mind is the one list that silently rots.
    tom = result.get("projects", {}).get("top_of_mind") if isinstance(result.get("projects"), dict) else None
    if isinstance(tom, list) and tom:
        ids = [t.get("id") for t in tom if isinstance(t, dict)]
        times = search_index.entity_update_times(db.current_user_id.get(), ids)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
        stale = sum(1 for i in ids if i in times and times[i] <= cutoff)
        if stale:
            payload["advisories"] = [
                f"{stale} top-of-mind item(s) unchanged for over 30 days — "
                "consider reviewing or removing them"
            ]
```

Check server.py's datetime imports: `timedelta` must be imported (`from datetime import ...` line near the top) — add it there if missing, do not import inline.

- [ ] **Step 4: Run new tests, then full suite**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_freshness.py -v` → 5 passed.
Run: `./venv/bin/python -m pytest tests/ -q` → all green. Titles-mode tests (`test_context_titles.py`) pin the `{id, title}` stub shape — update them for the new `updated_at` key IN THIS TASK and list the changes in your report.

- [ ] **Step 5: Commit**

```bash
git add backend/search_index.py backend/server.py backend/tests/
git commit -m "feat: freshness — updated_at on get_entity and titles stubs, top-of-mind staleness advisory"
```

---

### Task 2: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Three edits**

1. MCP tools table: `get_entity` row mentions each result carries `updated_at` (last change, day precision); `get_context` row mentions `detail="titles"` stubs are `{id, title, updated_at}`.
2. Under the titles-mode paragraph (search for `detail="titles"`), note stubs now include `updated_at` so clients can weight stale context, and that top-of-mind entries unchanged >30 days append a one-line advisory to `get_context` output.
3. Roadmap: add `- [x] Freshness surfacing — updated_at on lean reads + top-of-mind staleness advisory` above the unchecked items.

- [ ] **Step 2: Verify + commit**

Run: `cd backend && ./venv/bin/python -m pytest tests/ -q` → green.

```bash
git add README.md
git commit -m "docs: freshness surfacing in README"
```

## Completion Criteria

Full suite green; `get_entity` on a live entity shows `updated_at`; a backdated top-of-mind row triggers exactly one advisory line; full scope payloads unchanged except the conditional `advisories` key.
