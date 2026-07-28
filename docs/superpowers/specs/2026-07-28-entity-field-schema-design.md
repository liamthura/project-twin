# Entity field schema

**Date:** 2026-07-28
**Status:** Approved as the design of record. Deliberately NOT scheduled as a project — see "Sequencing". Accretes across waves 4-6.
**Sequel to:** `2026-07-27-section-editor-consolidation-design.md`, which deferred this as "reconciling `entities` with storage"

## Problem

MyGist has no machine-readable record of what it stores.

An entity's stored shape is decided by 45 hand-written `elif entity == …` branches inside
`execute_modify` (`backend/server.py`, 4,132 lines). Nothing else in the system can read
those branches, so every other subsystem maintains its own private guess at the same truth:

| Subsystem | Its model of "what fields exist" |
| --- | --- |
| `execute_modify` | 45 hardcoded per-entity branches — the only authority, unreadable by anything else |
| `FIELD_ALIASES` | 16 hand-maintained entries of accepted input spellings |
| `search_index.py` | `TITLE_FIELDS` / `TEXT_FIELDS` / `NESTED_LIST_FIELDS` — hardcoded name guesses |
| `ui` blocks in manifests | hand-authored storage keys, verified by a human reading `server.py` |
| `entities.required` / `.optional` | the MCP input vocabulary, served to clients by `get_schema` |
| `CANONICAL_STORED_KEY` | 16 more hand-verified entries, added in the wave 4 prerequisites |

Six models, one truth. They agree today only because people keep them in sync by hand.

### What that costs, concretely

**Guards cannot be written correctly.** The wave 4 prerequisites tried twice. A subset check
against `entities` was wrong in both directions — it accepted `contact` (an input alias for
`name`, never stored) and would have rejected `timestamp` (stored on every learning-log add,
absent from the entity vocabulary). The replacement, keyed on `FIELD_ALIASES`, was designed on
"index 0 is the canonical key"; that premise turned out to hold for 9 of 16 entries and to
break for `mental_tab` (stores `title`, index 3), `top_of_mind` (stores `idea`, absent from
its list entirely) and `curiosity` (stores `name`, index 4) — the first two being wave 4
entities. Both attempts were heuristics reconstructing a fact the system already knew.

**Search guesses.** `flatten_entity` picks a document title by matching against eleven
hardcoded field names, while every entity already declares an `identifier` one file away.
Twenty entities declare an identifier that is not in that list. It works today only because
the list was curated to fit the entities that happen to be indexed; a new entity whose fields
match nothing is skipped with no error and simply never found.

**Every migration wave repeats the same reading.** The consolidation spec mandates that each
wave begin by reading the section's bespoke editor and its `execute_modify` branch to
establish the real stored keys. That reading is done, discarded, and done again next wave.

**`profile` is unguarded entirely.** Its `kind: "fields"` section binds `name`,
`preferred_name`, `bio` and others that no current guard can check.

## The design

**Each entity declares its stored fields once. The keys of that declaration are the storage
keys. Everything else derives from it.**

```json
"connection": {
  "list": "connections",
  "id_prefix": "connection",
  "identifier": "name",
  "actions": ["add", "update", "remove"],
  "fields": {
    "name":         { "type": "string", "required": true },
    "relationship": { "type": "string" },
    "traits":       { "type": "string[]" },
    "notes":        { "type": "text" },
    "id":           { "type": "string", "managed": true },
    "related":      { "type": "ref[]",  "managed": true }
  },
  "input_aliases": { "name": ["person", "contact", "connection_name"] }
}
```

Three properties do the work:

- **There is no second vocabulary.** `fields` keys are storage keys by definition. Input
  spellings live in `input_aliases`, explicitly subordinate to a canonical key. The
  divergence that caused every problem above stops being expressible.
- **`managed: true`** marks system-written fields — `id`, `timestamp`, `related`. The UI may
  display them but never binds an editable control to them. This is what `display_fields`
  should have been: a property of the data, not a per-manifest opinion.
- **`type` is sufficient for every consumer** to infer its own behaviour, so no consumer needs
  its own field list.

### Type vocabulary

Six types plus one for nesting. A type earns inclusion by having a distinct control, a
distinct search treatment, or a distinct validation rule — and by being needed by real data.

| Type | Control | Search | Validation |
| --- | --- | --- | --- |
| `string` | single-line input | body text | string |
| `text` | textarea | body text | string |
| `string[]` | chip input | each entry a term | array of strings |
| `enum` | segmented ≤4, dropdown >4 | body text | member of `values[]` |
| `date` | date picker | body text | `yyyy-mm-dd`, non-ISO falls back to text |
| `ref[]` | read-only chips | not indexed | array of entity ids |
| `entity[]` | nested list | via the child entity | see nesting |

