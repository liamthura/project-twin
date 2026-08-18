# Closing the memory gap on mem0 and Honcho — design

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

This document measures against two systems. mem0 sets the bar for the write
path. Honcho sets a different and higher bar, and is analysed separately below —
its contribution is not a feature MyGist is missing but a **time** MyGist never
runs at.

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
staleness, capture and the unattended sweep are not four subsystems. They are four
producers feeding one review-gated inbox that already exists — which is why the
whole of this document adds one table, one column and one script rather than a
memory engine.

It also sets the constraint every unit below is held to: **a new producer may file
a proposal; nothing new may write to the persona.** The inbox is the only thing
standing between "MyGist learns" and "MyGist changes things behind your back", and
everything here stays on the safe side of it.

History looks like the odd one out, and is not. It shares a write point with the
contradiction advisory, because the moment before a section is overwritten is the
only moment anything holds both what the persona said and what it is about to
say. One place, two features.

## Honcho, and the thing it does that neither MyGist nor mem0 does

Honcho stores raw messages and **derives** everything else. A Deriver reads
incoming messages and emits conclusions; a Dreamer periodically revisits those
conclusions to consolidate them. Conclusions carry a `level` —
`explicit`, `deductive`, `inductive` or `contradiction` — and trace back to the
premises they were drawn from.

Most of that is the opposite of what MyGist is for, and the reasons to decline it
are in the declines table. Four ideas survive the philosophy difference.

### Contradiction is a stored type, not a passing remark

Honcho's `contradiction` is a first-class conclusion `level`. It persists. It is
queryable. Somebody has to deal with it.

MyGist's contradiction handling, including unit 1 as first drafted, is a string
appended to a tool result. If the agent reads it and acts, good. If the agent
ignores it — and the 2026-08-16 spec's whole subject is that agents ignore
things — the contradiction stays in the persona and **nobody ever hears about it
again**. Detection with no durability is barely detection.

MyGist does not need Honcho's conclusions table to fix this. It has an inbox.

### Memory that improves when nobody is talking

Honcho's Dreamer runs on idle: at least 50 new conclusions, at least 8 hours
since the last run, and a 60-minute idle timeout that resets if the user comes
back. It replaces outdated facts, resolves contradictions, refreshes the peer
card, and induces patterns — with the discipline that an inductive conclusion
needs evidence from **at least two** source conclusions, because "patterns need
more than a single data point".

**Every code path in MyGist is request-triggered.** Verified: no scheduler, no
worker, no cron, no scheduled workflow. Nothing in the system has ever run while
the user was elsewhere.

That is the real finding of this analysis, and it undercuts unit 3 as drafted.
A staleness marker computed at read time only fires when something reads it, and
the entries most likely to be stale are in the sections nobody reads. The marker
would be least visible exactly where it matters most.

### Conclusions trace back to their premises

Honcho can answer *why do you believe this about me*. MyGist half can.
`propose_update` requires `rationale` and `evidence`, and `main.py:1033` keeps
both on the ledger row after promotion — but `promoted_to` records the entity
**type** (`"project"`), not the entity **id**. So the ledger knows what a
proposal became in general terms and the persona knows nothing about where its
own contents came from. The reverse link, entity → the quote that justified it,
does not exist.

For a product whose pitch is that the persona is yours, readable and exportable,
"why is this here" is a fair question to be able to answer.

### Read frequency, not just recency

Honcho's context call takes `include_most_frequent`. Inverted, that is the most
useful staleness signal available: an entry the user has not touched **and** no
agent has ever read is a far stronger retire candidate than an old timestamp
alone. MyGist counts tool calls in `mcp_activity` but has no per-entity read
count.

## 1. The conflict advisory carries what it conflicts with — and outlives the turn

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

### The conflict also outlives the turn

Taken from Honcho, where `contradiction` is a stored conclusion level rather than
a remark. An advisory the agent ignores should not vanish.

When `_find_strong_match` fires on an add, file a proposal alongside the
advisory: `kind: "conflict"`, `data` holding the incoming entity, `note` naming
the entity it disagrees with, `proposed_by` the calling client, and `rationale`
generated rather than supplied. `_validate_proposal` (`server.py:3596`) grows
`"conflict"` as a third accepted kind; `kind` is already a plain `text` column
with a `(user_id, kind, status, created_at)` index, so there is no migration.

Three properties come free from the existing inbox and are the reason this is
cheap rather than a new subsystem:

- `fingerprint` deduplicates, so the same conflict re-detected on every add does
  not stack up.
- `seen_count` records that it kept happening, which is itself information.
- Rejection is permanent. A user who decides the two entries are legitimately
  different is never asked twice — the same guarantee `propose_update` makes.

The advisory still goes out in the tool result, because an agent that resolves it
in the same turn is the best outcome and the fastest. The proposal is the floor,
not the ceiling: it catches the case where the agent does nothing.

