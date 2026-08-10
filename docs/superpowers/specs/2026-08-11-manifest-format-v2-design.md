# Manifest Format v2 — Design

**Status:** design agreed; implementation plan to follow.

**Deliverable of this spec:** the normative definition of manifest format v2, the
rules for deriving today's MCP entity schema from it, the validation it must
enforce, and the migration that gets the 10 shipped packs there without changing
a pixel of the app or a byte of what MCP clients see.

**One-sentence goal:** a field is declared **once**, in one place, with a closed
key set — so nothing has to be kept in agreement by hand.

## Why

### A field's identity lives in three files

Take `name` on any of the four `*_reference` lists. Today it is written down:

1. in the `ui` node — `title_field: "name"`, plus `fields_outside_entity: ["name"]`
   to excuse the mismatch below;
2. in the `entities` block — `identifier: "ref_name"`, and `ref_name` again in
   `required`;
3. in `backend/server.py:738` — `FIELD_ALIASES`, a hand-maintained table of the
   input spellings each entity accepts, with a comment block transcribing which
   line of `execute_modify` writes which key.

Three files, two spellings, one stored key. `institution` appears **13 times** in
`profile/manifest.json`.

### The drift is not hypothetical

`profile.education`'s own `$comment` records it: the entity vocabulary declared
`degree`, `field` and `period` — *none of which any writer ever produced* — and
`period` mapped to two stored keys (`start_year`, `end_year`), so no UI node
could ever have bound it. Wave 6 existed in part to correct that.
`backend/tests/test_stored_key_audit.py` (5 tests) exists to police the same
class of drift, and `test_ui_schema.py` carries a 40-line docstring enumerating
its own blind spots — ending:

> "There is no authority on storage keys in this repo — nothing enumerates what
> `execute_modify`'s 37 hand-written branches write — so a `ui` field that is
> neither in the entity vocabulary nor in an alias list is unguarded. Closing
> that needs such an authority to exist first."

**v2 is that authority.** A field is declared once, with its stored name and its
accepted input spellings on the same line.

### The size of the thing being simplified

| | Today |
|---|---|
| Manifest lines, 10 shipped packs | **2,384** — 1,219 `ui`, 819 `entities`, ~350 pack metadata |
| Distinct keys on one `list` node | **26 in use**, 33 allowed by the schema |
| Blocks a contributor must author and keep in agreement | **2** (`ui`, `entities`) |
| Parallel arrays keyed by field name | 9 (`badges`, `detail_fields`, `display_fields`, `count_badges`, `array_fields`, `long_text`, `date_fields`, `time_fields`, `enum`) plus 4 maps (`field_placeholders`, `field_defaults`, `suggestions`, `display_formats`) |

Two keys the schema allows and **no pack uses**: `bool_fields`, node-level
`optional`. `fieldMeta.js` reads both.

### One visible behaviour is declared by a naming convention

`ScalarField.jsx:58` does `(meta.optional || []).includes("custom_" + field)`.
So whether a user gets a free-text box after choosing "other" depends on the
string `custom_type` appearing in the **entity's** `optional` array. Nothing in
the `ui` block says so. In v2 that is `allow_custom: true` on the field.

## Decisions taken

| Question | Ruling |
|---|---|
| Scope | **Unify.** One field list per node; `entities` is derived by the loader, not authored |
| Migration | **Hard cutover.** A converter regenerates all 10 packs; the legacy readers are deleted, including the flat `ui` map |
| Order of work | **Before slice 2b.** 2b modifies exactly the code v2 simplifies (`fieldMeta`, `ListRenderer`) |
| MCP contract | **Unchanged output.** `get_schema` keeps shipping the same shape; it becomes computed rather than copied |
| UI | **No visible change.** The format change is inert by construction, and provably so |
| `searchable` | **Stays an explicit key.** "Search past six items" is slice 2b's decision, made in the open |
| `FIELD_ALIASES` / `execute_modify` | **Out of scope to rewrite.** v2 declares aliases and a test asserts they agree with the table |
| Format version marker | **None.** One format exists; a manifest that fails validation halts startup, as today |

## The format

### Top level

Closed set. Every key required unless marked optional.

```jsonc
{
  "$schema": "../meta_schema.json",
  "key": "profile",                    // must equal the directory name
  "title": "Profile",
  "description": "Identity, work, education, contact",
  "core": true,
  "default_enabled": true,             // optional, default true (backend/sections.py:71);
                                       // the three opt-in packs declare it false
  "position": 10,
  "defaults": { "education": [] },     // the empty shape a new persona starts with
  "id_lists": [["education", "edu"]],  // [path, id prefix]; unchanged, now validated against the tree
  "scope_contributions": { "professional": ["education"] },
  "sections": [ /* nodes */ ]          // was `ui.sections`
}
```

