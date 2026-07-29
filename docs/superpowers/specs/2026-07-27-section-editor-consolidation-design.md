# Section editor consolidation

**Date:** 2026-07-27
**Status:** Approved, not started
**Branch:** `feature/section-renderer-kit`

## Problem

The frontend carries seven hand-written section editors totalling 6,050 lines, plus a
282-line `GenericSectionEditor` that renders section packs declaratively from a manifest.
The two paths have diverged: the bespoke editors have search, collapsible cards and info
dialogs the generic one lacks; the generic one has suggestion chips, enum controls with
`custom_*` overflow and `field_defaults` the bespoke ones lack. Every new section-level
feature has to be written twice, and in practice only ever gets written once.

The goal is a single renderer that drives every section, so section behaviour is defined
once in code and laid out per-section in the manifest.

## What is actually there

The headline "6,050 versus 282" is not a like-for-like ratio. `GenericSectionEditor`
renders exactly one shape — a top-level list of flat objects — and four distinct shapes
exist across the seven sections:

| Shape | Occurrences | Supported today |
| --- | --- | --- |
| Flat list of objects | 14 lists across all seven sections | yes |
| Child list nested inside a list item | 11 entities in `knowledge`, `lifestyle`, `profile`, `projects` | no |
| Singleton object of scalars | `profile.basic_info`, `preferences.communication_default` | no |
| Top-level array of strings | `lifestyle.personality_traits`/`values`, `preferences.code_style.*` | only as a field |

The dominant missing capability is **nested child lists**, not `profile` specifically.
Eleven entities across four sections already carry a `parent` key in their manifests
(`project_tag` → `project_name`, `coursework` → `institution`), so the backend vocabulary
for nesting exists. Only the renderer is missing.

Current file sizes:

| Section | Lines | Shapes present |
| --- | --- | --- |
| `learning_log` | 331 | one flat list |
| `circle` | 471 | one flat list |
| `preferences` | 478 | nested groups, singleton, nested list |
| `projects` | 1,021 | two lists, child lists, enums |
| `knowledge` | 1,138 | two lists, child lists, enums |
| `lifestyle` | 1,165 | four lists, child lists, nested `wellness` group |
| `profile` | 1,446 | singleton, two lists, two levels of child list |
| `GenericSectionEditor` | 282 | flat lists only |

Two things already work in our favour:

- `ui` is plumbed through the API end to end — `backend/sections.py:80` puts it in
  `PACK_META`, `backend/main.py:411` serves it. **No new backend endpoints are needed.**
- Only `goals`, `media` and `aesthetics` currently ship a `ui` block that is read.
  `lifestyle` has a partial one for `interests` that nothing consumes, because `lifestyle`
  is in `BESPOKE_EDITORS`.

One latent hazard: `backend/section_packs/meta_schema.json` declares `"ui": {"type":
"object"}` and validates nothing inside it. That is tolerable while `ui` drives three
optional packs. Once it drives the whole editing surface, a typo in a `ui` block becomes
silent data loss — a field that stops rendering, and therefore stops saving.

## The critical constraint: `entities` is not a storage schema

For the three generic packs (`goals`, `media`, `aesthetics`), an entity's field names are
the keys written to storage — the generic write path at `backend/server.py:2555` stores
what it is given.

For the seven legacy sections this is **not** true. Each has a hand-written branch in
`execute_modify` — 37 such branches exist — and those branches normalise aliases before
writing. Two confirmed examples in `profile`:

| Manifest declares | Actually stored | Where |
| --- | --- | --- |
| `language.proficiency` | `fluency` | `server.py:1410` aliases `fluency`/`level`/`proficiency`, stores `fluency` |
| `education.degree`, `.field`, `.period` | `degree_level`, `field_of_study`, `start_year`, `end_year`, `status` | `persona_store.py:63`, `ProfileEditor` |

So `entities` describes **the vocabulary an MCP client may pass**, and the hand-written
handler maps it onto the stored shape. It is a tool contract, not a schema.

**Consequence for this design:** `ui` cannot inherit field names from `entities`. A `ui`
block built on `education.degree` would render a control bound to a key that does not
exist, show blank, and write that blank on first save — exactly the silent-data-loss mode
this project must avoid.

**Decision: `ui` declares storage keys directly.** `entities` is left completely untouched,
so no MCP client behaviour changes. Where a `ui` node needs enum options, it may carry an
`enum` key inline, or reference `entities` via an explicit `enum_from` — never by
assuming the field names match.

Reconciling `entities` with storage, and collapsing the 37 bespoke `execute_modify`
branches onto the generic write path, is the obvious sequel to this work. It is a backend
project with its own risk profile, and it is explicitly **out of scope** here — folding it
in would place the MCP contract that AI clients depend on inside a frontend refactor.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| UI parity vs convergence | **Converge** | Migrated sections adopt the generic UI. Only features worth having everywhere (search, info tips) get promoted into the renderer. Parity would move the per-section complexity into the renderer rather than removing it. |
| Scope | **All seven** | Including `profile` and `preferences`, which requires the renderer to learn singletons and nested groups. |
| Architecture | **Recursive renderer kit** | Small units under `frontend/src/renderers/`, not one growing component. Nesting falls out of recursion; no file exceeds ~200 lines. |
| Field binding | **`ui` declares storage keys** | `entities` stays the MCP vocabulary. See the constraint above. |
| Test net | **Vitest + Testing Library + Storybook** | Stories run as tests via `@storybook/addon-vitest`, so a story cannot drift from what is verified. |
| Vite upgrade | **Vite 5 → 7 first, separate PR** | Required by Vitest 4. Kept apart so a build-tool failure never gets tangled with a rendering failure. |
| New UI primitives | **Adapt a shadcn-registry component before hand-rolling** | Don't reinvent the wheel: components land as editable source on the same Radix base, so tweaking beats maintaining bespoke. Non-shadcn libraries are out regardless of looks, and anything adopted is converted to the existing design tokens. See "Sourcing UI primitives". |

