# Smarter MCP Retrieval: Hybrid Search (FTS + pgvector) and Lean Retrieval Tools

**Date:** 2026-07-21
**Status:** Approved
**Scope:** Backend only (`backend/`). No frontend changes. Fully additive to the
existing schema — `persona_data` rows are never modified.

## Goal

Today every MCP read returns whole JSONB blobs; the only "search" is
`get_context`'s topic filter — case-insensitive substring matching over a
hardcoded ~22-entry alias dict (`server.py:901` TODO). As the unbounded list
sections grow (learning_log entries, projects, knowledge domains/tabs,
connections, work experience, hobbies), return-everything retrieval wastes
tokens and the keyword filter misses semantically related entries.

This work adds a per-entity search index with hybrid ranking (Postgres
full-text search + pgvector embeddings via Voyage AI, merged with Reciprocal
Rank Fusion), two new MCP tools (`search_context`, `get_entity`), and rewires
the existing topic filter through it.

## Decisions made with the user

- **Embedding provider:** Voyage AI (`voyage-4-lite`, 1024 dims — 200M free tokens/month; voyage-3.5-lite was the original choice but is now legacy with no free tier), key via
  `VOYAGE_API_KEY` env var. No key → FTS-only mode; everything still works.
- **Tool scope:** `search_context` + `get_entity` + rewired `topic` filter.
  `get_raw` keeps its behavior (docstring updated to steer AI callers toward
  `search_context`). `days`/`limit` stay learning_log-only (out of scope).
- **Architecture:** sibling index table synced at the `persona_store.save`
  choke point (Approach A). On-the-fly FTS (no table) and an external search
  service were rejected — the former forecloses embeddings, the latter is
  overkill for a personal-scale dataset.

## Schema (additive, in `db.ensure_schema`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS persona_search (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_type    text NOT NULL,
  entity_id    text NOT NULL,
  title        text NOT NULL DEFAULT '',
  text         text NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  embedding    vector(1024),
  content_hash text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_type, entity_id)
);
CREATE INDEX IF NOT EXISTS persona_search_tsv_idx ON persona_search USING gin (tsv);
CREATE INDEX IF NOT EXISTS persona_search_embedding_idx ON persona_search
  USING hnsw (embedding vector_cosine_ops);
```

Notes: `embedding` is nullable — rows without embeddings rank by FTS alone.
The HNSW index tolerates NULLs. `title` is stored so search hits can label
results without loading blobs. Local test-db image is already
`pgvector/pgvector:pg16`; Neon supports `CREATE EXTENSION vector` natively.

**pgvector is optional (self-hosted vanilla Postgres support).**
`ensure_schema` attempts `CREATE EXTENSION IF NOT EXISTS vector` in a
try/except. If the extension is unavailable (e.g. a self-hoster on a plain
`postgres:16` image), the table is created WITHOUT the `embedding` column and
without the HNSW index, a module-level `VECTOR_AVAILABLE = False` flag is
set, and the instance runs permanently in FTS-only mode: the sync path skips
embedding scheduling, the search query skips the vector CTE, and
`search_context` reports `mode: "fts"`. Startup must never fail because
pgvector is missing. (If pgvector is installed later, the column/index are
added by the same `ensure_schema` on next boot — guarded `ALTER TABLE ADD
COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.)

## Index sync (in `persona_store.save`)

After `_assign_ids` and the blob upsert, for each section with `id_lists`:

1. **Flatten** each entity to `(entity_id, title, text)`:
   - `title`: first non-empty of `name` / `title` / `topic` / `institution` /
     `language` (per-entity-type priority list defined in one place).
   - `text`: title + description-ish fields (`description`, `notes`,
     `content`, `details`, `role`, `status`) + `tags` + nested reference
     names/urls + nested `highlights`/`specifics`/`coursework` strings.
     Joined with newlines; values coerced to str; non-str/list/dict values
     skipped defensively.
2. **Diff by hash**: `content_hash = sha256(text)`. Compare against existing
   rows for `(user_id, file_type)`:
   - new/changed hash → upsert row (embedding set to NULL on change),
   - ids no longer present → delete rows.
   Unchanged entities are untouched (no re-embed, no write).
3. **Embed changed rows in the background**: schedule an asyncio task that
   batches the changed `(entity_id, text)` pairs to Voyage and updates
   `embedding`. Failures are logged and never propagate — the write path
   cannot fail or block on Voyage. Retried implicitly on next save of that
   section, or by the backfill script, or by the lazy-heal path below.