Two changes: **`entities` is gone** (derived), and **`ui` is gone** — its
`sections` array moves to the top level. The `ui` wrapper only ever held one key,
and the legacy flat-map form it also permitted is deleted.

### Nodes: four kinds, and what each one means

A node's `kind` states **the shape of the value at its `path`**. That is the
whole rule, and it is the sentence `CONTRIBUTING-PACKS.md` should open with.

| `kind` | The value at `path` is | Declares |
|---|---|---|
| `group` | nothing — binds no path | `sections` |
| `fields` | an **object** with named keys | `fields` |
| `list` | an **array of objects** | `item` |
| `strings` | an **array of bare strings** | neither |

Closed key sets:

```jsonc
// group -- an eyebrow band over its children
{ "kind": "group", "title": "Contact & Links", "description": "…", "info": {…},
  "sections": [ /* 1+ nodes */ ], "$comment": "…" }

// fields -- an update-only singleton object
{ "kind": "fields", "path": ["communication", "default"],
  "title": "Default Communication Style", "description": "…", "info": {…},
  "entity": "communication_default",        // MCP name
  "actions": ["update"],                    // optional, default ["update"]
  "fields": [ /* 1+ field descriptors */ ], "$comment": "…" }

// list -- an array of objects
{ "kind": "list", "path": ["education"],
  "title": "Education", "description": "…", "info": {…},
  "search": true,                           // optional, default false
  "facets": ["status"],                     // optional; must name declared enum fields
  "sort": { "field": "timestamp", "dir": "desc" },   // optional
  "item": {
    "entity": "education",                  // MCP name; NOT derivable from `path`
    "identifier": "institution",            // must name a declared field
    "actions": ["add", "update", "remove"], // optional, default all three
    "description": "…",                     // optional; MCP-facing
    "variants": [ /* see below */ ],         // optional
    "fields": [ /* 1+ field descriptors */ ]
  },
  "$comment": "…" }

// strings -- an array of bare strings, stored under no key at all
{ "kind": "strings", "path": ["values"], "title": "Values", "description": "…",
  "info": {…}, "control": "chips",           // optional: "chips" (default) | "input"
  "placeholder": "Add a value…", "$comment": "…" }
```

`children` is **deleted**. A nested list is a field with `type: "list"`, which
also fixes a documented confusion: a `group`'s children bind against the section
root, while a list's `children` bound against the row. As a field inside
`item.fields`, binding against the row is the only reading available.

`entity` sits directly on a `fields` node and inside `item` on a `list` node,
because on a `fields` node the node *is* the record while on a list the row is.
Rejected alternative: one `record: {…}` block on both kinds — uniform, but it
makes every `fields` node one level deeper for no gain.

### The field descriptor

Closed set. `name` is the only required key.

```jsonc
{
  "name": "status",              // the STORED key. The authority this repo lacked.
  "label": "Status",             // optional; default derives from name ("detail_level" -> "Detail level")
  "type": "enum",                // optional; default "text"
  "values": ["current", "…"],    // required iff type is "enum"
  "default": "current",          // optional
  "placeholder": "e.g. …",       // optional
  "suggestions": ["…"],          // optional; offered in the add dialog
  "required": true,              // optional, default false
  "role": "title",               // optional; exactly one field per item may take it
  "show": ["badge", "form"],     // optional, default ["form"]
  "format": "datetime",          // optional; "date" | "datetime" -- display only
  "alias": ["ref_name", "reference"],  // optional; accepted MCP input spellings.
                                       // alias[0] is the PRIMARY one -- the spelling
                                       // today's entity declares, and what the derived
                                       // required/optional/identifier use. Later entries
                                       // are additional accepted spellings, from
                                       // server.py's FIELD_ALIASES.
  "write_only": true,            // optional; in the contract, never rendered
  "exclusive": true,             // optional; at most one item may hold it
  "allow_custom": true,          // optional; enum only -- adds the "other" free-text box
  "pin": { "title": "…", "empty": "…", "noun": "…" },  // optional; the pinned-row feature
  "control": "input",            // optional; overrides the control `type` would pick
  "item": { /* an item block */ },  // required iff type is "list"
  "$comment": "…"
}
```

### Types

Eight, closed, each mapping to a control `ScalarField` already renders. Nothing
new is invented.