One constraint, and it is the reason this is safe: a conflict proposal is filed
**only on a write the user's agent already made**, never speculatively. It
reports a collision between two things in the persona. It does not infer that
anything is wrong.

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

## 3. Staleness as a field on the entity, surfaced by unit 5

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

### The marker alone is not enough, which is why unit 5 exists

A read-time marker only fires when something reads the entity, and the sections
most likely to hold stale entries are the ones nothing reads. Honcho's answer is
to run when the user is not there. Unit 5 is that, and it is what makes this unit
reach anybody. The marker is the signal; the sweep is the delivery.

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

## 5. The sweep — one thing that runs when nobody is talking

Honcho's Dreamer, minus the inference. `scripts/dream.py`, beside the migration
and backfill scripts already in `backend/scripts/`, run on a schedule by the
host. No new dependency, no in-process scheduler, no locking problem, and it is a
plain function so it tests like one.

### It files proposals. It never writes.

This is the whole design, and it is what makes an autonomous process acceptable in
a product that promises nothing is inferred behind your back. The sweep has no
write access to the persona. Its only output is rows in the inbox the user already
reviews, subject to the same fingerprinting and the same permanent rejection.

### Version one needs no LLM at all

Every check below is SQL over data MyGist already has, which is why this is a
script and not a service:

| Check | Signal | Proposal |
|---|---|---|
| Passed target date | a `goal` whose target date is in the past and whose status is still active | update the status or move the date |
| Gone quiet | an entity past its section's `stale_after_days` (unit 3) | confirm it or retire it |
| Near-duplicate pair | two entities in one section within the existing `DUPLICATE_DISTANCE_CUTOFF` | merge, or link them with `action="link"` |
| Dangling link | a `related` id whose target was deleted — already surfaced as `{"id", "title": None}` by `get_entity` | drop the link |

None of that is a judgement about the user. Each one is an internal
inconsistency in their own data, which is the only kind of thing a process
running without them present has any business raising.

### Honcho's trigger discipline, kept

Honcho gates its Dreamer on volume, elapsed time and idleness together, and
requires two independent data points before inducing a pattern. Both rules
transfer:

- **Nothing to say is the normal outcome.** A sweep that finds nothing files
  nothing. An inbox that fills up weekly with the same four soft observations is
  an inbox the user stops opening, and then the whole review gate stops working.
- **A cap per run**, so one sweep over a neglected persona cannot produce ninety
  rows. The rest wait for next time; `seen_count` shows what has been waiting.
- **Two signals before proposing a retirement.** Age alone is weak. Age plus
  never-been-read is not.

### The second signal, and the one new column

That last rule needs a read count, which is Honcho's `include_most_frequent`
turned around. One column on `persona_search`:

```sql
alter table persona_search add column if not exists read_count bigint not null default 0;
```

Incremented on `get_entity` only — a deliberate, targeted fetch of one entity —
and not on scope reads, which pull whole sections and would say nothing about
which entries earned it. That keeps it to one cheap update on an already-indexed
primary key, on a path that is not hot.

An entry old **and** never once fetched is a retire candidate worth raising. Old
and read every week is just settled.

### Observability, because it runs unattended

`GET /api/sweep` returning the last run time, what it examined and what it filed.
A background process with no surface is one nobody can tell has silently stopped,
and this one's failure mode is looking exactly like a persona with nothing wrong
with it.

## 6. Where an entry came from

Honcho traces a conclusion to its premises. MyGist keeps the evidence on the
ledger row and then loses the thread: `promoted_to` holds the entity **type**, so
nothing links a line in the persona back to the quote that put it there.

Two changes, and the first is already half-built by unit 1.

**One `last_write` contextvar.** Unit 1 needs the changed-field diff out of
`persona_store.save()` and this needs the id `execute_modify` assigned. Both are
"what did the write just do", both cross the same layer boundary, and two
contextvars for one question would be the wrong shape. One carries
`{entity_id, changed_fields}`.

**`promoted_to` holds the id.** `main.py:1061` then records `project_c140959c`
instead of `project`, and the ledger becomes reversible: `GET /api/proposals`
filtered by entity id answers "why is this in my persona", with the client that
proposed it, the date, and the user's own words as evidence.

The `agent-observation` tag (`main.py:1053`) stays. It is coarse — it marks that
something came from an agent without saying which or when — but it is what makes
provenance visible while reading the persona by hand, which is a different job
from querying the ledger.

## What this declines, and why

| mem0 feature | Why not |
|---|---|
| LLM pass deciding ADD/UPDATE/DELETE/NOOP | The calling agent is already that LLM. An advisory it reads in the same turn buys the same decision without a second inference call or an API key in the write path. |
| Graph memory over a graph store | `related` (explicit, via `action="link"`) and `similar` (derived neighbours) already answer what one hop covers. Multi-hop would mean a second database for a question nobody has asked. |
| `agent_id` / `run_id` / session partitioning | A persona belongs to one person, and OAuth client scopes already control what each client may read. Per-client memory partitions would fragment the thing whose value is being one place. |
| Recency-weighted retrieval | Covered above. |
| Session / working memory | The conversation is the working memory. Storing a copy server-side adds a lifecycle to manage and expires nothing on its own. |