The embedder is an injectable client (module-level factory reading
`VOYAGE_API_KEY`), so tests substitute a deterministic fake. Sections without
`id_lists` (preferences) are not indexed. The `_settings` row is excluded.

Sync failures (any exception in flatten/diff/upsert) are caught and logged;
the persona write itself always succeeds — the index is derived data and
self-heals.

## Self-healing / backfill

- **Lazy heal:** when a search query finds zero index rows for a user who has
  persona data, build the FTS rows inline for that user (fast — no network)
  and schedule embeddings in the background, then run the query. This covers
  existing users after deploy with no manual step.
- **Backfill script:** `backend/scripts/backfill_search_index.py` walks all
  users' blobs, rebuilds rows, and embeds in batches (for initial deploy /
  disaster recovery). Mirrors the style of `migrate_json_to_postgres.py`.

## Search query (one SQL statement, hybrid RRF)

Two ranked CTEs over `persona_search` scoped to `user_id` (from the existing
contextvar) and optional `file_type = ANY(sections)`:

- **FTS:** `websearch_to_tsquery('english', query)` matches ranked by
  `ts_rank_cd(tsv, tsq)`, top 40.
- **Vector:** `embedding <=> $query_embedding` ascending (skipped entirely in
  FTS-only mode: no key, or query embedding call fails), top 40.

`FULL OUTER JOIN` on the PK, score = `COALESCE(1.0/(60+fts_rank),0) +
COALESCE(1.0/(60+vec_rank),0)`, order by score desc, `LIMIT $limit`.
Disabled sections are excluded by adding them to the `file_type` predicate
(reusing `settings_store.get_disabled_sections`). Snippets come from
`ts_headline('english', text, tsq)` when there is an FTS match, else the
first 160 chars of `text`.

The query embedding is fetched from Voyage per search call with a short
timeout (2s, `input_type="query"`); on timeout/error the search degrades to
FTS-only for that call.

## New MCP tools (`server.py`)

```
search_context(query: str, sections: str | list[str] | None = None,
               limit: int = 10) -> str  # JSON
```
Returns `{"query": ..., "mode": "hybrid" | "fts", "results": [
  {"entity_id", "section", "title", "snippet", "score", "fts_hit", "distance"}]}`.
`fts_hit` is `true` when the row matched the FTS leg (`websearch_to_tsquery`);
`distance` is the vector leg's cosine distance (`embedding <=> query_embedding`,
lower = closer) or `null` when the row has no embedding or mode is `"fts"`.
Validation: empty query → error string; unknown section names → error listing
valid sections; every requested section disabled → the same disabled-section
error wording `get_entity` uses (not a silent empty result); limit clamped to
1..25. Docstring tells AI callers this is the preferred way to find relevant
persona entries, and to follow up with `get_entity` for full detail.

```
get_entity(entity_id: str) -> str  # JSON of the full entity
```
Resolution: the id prefix maps to `(file_type, list_field)` via a
registry-derived map built from `sections.SECTION_REGISTRY`'s `id_lists`
(e.g. `learn_ → (learning_log, entries)`, `project_ → (projects, projects)`).
Load the one blob, scan the one list for the id. Errors: unknown prefix →
message listing valid prefixes; known prefix but id not found → not-found
message; entity in a disabled section → same disabled-section error wording
`get_context` uses. Response includes `{"section", "entity_id", "entity"}`.

Prefix collision note: `learning_` (projects.current_learning) vs `learn_`
(learning_log entries) — resolution must match the LONGEST prefix first.

## Topic filter rewire (`get_context`)

`_filter_by_topic` is reimplemented on top of the search internals:

1. Run the same hybrid/FTS query (query = topic, sections = the id-list
   sections present in the scoped output, limit = 100) to get matching
   entity ids.
2. In the scoped output, filter each id-list field to items whose id is in the
   match set. Non-id-list fields are untouched (same as today's behavior of
   keeping non-list content).
   A row counts as a topic match when `fts_hit` is true, OR when it has a
   vector `distance` at or under a hard cutoff of `0.5` cosine distance
   (`fts_hit OR distance <= 0.5`; `TOPIC_VECTOR_DISTANCE_CUTOFF` in
   `server.py`). Rows with neither an FTS hit nor a close-enough embedding
   are dropped even if they were in the raw top-100 candidates.
3. If the user's index is empty, the lazy-heal path (above) builds it first —
   so behavior is well-defined from the first call.