| `type` | Stores | Control today | Replaces |
|---|---|---|---|
| `text` (default) | string | `Input` | the absence of every array below |
| `longtext` | string | `Textarea` | `long_text` |
| `enum` | string from `values` | segmented or select by count | `enum` / entity `valid_values` |
| `date` | string | date input | `date_fields` |
| `time` | string | time input | `time_fields` |
| `bool` | boolean | `Switch` | `bool_fields` (unused by every pack) |
| `strings` | array of strings | `ArrayInput` | `array_fields` |
| `list` | array of objects | nested list editor | `children` |

### `show` — where a field appears

| Value | Position | Replaces |
|---|---|---|
| `form` (default) | the add/edit form | `detail_fields` |
| `badge` | a chip on the collapsed row | `badges` |
| `row` | the faded secondary line on the collapsed row | `display_fields` |
| `count` | an "N topics" chip on the collapsed row | `count_badges` |

An array, because `status` is a badge **and** a form field today. Order within a
position comes from the `fields` array, which also **replaces two independent
orderings** (`badges` order and `detail_fields` order) with one.

`show` must be non-empty when present. A field that renders nowhere says
`write_only: true` — one way to say one thing, which is the point of the exercise.

### `variants` — two MCP names over one stored list

`preferences` needs this and nothing else does: `like` and `dislike` are two
entities over one `likes_dislikes` list, identical but for their `description`.

```jsonc
"item": {
  "entity": "like", "identifier": "item",
  "variants": [{ "entity": "dislike", "description": "Something you dislike; …" }],
  "fields": [ … ]
}
```

The validator requires a variant to differ from its parent in `entity` and
`description` only. Without this, `dislike` — which no node binds — could not be
derived at all, and dropping it would be a silent contraction of the MCP surface.

### Worked example: `profile.education`

Today: 60 lines of `ui` node plus 3 entity blocks, `institution` named 5 times
within them. v2, complete and equivalent:

```jsonc
{
  "kind": "list",
  "path": ["education"],
  "title": "Education",
  "description": "Your educational background and qualifications",
  "info": { "overview": "Document your educational journey…", "tips": ["…"] },
  "search": true,
  "item": {
    "entity": "education",
    "identifier": "institution",
    "actions": ["add", "update", "remove"],
    "fields": [
      { "name": "institution", "role": "title", "required": true,
        "placeholder": "School, college, or university" },
      { "name": "degree_level",   "placeholder": "e.g. High School, Bachelor's, Master's, PhD" },
      { "name": "field_of_study", "placeholder": "e.g. Computer Science, Economics, Design" },
      { "name": "start_year",     "placeholder": "e.g. 2020" },
      { "name": "end_year",       "placeholder": "e.g. 2024 or Expected 2026" },
      { "name": "status", "type": "enum", "values": ["current", "completed", "incomplete"],
        "default": "current", "show": ["badge", "form"] },
      { "name": "highlights", "type": "strings", "control": "input", "show": ["count"],
        "placeholder": "e.g. Graduated with honours, Led the debate team" },
      { "name": "coursework", "type": "list", "show": ["count"], "label": "Coursework / Modules",
        "item": {
          "entity": "coursework", "identifier": "name", "actions": ["add", "remove"],
          "description": "A module or class.",
          "fields": [
            { "name": "name", "role": "title", "required": true, "alias": ["course"],
              "placeholder": "e.g. Macroeconomics, Data Structures" },
            { "name": "topics", "type": "strings", "placeholder": "Key topics covered…" }
          ]
        }},
      { "name": "clubs", "type": "list", "label": "Clubs & Societies",
        "item": {
          "entity": "club", "identifier": "name", "actions": ["add", "remove"],
          "description": "A society or extracurricular.",
          "fields": [
            { "name": "name", "role": "title", "required": true },
            { "name": "activities_involved", "type": "strings",
              "placeholder": "e.g. Committee member, Event organiser" }
          ]
        }}
    ]
  }
}
```

`institution` once. `status` once. `coursework` once — instead of a child node, a
count badge and an entity.

## Deriving the entity schema

`build_entity_schema` (`backend/pack_loader.py:156`) stops copying and starts
computing. The shape it returns is unchanged, so `server.ENTITY_SCHEMA`,
`get_schema`, `get_entity_schema` and the `/proposals` path are untouched.

