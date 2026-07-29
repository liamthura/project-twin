# Wave 7 — closing the recorded MCP contract gaps

**Date:** 2026-07-29
**Branch:** `feat/wave-7-mcp-contract`
**Predecessors:** waves 2–6, the section-editor consolidation
([spec](../specs/2026-07-27-section-editor-consolidation-design.md))

The consolidation is finished: seven bespoke editors gone, 6,332 lines deleted,
`frontend/src/editors/` no longer exists. What it left behind is a list. Each
wave read one section's storage keys against its `execute_modify` branches and
recorded what did not line up, deferring the fix so the wave stayed a wave.
Twelve such follow-ups accumulated across waves 5 and 6, of which four were
taken back into wave 6 as it went.

This wave closes the remaining eight. It touches no renderer and no UI.

---

## 1. Why these eight are one thing

They look like eight unrelated small bugs. They are eight instances of a single
failure: **what an MCP client can do diverges from what `get_schema` says it can
do**, in either direction.

| Direction | Instances |
|---|---|
| Contract promises what the code does not do | `work_experience.highlights` on update; `link.update` absent from the branch but the entity read as complete |
| Code does what the contract never mentions | `stance` — the key that decides which entity a row *is* |
| Neither contract nor code offers it | `wellness.stress_triggers` — a stored key, a UI node, and no entity at all |
| Code is more restrictive than any reader expects | `basic_info` and `hobby.notes` — writable, never clearable |
| Code is less restrictive than any reader expects | `preference` replacing a stored list with a bare string |
| Two implementations of one contract | `coursework_topic`, a verbatim copy of `coursework` |

The point is not that each is small. It is that **not one of them was found by a
guard**. Every one came out of reading a branch beside its manifest entity. The
guards are a ratchet — they stop new divergence being introduced silently — but
they do not audit what is already there, because nothing in the repo is a
machine-readable authority on what the 38 `execute_modify` branches write. That
authority is the sequel the spec has carried since wave 4, and this wave is the
last of the evidence-gathering for it.

---

## 2. The eight

### 2.1 `link` gains `update` — wave 6 follow-up 5

Add and remove only. Fixing a typo'd URL meant remove + re-add, which loses the
link's position in the list.

`label` is the identifier, so a rename needs a second key: `new_label`. Without
it, a `label` in the payload is ambiguous between "find this row" and "call it
this", and the branch has to guess.

### 2.2 `basic_info` can clear a field — wave 6 follow-up 6

`if data.get(field)` skips the empty string, so all seven fields could be set
over MCP and never emptied again — a `bio` written once was permanent.

Switched to presence. `name` keeps the old guard: it is what most readers title
the persona with, and a blank there degrades every downstream context. A cleared
field also has to count as `updated`, or the branch returns its "requires at
least one of" error for a request it actually honoured.

### 2.3 `hobby.notes` can be cleared — wave 5 follow-up 5

Same idiom, same effect. One wrinkle: `notes` collapses three input spellings
(`notes`/`description`/`details`), so the presence test has to check all three,
or clearing works under one name and silently no-ops under the others.

### 2.4 `work_experience.update` accepts `highlights` — wave 6 follow-up 7

`highlights` sat in this entity's `optional` and was honoured by `add` — but not
by `update`. So once a row existed, `work_highlight` was the only way to touch
them, and `work_highlight` only appends: there was no path to remove the last
highlight from a job.

Same wholesale replacement `skills` got in wave 6, which is what makes `[]` a
clear rather than a no-op.

This is a **phantom-key bug in miniature**: a declared field, written by one
action and dropped by another. The standing example, `sleep.day_type`, is the
same shape — a declared key no branch stores, passing both guards.

### 2.5 `coursework_topic` stops duplicating `coursework` — wave 6 follow-up 4

Two branches, one file, one list, one object shape, bodies identical line for
line. Any future fix had to be made twice or the two would drift.

Now one branch, two entity names. The alias lists are merged (`course` still
first, so no existing caller changes meaning); the only behaviour change is that
each entity also answers to the other's spelling. Messages still name the entity
that was called. `coursework_topic` stays in the vocabulary because clients call
it — it just stops being a copy.

### 2.6 `like`/`dislike` declare `stance` — wave 5 follow-up 4

`stance` is the key that decides which entity a `likes_dislikes` row *is*, and it
was in neither entity's `required` nor `optional`. No MCP client could see it
existed. The UI needed it, so the manifest declared it through
`fields_outside_entity` — deliberately, at the time, because adding it to the
entities would have changed the MCP vocabulary as a side effect of a UI change.

