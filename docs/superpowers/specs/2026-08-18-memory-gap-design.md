# Closing the memory gap on mem0 — design

Date: 2026-08-18
Status: designed, not implemented

## Why

mem0 is the reference implementation of the thing MyGist is: a memory layer an
assistant reads and writes across sessions. It is worth measuring against
because the comparison is honest — same problem, opposite philosophy. mem0
decides what to remember. MyGist lets the user decide.

A learning-log entry from 2026-01-05 (`learn_20260105_599758`) listed five ideas
from an earlier comparison against MARM. Four of them shipped:

| Idea, Jan 2026 | Now |
|---|---|
| Semantic search alongside keyword filtering | hybrid FTS + pgvector, `search_index.py` |
| Smart summaries with truncation | `detail="titles"`, `limit`, scope narrowing |
| Handoff / catch-up briefing | the `catch_up` prompt |
| Context bridging between sessions | the same prompt |
| Health/status tool | `whats_on_file`, plus `section_counts` |

So the easy comparison is finished, and what is left is the part that is
actually about memory rather than retrieval: what happens when a stored fact
stops being true. That is the whole of mem0's write path and none of MyGist's.

## The gap, stated precisely

mem0's write loop is: embed the incoming fact, retrieve similar stored
memories, ask an LLM whether to ADD, UPDATE, DELETE or NOOP, apply it, and keep
a per-memory history of what changed.

MyGist has the first two steps and neither of the last two.

| mem0 | MyGist today | What is missing |
|---|---|---|
| retrieve similar before writing | `_find_strong_match`, `server.py:3318` | nothing — this exists and is good |
| LLM decides ADD/UPDATE/DELETE/NOOP | advisory string the calling agent reads | the advisory does not say what the old value **is** |
| per-memory change history | `persona_data` is one JSON blob per section with a single `updated_at` | a bad write is unrecoverable |
| recency in retrieval scoring | `days` filter, `status: inactive` | nothing surfaces that an entry has gone quiet |
| extraction from raw messages | `propose_update` + review queue | depends on the agent choosing to call it |

The second row is the important one, and it is smaller than it looks. mem0
spends an inference call deciding whether the new fact conflicts with the old.
MyGist does not need to: **the calling agent is already that LLM**, already in
the loop, already holding the new fact. It only needs to be told what the old
one says. That is a field, not a feature.

## The unifying observation

`persona_proposals` already has `kind`, `fingerprint`, `seen_count`, `status`,
and the guarantee that a rejected proposal is never raised again. Contradiction,
staleness and capture are not three subsystems. They are three producers feeding
one review-gated inbox that already exists.

History looks like the odd one out, and is not. It shares a write point with the
contradiction advisory, because the moment before a section is overwritten is the
only moment anything holds both what the persona said and what it is about to
say. One place, two features.

## 1. The conflict advisory carries what it conflicts with

### Current state, verified

`_find_strong_match` (`server.py:3318`) runs the hybrid index against the
incoming entity and returns `{entity_id, title, distance, file_type}` for a
strong hit. Three callers:

| Caller | Gating | Returns |
|---|---|---|
| `persona_modify`, `server.py:3523` | `action == "add"` only | advisory string via `_advisory_note` |
| `persona_batch`, `server.py:3578` | `action == "add"` only | same |
| `propose_update`, `server.py:3743` | any stored `kind == "entity"` proposal | `conflicts_with_existing: {entity_id, title}` |

The comment above the `propose_update` call says the user "should not have to go
and look up what it currently says". It then returns the title, which does not
say what it currently says. That is the whole gap in one place.

### The change

Add the matched entity's stored text to what `_find_strong_match` returns, and
carry it through both `_advisory_note` and `conflicts_with_existing`.

This costs no extra query. `persona_search.text` is a column on the row the
search already reads — `flatten_entity` wrote it at index time. Truncate to
roughly 300 characters; the advisory is a nudge, and an agent that needs the
whole entity has `get_entity`.

After the change, an agent adding "MyGist runs on a Coolify VPS with
self-hosted pgvector" against a stored project that still says Neon sees the
contradiction in the tool result and resolves it in the same turn — an
`action="update"`, or a `propose_update` if it is inferring rather than being
told. That is mem0's ADD/UPDATE/NOOP decision, made without a second inference
pass.

### The update side is a different question, answered in one place

The `action == "add"` gating stays. Widening it to `update` looks right and is
not: an update names its target, so "resembles an existing entity" is trivially
true of the entity being updated, and the advisory would fire on every update
saying the entity resembles itself.

The useful check on an update is not *what does this resemble* but *what did this
replace*. `execute_modify` already holds the old value — the project branch binds
it at `server.py:1713` and overwrites fields at 1717 — and reports only
`✅ Updated project: {name}`. But that pattern repeats across roughly thirty
entity branches, so adding a "was: X" clause to each is thirty edits and thirty
chances to drift.

