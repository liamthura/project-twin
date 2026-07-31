# Proposal inbox and agent-authored capture

**Date:** 2026-07-31
**Status:** Approved as the design of record.
**Replaces:** the `suggest_persona_update` capture pipeline (`backend/server.py:65-557`, `:3256-3648`)

## Problem

MyGist's only capture surface, `suggest_persona_update`, decides what is worth remembering by
matching substrings against hand-written English word lists. It has three failure modes, and
the results of its analysis are thrown away regardless.

### The vocabulary is closed and already stale

`KNOWN_SKILLS` (`server.py:3318`) is a literal list of about ninety technology names.
`KNOWN_CONCEPTS` (`server.py:3350`) is fifteen business terms. Nothing outside those lists can
be detected. `knowledge.json` currently records Datadog at `advanced` — Datadog is not on the
list, so the user's strongest skill is invisible to capture. Neither are Coolify, Alembic,
pgvector, or anything not written in English.

Every new tool, framework, and interest requires a code change to become detectable. The list
began ageing the day it was written.

### `IGNORE_PATTERNS` discards real statements

`IGNORE_PATTERNS` (`server.py:3309`) is substring-scanned against the whole message, and a hit
returns immediately with confidence `0.1` before any other analysis runs (`server.py:3394`).

> "ok so I've decided to drop Neon and self-host Postgres"

is discarded because it contains `ok`. Any message containing `explain`, `what is`, or
`thanks` anywhere in its body is discarded the same way. This is a bug, not a tuning problem.

### Triggers match idioms, not meaning

`CAPTURE_TRIGGERS` (`server.py:3256`) requires literal phrases. `completed` fires on the
profile bio's "completed placement year". "finally got the search index working after three
days" matches nothing at all. False positives and false negatives from the same mechanism.

### Coverage is a fraction of the schema

Suggestions are generated for a handful of entity types. There are eleven section packs.
Nothing can propose against `preferences.communication` — the highest-steering data in the
system.

### Nothing survives the call

The tool returns suggestions to the calling agent along with an `instruction` string telling
it what to do (`server.py:4380-4388`). Whether anything is captured depends entirely on
whether that agent chooses to act or to ask. If it does neither, the observation is gone. There
is no queue, no record, and no way for the user to see what was noticed and dropped.

### The whole approach is redundant

The calling agent has already read the message with full conversation context. It knows the
referents, the tone, whether the user is joking, and it holds the persona from `get_context`.
Roughly a thousand lines of Python are re-deriving, by substring match, a worse version of
what the caller already computed for free.

Four of those functions — `calculate_evidence_boost`, `calculate_final_confidence_v2`,
`resolve_pronoun_references`, `consolidate_suggestions_for_ux` — are defined and never called
at all. `ConversationContext` (`server.py:120`) is a module-level global doing pronoun tracking
in a multi-user server; it is currently unreachable, which is the only reason it has not leaked
state between users.

## The design

**The agent authors the proposal. The server adjudicates and persists it. The user resolves it.**

Three tools, one rule each:

| Tool | When | Effect |
| --- | --- | --- |
| `persona_modify` / `persona_batch` | user explicitly asks for something to be recorded | writes immediately |
| `propose_update` | agent infers something durable | creates a pending proposal, never writes |
| `get_context` / `search_context` / `get_entity` | reading | unchanged |

The server stops analysing text. Its job becomes what a database is good at: validate the claim
against the pack manifest, dedupe it against existing entities, check it against the current
value, persist it, and return what it did. None of those need updating when a new technology
or a new section pack appears.

### Two kinds of proposal

**`kind: "entity"`** — typed, schema-valid, destination known.

```json
{
  "kind": "entity",
  "action": "update",
  "entity": "domain",
  "data": { "name": "Datadog", "level": "advanced" },
  "rationale": "Described running the on-call dashboards unaided and training two others on them — level was 'intermediate'.",
  "evidence": "I ended up rebuilding the whole alerting setup myself",
  "confidence": 0.7
}
```

**`kind: "note"`** — durable but ambiguous. Nothing in the schema holds it.