## Architecture

```
frontend/src/renderers/
  SectionRenderer.jsx   walks ui.sections and dispatches each node by kind
  ListRenderer.jsx      list of objects — rows, add dialog, remove; recurses into children
  FieldGroup.jsx        labelled group of fields over the object at a path
  ScalarField.jsx       text | textarea | enum (+ custom_*) | ArrayInput
  paths.js              getAt / setAt / removeAt — immutable updates at a path
```

`paths.js` is the load-bearing piece. Every bespoke editor today hand-writes its own spread
chain for updates — `PreferencesEditor.jsx:58` is three levels deep:

```js
onChange({ ...data, communication: { ...comm, default: { ...comm.default, [field]: value } } })
```

A path-based setter collapses all of those into one code path, which is what makes
arbitrary nesting tractable at all.

`GenericSectionEditor.jsx` is deleted. `App.jsx` renders `SectionRenderer` for every
section, and `BESPOKE_EDITORS` disappears along with the seven editor files.

Each unit's contract:

- **`SectionRenderer`** — given `pack`, `data`, `onChange`, `onShowConfirmation`, renders
  the pack's `ui.sections`. Owns nothing but dispatch and the section `Card`.
- **`ListRenderer`** — given a `list` node and the array at its path, renders rows and
  edit controls. Calls back with a whole replacement array. Recurses by rendering child
  nodes against each item.
- **`FieldGroup`** — given a `fields` node and the object at its path, renders labelled
  controls. Used for section-root singletons and nested groups alike.
- **`ScalarField`** — given a field spec, picks a control. Knows about inline enums,
  `custom_*` overflow and long-text fields.

## The `ui` schema

Three node kinds. A `list` node may carry `children`, which is where recursion enters.

```json
"ui": {
  "sections": [
    {
      "kind": "fields",
      "title": "Basic info",
      "path": [],
      "fields": ["name", "preferred_name", "current_role", "organisation", "location"],
      "long_text": ["bio"]
    },
    {
      "kind": "list",
      "title": "Education",
      "path": ["education"],
      "title_field": "institution",
      "badges": ["degree_level", "status"],
      "detail_fields": ["field_of_study", "start_year", "end_year"],
      "array_fields": ["highlights"],
      "children": [
        {
          "kind": "list",
          "title": "Coursework",
          "path": ["coursework"],
          "title_field": "course",
          "array_fields": ["topics"]
        }
      ]
    },
    {
      "kind": "strings",
      "title": "Preferred languages",
      "path": ["code_style", "preferred_languages"]
    }
  ]
}
```

Rules:

- `path` is relative to the parent node's path. A child node's path resolves against the
  list *item*, not the section root.
- **All field names are storage keys.** Note `degree_level` and `field_of_study` above,
  not the manifest's `degree`/`field`.
- Enum options come from an inline `enum` map on the node, or `enum_from: "<entity>"`
  where an entity's `valid_values` genuinely match the stored keys. The three generic
  packs use `enum_from`; the legacy sections declare inline until the backend sequel
  reconciles them.
- `kind: "strings"` renders an `ArrayInput` over an array of plain strings. Confirmed
  string arrays are `lifestyle.personality_traits`, `lifestyle.values`,
  `lifestyle.wellness.energy_peaks`, `preferences.code_style.*` and
  `preferences.learning_style.*`. `profile.languages_spoken` is **not** one — it holds
  `{name, fluency}` objects and is a `list` node.
- `kind: "fields"` with `path: []` addresses the section root, which is how `profile`'s
  top-level scalars are rendered.

### Backwards compatibility

`goals`, `media` and `aesthetics` ship the old flat `ui` map, and `_template` invites users
to author their own packs. The new schema is therefore a strict superset: a `ui` object
with no `sections` key is normalised at load into

```
sections: [ { kind: "list", path: [key], ...value } for each key ]
```

Existing packs keep working with no manifest change. The three in-repo packs are moved to
the explicit form in wave 2 for consistency, but nothing forces that on a user's pack.

**One narrowing, added in the wave 4 prerequisites.** A node in the explicit form with
`kind: "list"` must now declare `entity`. It was previously optional, and an entity-less
list node was silently skipped by both `ui` guards while still rendering and writing
normally — so a control could bind to a key nothing reads with nothing to catch it. The
promise above still holds where it was aimed: the legacy flat map is normalised, not
rejected, and no pack using it is affected. What changed is a requirement inside the
explicit `sections` form, which wave 2 introduced days earlier and which no third-party
pack can plausibly be using yet. A pack that does hit it fails validation, and `load_packs`
warns and skips that pack rather than refusing to boot — so the section disappears rather
than taking the server down. That is the deliberate trade: a missing section is recoverable,
an unchecked editable node writing unreadable keys is not.

