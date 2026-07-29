# Contributing a Section Pack

A section pack adds a new persona section to MyGist with **one file** — no
backend code. The loader validates every pack at boot against
`backend/section_packs/meta_schema.json`. **An invalid pack in this repository
raises and stops the server** — it is not skipped with a warning.

That changed deliberately. Warn-and-skip meant a single mistyped key removed an
entire section silently: the pack vanished, and the first symptom showed up much
later and nowhere near the cause (a client being told an entity type was
unknown). It happened twice. Failing at boot puts the error where the mistake
is. Warn-and-skip survives only for pack directories the server does not own.

## Steps

1. Copy `backend/section_packs/_template/` to `backend/section_packs/<key>/`
   where `<key>` is your section key (lowercase, snake_case). The manifest's
   `"key"` must equal the directory name.
2. Edit `manifest.json`:
   - `defaults` — the empty skeleton blob for the section.
   - `id_lists` — `[list_field, id_prefix]` pairs; every listed field must
     exist in `defaults` as a list. Prefixes must be unique across all packs.
   - `entities` — the write schema (actions, required/optional fields,
     enum `valid_values`, the `identifier` field used for update/remove).
     Entity names must be unique across all packs. Each entity should include
     a `list` field specifying which id-list it belongs to (e.g., `"list": "items"`);
     this is **effectively required** for the generic write path when a section
     has multiple id-lists, as the sole-id-list fallback has an ambiguity guard
     and may decline entities. Including `list` explicitly is recommended always.
   - `field_defaults` (optional) — default values for optional entity fields.
   - `scope_contributions` — which fields each global scope
     (minimal/professional/personal/learning/full) pulls from this section.
     Omit a scope to stay out of it; the section always gets its own scope
     token for free.
   - `capture_triggers` — phrases that hint `suggest_persona_update`.
   - `ui` — how the web editor renders your section. Use the explicit
     `ui.sections` form, documented below; it's what the schema and this
     guide's `_template` both use.
   - `default_enabled` (optional, defaults to true) — whether the pack starts
     enabled or requires users to opt-in via the Sections manager.
3. Boot the server (`python main.py`) — a schema violation raises a `PackError`
   naming your pack and the offending key; fix until it boots.
4. Run the tests: `python -m pytest tests/test_pack_loader.py -q`.
5. Open a PR containing exactly one new directory under
   `backend/section_packs/`.

## The `ui.sections` block

`ui` is `{ "sections": [<node>, ...] }`, where each node binds one part of
`defaults` and is rendered by the shared renderer kit
(`frontend/src/renderers/`) — no per-pack frontend code.

The renderer implements **four** node kinds:

| `kind` | Binds | Renders |
| --- | --- | --- |
| `list` | a list of objects | expandable rows with fields, badges and an Add dialog |
| `fields` | named keys of one object | a form; `path: []` addresses the section root |
| `strings` | a bare `string[]` | tag chips, or one editable row per item with `"item_control": "input"` |
| `group` | nothing | a heading with nested `sections` under it |

A `list` node may also carry `children`, rendered against each row — that is how
a project's references and an education entry's coursework are edited.

The commonest node, a top-level list:

```json
{
  "kind": "list",
  "path": ["items"],
  "entity": "example_item",
  "title_field": "name",
  "badges": [],
  "detail_fields": ["notes", "tags"],
  "array_fields": ["tags"],
  "suggestions": { "name": ["Example 1", "Example 2", "Example 3"] }
}
```

- `kind` — `"list"` is the only kind the renderer draws today. `"fields"` and
  `"strings"` validate against the schema for forward compatibility with
  sections still being migrated onto this kit, but nothing renders them yet.
- `path` — the storage-key path (relative to the section's `defaults`) the
  list lives at, e.g. `["items"]`.
- `entity` — the name of the entity in this manifest whose `valid_values`
  and `field_defaults` back this list's controls.
- `title` (optional) — a heading shown above this node, useful when a
  section has more than one list.
- `title_field` — the field shown as each row's title.
- `badges` — fields shown as small chips on the collapsed row.
- `detail_fields` — fields shown when a row is expanded.
- `array_fields` — a subset of `detail_fields` that hold arrays of strings
  and expand as tag-style inputs.
- `long_text` (optional) — a subset of `detail_fields` rendered as a
  multi-line textarea instead of a single-line input.
- `suggestions` (optional) — `{ [title_field]: [preset, ...] }`, rendered as
  tap-to-add chips.
- `enum`, `optional`, `field_defaults` (optional) — inline overrides of the
  entity's `valid_values` / `optional` / `field_defaults`, for the rare case
  where this node's fields aren't the entity's field names one-to-one.

**Compatibility note:** older packs may still use the legacy flat form,
`"ui": { "<listKey>": { <same keys as above, minus kind/path/entity> } }`.
The schema still accepts it and the loader still normalises it into the
`ui.sections` form above, but new packs should use the explicit form —
it's the only one documented going forward.

## Rules

- Packs are declarative only — community packs cannot ship Python.
- New packs default **off**; users enable them in the Sections manager.
- Keep entries small: every field you add costs context tokens for every
  user who enables the pack. MyGist is a context provider — describe the
  person, don't manage their tasks.
- Manifest-only entities are writable automatically via `persona_modify` and
  `persona_batch` (no server code required) and rendered automatically by the
  web editor's shared renderer kit using the `ui.sections` configuration.