```json
{
  "kind": "note",
  "section_hint": "preferences",
  "text": "Wants the recommendation first, then the reasoning — pushes back when given a neutral list of options.",
  "evidence": "just tell me which one you'd pick",
  "confidence": 0.6
}
```

`propose_update` takes a batch (`proposals: [...]`); an agent that has noticed one durable thing
has usually noticed two.

### Required fields carry the nuance

| Field | Why it is required |
| --- | --- |
| `rationale` | why this is durable, in the agent's words. This is what the user reads when deciding. |
| `evidence` | the user's own words that prompted it. An agent that cannot quote the user has inferred too far. |
| `confidence` | agent's own estimate. Gates nothing — ordering hint for the queue only. |

`confidence` deliberately does not decide anything. The old pipeline let a computed score
auto-apply writes at `>= 0.8` (`server.py:4380`); that is exactly the behaviour this design
removes.

### Two surfaces over one table

```
persona_proposals
├── kind: entity  → Inbox tab        → approve / edit+approve / reject
└── kind: note    → Observations tab → promote / delete
```

The split is by **how much thought an item needs**, not by lifecycle stage. Inbox items are a
two-second approve/reject. Observations require deciding where something belongs. A queue that
mixes fast and slow items gets abandoned at the slow ones.

Approving an entity proposal routes through `execute_modify` — the same path `persona_modify`
uses — so every existing validation, duplicate advisory, and cross-section nudge applies
automatically. There is no second write path to keep in sync.

Promoting a note opens the entity editor prefilled from its text. The user picks the entity and
fields; the note row is then deleted.

### Observations are staging, not storage

Notes live only in `persona_proposals`. There is no observations section pack, and notes
contribute to **no scope** — not `minimal`, not `learning`, not `full`.

This matters because notes are unvetted. Serving an agent its own uncorroborated inference back
as context creates a loop where an inference is laundered into established fact. What agents
should read is the **promoted** version: typed, searchable, filed in the correct section, and
carried by the correct scope.

The consequence, accepted deliberately: a true-but-unfileable insight has no permanent home. If
the same kind of observation keeps recurring and nothing fits, that is the signal to write a new
section pack — which costs one manifest. A permanent untyped bucket would absorb that pressure
and the signal would never arrive.

### Provenance survives promotion

A promoted entity carries the `agent-observation` tag. Six months on, the user can tell which
parts of the persona they stated themselves and which an agent inferred and they accepted. On a
staging row that is about to be deleted either way, the tag would do nothing.

## Storage

New alembic revision `0003_proposals`. A pending proposal is not persona data — filing it as one
would drag it into `/api/export`, the search index, the pack registry, and the editor.

```sql
create table persona_proposals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  kind         text not null,              -- entity | note
  action       text,                       -- add | update | remove   (entity only)
  entity       text,                       -- domain, connection, …   (entity only)
  data         jsonb,                      --                         (entity only)
  note_text    text,                       --                           (note only)
  section_hint text,                       --                           (note only)
  rationale    text not null,
  evidence     text,
  confidence   real,
  proposed_by  text,                       -- MCP client name where available
  fingerprint  text not null,
  status       text not null default 'pending',   -- pending | approved | rejected | promoted | evicted
  seen_count   int  not null default 1,
  seen_at      timestamptz,                -- set when first rendered to the user
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  promoted_to  text                        -- entity_id, when status = promoted
);

create index on persona_proposals (user_id, kind, status, created_at desc);
create unique index on persona_proposals (user_id, fingerprint)
  where status in ('pending', 'rejected', 'promoted');
```

`note_text` rather than `text`: the latter is a Postgres type name and, while legal as a column
identifier, reads badly in every query that touches it.

### Fingerprint dedupe and tombstones

`fingerprint` hashes the normalised claim: `kind` + `entity` + identifier value for entity
proposals, normalised `note_text` for notes. The partial unique index gives three behaviours:

- **Re-proposed while pending** → `seen_count` increments instead of inserting a second row.
  Three agents independently noticing the same thing surfaces as one item seen three times,
  which is signal rather than clutter.