`meta_schema.json` gains a real `ui` definition — node kinds, required keys per kind,
recursive `children` — replacing today's unvalidated `{"type": "object"}`.

## Data safety

**No section changes its stored JSON shape.** The renderer reads and writes exactly the
paths the bespoke editors do. There is no data migration for the seven sections, with the
one exception below.

Because `entities` cannot serve as the reference for what fields exist, the completeness
guard is driven by **populated fixtures** instead:

1. **Fixture coverage test (vitest).** Each section has a fixture populated with every key
   the app actually stores, captured from real persona shapes. The test renders the section
   and asserts every leaf key in the fixture is reachable in the UI. A `ui` block that
   forgets a field fails here. This replaces a naive manifest-versus-`ui` comparison, which
   would be wrong for the legacy sections.
2. **Round-trip test (vitest).** Render from that fixture, simulate an edit at one path,
   assert the `onChange` payload deep-equals the input everywhere except that path.
   Catches drop-on-write, which coverage alone cannot.
3. **A story per section**, driven by the real manifest and the same fixture. This is how
   each converged section gets visually signed off before its PR merges — necessary
   because we chose convergence over parity, so every section's appearance changes.

A narrower pytest check still applies to the three generic packs, where entity fields *are*
storage keys: every field in `entities[*].required + optional` must appear somewhere in
that pack's `ui`. It is not extended to the seven, for the reasons above.

### The `preferences` legacy-format landmine

`PreferencesEditor.jsx:35` (`getComm`) carries a silent migration: stored data in the old
flat shape (`communication.tone`) is rewritten to the nested shape
(`communication.default.tone`) **on read, and persisted only if the user happens to edit
that section**. Any profile never edited since the format changed is still stored flat.

A generic renderer reading `communication.default.*` against flat data shows blank fields,
and the next save writes those blanks — the user's communication settings disappear.

Therefore: **normalisation moves into the backend and runs over stored data before
`PreferencesEditor` is deleted.** This lands in wave 5, ahead of the `preferences`
migration in the same PR, with a test that exercises it against a record in the old shape.
`persona_store.py:45` already hosts equivalent legacy migrations for `profile` and is the
natural home.

This is the only place in the project where the consolidation touches stored data.

### Known gaps in the wave 1 harness

