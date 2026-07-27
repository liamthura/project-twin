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
| 3 | `learning_log`, `circle` | 802 |
| 4 | Child-list support; `projects`, `knowledge` | 2,159 |
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
| Third-party pack authors' `ui` blocks break | New schema is a strict superset; the old flat form is normalised, not rejected |

## Open questions

None. The field-binding question raised during spec review is resolved above in favour of
`ui` declaring storage keys, with backend reconciliation deferred to a sequel project.
