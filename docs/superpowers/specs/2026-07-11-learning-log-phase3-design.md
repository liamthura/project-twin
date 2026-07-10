# Learning Log Phase 3: Full CRUD + Frontend Panel — Design

**Date:** 2026-07-11
**Status:** Approved by user (pre-implementation)
**Roadmap:** Phase 3 of `docs/plans/2026-07-07-mcp-registry-efficiency-learning-log.md`

## Problem

The learning log is the only section without full write access or a frontend
view:

1. The MCP `update` action for `learning_entry` can only set `followup_items`,
   and only when given an internal `id` — conflicting with the schema-wide
   "identify by natural field, never by id" guidance. Because of that conflict,
   `update` is deliberately hidden from `get_schema`.
2. `related_entries` links (entry → domain/project/hobby) are stored if passed
   but never validated.
3. The frontend never loads `learning_log` (`loadAllData` drops it) and has no
   editor panel for it.

Efficient load (days/limit windowing via `_filter_learning_log_by_time`) was
already delivered in an earlier phase and is out of scope here.

## Decisions

- `update` locates the entry by `id` when provided, otherwise by `topic` —
  case-insensitive, **most-recent match wins** (reverse scan). (User-confirmed.)
- Task 3.2 (`related_entries` id-links) is **in scope**. (User-confirmed.)
- `learning_log` stays in `ALWAYS_ON_SECTIONS` — it is NOT made toggleable.
  This supersedes the Phase 2 design note that deferred "learning_log toggling"
  to Phase 3. (User-confirmed 2026-07-11.) The frontend tab is therefore
  unconditional, like Profile and Preferences.
- Falsy values are ignored on update (no empty-string clearing) — house
  convention (`communication_default`, `basic_info`).
- Topic rename is supported via `new_topic`, mirroring the `email` entity's
  `new_address` precedent. `id` and `timestamp` are immutable.

## Part 1 — Full CRUD via MCP (`backend/server.py`)

### Handler: `learning_entry` `update` (rewrite of server.py:~1760)

- Locate: if `data["id"]` given, match on `entry["id"]`; else match
  `entry["topic"]` case-insensitively, scanning from the end of the list
  (most recent first). Not found → `❌ Learning entry not found: <id or topic>`.
- Apply partial update for any provided field among: `details`, `source`,
  `tags`, `key_decisions`, `followup_items`, `conversation_metadata`,
  `related_entries` (validated per Part 2), plus `new_topic` → replaces
  `topic`. Falsy values ignored.
- Nothing provided beyond the identifier → ❌ error listing the editable
  fields.
- Success: `✅ Updated learning entry: <topic> (field, field, ...)`.

`remove` already accepts `id` or `topic` and scans newest-first — unchanged.
`add` gains `related_entries` validation (Part 2); otherwise unchanged.

### Schema

`ENTITY_SCHEMA["learning_log"]["learning_entry"]`:

- `actions: ["add", "update", "remove"]` (update now advertised; delete the
  explanatory comment block above the entry).
- `optional` gains `new_topic` and `related_entries` (full list: `source`,
  `tags`, `conversation_metadata`, `key_decisions`, `followup_items`,
  `new_topic`, `related_entries`).
- `identifier` stays `"topic"`. The example generator then emits a correct
  topic-based `update` example with no special-casing.

### Tests

- Replace `test_learning_entry_does_not_advertise_update`
  (test_get_schema.py:82) with an assertion that all three actions and an
  `update` example are present.
- New handler tests: update-by-topic picks the most recent of duplicate
  topics; update-by-id; rename via `new_topic`; multi-field partial update
  leaves unnamed fields untouched; identifier-only update → ❌; not-found → ❌.

## Part 2 — `related_entries` id-links

Shape: `related_entries: [{"type": "domain"|"project"|"hobby", "id": "..."}]`,
accepted on `add` and `update`.

Write-time validation (shared helper used by both actions):

- Type map: `domain → knowledge.domains`, `project → projects.projects`,
  `hobby → lifestyle.hobbies`.
- Unknown `type`, malformed link (not a dict with `type` + `id`), or an `id`
  not present in the mapped list → `❌` naming the offending link; nothing is
  written.
- Validation reads the target file's data directly (a link may target an
  entity in a currently disabled section — data still exists and the link is
  still meaningful).

No surfacing work: the learning scope emits whole entries, so links ride
along. No reverse index and no cascade/cleanup when a linked entity is later
deleted — a dangling link is tolerable and detectable (YAGNI).

Tests: valid links accepted on add and update; unknown type rejected;
nonexistent id rejected; malformed entry rejected; rejection writes nothing.

## Part 3 — Frontend `LearningLogEditor` (`frontend/src/App.jsx`)

### Data plumbing

- `loadAllData` loads `learning_log` alongside the other files; new state +
  `handleLearningLogChange` + `debouncedSave("learning_log", data)` autosave,
  identical in shape to the other sections.
- **IDs for UI-created entries:** add `("entries", "learn")` to the
  `learning_log` `SectionSpec.id_lists` (`backend/sections.py`).
  `persona_store._assign_ids` uses `setdefault`, so existing MCP-generated
  ids (`learn_YYYYMMDD_xxxxxx`) are untouched and frontend-added entries get
  a stable server-assigned id (`learn_<hex8>`) on save. Add a registry test.
- `timestamp` is set client-side on add (`new Date().toISOString()`) and not
  editable afterwards.

### Editor panel

New `LearningLogEditor` component modeled on `CircleEditor`, item rendering
using the per-item collapse pattern shipped for work experience/education:

- Entries listed newest-first (by `timestamp`).
- Search box filtering on topic, details, and tags (client-side).
- Collapsed header: chevron, topic (fallback "Untitled entry"), date badge
  (YYYY-MM-DD from timestamp), source badge, `N tags` / `N follow-ups` count
  badges, delete icon (confirmation dialog, `stopPropagation`).
- Expanded form: topic (Input), details (Textarea), source (Input), tags
  (ArrayInput), key_decisions (ArrayInput), followup_items (ArrayInput).
  `id`/`timestamp` displayed read-only, not editable.
- `related_entries` render as read-only chips when present; no link-editing
  UI this phase.
- Add button appends a new entry (topic empty, timestamp stamped, arrays
  empty) and auto-expands it.

### Tab registration

- New "Learning Log" tab added unconditionally (like Profile/Preferences —
  NOT gated by enabled-sections, since the section is always-on).
- No `SECTION_LABELS` / Manage Sections changes (those cover toggleable
  sections only).

### Verification

Playwright against the docker test-db backend: seed entries via
`persona_modify`, confirm list renders newest-first, search filters,
expand/edit/delete work, added entry persists with a server-assigned id
after autosave (round-trip through GET /api/files/learning_log).

## Out of scope

- Making learning_log toggleable (explicitly rejected — stays always-on).
- Learning-log auto-summarization/rollup, semantic topic filtering,
  capture-engine changes (roadmap-listed exclusions).
- Editing `related_entries` in the UI; cascade/cleanup of dangling links.
- Backfilling fields on existing entries.