Wave 7 makes that vocabulary change on its own terms. `stance` is `optional` on
both entities with its two valid values, and an explicit value now beats the
entity-implied default — so `update` can flip a row without the client having to
know it must address it through the *other* entity. The `fields_outside_entity`
declaration is gone, which means the node's `stance` binding is now checked
against the vocabulary like every other field.

### 2.7 `stress_trigger` — wave 5 follow-up 2

`wellness.stress_triggers` had a seeded default, a UI node, and an editor. It had
no entity and no `execute_modify` branch. An AI client could read the value in
context and never change it.

New branch mirroring `energy_peak`: same sub-object, same bare-string list, same
case-insensitive dedupe. Deliberately **not** given a `list` key in its manifest
entity, so `_generic_entity_spec` returns `None` and it stays out of
`ADVISORY_ENTITIES` — a plain-value list has no ids, so a duplicate advisory
could not resolve to an `entity_id`. Same reason `energy_peak` and
`personality_trait` are excluded.

### 2.8 `preference` cannot overwrite a list with a scalar — wave 5 follow-up 3

`preference` is the generic escape hatch: it writes any key under any category.
That let it replace a stored list — `code_style.tools`,
`learning_style.preferred` — with a bare string, a shape no reader expects and
no other branch can produce.

Closed with a guard rather than with dedicated entities, which was the other
option recorded. Replacing a list is still allowed; doing it with a scalar is
not; `remove` is the escape hatch, so a key that became a list can still go back
to being something else.

---

## 3. What the work turned up that was not on the list

### 3.1 The meta-schema rejected `$comment` on an entity

Every provenance note in this wave wanted to live next to the entity it explains.
`uiSection` has had `$comment` since wave 2 for exactly this; `entity` did not,
and `additionalProperties: false` meant the profile pack **failed to load
entirely**.

This is the second time this exact trap has fired — wave 6 put `exclusive_fields`
in the `uiSection` block instead of the `entity` block and the aesthetics pack
was silently skipped, surfacing much later as `"❌ Unknown entity type:
aesthetic"`. It surfaced immediately this time only because `profile` is a
**core** pack, so `sections._check_core` raises rather than warns.

Worth noting as a standing hazard: for a non-core pack, a meta-schema violation
is a warning and a missing section, not an error.

### 3.2 `$comment` was reaching MCP clients

Adding it to the entity schema revealed that `pack_loader.build_entity_schema`
passes entity dicts through wholesale — so an authoring note would have shipped
inside `get_schema`'s output as part of the tool contract. That directly
contradicts what the meta-schema promises: `description` is the client-facing
text, `$comment` is for the next author.

Dropped in the loader rather than left to each reader, with a test asserting no
`$comment` survives into `ENTITY_SCHEMA`.

---

## 4. Verification

- **643 backend tests pass** (609 before; 34 new in
  `backend/tests/test_mcp_contract_gaps.py`).
- **398 frontend tests pass**, build clean. No renderer or UI file changed; the
  frontend moved only because `src/__fixtures__/packs.json` is generated from the
  manifests.
- `tests/fixtures/registry_golden.json` moved, and was diffed entity by entity
  first. Exactly four entities changed — `profile.link`, `preferences.like`,
  `preferences.dislike`, and the new `lifestyle.stress_trigger` — and nothing
  else. The test's docstring records the move and why, per its own rule that the
  fixture is only allowed to move for a deliberate contract change argued on its
  own terms.

---

## 5. What remains open

The follow-up lists in the wave 5 and wave 6 reference documents are now fully
struck through. Nothing is deferred out of this wave.

What is **not** closed is the thing all twelve were evidence for:

> The phantom-key hole is unclosed. An entity-bearing node is checked for
> spelling and aliases, never for whether a key is actually written.
> `sleep.day_type` is the standing example — a router that is never stored and
> passes both checks. §2.4 of this document is the same bug in a smaller form,
> and it survived six waves of reading.

Closing it needs a machine-readable authority over what the 38 `execute_modify`
branches write. It is now as well-resourced as it will get without doing it:
three storage-key reference documents, twelve worked examples of the failure, and
a test file that states the class rather than the instances.

Also still open, from the consolidation spec and unchanged by this wave:
`ListRenderer.jsx` at ~560 lines against a ~200 budget; `describeGuards`
locating a node by `path[0]` and so unable to address a nested list; no Storybook
story for any migrated section.