| Derived key | Rule |
|---|---|
| entity name | `item.entity` (or the `fields` node's `entity`), plus one per `variants` entry |
| `required` | fields with `required: true`, as `alias[0] ?? name` |
| `optional` | every other field, same spelling rule |
| `identifier` | `item.identifier`, as `alias[0] ?? name`; `null` for a `fields` node |
| `actions` | `item.actions` / node `actions`; defaults `["add","update","remove"]` for a list, `["update"]` for a `fields` node |
| `valid_values` | `{name: values}` for every `enum` field, plus `allow_custom` contributing `custom_<name>` to `optional` |
| `field_defaults` | `{name: default}` for every field carrying one |
| `exclusive_fields` | fields with `exclusive: true` |
| `parent` | the enclosing `item`'s `identifier`, for a nested list only |
| `list` | the top-level path segment, when the entity name differs from it |
| `description` | `item.description` |
| `$comment` | never emitted (already true today) |

**One accepted difference: array order.** `required` and `optional` are derived in
declared-field order, which may differ from today's hand-written order. The two
already disagree with each other in the shipped packs — `communication_default`
lists `tone, locale, detail_level` in `ui.fields` and `tone, detail_level, locale`
in the entity — so no order is currently authoritative. The equivalence gate
therefore compares `required` and `optional` **as sets**, and everything else
exactly. Recorded here because it is the one place the derived output may not be
byte-identical.

## Validation — what "rigid" means

`meta_schema.json` is rewritten. `additionalProperties: false` everywhere (as
today on `uiSection`), plus cross-checks the loader performs after schema
validation, each raising `PackError` and halting startup:

1. `item.identifier` names a declared field in that item.
2. Exactly one field per item may carry `role: "title"`; a `list` item must have
   one.
3. `facets` and `sort.field` name declared fields; `facets` entries must be
   `enum`. Verified against the shipped packs first: all five facets in use
   (`level`, `status` ×2, `skill_level`, `stance`) already are.
4. `values` is present and non-empty **iff** `type` is `enum`; `allow_custom` only
   on `enum`.
5. `item` is present **iff** `type` is `list`.
6. No two fields in one item share a `name`; no `alias` collides with any `name`
   or `alias` in the same item.
7. `pin` only on a `bool` field; at most one per item.
8. Entity names are unique across the whole pack, `variants` included.
9. `id_lists` paths resolve to a `list` node **and** to a list in `defaults`
   (today only the second half is checked).
10. `scope_contributions` names paths that exist in the tree.
11. `key` equals the directory name (already enforced).

Rules 1–8 and 10 are new. Every one of them describes a mistake that is silent
today.

## What v2 deletes

| Deleted | Why it can go |
|---|---|
| the authored `entities` block | derived |
| `ui` wrapper, and the legacy flat `ui` map | one form only; `test_legacy_flat_ui_map_is_still_accepted` goes with it |
| `fields_outside_entity` | there is no second vocabulary to diverge from |
| `children` | a field with `type: "list"` |
| `title_field`, `badges`, `detail_fields`, `display_fields`, `count_badges`, `array_fields`, `long_text`, `date_fields`, `time_fields`, `bool_fields`, `enum`, `field_defaults`, `field_placeholders`, `display_formats`, `suggestions`, `item_control`, `pinned`, `optional` | per-field keys |
| entity `list` | derived from `path` |
| the `custom_` naming convention | `allow_custom: true` |

33 allowed keys on one node become **at most 10 on any node** — `group` 6,
`strings` 8, `fields` 9, `list` 10, sixteen across all four kinds — plus **19
field keys that mean the same thing wherever they appear**, instead of thirteen
arrays and maps that each mean something different.

## Migration

Hard cutover, in this order. Each step ends with the full suite green.

1. **The gate first.** Write `test_derived_entity_schema_matches_authored`: for
   each of the 10 packs, the schema derived from the v2 manifest equals today's
   authored one (sets for `required`/`optional`, exact elsewhere). It cannot pass
   before step 3 and must not be weakened to make it pass.
2. **The converter**, `backend/tools/manifest_v1_to_v2.py`, deterministic and
   re-runnable. Rules: the field list is **exactly** the union of what the `ui`
   block renders today, in `detail_fields` order, then fields appearing only in
   `badges`/`row`/`count`, then `write_only` ones. It never invents a field from
   the entity's vocabulary alone.
3. **Convert all 10 packs plus `_template`**, committed as generated output with
   the converter, so the diff is reviewable and reproducible.
4. **New `meta_schema.json`** and the loader cross-checks.
5. **Derive** `build_entity_schema`; delete the authored block; the gate goes
   green.
6. **Frontend:** `fieldMeta.js` collapses to reading one descriptor; the
   precedence rule it documents ("a NODE-level key wins over the entity's
   vocabulary") is deleted rather than maintained. `ListRenderer`,
   `AddEntryDialog`, `FieldsRenderer`, `StringsRenderer`, `ScalarField` read
   descriptors. **No test in the 8 affected frontend files may change.**
7. **`CONTRIBUTING-PACKS.md`** rewritten around the one-sentence rule and one
   worked example.
8. **`test_stored_key_audit.py`** re-pointed: its blind spots close, because the
   manifest now enumerates stored keys. A new test asserts every declared `alias`
   agrees with `server.py`'s `FIELD_ALIASES` for the entities that table names.

### The 13 names that render nothing, classified explicitly

The converter must place each of these; a default would put a control on screen
that does not exist today.

| Name | Node | v2 |
|---|---|---|
| `course` | profile Coursework | `alias` of `name` |
| `ref_name` ×3 | knowledge / lifestyle / projects References | `alias` of `name` |
| `item` | projects Top of Mind | `alias` of `idea` |
| `new_topic` | learning_log entries | `alias` — an MCP input parameter |
| `new_label` | profile Links | `alias` — an MCP input parameter |
| `conversation_metadata` | learning_log entries | `write_only` |
| `related_entries` | learning_log entries | `write_only` |
| `day_type` | lifestyle Sleep ×2 | `write_only` — a router; never stored (`server.py:2295`) |
| `custom_type` | goals | disappears: `allow_custom: true` on `type` |
| `primary` | aesthetics Styles | a `bool` field with `exclusive: true` and `pin: {…}` |

## How we know the UI did not change

- The 810 frontend unit tests pass **untouched**. If one needs editing, the
  conversion is wrong, not the test. This is the primary gate.
- `realWorldShapes.test.jsx` renders the real shipped shapes and is the file that
  would catch an invented or dropped field.
- A rendered-field census: for each pack, the set of `[data-ui-node]` nodes and
  the labels inside each card, before and after, compared as text. Cheap to write
  from the existing harness and it catches exactly the "sprouted a control"
  failure.
- The Docker preview, eyeballed on Profile, Preferences and Goals.

## Out of scope

- **Rewriting `execute_modify`'s 37 branches or `FIELD_ALIASES`.** v2 makes the
  manifest the authority and *verifies agreement*; making the runtime read from it
  is a follow-up, and a large one.
- **Folding `id_lists` into the field descriptors.** It is consumed by
  `pack_loader` and `search_index`; v2 validates it against the tree and leaves
  its shape alone.
- **New node kinds, new controls, new pack features.** Nothing gains a
  capability except per-field `label` and single-array ordering, both of which
  fall out of the shape.
- **Slice 2b** (field patterns: chip paste, inline row edit, search past six,
  overflow remove). It follows this and reads the new descriptors.
- **The `ui` → `sections` rename cascading into `normalizeUi`'s dual-shape
  support** beyond deletion: one shape survives, and the function collapses.

## Risks

| Risk | Mitigation |
|---|---|
| The converter invents a field, and the app sprouts controls | The field list comes only from what renders today; the 13 exceptions are enumerated above; the rendered-field census compares before/after |
| A derived entity silently loses a field, breaking an AI writer with nothing red | The gate compares all 10 packs' schemas before the authored block is deleted |
| `required`/`optional` order changes and some client reads order | The two blocks already disagree in the shipped packs, so no order is authoritative; compared as sets, recorded as an accepted difference |
| 96 backend tests touch this area and rewriting them hides a regression | Only tests asserting *the old syntax* may change. Tests asserting *behaviour* must pass untouched, and each edit needs a one-line reason |
| The one-function risk in `build_entity_schema` | It is pure, and the gate is exact equality over real packs |
| Scope creep into the MCP runtime | Stated out of scope above; the alias-agreement test is the seam that lets it wait |

## Verification

```
backend:   pytest                       — including the new derivation gate
frontend:  npm test -- --project unit   — 810 tests, unchanged
census:    rendered fields per pack, before vs after, identical
preview:   Docker, eyeball Profile / Preferences / Goals
docs:      CONTRIBUTING-PACKS.md teaches one format, with one worked example
```

## Correction to an earlier spec

`docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md` § "Section
editor" lists `scalar` as a node kind in its header-slot table. There is no
`scalar` node kind — `meta_schema.json` closes the set at `list`, `fields`,
`strings`, `group`, and `ScalarField` is the per-**field** control. The rule it
states still holds, reworded: a field with no denominator shows no count.
