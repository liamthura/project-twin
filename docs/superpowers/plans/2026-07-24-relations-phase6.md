# Relations (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make entries traversable: (1) derived semantic neighbors on `get_entity` (zero-maintenance, works on all existing data), (2) explicit `related` id links via a new entity-agnostic `link`/`unlink` action, AI-authored and nudged by a cross-section advisory on adds.

**Architecture:** `search_index.semantic_neighbors()` queries pgvector for nearest cross-section entries (FTS fallback in keyword mode). `get_entity` gains `include_related`; responses distinguish `related` (stored links, always resolved to `{id, title, section}` stubs when present) from `similar` (derived neighbors, only when requested). Links live as a universal optional `related: [entity_ids]` array on any id-carrying entry, written ONLY through `persona_modify(action="link"|"unlink")` — entity-agnostic via `entity_location`, so zero per-entity code. Scope payloads strip `related` (token discipline, like `_meta`); `get_raw` keeps it. The existing add-advisory pipeline gains a cross-section nudge suggesting links.

**Tech Stack:** existing; no new deps; no schema/manifest changes (`related` is a core field like `id` — golden fixture UNCHANGED).

## Global Constraints

- No manifest changes, no golden regen, no migration (links start empty). `test_registry_golden.py` must pass untouched.
- Naming contract (LLM-facing): `related` = stored explicit links; `similar` = derived neighbors. Never mix.
- `link`/`unlink`: `persona_modify(action="link", entity="link", data={"entity_id": ..., "related": [ids]})` — the `entity` arg is ignored for these actions (accept anything; document `entity="link"` as convention). Validation is STRICT both ends: source id must resolve to an existing entry; every target id must resolve to an existing entry in an ENABLED section; self-links rejected; dedupe; cap `related` at 10 per entry (❌ beyond). Unlink removes ids; unlink of a non-linked id → ℹ️. Links are one-directional (stored on the source entry only); `similar` covers the reverse direction — do NOT build bidirectional bookkeeping.
- Neighbors: cross-section only by default, limit 5, hybrid mode uses vector distance ≤ 0.5 (`TOPIC_VECTOR_DISTANCE_CUTOFF`); FTS-only mode falls back to `search_index.search()` seeded with the entity's flattened title, self and same-section filtered. Disabled sections excluded from both neighbors and link targets (respect `enabled_sections()`).
- Scope reads: `related` stripped from every entry in `get_scoped_context` output (all detail modes); present in `get_entity` and `get_raw`. Titles stubs do NOT carry related (polarity fields only).
- Cross-section nudge: after a successful generic-or-advisory-eligible add, if a strong cross-section match exists (reuse `DUPLICATE_DISTANCE_CUTOFF` tightness), append one line: `Possibly related to <id> "<title>" (<section>) — link them with action="link"`. At most ONE nudge per add; never on updates/links; never when a same-section duplicate advisory already fired (one advisory per response, duplicate wins).
- Suite green per task (339 baseline); tests use `as_user`; embedding-dependent tests mirror the existing fake-embedding patterns in tests (read `test_search_query.py`/conftest first).
- Branch `feature/section-packs`; exact commit messages; no Co-Authored-By; backend from `backend/` via `./venv/bin/python`; never reset/rebase/checkout; never add .agents/, .claude/, skills-lock.json.

## File Structure

```
backend/
  search_index.py        # T1: semantic_neighbors(); resolve_titles() helper
  server.py              # T1: get_entity include_related + related resolution + scope strip
                         # T2: link/unlink executor + cross-section nudge
  tests/test_relations.py  # T1 + T2
README.md                # T3
```

---

### Task 1: Semantic neighbors + get_entity surfaces

**Files:** `backend/search_index.py`, `backend/server.py`, `backend/tests/test_relations.py` (new).