- **Re-proposed after rejection** → the rejected row acts as a tombstone and the proposal is
  dropped. Without this, every agent re-suggests the thing the user already declined, forever.
  This is the single largest cause of abandoned review queues.
- **Re-proposed after promotion** → also dropped. A promoted note has already become a typed
  entity; re-raising it as an ambiguous note is noise. The trade-off is that a promoted claim
  can never be re-raised as a note even if the underlying fact later changes — but at that point
  the typed entity exists, so the correct route is an `update` entity proposal, which dedupes
  against the entity through `_find_strong_match` rather than through this index.

### Notes are a rolling window

Notes are bounded by a **rolling window of 50 rows**, not a hard cap. A hard cap would block
capture to punish the user's inaction, and would do so silently — MyGist would stop capturing
and nobody would find out for weeks. Losing an observation is worse than having fifty of them.

Eviction order:

```sql
order by (seen_at is null), seen_count asc, created_at asc
```

Rows the user has already seen go first. A note independently raised by three agents is not
evicted ahead of a one-off. **Unseen rows are only evicted at a 100-row backstop**, so a
runaway agent cannot grow the table without bound, but normal use never silently drops
something the user had no chance to look at. Evicted rows are marked `status = 'evicted'` rather
than deleted.

Every eviction is logged with the row's age and `seen_count`. Nobody knows the real note rate
yet — it depends on how often agents find genuinely durable-but-unfileable things, which is the
rarest category by design, and dedupe collapses repeats on top of that. A month of logs answers
the question that would otherwise be a second guess. The window size is deliberately **not** a
user setting: instrumentation will produce the correct value, and a knob nobody tunes is worse
than a constant with evidence behind it.

## Interfaces

### MCP

`propose_update(proposals: list) -> str`

Returns a per-item result, mirroring `persona_batch`'s numbered output:

| Result | Meaning |
| --- | --- |
| `stored` | accepted, pending review |
| `duplicate_pending` | matched a pending fingerprint; `seen_count` incremented |
| `previously_rejected` | matched a rejection tombstone; dropped |
| `conflicts_with_existing` | stored, with the current value attached for the user to compare |
| `invalid` | rejected, with the relevant `get_schema` excerpt attached |

Invalid items never fail the batch — valid items still land. Missing `rationale`, or `evidence`
that quotes no user text, is `invalid`. That requirement is the mechanism keeping proposal
quality honest.

**The queue is not exposed over MCP.** Agents propose; they do not read or nag about the
backlog. Fingerprint dedupe handles repeat proposals server-side without the agent needing
visibility.

### REST

| Endpoint | Effect |
| --- | --- |
| `GET /api/proposals?kind=entity\|note` | list pending; sets `seen_at` on rendered rows |
| `POST /api/proposals/{id}/approve` | entity only — routes through `execute_modify` |
| `POST /api/proposals/{id}/reject` | both kinds — creates the tombstone |
| `POST /api/proposals/{id}/promote` | note only — creates the typed entity, deletes the note |

### Docstring and skill

The docstring is the portable contract — it is all a plain MCP client ever sees. It states what
`propose_update` is for, that it never writes, that `rationale` and `evidence` are required and
`evidence` must be the user's own words, the two kinds, and what **not** to propose:

> Do not propose session summaries, moods, one-off task instructions, things the user only
> asked about, or anything you would struggle to quote them on.

That last clause is where `IGNORE_PATTERNS`' intent survives — as judgment rather than substring
matching.

A **skill** carries the long form: worked examples of the conversational edge cases.

- Sarcasm and self-deprecation — "I'm terrible at CSS", said after shipping a polished UI
- Aspiration versus fact — "I should really learn Rust"
- Venting that reads as a state change — "I'm done with this project", mid-frustration
- Third-party facts belonging in `circle`, not `profile`
- True today, not true next month
- Attribution: observations are restated as inferences, never as the user's own words

The docstring is the skill's summary, not a second copy. One source of truth, with the skill
linked from it.

## What gets deleted