**`number` and `boolean` are deliberately excluded.** No entity field in the system is either:
all five numeric-sounding fields (`level`, `skill_level`, `detail_level`) are enums, and
`start_year`/`end_year` — the most number-like fields present — are stored as strings
(`persona_store.py:68-69` seeds `""`, `server.py:1616` writes `data.get(…, "")` with no
coercion). There is no `int()`/`float()`/`bool()` coercion anywhere in the persona write path,
and manifest `defaults` across all 11 packs contain only dict, list and str.

The asymmetry decides it: adding a type later is one additive line touching no existing
declaration, whereas adding one now invites a wrong answer on 39 entities. `start_year` reads
like a number; declaring it one would either fail the Phase A differential test or prompt
someone to coerce real user data from strings to integers to match the declaration. **The
migration rule is: declare the type the code actually writes, never the type the field name
suggests.** Numbers are not rejected at runtime either way — `listPipeline`'s comparator
already sorts real numbers numerically.

Add `number`/`boolean` when a field genuinely needs arithmetic or range semantics.

### Nesting: by reference

A parent field points at a child entity by name. The child keeps its own top-level entry.

```json
"work_experience": {
  "fields": {
    "company":    { "type": "string" },
    "role":       { "type": "string" },
    "highlights": { "type": "entity[]", "entity": "work_highlight" }
  }
},
"work_highlight": {
  "parent": "work_experience",
  "identifier": "highlight",
  "fields": { "highlight": { "type": "text" } }
}
```

Inline nesting reads better as a single schema but was rejected: `execute_modify` dispatches
on entity name, and `get_schema` exposes child entities as addressable targets, so folding a
child into its parent would change the MCP contract. By-reference keeps the flat,
name-addressable entity map exactly as it is.

Eleven entities carry a `parent` today. `parent` stays and gains a precise meaning: the entity
whose `entity[]` field references this one.

### What derives from `fields`

| Consumer | Derivation |
| --- | --- |
| `entities.required` | `fields` where `required: true`, excluding `managed` |
| `entities.optional` | remaining non-`managed` `fields`, plus every `input_aliases` spelling |
| `FIELD_ALIASES` | flattened `input_aliases` across entities |
| `valid_values` | `fields` of type `enum`, their `values[]` |
| search title | the `identifier` field |
| search body | `string`, `text`, `enum`, `date` fields |
| search terms | `string[]` entries, and `entity[]` children via their own entity |
| `ui` guard | `ui` field ∈ `fields` keys — enforced at manifest load, not only in tests |
| write validation | type and `required` per field; `managed` fields rejected from client input |

`required`/`optional` are **derived, not stored**. That is the actual dedupe: two hand-
maintained lists that can drift collapse into one declaration. `get_schema`'s output must not
change — see Phase A.

## Why this is safe: derive, then verify

The design is not the risk; the migration is — 45 branches over real user data. So **the
declaration is verified against the incumbent implementation before anything depends on it.**

### Phase A — declare, change nothing

Add `fields` and `input_aliases` to all 39 entities, derived by reading each `execute_modify`
branch. Then add two differential tests:

1. **Write-shape test.** For each entity, drive its existing `execute_modify` branch with
   generated input and assert the set of keys it writes is exactly the declared non-`managed`
   `fields` keys plus the `managed` ones the branch sets. This proves the declaration matches
   reality.
2. **Contract test.** Assert the derived `required`/`optional`/`valid_values` reproduce
   today's `get_schema` output byte-for-byte for every entity.

Nothing changes at runtime. `fields` is inert documentation with tests proving it true, and
both tests stay in CI permanently so drift fails the build.

**This is the entire safety argument.** It is the difference between "we believe this is the
schema" and "the running code agrees this is the schema". Every later phase depends on Phase A
having been done honestly, which is why the write-shape test must exercise the real branch
rather than a reimplementation of it.

**Scope: all 39 entities in one pass.** Doing it per-wave would leave the system on two models
at once and repeat the reading three more times.

### Phase B — consumers read it

Guards, search and `ui` validation switch over. The write path is untouched.

- The `ui` guard becomes `set(ui_fields) ⊆ set(fields)`, enforced in `pack_loader` at load. A
  typo becomes a startup error instead of silent data loss.
- `search_index` reads `identifier` and types; the three hardcoded lists are deleted.
- `FIELD_ALIASES` and `CANONICAL_STORED_KEY` become derived and their literals are deleted.