`KEYWORD_ALIASES`, `_extract_keywords`, `_item_matches_topic`, and the old
`_filter_by_topic` matching internals are deleted. The `topic` parameter's
public API and docstring semantics are unchanged.

## Dependencies

`voyageai` is NOT added. All embedding HTTP calls use `httpx` (already a
transitive dependency of fastmcp; add it explicitly to requirements.txt).
One small module `backend/embeddings.py` owns: the provider factory, batch
embed, query embed, timeouts, and the "not configured → None" behavior.

**Provider configuration (hosted OR locally hosted models):**

| Env var | Default | Meaning |
|---|---|---|
| `EMBEDDING_PROVIDER` | `voyage` | `voyage` or `openai` (OpenAI-compatible `/v1/embeddings` — covers Ollama, LM Studio, llama.cpp server, vLLM, LocalAI, and OpenAI itself) |
| `VOYAGE_API_KEY` | unset | Voyage key; unset with provider=voyage → FTS-only mode |
| `EMBEDDING_API_URL` | provider default | Base URL for openai provider, e.g. `http://localhost:11434/v1` (Ollama) |
| `EMBEDDING_API_KEY` | unset | Bearer key for openai provider; optional (local servers usually need none) |
| `EMBEDDING_MODEL` | `voyage-4-lite` | Model name sent to the provider (e.g. `nomic-embed-text`) |
| `EMBEDDING_DIM` | `1024` | Vector column dimension; read at schema-creation time |

`ensure_schema` creates `vector(EMBEDDING_DIM)`. If the existing column's
dimension differs from the configured value at boot, the backend logs a
clear warning naming `scripts/backfill_search_index.py --recreate` (which
drops + recreates the embedding column at the new dimension and re-embeds
everything) and runs in FTS-only mode until that is done — it never writes
mismatched vectors and never fails startup. For provider=openai the
"configured" test is `EMBEDDING_API_URL` being set (key optional); for
voyage it is `VOYAGE_API_KEY` being set.

## Error handling summary

| Failure | Behavior |
|---|---|
| No `VOYAGE_API_KEY` | FTS-only everywhere; `mode: "fts"` in responses |
| pgvector extension unavailable (self-hosted vanilla Postgres) | Table created without embedding column; permanent FTS-only mode; startup never fails |
| `EMBEDDING_DIM` mismatch with existing column | FTS-only mode + logged instruction to run backfill `--recreate`; startup never fails |
| Voyage down / timeout on write | Row saved with NULL embedding; retried next save/backfill |
| Voyage down / timeout on query | That search degrades to FTS-only |
| Index sync exception | Logged; persona write still succeeds |
| Bad query string | `websearch_to_tsquery` handles arbitrary input safely |
| Unknown entity id / prefix | Clear error message with valid options |

## Non-goals

- No frontend/UI search changes (client-side filters stay as they are).
- No `days`/`limit` extension beyond learning_log.
- No behavior change to `get_raw` (docstring only).
- No reranker model, no chunking (entities are small; one row per entity).
- No index rows for fixed-shape sections (preferences).

## Testing

Extends the existing pytest suite (real Postgres test-db, which already runs
the pgvector image; `ensure_schema` gains the extension + table):

- Flattening: per-entity-type title priority, tags/references/nested strings
  included, non-string values tolerated.
- Sync: add/update/remove diffing; unchanged hash → no write; embedding
  nulled on content change; `_settings` and preferences excluded.
- Search: FTS ranking sanity; hybrid RRF ordering with a deterministic fake
  embedder; sections filter; disabled-section exclusion; limit clamping;
  empty-index lazy heal.
- Vector-unavailable mode: with `VECTOR_AVAILABLE` forced False, schema
  creates without the embedding column, sync skips embedding, search stays
  FTS-only end-to-end.
- `get_entity`: every prefix resolves; longest-prefix (`learning_` vs
  `learn_`) collision; not-found; disabled section.
- Topic rewire: scoped output keeps only matched id-list items; non-list
  fields untouched; parity test showing an alias-style query ("js") still
  finds a "JavaScript" entry via FTS/vector rather than the deleted alias
  dict.
- MCP real-dispatch-path tests for `search_context` and `get_entity` (per
  the established ledger precedent for tool-schema regressions).
- All embedding tests use the injectable fake; no network in tests.

## Deploy notes

- `ensure_schema` runs on startup — Neon needs the `vector` extension
  available (it is, natively). First deploy: run
  `scripts/backfill_search_index.py` once (or rely on lazy heal per user).
- New env var: `VOYAGE_API_KEY` (optional — absence is a supported mode).