There is one place that holds both the old and new state for every entity in
every section: `persona_store.save()`, which is about to read the previous blob
anyway for unit 2's history row. So the diff is computed there, once, generically
— which top-level fields of which entities changed, and what they were — and
stashed in a contextvar, following the `db.current_user_id` pattern the codebase
already uses. `persona_modify` and `persona_batch` read it after `execute_modify`
returns and append it to the receipt.

One implementation, no per-branch edits, and it covers sections that do not exist
yet. This is why units 1 and 2 are sequenced together: the history write point is
the chokepoint the update advisory needs.

`ADVISORY_ENTITIES` coverage also stays as it is. Generic pack entities already
qualify automatically (`server.py:3309`), so a new section pack inherits the
advisory without code.

## 2. Section history, and revert

### Table

```sql
create table if not exists persona_history (
    id          bigserial primary key,
    user_id     uuid not null references users(id) on delete cascade,
    file_type   text not null,
    data        jsonb not null,
    written_by  text not null default '',
    replaced_at timestamptz not null default now()
);
create index if not exists persona_history_lookup_idx
    on persona_history (user_id, file_type, replaced_at desc);
```

Whole-section snapshots, not per-entity diffs. `persona_data` rows are already
whole-section JSON blobs and `persona_store.save()` already writes at that
granularity, so a diff would need building and replaying for no gain. A snapshot
restores by being written back.

`ponytail: 20 whole-section snapshots per section; move to jsonb diffs only if
a section's blob ever gets large enough to notice.`

### Write point

`persona_store.save()` (`persona_store.py:483`) is the single write path — every
MCP write, every web-UI write and every migration goes through it, and it is
already where `sync_index` is called at line 499.

Insert the row currently in `persona_data` **before** the upsert. A first-ever
write for a section has no previous state and writes no history row. `written_by`
takes the MCP client name from the same contextvar `mcp_activity` reads, and is
empty for web-UI writes.

Retention: delete all but the newest 20 per `(user_id, file_type)` in the same
transaction as the insert, so pruning cannot drift.

Because this is the one place holding the previous blob and the incoming one at
the same time, it also computes the changed-field diff unit 1 needs for the
update advisory, and stashes it in a contextvar for the tool layer to read. The
diff is derived from the two blobs, so it stays correct for entities and sections
that do not exist yet.

### Read path

REST only.

- `GET /api/history/{section}` → `[{id, replaced_at, written_by, entity_count}]`
- `POST /api/history/{section}/revert/{id}` → writes that snapshot back through
  `persona_store.save()`

Routing revert through `save()` rather than straight to the table means it lands
in history itself and re-syncs the search index by the existing path. A revert is
reversible, and there is no second write path to keep correct.

A settings-page panel per section: revision list, a diff against current, and a
revert button. Destructive action, so it is red and labelled, and it names the
section it will overwrite.

### No MCP tool for any of this

An agent that can revert can undo a rejection, and "anything you reject is never
raised again" is a guarantee the product makes in the README. History is a user
affordance. It stays on the side of the wall the user controls.

## 3. Staleness as a field on the entity

### It needs no new storage

`persona_search.updated_at` is per entity, and `search_index.entity_update_times`
is already joined into `get_context` (`server.py:519`, `695`) and `get_entity`
(`server.py:3105`). The data has been there since the search index shipped and
nothing reads it except the `days` filter.

### The one real decision: staleness is per section

`projects` and `goals` go stale. `profile.name` and a favourite film do not. So
the threshold belongs in the section manifest, not in backend code:
`stale_after_days` as an optional key in `section_packs/*/manifest.json` and
`section_packs/meta_schema.json`. Omit it and the section never goes stale,
which keeps every existing pack valid and unchanged.

Proposed defaults:

| Section | `stale_after_days` | Reasoning |
|---|---|---|
| `projects` | 120 | a project untouched for four months has probably moved or ended |
| `goals` | 120 | same, and goals carry a target date the marker can be read against |
| `knowledge` | 365 | a skill decays slowly, but "intermediate" from two years ago is a guess |
| `learning_log` | none | a dated entry is not stale, it is dated |
| everything else | none | identity, taste, preferences and people do not expire on a timer |

### Emitted as a field, not a footer line

Entities past their section's threshold get `"stale": true` in `get_context`,
`search_context` and `get_entity` output.

Not a footer sentence. The 2026-08-16 tool-triggering spec settled that the
result footer is one short static string, on the grounds that a footer varying
with how well the model is behaving is a footer that nags. That constraint holds
here and this respects it: a field on an entity varies with the **data**, the
way `not_in_this_scope`'s counts already do, and it costs five tokens on only
the entities where it fires.