**Interfaces produced:**
- `search_index.semantic_neighbors(user_id, entity_id, limit=5, exclude_sections=None) -> list[{"entity_id","file_type","title","distance"|None}]` — cross-section by default (excludes the source entity's own file_type plus `exclude_sections`); vector path when embeddings available AND the source row has one, else FTS fallback via `search()` with the source row's title; always excludes the source id; ordered best-first.
- `search_index.resolve_titles(user_id, entity_ids) -> {entity_id: {"title", "file_type"}}` — one query over persona_search (for resolving stored `related` ids).
- `server.get_entity(entity_id, include_related: bool = False)` — single AND batch paths. Response additions: when the stored entry has `related`, add resolved `"related": [{"id","title","section"}]` (unresolvable ids appear as `{"id", "title": None, "section": None}` — links to since-deleted entries must be visible, not hidden). When `include_related=True`, also add `"similar": [{"id","title","section"}]` from neighbors (empty list if none / no index row). Batch: one `resolve_titles` call for all related ids (no N+1); neighbors per-entity (bounded by the 25 cap).
- `get_scoped_context`: every id-list entry's `related` key stripped from output (implement inside the existing result-assembly path or `_filter_inactive`-adjacent post-pass — NOT by mutating the loaded blob in place if `load_json` shares references; check and deepcopy-guard like existing code does).

TDD sketch (write first; adapt tool-invocation convention from test_get_entity.py):

```python
def test_neighbors_cross_section(clean_database, as_user):  # FTS-only mode
    server.execute_modify("add", "project", {"name": "MyGist MCP server", "description": "persona context server"})
    server.execute_modify("add", "goal", {"title": "Ship MyGist relations", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]
    result = json.loads(server.get_entity.fn(gid, include_related=True))
    assert any(s["section"] == "projects" for s in result["similar"])
    assert all(s["id"] != gid for s in result["similar"])

def test_related_resolution_and_dangling(clean_database, as_user): ...
def test_scope_reads_strip_related(clean_database, as_user): ...
def test_batch_get_entity_resolves_related_once(...): ...  # shape only; N+1 not asserted
```

(Full assertions per the interfaces above; seed `related` directly via a `link` no… Task 1 precedes link — seed `related` by writing the blob through persona_store.save in the test.)

Verify existing `test_get_entity.py`/`test_freshness.py` unaffected (signature gains a defaulted kwarg — MCP tool schema changes; check `test_tool_docstrings.py` expectations and update honestly). Full suite green.

Commit: `feat: semantic neighbors and related-link surfaces on get_entity`

---

### Task 2: link/unlink action + cross-section nudge

**Files:** `backend/server.py`, `backend/tests/test_relations.py` (append).

**Implementation:**
- Top of `execute_modify` (before the entity chain): `if action in ("link", "unlink"): return _execute_link(action, data)`.
- `_execute_link(action, data)`:
  - `entity_id = get_field(data, "entity_id", "id", "source")`; `targets = data.get("related") or data.get("targets") or []` (single string accepted → wrap).
  - Resolve source via `search_index.entity_location` + blob scan (mirror `_resolve_entity`'s loop); ❌ unknown prefix / not found / section disabled.
  - link: validate EVERY target — resolvable prefix, exists, enabled section, not the source itself (❌ naming the first offender). Merge into `entry.setdefault("related", [])` deduped, preserve order, cap 10 (❌ if the merge would exceed: "❌ related is capped at 10 links per entry"). Save via `save_json`. ✅ message lists linked ids with titles.
  - unlink: remove listed ids; ℹ️ for ids that weren't linked; save only if changed.
- `persona_batch` must accept link/unlink ops too (it dispatches through execute_modify — verify, don't duplicate).
- Cross-section nudge: in the `persona_modify` advisory call site (where `_find_strong_match` runs for `ADVISORY_ENTITIES` adds): when the add succeeded AND no same-section duplicate advisory fired, run ONE cross-section probe — a `_find_strong_match` variant (or param `same_section=False`) searching other enabled sections with the same tight cutoff; on hit append the nudge line from Global Constraints. Respect the existing "advisory never blocks/raises" discipline (try/except log).
- get_schema `_SCHEMA_USAGE` gains a `linking` line documenting action="link"/"unlink", the data shape, one-directional semantics, and that `similar` in get_entity suggests candidates.

TDD: link happy path (+response names titles), strict target validation (unknown id ❌, disabled section ❌, self ❌), dedupe + cap, unlink + ℹ️, batch op passthrough, nudge fires on cross-section near-match add (fake embeddings, mirror dupe-advisory test setup) and does NOT fire when the same-section duplicate advisory already fired, get_entity round-trip shows the stored link resolved.

Full suite green. Commit: `feat: entity-agnostic link/unlink action with cross-section relation nudges`

---

### Task 3: Documentation

**Files:** `README.md`.
1. MCP tools table: `get_entity` row gains `include_related` (returns stored `related` links + derived `similar` neighbors); `persona_modify` row mentions `action="link"/"unlink"` for connecting any two entries.
2. New short subsection under the lean-retrieval paragraph: "Relations" — explicit links vs derived similarity, one-directional, AI-authored (the add-response nudge), capped at 10, stripped from scope payloads.
3. Roadmap: `- [x] Relations — semantic neighbors + explicit entry links (link/unlink), AI-authored`.
Verify suite; commit `docs: relations README`.

---

## Post-execution (controller)
Final whole-phase review (most capable model) — hunt: scope-strip vs shared-reference mutation, neighbors under FTS-only prod fallback, nudge cost per add, tool-schema regressions in MCP clients. Fixes → merge → deploy → live verify (link two real entries, read back with include_related, unlink).

## Completion Criteria
Suite green; on production: `get_entity(id, include_related=true)` returns sensible `similar` for a real goal; linking goal↔project round-trips; scope payloads show no `related` keys; add-nudge appears when adding an obviously-related entry.