Each is independently revertible.

### Phase C — collapse the write path

Replace `execute_modify` branches with the generic write path **one entity at a time**, each
gated by its Phase A write-shape test now acting as a regression test. Independently
verifiable, independently revertible. Branches with genuine special behaviour (cross-entity
forwarding such as `curiosity` → `interest`, or `career_aspiration` → `goal`) stay hand-written
and are documented as deliberate exceptions rather than quietly skipped.

## What gets deleted

| Deleted | Replaced by |
| --- | --- |
| `FIELD_ALIASES` literal, 16 entries | derived from `input_aliases` |
| `CANONICAL_STORED_KEY`, 16 entries | redundant — `fields` keys are canonical by construction |
| `search_index.TITLE_FIELDS` / `TEXT_FIELDS` / `NESTED_LIST_FIELDS` | `identifier` + `type` |
| `test_ui_fields_are_covered_by_the_entity` and the alias check | one set-membership test that is correct |
| `entities.required` / `.optional` literals in 39 entities | derived |
| Most of 45 `execute_modify` branches | the existing generic write path |

## Sequencing

**Revised 2026-07-28, before any work started. This does not run before wave 4.**

The original recommendation was Phases A and B ahead of wave 4. Checking guard coverage per
wave showed that was wrong, and the reasoning is recorded here so it is not relitigated.

| Wave | Alias-guard coverage after the wave 4 prerequisites |
| --- | --- |
| 4 — `projects`, `knowledge` | Main list entities **covered**: `project`, `top_of_mind`, `domain`, `mental_tab` — including the two that broke the alias heuristic. Child entities and `knowledge` itself are not |
| 5 — `lifestyle`, `preferences` | Near-total gap. `preferences` has no covered entity at all |
| 6 — `profile` | `work_experience`, `education` and `basic_info` uncovered |

Wave 4 is the best-covered wave remaining, so blocking it on this project buys the least.

Two further facts weigh against front-loading it:

- **No guard has yet caught a real bug.** Every trap found — `contact`, `new_topic`,
  `mental_tab` storing `title`, `top_of_mind` storing `idea` — was found by a human reading
  `execute_modify`, which the consolidation spec already mandates as each wave's first step.
  The guards are regression protection against future edits, not discovery tools. The checks
  that have repeatedly caught real defects are the frontend round-trip and coverage guards,
  which already exist and are cheap.
- **The reading is not avoidable work this project eliminates.** It happens every wave either
  way. Phase A only moves it earlier and adds the differential harness on top.

**Revised plan: accrete, do not detour.**

1. Waves 4–6 proceed as planned. Each wave's mandated reading of `execute_modify` now also
   **writes down what it found** as `fields` on the entities it touched, instead of
   discarding it. Cost per wave is near zero — the reading is happening regardless.
2. Build the Phase A differential harness once, when enough is declared to justify it.
   Revisit before wave 5, where the coverage gap is genuinely severe.
3. Phases B and C follow only if the accreted declaration proves its worth.

Stopping at any point loses nothing: a partial `fields` declaration is still accurate
documentation of what was read, verified by whatever harness exists at the time.

## Non-goals

- **Changing the MCP contract.** `get_schema` output is asserted unchanged in Phase A. Input
  aliases keep working. Clients see no difference.
- **Changing any stored JSON.** This describes what is stored; it does not restow it.
- **`preferences`' legacy flat shape.** Still needs the normalisation wave 5 plans.
- **Retyping existing data.** No coercion, in either direction.
- **Rewriting `search_index`'s ranking or embedding.** Only where it gets its fields from.

## Risks

| Risk | Mitigation |
| --- | --- |
| A `fields` declaration is wrong | Phase A's write-shape test fails before anything depends on it. This is the design's whole point |
| Deriving `required`/`optional` changes what MCP clients see | Phase A asserts byte-for-byte parity with today's `get_schema` output, per entity |
| Phase C breaks a write path | One entity at a time, each gated by its own regression test, each revertible |
| A branch has behaviour no schema can express | It stays hand-written and is documented as a deliberate exception, not skipped silently |
| The effort stalls half-migrated | Phases A and B are complete and valuable on their own. Phase C is optional and incremental |
| `type` proves too narrow | Adding a type is additive and touches no existing declaration — the reason `number`/`boolean` were deferred rather than guessed |

## Open questions

None. The three design decisions raised during proposal — type vocabulary, nesting strategy,
and whether `required`/`optional` are kept or derived — are resolved above.