The agent then has what it needs without being told what to conclude. A stale
project plus the user mentioning that project is a `propose_update`, and the
footer already says so.

### No recency weighting in ranking

mem0 weights retrieval by recency. Declined. An old preference is not less true,
and down-ranking it is how a memory layer starts forgetting things the user never
asked it to forget. A stale entity already carries its own marker; the agent can
weigh it.

## 4. Capture: the measurement the last spec earned, then one prompt

The 2026-08-16 spec moved the trigger prose out of the `instructions` string —
which it proved was not arriving — and into tool descriptions and read-tool
footers. Those shipped. Nobody has checked whether they worked.

`mcp_activity` is keyed `(user_id, client, method, tool)` with `calls`,
`first_seen` and `last_seen`, so it is one query:

```sql
select client,
       sum(calls) filter (where tool = 'propose_update')                as proposals,
       sum(calls) filter (where tool in ('get_context','search_context')) as reads,
       min(first_seen) as since
from mcp_activity
where user_id = %s and method = 'tools/call'
group by client
order by reads desc;
```

This distinguishes two diagnoses that need different fixes. A client with reads
and zero proposals is a description problem — that client is not receiving or not
matching the trigger prose, and the skill or description wording is the lever. A
low but non-zero rate across every client is a moment problem: the model knows
when to propose and the moment passes anyway, which no static text fixes.

Run it before building. It costs nothing and it changes what gets built.

### The prompt, either way

A fourth entry in `mcp_prompts.py` beside `catch_up`, `whats_on_file` and
`log_learning`:

`file_what_you_heard` — re-read this conversation, list what is durable, call
`propose_update` once per item with the user's own words quoted as evidence, do
not narrate.

Roughly thirty lines, no backend change, and it inherits the review gate — so
this is mem0's automatic extraction with the user still holding the approval.
It is worth having regardless of the query, because a user-triggered sweep is a
lever a passive footer cannot be: it fires at the end of a conversation, which is
exactly the moment the footers cannot reach.

Automatic capture in mem0's sense — the server extracting from a message array on
its own — stays declined, for the reason `learn_20260105_599758` already
recorded: an MCP tool cannot self-execute. Every "automatic" memory layer over
MCP is a model choosing to call something. The honest levers are the description,
the footer and the prompt, and this spec covers all three.

## What this declines from mem0, and why

| mem0 feature | Why not |
|---|---|
| LLM pass deciding ADD/UPDATE/DELETE/NOOP | The calling agent is already that LLM. An advisory it reads in the same turn buys the same decision without a second inference call or an API key in the write path. |
| Graph memory over a graph store | `related` (explicit, via `action="link"`) and `similar` (derived neighbours) already answer what one hop covers. Multi-hop would mean a second database for a question nobody has asked. |
| `agent_id` / `run_id` / session partitioning | A persona belongs to one person, and OAuth client scopes already control what each client may read. Per-client memory partitions would fragment the thing whose value is being one place. |
| Recency-weighted retrieval | Covered above. |
| Session / working memory | The conversation is the working memory. Storing a copy server-side adds a lifecycle to manage and expires nothing on its own. |

## Testing

One check per piece of non-trivial logic, in the existing suite.

| Unit | Check |
|---|---|
| Contradiction | an add that strongly matches a stored entity returns that entity's text in the advisory; a `propose_update` returning `conflicts_with_existing` carries it too |
| Update advisory | an `action="update"` that overwrites a field reports the previous value; an update that changes nothing reports nothing; an entity in a section with no bespoke branch is covered by the same diff |
| History | `save` writes the previous blob and not the new one; a first-ever save writes no row; the 21st save prunes the oldest; revert round-trips a section, appears in history itself, and re-syncs `persona_search` |
| Staleness | an entity past its section's threshold is marked in all three read tools; a section without `stale_after_days` never marks; every existing pack still validates against `meta_schema.json` (`test_pack_cross_checks`, `test_manifest_v2_schema`) |
| Capture prompt | `test_mcp_prompts` covers the fourth prompt; `test_skills_match_the_tools` still passes |

## Order of work

1. **The activity query.** One query, no code, and it decides how much of unit 4
   is worth building.
2. **History.** The safety net that makes the rest safe to iterate on, and the
   write point that unit 1's update advisory depends on.
3. **Contradiction text in the advisory**, and the update advisory reading the
   diff from step 2.
4. **Staleness.** One manifest key, one marker in three read paths.
5. **`file_what_you_heard`.**

Rough sizes: unit 1 is one changed return value across three call sites plus the
diff reader; unit 2 is a migration, a table, the diff at the write point, two
routes and a settings panel; unit 3 is a manifest key and a field in three read
paths; unit 4 is a query and thirty lines of prompt.