| Honcho feature | Why not |
|---|---|
| The Dialectic (`peer.chat()`) — ask a question about the user, get a synthesised answer | This is the same decline as mem0's write-path LLM, pointed at the read path, and it costs more there. It puts a second model's interpretation between the user and their own data, adds an API key and latency to every read, and returns prose in place of the structured JSON the product promises is exportable. The calling agent already synthesises, from `search_context` and `get_entity`, and it is the one that knows what the question was for. |
| Derived conclusions as the primary store | Honcho stores messages and derives the rest, so its representation is only as good as its last inference pass and cannot be hand-corrected. MyGist stores what the user approved. Inverting that is not an improvement to MyGist; it is a different product. |
| Session summaries every 20 / 60 messages | MyGist has no message stream to summarise. Entities are already the compressed form. |
| Peer Card — 40 stable facts, auto-distilled | `get_context(scope="minimal")` is this, and the user curates it by hand rather than having it inferred. The idea worth keeping is the hard cap on a first read, and scopes already bound that. |
| Token budget parameter on reads | `scope`, `topic`, `detail="titles"`, `limit` and `days` are five ways to narrow a read. A sixth is not a sixth capability. |
| Observer/observed representations across peers | A persona belongs to one person. Modelling what other people think of them is a different product, and `circle` stores the relationships without claiming their perspectives. |
| Webhooks | Real, and deferred rather than declined. It matters once unit 5 files proposals while the user is away, and the existing inbox badge is the cheaper half of it. Revisit if the sweep proves the inbox goes unread. |

## Testing

One check per piece of non-trivial logic, in the existing suite.

| Unit | Check |
|---|---|
| Contradiction | an add that strongly matches a stored entity returns that entity's text in the advisory; a `propose_update` returning `conflicts_with_existing` carries it too |
| Update advisory | an `action="update"` that overwrites a field reports the previous value; an update that changes nothing reports nothing; an entity in a section with no bespoke branch is covered by the same diff |
| History | `save` writes the previous blob and not the new one; a first-ever save writes no row; the 21st save prunes the oldest; revert round-trips a section, appears in history itself, and re-syncs `persona_search` |
| Staleness | an entity past its section's threshold is marked in all three read tools; a section without `stale_after_days` never marks; every existing pack still validates against `meta_schema.json` (`test_pack_cross_checks`, `test_manifest_v2_schema`) |
| Capture prompt | `test_mcp_prompts` covers the fourth prompt; `test_skills_match_the_tools` still passes |
| Conflict proposals | a detected conflict files exactly one proposal; the same conflict on a second add does not file a second row and bumps `seen_count`; a rejected conflict is never re-filed; `_validate_proposal` accepts `"conflict"` and still rejects anything else |
| Sweep | a passed target date, a stale entity, a near-duplicate pair and a dangling link each file one proposal; a clean persona files nothing; the per-run cap holds; the sweep cannot write to `persona_data` — assert it, because that is the property the whole design rests on |
| Read counts | `get_entity` increments; a scope read does not; a retirement proposal needs age **and** a zero read count |
| Provenance | a promoted proposal records the new entity's id, and the ledger is queryable by it |

## Order of work

1. **The activity query.** One query, no code, and it decides how much of unit 4
   is worth building.
2. **History**, with the `last_write` contextvar. The safety net that makes
   everything after it safe to iterate on, and the write point units 1 and 6 both
   depend on.
3. **Unit 1 in full** — the conflicting text in the advisory, the update advisory
   reading the diff from step 2, and conflict proposals.
4. **Unit 6.** Small, and it follows step 2 directly.
5. **Staleness**, plus the `read_count` column, which is one migration line and is
   needed by step 6.
6. **The sweep.** Last, because every signal it reads is built by then, and
   because it is the only piece that runs unattended — it should go last on a
   foundation that is already reversible.
7. **`file_what_you_heard`**, whenever step 1 says it is worth it.

Rough sizes: unit 1 is one changed return value across three call sites, plus the
diff reader and a proposal kind; unit 2 is a migration, a table, the contextvar,
two routes and a settings panel; unit 3 is a manifest key and a field in three
read paths; unit 4 is a query and thirty lines of prompt; unit 5 is one script,
four SQL checks and a status route; unit 6 is two changed lines and a query.

The sequencing is not arbitrary. Unit 2 gives every later step an undo, and unit 5
is the only part of this that acts without the user in the room — so it lands last,
on top of history, a review gate it cannot bypass, and a test asserting it holds no
write access.