| Location | Contents |
| --- | --- |
| `server.py:65-557` | `ConversationContext`, `SKILL_HIERARCHY`, `determine_skill_level`, `EXPLICIT_STATE_PATTERNS`, `detect_explicit_state_changes`, `SENTIMENT_MULTIPLIERS`, `TRIGGER_STRENGTH_BOOSTS`, `ENTITY_THRESHOLDS`, `calculate_evidence_boost`, `calculate_final_confidence_v2`, `get_action_from_confidence`, `deduplicate_suggestions`, `PRONOUNS`, `is_pronoun`, `resolve_pronoun_references`, `find_in_persona`, `cross_reference_persona`, `is_same_data`, `consolidate_suggestions_for_ux` |
| `server.py:3256-3648` | `CAPTURE_TRIGGERS`, `IGNORE_PATTERNS`, `KNOWN_SKILLS`, `KNOWN_CONCEPTS`, `analyze_message_for_capture` |
| `server.py:4282-4405` | `suggest_persona_update` body |

Roughly 1,000 lines, about a fifth of `server.py`. Every call site was traced: nothing outside
`server.py` references any of it, and the only in-file callers are within the capture path
itself (`server.py:3462`, `:3587`, `:3606`, `:3609`).

`_find_strong_match`, `normalize_data`, `ENTITY_SCHEMA`, and the search index all **stay** —
they are the validation layer `propose_update` leans on, and `persona_modify` already uses them.

### Archived, not destroyed

The removed pipeline moves to `backend/archive/capture_heuristics.py`, alongside the existing
`mcp_server_old.py` and `mcp_server.py`. It carries a header noting what it was and why it is
kept, and is excluded from imports and test collection. It was the first version of MyGist that
felt like it was paying attention; the receipt is worth keeping.

## Testing

- fingerprint dedupe increments `seen_count` rather than inserting
- rejection tombstone suppresses re-proposal of the same claim
- eviction prefers seen rows; unseen rows survive to the 100-row backstop
- eviction order respects `seen_count` ahead of `created_at`
- promotion creates the typed entity, deletes the note, sets `promoted_to`
- promoted entities carry the `agent-observation` tag
- notes appear in no scope — assert absence from `minimal`, `professional`, `personal`,
  `learning`, and `full`
- partial batch: invalid items rejected with schema excerpt, valid items stored
- missing `rationale` is `invalid`
- approving an entity proposal produces the same result as the equivalent `persona_modify` call

`test_tool_docstrings.py` and `test_mcp_contract_gaps.py` both need updating for the changed
tool surface.

## Non-goals

- **No auto-apply.** No confidence threshold writes to the persona. Explicit user instruction
  writes; inference proposes. This is the whole mental model and it should not acquire
  exceptions.
- **No per-section policy.** Configurable auto-apply per section is a plausible future, but it
  needs the inbox and settings UI to exist first.
- **No MCP access to the queue.** Agents cannot list, read, or resolve proposals.
- **No cap on the entity inbox.** Dedupe and tombstones bound it substantially. Whether it rots
  in practice is an empirical question; instrument first.
- **No `get_scoped_context` refactor.** The `goals` and `aesthetics` per-section hooks
  (`server.py:904`, `:929`) are worth folding into something declarative, but this design adds
  no third hook, so that cleanup stands on its own and is out of scope here.

## Risks

**The agent may not call it.** The keyword pipeline fired automatically when a substring
matched; `propose_update` fires only when an agent judges it should. If the docstring and skill
are not persuasive, capture rate could fall rather than rise. Mitigated by making the docstring
carry the full contract for clients that never see the skill — but this is the design's central
bet and should be measured after landing.

**Agents may over-propose.** The reverse failure. The required `evidence` field is the main
brake: an agent that must quote the user cannot propose freely. Eviction and dedupe absorb the
rest.

**`evidence` is unverifiable.** The server cannot check that a quote is real. It can check the
field is present and non-trivial, which is a weaker guarantee than it appears. Accepted:
the user reads the evidence when resolving, and a pattern of fabricated quotes from one client
would be visible in the queue.

## Open questions

- Should `proposed_by` be surfaced in the UI, or is it audit-only? It is available from the MCP
  client name but not reliably populated by every client.
- Does the Observations tab need search once it can hold fifty rows, or is that over-building
  for a list that should be kept short by design?
