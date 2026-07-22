# MCP Tool-Surface Refinement: Search-Aware Tools

**Date:** 2026-07-22
**Status:** Approved (follows the tool-surface analysis; user approved all 5 items)
**Scope:** Backend only (`backend/server.py`, `backend/search_index.py`, tests).
Builds on the hybrid-search feature (spec 2026-07-21-search-retrieval-design.md).

## Items

### 1. `get_context` docstring boundary (copy only)

Add a steering block: for finding specific entries, use `search_context` +
`get_entity` instead of pulling large scopes. Demote the `full` scope's
billing from "Complex questions" to "complete dump — prefer targeted scopes
plus search". No behavior change; no parameter changes.

### 2. `persona_modify` / `persona_batch` advisory duplicate warning on add

Before executing an `add` operation, flatten the incoming entity data
(`search_index.flatten_entity`) and search the TARGET section for
near-matches. The check runs BEFORE `execute_modify` (after the add, the
save hook indexes the new entity and it would match itself). If a strong
match exists, the operation still executes normally, and the returned
message gains one advisory line:

```
Note: resembles existing <entity_id> "<title>" — if this is the same item, use action="update" instead.
```

**Strong-match criteria (deliberately conservative — advisory must be
near-zero false-positive):**
- Hybrid mode: top same-section hit with `distance <= 0.4` (tighter than the
  topic filter's 0.5).
- FTS-only mode: top same-section hit whose `title` equals the new entity's
  flattened title case-insensitively (exact-title dupes only).

Implementation point: a helper in `server.py` called from `persona_modify`
and from `persona_batch`'s per-op loop (NOT inside `execute_modify`'s 40
branches). Entity → section resolution reuses the existing entity schema
mapping. Failures in the advisory path are swallowed (log only) — a broken
advisory must never break a write. No advisory for `update`/`remove`, nor
for entities whose section has no `id_lists`.

### 3. `suggest_persona_update` repurposed: search-grounded dedupe advisor

Keep the tool name and signature `(message, context)`. Keep the existing
signal analysis. Change what the suggestions contain:

- For each suggestion with `action: "add"`, run the same strong-match check
  as item 2 against the suggestion's target section.
- On a strong match, rewrite that suggestion to `action: "update"` targeting
  the existing entity (include its `entity_id` and `title` in the
  suggestion's `data`/identifier per the entity's update contract), and add
  `"existing_entity": {"entity_id": ..., "title": ...}` to the suggestion.
- On a weak/no match, leave the suggestion as-is.
- Response gains a top-level `"dedupe_checked": true` marker.

Docstring rewritten to present the tool as: "analyze a message for capture
AND check captures against existing persona entries (dedupe) — trust your
own judgment over the confidence score for capture-worthiness; trust the
dedupe hits for add-vs-update." The confidence machinery stays (harmless,
some callers rely on it).

### 4. `get_entity` accepts a list

`entity_id: Union[str, List[str]]`. String input: exactly today's behavior
and response shape (backward compatible). List input: up to 25 ids (aligned
with `search_context`'s max limit, so one search's hits always fit one
call), response `{"entities": [<per-id result>, ...]}` where each element is
either the current single-entity success shape or
`{"entity_id": ..., "error": "..."}` — per-id errors never fail the whole
call. >25 ids → error string naming the cap and advising to split into
multiple calls (no cursor pagination — the caller holds the id list, so
splitting IS pagination). Empty list → error string.

### 5a. `get_context` titles-only detail mode

New parameter `detail: str = "full"`; accepted values `"full" | "titles"`
(anything else → error string listing valid values). In `"titles"` mode,
applied AFTER topic/inactive/days filtering: every entity in an id-list
field is replaced by `{"id": ..., "title": ...}` where title comes from
`search_index.flatten_entity(entity)[0]` (fallback `""`). Non-id-list fields
are untouched; `token_estimate` reflects the reduced payload (it already
recomputes from the final dict). Docstring: "titles mode returns id+title
stubs for list entries — follow up with get_entity for detail."

### 5b. `search_context` recency filter

New parameter `days: Optional[int] = None`. When set, the search restricts
to rows with `updated_at >= now() - days` (both CTEs get the predicate; the
lazy-heal and mode logic are unchanged). Validation: `days` must be a
positive int (else error string).

**Semantics (docstring must state this):** the filter is strictly
PER-ENTITY — each indexed entry (a learning entry, a project, a tab…) is
included or excluded by its own last-change time. It never excludes a whole
section, and non-entity data (profile scalars, preferences, wellness) is
not in the search index at all, so `days` cannot hide it. This differs from
`get_context(days=…)`, which windows learning_log entries by their content
timestamps.

**Documented limitation (docstring + README):** `updated_at` is the
last-content-change time of the indexed entry — a full reindex
(`backfill --recreate`) resets it for every row, so "recent" means "recently
changed or recently reindexed". Good enough for "what did I add lately";
not a substitute for entry-content timestamps.

## Non-goals

- No dropping of any tool; `suggest_persona_update` keeps name + signature.
- No blocking dedupe — advisories and rewritten suggestions only; writes
  always proceed as requested.
- No changes to `get_raw`, `get_schema`, REST routes, or the frontend.
- No new dependencies, no schema changes (uses existing `updated_at`).

## Error handling summary

| Failure | Behavior |
|---|---|
| Advisory/dedupe search fails (any exception) | Log, skip advisory; write/suggestion proceeds unmodified |
| `get_entity` list: one id bad | Inline `{"entity_id", "error"}` element; others succeed |
| `detail` invalid | Error string listing `full`, `titles` |
| `days` invalid | Error string |

## Testing (extends the 216-test suite; fake embedders as established)

- Item 2: add with a hybrid near-dupe → advisory line present, write still
  applied; distance just above 0.4 → no advisory; FTS-only exact-title dupe
  → advisory; FTS-only word-overlap-but-different-title → no advisory;
  advisory-path exception (monkeypatched search raising) → write succeeds,
  no advisory; update/remove → never checked. Batch: per-op advisories.
- Item 3: suggestion for existing content → rewritten to update with
  existing_entity attached; novel content → unchanged add; dispatch-path
  test for the response shape (`dedupe_checked`).
- Item 4: single-string behavior byte-compatible (existing tests untouched
  and passing); list happy path; mixed good/bad ids; 26 ids → cap error advising split;
  dispatch-path test for the union signature.
- Item 5a: titles mode strips entities to id+title, non-id-list fields
  intact, token_estimate smaller than full mode for same data; invalid
  detail → error.
- Item 5b: days=1 excludes an entity whose row was backdated via SQL
  (`update persona_search set updated_at = now() - interval '3 days'`);
  days present in both FTS-only and hybrid modes; invalid days → error.
- Item 1: docstring assertions (steering text present) — cheap greps in a
  test to prevent regression.