The whole-branch review of wave 1 (PR #14) surfaced two scope calls worth carrying into
wave 3's plan rather than fixing retroactively in wave 1:

1. **The fixtures do not yet represent the shapes waves 3-6 must migrate.** `goals`, `media`
   and `aesthetics` are flat lists of objects. Production data for the seven legacy sections
   contains top-level scalars beside lists, nested objects three levels deep, arrays of
   primitives, arrays nested inside list items, and numerous fields stored but absent from
   the manifest. Each section's own wave must ship a fixture carrying its real shape — the
   three generic-pack fixtures from wave 1 are not a template for that shape, only for the
   two guards.
2. **Three untested behaviours in `GenericSectionEditor` that wave 3 must cover.**
   - **`onChange` sibling-key preservation.** `GenericSectionEditor.jsx:274` spreads `data`,
     but every current fixture's `data` has exactly one key, which *is* the list. A renderer
     that rebuilt `data` from the `ui` keys alone rather than spreading the original object
     would drop top-level scalars like `profile.name` and still pass every wave 1 test.
   - **Add and delete are untested entirely.** `renderSection` (`frontend/src/test/harness.jsx`)
     omits the `onShowConfirmation` prop that `App.jsx:683-687` always passes, so `removeItem`
     takes the no-confirmation branch in every wave 1 test — a branch production never takes.
   - **`updateItem` deletes a key whose value becomes `""`** rather than storing an empty
     string. This is a real persistence decision (an edited-to-blank field disappears from
     storage rather than persisting as `""`) that nothing in wave 1 pins down; a future
     refactor could flip it either way without a test noticing.

Also: `goals` declares `custom_type` in its entity's `optional` list, but no `ui` block
references it. The completeness check this spec proposes for the generic packs (every field
in `entities[*].required + optional` appears somewhere in that pack's `ui`) would fail on
`goals` as it stands today. That needs resolving — either by wiring `custom_type` into the
`goals` `ui` block or by removing it from the manifest — before that check is written.

### Known gaps in the wave 2 renderer kit

The whole-branch review of wave 2 (PR #15) found and fixed several correctness issues in
`ListRenderer`/`ScalarField`/`SectionRenderer`/`paths.js`/`meta_schema.json` directly (schema
gaps for `kind: "fields"` and a shapeless `enum`, node-metadata precedence for `optional` and
`long_text`, a crash on an entity-less node, and a couple of silent-data-loss paths). One
structural item was found and deliberately **not** fixed in that pass, because fixing it is a
refactor in its own right, not a bug-sized patch:

**`SectionRenderer` has no seam to dispatch a child node.** The `kind` switch that picks a
renderer for each node is inline JSX living inside `SectionRenderer`'s own `CardContent.map` —
it cannot be invoked for a node that isn't a direct child of the section root without dragging
the `Card`/`CardHeader` wrapper along with it. It also binds every path it renders
(`getAt(data, node.path)`, `setAt(data || {}, node.path, next)`) to the section root, not to a
list item, so it has no way to resolve a child node's path against `data[item]` instead of
`data`. And `SectionRenderer` imports `ListRenderer` directly, so `ListRenderer` recursing back
into `SectionRenderer` for its `children` would be an import cycle.

None of this blocks wave 2, because no in-repo pack declares `children` yet and nothing calls
for recursion. But `education.children[0]` (`Coursework`, nested inside `Education`) is real
wave-4/5 shape from this spec's own `## The ui schema` example, and the fix is a one-commit
refactor — extract the dispatch into its own module as a `renderNode(node, value, onValue)`
seam that both `SectionRenderer` and `ListRenderer` can call — that has to land **before**
wave 4 starts, not be improvised inside it under that wave's own deadline pressure.

Also noted in passing: `key={node.path.join(".")}` (`SectionRenderer.jsx`) collides for any
two nodes that happen to share a path — nothing in today's three packs does, but nothing
stops a future manifest from declaring two sibling nodes over the same list either.

### Known gaps after wave 3

Wave 3 migrated `learning_log` and `circle` and added six capabilities to `ListRenderer`
(`@now` field defaults, display `sort`, `searchable`, `info`, read-only `display_fields`, and
an `expanded` remap across add and remove). Data safety was verified against `server.py`
directly: no phantom fields, no unreachable editable key, every unmodelled key round-trips.
Four items are carried forward rather than fixed.

**The backend ui-field guard is anti-correlated with the risk it appears to cover.**
`backend/tests/test_ui_schema.py::test_ui_fields_are_covered_by_the_entity` asserts a `ui`
block's fields are a subset of `entity.required + entity.optional`. That is the wrong
direction on both sides. It *accepts* MCP-only input aliases — `contact` is in
`connection.optional`, so a `ui` block declaring the exact trap this spec warns about would
pass green — and it *rejects* legitimate storage keys absent from the entity vocabulary, which
is why `display_fields` had to be left out of the check for `timestamp` to be declarable at
all. The only thing actually guarding the phantom case is one frontend test per pack. Before
wave 4 migrates `projects`, `knowledge` and `profile` — the sections where manifest names and
storage keys deliberately diverge — this guard must be reworked against a real source of truth
for storage keys, not merely have the divergent packs omitted from its list to keep it green.

**`display_fields` is unguarded.** No test asserts that a key declared there is real. The
`learning_log` case is covered incidentally, because its section test derives the expected
badge text from the fixture's own `timestamp`. A cheap general guard does not exist for the
same reason as above: there is no authority on storage keys short of the deferred backend
reconciliation.

**`ListRenderer` has breached the file-size budget.** This spec promised no file above ~200
lines; `ListRenderer.jsx` is now past 400 — one component, five `useState` hooks and a
four-stage derived pipeline (`order` → `visible` → badge strip → `editFields`), before wave 4
adds `children` recursion. It has **not** become what it replaced: there is no `pack.key`
branch anywhere and every capability is manifest-driven and optional-guarded. But the
order/filter pipeline and the badge strip should be extracted alongside the `renderNode`
dispatch refactor above, in the same wave-4 prerequisite commit.

**Test-selector fragility.** Row delete buttons are icon-only with no accessible name, and
existing tests select them with `getAllByRole("button").filter(b => b.textContent === "")`.
The info button added in wave 3 is also icon-only and renders *before* the rows, so the first
wave-4 test that needs a delete button on a node declaring `info` will click Info instead —
failing confusingly, or passing for the wrong reason. Giving the delete button an
`aria-label` fixes it without breaking the `textContent` filter.

Convergence losses in wave 3 that were not on the original drop list, recorded so the pattern
is visible rather than rediscovered: field placeholders (`"e.g. React Server Components"`),
the `"Untitled entry"` / `"Untitled connection"` fallbacks, and `circle`'s fifth info tip. The
date badge *was* restored, as `display_fields`.

### Stored-data exception, taken in wave 4

This spec's non-goals forbid changing stored JSON, with `preferences` normalisation as the sole
exception. Wave 4 took two more, deliberately and with the user's approval, both in
`persona_store._normalize` and both of the same kind: **backfilling a legacy shape so that
deleting a bespoke editor does not make existing rows unreachable.**

- A bare-string `top_of_mind` entry becomes `{idea: "<string>"}`. Left alone it renders as
  "Untitled entry" with no reachable content once `ProjectsEditor` is gone, and being a string
  it could never carry an `id`, be linked, or be indexed.
- A `mental_tabs` entry carrying only the legacy `topic` gains a `title`. Left alone it renders
  blank once `KnowledgeEditor` is gone. `topic` is never removed — where the two differ the
  entry is MCP-addressable by either, and dropping one removes an address.

Both are idempotent, neither clobbers an existing value, and the `topic` backfill is
read-neutral because all four `server.py` read sites already compute `title or topic`, so they
now reach the same value through the first branch. `search_index` already ranks `title` above
`topic`, so the indexed title is unchanged.

**One guard was needed.** The backfill is *not* read-neutral under a name collision: if tab A
stores `{topic: "X"}` and tab B stores `{title: "X"}`, backfilling makes a title lookup resolve
A rather than B, so an MCP `remove` deletes the wrong tab. The backfill therefore skips any
entry whose `topic` matches another tab's title — including a title backfilled earlier in the
same pass, so two topic-only duplicates cannot both claim the same name. Such a tab keeps
rendering blank and stays addressable by `topic`. A visible gap beats a wrong deletion.

The principle worth carrying to waves 5 and 6: a migration that only *enables* an editor
deletion is in scope for the wave doing that deletion. Restructuring stored data for any other
reason is not, and still belongs to the deferred backend reconciliation.

### State after the wave 4 prerequisites

The three items above are addressed, with one exception and one carry-forward.

**The `renderNode` seam exists and is half ready.** `frontend/src/renderers/renderNode.jsx` takes
`value` and `onValue` as arguments rather than deriving them from a section root, so a caller
*can* resolve a child's path against a list item. That was the part that mattered. But its only
future caller cannot supply two of its six parameters: `ListRenderer` receives a single
**resolved** `entity` object and no `packKey`, while `renderNode` needs the whole `entities` map
and the pack key. Calling it from inside a row today would pass `entities: undefined`, so every
child node's `valid_values`, `field_defaults` and `optional` would silently degrade — an enum
rendering as a free-text box, which is the exact silent-binding failure this project exists to
prevent — and its error logs would read `pack "undefined"`.

So wave 4's first step is three small edits, not a one-liner: thread `entities` and `packKey`
through `ListRenderer` into its `renderNode` call and `SectionRenderer`'s. `ListRenderer` will
also need `setAt`, because `updateItem(idx, changes)` takes a flat field map and cannot express
a nested child path. **Put this in the wave 4 plan rather than leaving it to be discovered.**

The `ListRenderer → renderNode → ListRenderer` import cycle is still unexercised, because
`children` is not implemented. It should survive — both sides reference the import only inside
a render-time function body, never at module init — but nothing proves it yet.

**The residual hole is now the largest risk, and it is unchanged.** `display_fields`,
`sort.field`, `field_defaults` keys and every field on a `kind: "fields"` or `kind: "strings"`
node are asserted by a human and checked by nothing. The alias guard added in these
prerequisites has real teeth only where `FIELD_ALIASES` names the entity — today that is
exactly one node (`circle`'s `connection`). It becomes load-bearing when wave 4 migrates
`knowledge` (`mental_tab`, which persists `title`, not the `name` or `topic` its alias list
starts with) and `projects` (`top_of_mind`, which persists `idea`, a key absent from its alias
list entirely).

`profile` is a `kind: "fields"` shape, so its top-level bindings — `name`, `preferred_name`,
`bio` — would ship guarded by nothing at all. Closing this needs a machine-readable authority
on what the 37 `execute_modify` branches actually write, which is the backend reconciliation
this spec deferred as a sequel. That deferral is now doing real work rather than being
theoretical, and it is worth deciding whether to pull it forward **before** wave 4 rather than
after.

### State after wave 5

`lifestyle` (1,165 lines) and `preferences` (478 lines) are retired. **4,886 lines deleted across
waves 2-5.** `ProfileEditor.jsx` (1,446 lines) is the last one standing.

**All three node kinds now exist.** `renderNode` dispatches `list`, `strings` and `fields`.
Both new renderers are thin because `ScalarField` already owned every control they needed:
`StringsRenderer` binds a bare `string[]` to the existing `ArrayInput`, and `FieldsRenderer`
binds named keys of an object to `ScalarField`. `buildFieldMeta` and `needsFullRow` were pulled
out of `ListRenderer` so all three resolve enums, long text, dates and column layout
identically.

A `fields` node accepts an **empty path** where `list` and `strings` reject one. `setAt` on a
zero-length path replaces the target, which is fatal for a list but correct for a writer that
spreads the stored object first — and it is exactly what `profile`'s top-level scalars need in
wave 6.

**Two manifest keys were added for parity, not for novelty.** `time_fields` (mirroring
`date_fields`, including the guard: a non-`HH:MM` value stays a text input rather than being
silently discarded by a picker that cannot parse it) and `placeholder`/`description`, which
carry the retired editors' concrete example copy — "e.g. Python, TypeScript..." does more to
explain a free-text list than any derived label.

**The residual hole is narrower but still open.** Both `ui` guards key off whether a node
declares an `entity`, not off its kind, so an entity-bearing `fields` node is checked exactly
as a list node is — the wave-4 note that neither guard could see one was half right. The real
gap was the spelling check, whose `_SUBSET_CHECKED_KEYS` omitted the `fields` key entirely;
that is closed, and `assert_node_spelling` is extracted so synthetic nodes drive the same code
as the shipped-pack sweep.

What remains is genuinely narrower than "every non-list node":

- A `strings` node binds a **path**, not field names — what is stored is the bare string under
  no key at all. There is nothing to compare, so the skip is a property of the kind.
- Entity-bearing nodes are still checked for spelling and aliases, **not for phantoms**.
  `sleep.day_type` is a router selecting which fixed sub-object to write and is never itself
  stored; a node binding it passes both checks.

  Wave 6 still faces this, but not in the form earlier drafts of this section claimed. `profile`
  is **not** "entirely `kind: fields`" -- the wave table above had it right all along: a
  singleton plus two lists plus two levels of child list. Its seven top-level scalars do bind
  through one `fields` node at `path: []`, and that node **does** have an entity (`basic_info`),
  so it is checkable. What is not checkable is that `basic_info` is absent from `FIELD_ALIASES`,
  as are `work_experience`, `work_highlight`, `education`, `education_highlight`, `coursework`
  and `coursework_topic` -- **7 of `profile`'s 10 entities**, leaving only `email`, `link` and
  `language` visible to the alias guard.

**Two live bugs surfaced, both of the shape this project exists to find.** `hobby.status`
declared three values and stored two — `"paused"` was folded into `"inactive"` on write while
`_filter_inactive` had always treated it as distinct, so a user's "paused" survived only until
the next AI edit. And the retired `PreferencesEditor` wrote a mood override's name under
`when_feeling` while `execute_modify` has always written `mood`: every MCP lookup resolves on
`o.get("mood")`, so a UI-written override could never be updated or removed and a second add
duplicated it, while an AI-written one rendered as "Untitled mood". Both are fixed, the second
with a collision-guarded backfill matching the `mental_tab` precedent.

Counting `top_of_mind` in wave 4, that is **three** live data bugs found by reading storage keys
before writing a manifest. The per-wave reading is now the single highest-yield step in this
project, and its output is committed rather than discarded — see
`docs/superpowers/plans/2026-07-29-wave-5-storage-keys-reference.md`, which also carries five
backend follow-ups this wave did not take.

**Deferred from wave 5.** `ListRenderer.jsx` is ~560 lines against the spec's ~200 budget; only
`buildFieldMeta`/`needsFullRow` were extracted, and the badge-strip and `editFields` cuts are
still outstanding. `describeGuards` locates a node by `path[0]` and so cannot address a nested
list — `preferences.communication.mood_overrides` is covered by explicit tests instead. No
Storybook story exists for any migrated section.

### State after wave 6 — the consolidation is complete

`profile` (1,446 lines) is retired. **6,332 lines deleted across waves 2-6.** There are no
bespoke section editors left: `frontend/src/editors/` is gone, `BESPOKE_EDITORS` is gone, and
every section renders from its manifest through `SectionRenderer`.

**`profile` is not "entirely `kind: fields`"** — one `fields` node at `path: []` plus five lists.
That was the only thing this spec had wrong about its shape.

**The wave table's "two levels of child list" is real, and a first pass at wave 6 wrongly denied
it.** `execute_modify`'s `coursework` branch appends a bare string, so reading the backend alone
says `education.coursework` is `string[]`. But `ProfileEditor.jsx` wrote and read `{name,
topics}` objects into that same list — `education → coursework → topics` is two levels, and the
UI was the real author of the shape. Trusting only the backend produced a manifest that bound
both `coursework` and `clubs` as chip controls, which throw *"Objects are not valid as a React
child"* on real data; the fixture used bare strings, so every test passed while the actual
stored shape was never exercised. **The standing rule is now: read both writers.**
`execute_modify` is one author of a section's shape, the editor being replaced is the other, and
where they disagree neither alone is the truth.

That disagreement was itself the fifth live defect: an AI-added course rendered as "Untitled
Course" and could never be removed, because `course in coursework` compares a string to a dict.
Wave 6 makes the branches write objects, adds the `club` entity and branch that never existed,
and coerces legacy strings on read.

**The vocabulary was the actual defect, and it was the largest of the project.**
`profile.entities` declared **seven field names nothing stored** (`language.proficiency`,
`email.label`, `work_experience.location`, `work_experience.description`, `education.degree`,
`education.field`, `education.period`) and **omitted seven that were stored**. `get_schema`
advertised all seven phantoms to every AI client and values sent under them were discarded on
arrival; `email.add` demanded a `purpose` the contract never mentioned, so **no MCP client could
add an email at all**. `education.period` mapped to *two* stored keys, so no node could ever have
bound it.

Neither `ui` guard could see any of it: every phantom sat in an entity's `optional`, so the
spelling check accepted it, and seven of the ten entities are absent from `FIELD_ALIASES`, so
the alias check skipped them. The editor, notably, was **correct** — it wrote `degree_level` and
`fluency`, and a prior author had documented the `fluency` divergence in a comment. No user data
was ever affected. The damage was confined to AI clients.

Wave 6 corrected the vocabulary rather than declaring the divergences, and made
`work_experience.location`/`description` real rather than dropping them. The result is that
`profile` — the section with the worst vocabulary in the repo — ships with **zero
`fields_outside_entity` declarations**, because there is no longer anything to declare.

**Final tally on the reading discipline.** Every wave from 3 onward began by reading the
section's `execute_modify` branches. That step found **five** live defects no guard caught:
`top_of_mind`'s `idea`/`item` split (wave 4), `hobby.status` silently collapsing `"paused"`
(wave 5), the mood-override `when_feeling`/`mood` split (wave 5), `profile`'s seven phantom
fields and its `coursework` shape conflict (wave 6). The guards caught **zero** defects — but they are not therefore worthless: in
wave 5 the spelling check *rejected a correct binding* (`hobby_reference.name`), which forced the
divergence to be declared in the manifest instead of assumed. Guards work as a ratchet, not a
detector. Both reference documents are committed under `docs/superpowers/plans/`.

**What remains open.** The phantom-key hole is unclosed: an entity-bearing node is checked for
spelling and aliases, never for whether a key is actually written. `sleep.day_type` is the
standing example — a router that is never stored and passes both checks. Closing it needs a
machine-readable authority over what the 38 `execute_modify` branches write, which is the
backend reconciliation this spec has always carried as a sequel. It is now better-resourced than
it has ever been: three storage-key reference documents, and twelve recorded backend follow-ups
across waves 5 and 6.

`ListRenderer.jsx` is ~560 lines against the spec's ~200 budget; only `buildFieldMeta` and
`needsFullRow` were extracted. `describeGuards` locates a node by `path[0]` and cannot address a
nested list. No Storybook story exists for any migrated section.

## Sourcing UI primitives

Convergence means every migrated section funnels through one small set of controls, so the
few primitives the renderer kit still needs are worth getting right rather than hand-rolling.

**Default to adapting a ready-made component over writing one from scratch.** A component
pulled from a shadcn-compatible registry and then tweaked is cheaper to build and cheaper to
maintain than a bespoke one: it arrives with the accessibility behaviour, keyboard handling
and dark-mode tokens already worked out, and the next person can diff it against its source.
Hand-rolling is the fallback for when nothing off the shelf fits the repo's stack.

That said, this is **optional** and conditional — take a registry component only where it
produces a better result *and* lands faster. It is never a reason to add a dependency this
project would not otherwise carry; the point of the consolidation is deleting code.

### shadcn CLI

`frontend/src/components/ui/*.jsx` are shadcn components that were added by hand — there is
no `components.json`, so `npx shadcn@latest add …` does not work in this repo today. A wave
that needs a new primitive should run `npx shadcn@latest init` first, configured to match
what already exists:

- `"tsx": false` — this frontend is JavaScript, and the CLI emits `.tsx` by default
- Tailwind **3** config at `frontend/tailwind.config.js`, CSS variables enabled (the existing
  components use them)
- `@/*` → `./src/*`, matching `frontend/jsconfig.json`

`init` overwrites `lib/utils` and can rewrite `tailwind.config.js` and the global stylesheet.
Run it, diff it, and keep only the `components.json` it generates plus whatever the new
component genuinely needs. Anything it changes underneath the existing primitives is a
regression, not an upgrade.

### Third-party registries

**Only registries that extend shadcn qualify.** A shadcn-registry-protocol component installs
through the same CLI — `npx shadcn@latest add "<registry-url>/<component>.json"` — lands as
source in `frontend/src/components/ui/`, is built on the same Radix primitives, and already
speaks the same semantic tokens as everything else in this codebase. It becomes ours on
arrival, so tweaking it is normal work rather than fighting a library.

A library that merely *looks* good but is built on some other foundation is out of scope, no
matter how good it looks. Adopting it would mean maintaining two styling systems, which costs
more than the hand-rolled control it was meant to save.

Three filters, all of which must pass:

1. **shadcn registry protocol.** Installs via `npx shadcn@latest add <url>`, emits editable
   source, built on Radix. A library with its own CLI and its own runtime does not qualify.
2. **Tailwind 3.** Most current registries target Tailwind 4, which is a standing non-goal
   here. A v4-only component is markup to adapt by hand — its `@theme` blocks and v4-only
   utilities have to be rewritten, not pasted.
3. **No new runtime dependency.** A component that drags in an animation or styling runtime
   the section editors do not otherwise need is not worth it. Take the layout, drop the
   dependency.

Fail any of the three and the answer is the simpler hand-written control, revisited after the
deferred Tailwind 4 upgrade.

### The design language is non-negotiable

Whatever the source, the result has to look like the rest of MyGist. A component that arrives
carrying its own palette, radii or focus treatment is not finished until it has been converted
to the tokens below — and converting it is part of the cost when judging whether it was
worth taking.

- **Semantic colour tokens only** — `background`, `foreground`, `muted`, `muted-foreground`,
  `card`, `border`, `input`, `primary`, `destructive`, plus this project's own `success` and
  `warning`. All defined in `frontend/tailwind.config.js` against CSS variables in
  `frontend/src/globals.css`. No raw hex, and no arbitrary Tailwind palette colours except the
  deliberate per-value chips already in `VALUE_META` (`frontend/src/components/controls.jsx`).
- **Dark mode is a `class` strategy** — every colour must resolve in both themes. A semantic
  token does this for free; a literal one needs an explicit `dark:` counterpart.
- **Radius comes from `--radius`** (`0.5rem`) via `rounded-lg` / `rounded-md` / `rounded-sm`.
  Full-round is reserved for chips and suggestion pills.
- **Type is Geist / Geist Mono.** Labels are `text-xs capitalize`, secondary copy is
  `text-sm text-muted-foreground`.
- **Focus rings come from `FOCUS_RING`** (`frontend/src/components/controls.jsx:82`). Any
  interactive element that is not already a shadcn primitive spreads that constant rather
  than writing its own ring.
- **Icons are `lucide-react`**, sized in the `h-3.5`/`h-4` range and `aria-hidden` when
  decorative.
- **`tailwindcss-animate` is the only animation dependency.** No second one gets added for a
  section editor.

The point is not to reinvent the wheel — but a wheel that does not match the rest of the car
is its own kind of rework.

## Testing

Wave 1 establishes the harness:

- `vitest@4` + `@testing-library/react@16` + `jsdom@30`
- `storybook@10` with `@storybook/react-vite` and `@storybook/addon-vitest`, so stories
  execute as browser-mode tests under Playwright
- A `test` script in `frontend/package.json`, added to the existing CI `frontend` job
  (`.github/workflows/ci.yml:71`)
- Per-section fixtures under `frontend/src/__fixtures__/`, populated with every stored key.
  Stories and tests share them.

Storybook is local and CI only. It is not deployed.

## Waves

Each wave is a PR. `main` stays deployable throughout.

| Wave | Work | Deletes |
| --- | --- | --- |
| 0 | Vite 5 → 7; pin Node 20.19 in `Dockerfile` and CI | — |
| 1 | Vitest + Testing Library + Storybook + addon-vitest; fixtures | — |
| 2 | Renderer kit at current capability; `ui.sections` schema and normalisation; `meta_schema` validation; move `goals`/`media`/`aesthetics` to the explicit form | `GenericSectionEditor` (282) |
| 3 | `learning_log`, `circle`; plus `@now` defaults, display `sort`, `searchable`, `info`, `display_fields` | 802 ✅ |
| 4 | Child-list support (`children`), `facets`, `count_badges`; `projects`, `knowledge` | 2,159 ✅ |
| 5 | `strings` and `fields` nodes; backend `preferences` normalisation; `lifestyle`, `preferences` | 1,643 |
| 6 | `profile` — singleton plus two lists plus two levels of child list | 1,446 |

Wave 2 proves the kit against the three packs that already render generically, so the seven
sections are never what shakes out the renderer's initial bugs.

Every wave from 3 onward begins with the same step: **read the section's bespoke editor and
its `execute_modify` branch to establish the real stored keys**, then author the `ui` block
against those. The manifest's `entities` are not a shortcut for this.

### Wave 0 detail

Vite 5 → **7.3.6**, not 8. Vite 8 moves to Rolldown and requires
`@vitejs/plugin-react@6`, which is a larger change than this project needs. Vite 7
satisfies both Vitest 4 (`vite ^6 || ^7 || ^8`) and Storybook 10
(`vite ^5 || ^6 || ^7 || ^8`), and `@vitejs/plugin-react@4.7.0` already supports it.

Vite 7 requires Node `^20.19.0 || >=22.12.0`. Both `node:20-alpine` in the `Dockerfile`
and `node-version: "20"` in CI currently float to the latest 20.x and happen to satisfy
this. That implicit dependency gets pinned to `20.19` in both places rather than left to
chance.

> **Superseded:** the implementation pins Node **22**, not 20.19. See the
> wave 0 plan's "Deviation from the spec" section
> (`docs/superpowers/plans/2026-07-27-wave-0-vite-upgrade.md`) for the
> rationale.

Wave 0 must be merged **and deployed** before wave 1 begins, so that any production build
regression is attributable to the upgrade alone.

## Expected outcome

Removed: 6,332 lines (seven editors plus `GenericSectionEditor`).
Added: roughly 800 lines of renderer across five files, plus roughly 500 lines of JSON
`ui` blocks in the manifests. Tests, fixtures and stories add further lines that are not
netted off, being new capability rather than replacement.

Net source reduction around 5,000 lines — not the 5,750 a naive reading of
"6,050 versus 282" suggests.

The durable win is not the line count. It is that section behaviour becomes defined once:
a new field on an existing section is a manifest edit, and a new section is a manifest
plus a `ui` block, with no frontend code at all.

## Non-goals

- **Reconciling `entities` with stored keys**, and collapsing the 37 bespoke
  `execute_modify` branches. The natural sequel, but a backend project touching the MCP
  contract; keeping it out is what bounds this one.
- **Tailwind 4.** Deferred separately. Bundling it would double the blast radius of wave 0.
- **TanStack Query.** Separate item from the codebase review; unrelated to rendering.
- **Changing any section's stored JSON**, beyond the `preferences` normalisation above.
- **Deploying Storybook.** Local and CI only.
- **New section features.** Search and info tips are promoted into the renderer because
  they already exist in bespoke editors and convergence would otherwise lose them. Nothing
  genuinely new is added.

## Risks

| Risk | Mitigation |
| --- | --- |
| A `ui` block is authored against manifest field names rather than storage keys, blanking real data | `ui` declares storage keys by rule; fixture coverage tests fail on an unreachable key; every wave starts by reading the bespoke editor and its `execute_modify` branch |
| A `ui` block omits a field entirely | Fixture coverage test, plus round-trip tests |
| Stored `preferences` data in the legacy flat shape is blanked | Backend normalisation lands in the same PR, ahead of the editor deletion, with a test against old-shape data |
| Vite 7 upgrade breaks the production image | Wave 0 is a standalone PR, merged and deployed before any renderer work |
| The renderer accretes per-section special cases and becomes what it replaced | Convergence was chosen over parity precisely to prevent this; any node kind beyond the three specified needs justifying against that |
| Third-party pack authors' `ui` blocks break | The old flat form is normalised, not rejected, so no pack using it is affected. One narrowing since: a `kind: "list"` node in the explicit form must declare `entity` — see "Backwards compatibility" for why that trade was taken |

## Open questions

None. The field-binding question raised during spec review is resolved above in favour of
`ui` declaring storage keys, with backend reconciliation deferred to a sequel project.
