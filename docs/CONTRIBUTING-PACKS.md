# Contributing a Section Pack

A section pack adds a whole persona section to MyGist — storage, MCP write
vocabulary, read scopes, search indexing and editor UI — from **one file**:

```
backend/section_packs/<key>/manifest.json
```

No Python. No React. Packs are declarative only, which is what makes accepting
one from a stranger a reasonable thing to do.

`backend/section_packs/meta_schema.json` is the authority above this file. Every
key it accepts carries a `$comment` explaining why it exists; set
`"$schema": "../meta_schema.json"` at the top of your manifest and your editor
will validate it as you type. Read it when this document and the schema seem to
disagree — the schema is right.

Two pages on the docs site cover the same ground for a reader who is not in this
repo: `/docs/run/section-packs` walks through building a pack, and
`/docs/run/pack-reference` lists every key. Both describe format v2.

## The one rule

**A node's `kind` states the shape of the value at its `path`.**

That is the whole format. A node at `path: ["education"]` with `kind: "list"`
says the stored persona file holds `"education": [ {...}, {...} ]`. A node with
`kind: "fields"` says the value there is one object with named keys. A node with
`kind: "strings"` says it is an array of bare strings — no keys inside, nothing
to name. A `group` binds no value at all, so it has no `path`.

A `list` or `fields` node then carries an **`element`**, which describes ONE
member of what the node binds: one row of the list, or the one object the
`fields` node is. Everything else in the format follows from those two
sentences.

| `kind` | The value at `path` is | Carries |
|---|---|---|
| `group` | nothing — it binds no path | `sections` (1+ child nodes) |
| `fields` | one **object** with named keys | `element`, with `fields` |
| `list` | an **array of objects** | `element`, with `fields` |
| `strings` | an **array of bare strings** | `element`, with no `fields` (optional) |

## The top level

Eight keys are required: `key` (which must equal the directory name), `title`,
`description`, `core`, `position`, `defaults`, `id_lists` and `sections`. Four
are optional: `$schema`, `default_enabled` (default true, so a contributed pack
declares it false), `scope_contributions`, and `mcp_entities`. Nothing else is
accepted.

`defaults` is the empty shape a new persona starts with, and it is what read
scopes and `id_lists` are checked against — a section whose stored key is not
there contributes nothing to context output. `id_lists` is a list of
`[path, id prefix]` pairs, one per array whose rows need addressable ids.
`position` orders the section in the sidebar. The worked example at the end shows
all of them filled in.

## The four kinds

Every object in a manifest is closed (`additionalProperties: false`), so a
mistyped key is a startup error and never a silently ignored one. These are the
complete key sets.

```jsonc
// group -- an eyebrow band over its children, and nothing else.
// It binds no storage, so `path`, `element` and `fields` are all rejected here.
// A group is the one kind that MUST have a title: the band is a label.
{ "kind": "group", "title": "Contact & Links", "description": "…",
  "info": { "overview": "…", "tips": ["…"] },
  "sections": [ /* 1+ nodes */ ], "$comment": "…" }

// fields -- one object, edited in place. Never added to, never removed from.
{ "kind": "fields", "path": ["communication", "default"],
  "title": "Default Communication Style", "description": "…", "info": {…},
  "element": {
    "entity": "communication_default",   // the name an MCP client passes
    "identifier": "day_type",            // optional here -- see below
    "actions": ["update"],               // optional, default ["update"]
    "description": "…",                  // optional, MCP-facing
    "fields": [ /* 1+ field descriptors */ ]
  },
  "$comment": "…" }

// list -- an array of objects. The ROW is the record, so `entity`,
// `identifier` and `fields` live inside `element`.
{ "kind": "list", "path": ["education"],
  "title": "Education", "description": "…", "info": {…},
  "search": true,                        // optional, default false: a filter box
  "facets": ["status"],                  // optional: filter chips; enum fields only
  "sort": { "field": "timestamp", "dir": "desc" },   // optional, display order only
  "element": {
    "entity": "education",
    "identifier": "institution",         // the field that names a row
    "actions": ["add", "update", "remove"],   // optional, that is the default
    "description": "…",                  // optional, MCP-facing
    "variants": [ { "entity": "…", "description": "…" } ],   // optional
    "parent": "…",                       // nested arrays only
    "list": "…",                         // see "list, the wart" below
    "fields": [ /* 1+ field descriptors */ ]
  },
  "$comment": "…" }

// strings -- an array of bare strings.
{ "kind": "strings", "path": ["values"], "title": "Values", "description": "…",
  "info": {…},
  "control": "chips",                    // optional: "chips" (default) | "input"
  "placeholder": "Add a value…",
  "element": {                           // OPTIONAL -- see below
    "entity": "value", "identifier": "value",
    "actions": ["add", "remove"],         // optional, that is the default
    "description": "…", "parent": "…", "bulk": true
  },
  "$comment": "…" }
```

A `list` or `strings` node's `path` must be non-empty. An empty path addresses
the containing object itself, and a write with `path.length === 0` returns the
new value — so the first save would replace the section's entire stored object
with one row. `Array.isArray([])` is true, so no renderer-side guard catches it.

A `fields` node's `path` **may** be empty, and that is meaningful: `path: []`
addresses the section root, which is how profile's Personal Information binds
seven top-level scalars. `FieldsRenderer` spreads the stored object on every
write, so a root write updates those keys rather than replacing the section.

`identifier` is required on a list element and optional on a `fields` element: a
singleton is not one of many, so there is usually nothing to name it by. It is
the exception that proves the rule — lifestyle's sleep pair identifies itself by
`day_type`, a router that selects which fixed sub-object a client means.

A `strings` node's `element` says only **who may write the array over MCP**, and
it is optional because most string arrays have no MCP writer at all. Without it
the array is editable in the app and invisible to a client. It declares no
`fields`, because a bare string has no named keys — its `identifier` is the
parameter name a client passes for one string (`energy_peaks` takes `peak`), not
a field name. `bulk: true` additionally lets a client send the whole array at
once under the array's own name.

`$comment` belongs to a node, or to a field, and is ignored by the loader, every
renderer, and the MCP contract. It is where an author explains a decision to the
next author, since JSON has no comment syntax. An `element` has no `$comment` of
its own on purpose: there is one place per node to look.

## You do not write the entity contract

There is no entity block. **The contract MCP clients see is derived from the
field descriptors** — `pack_loader.derive_entities` computes it, and
`get_schema` ships the result. That is the reason the format exists: a field's
stored name, type, vocabulary, default and requiredness are declared once.

The cost of that convenience is that a misspelled field name is not an error. It
is a **new field in the contract**, plus a control writing a key nothing reads.
Nothing can catch it for you, because the manifest is the authority on what the
stored keys are. Read your derived contract before opening a PR:

```bash
cd backend && python3 -c "
import json, pack_loader
print(json.dumps(pack_loader.derive_entities(json.loads(
    open('section_packs/<key>/manifest.json').read())), indent=2))
"
```

What the derivation does with each descriptor:

| Contract key | Comes from |
|---|---|
| entity name | `element.entity`, plus one per `variants` entry |
| `identifier` | `element.identifier`, reported as that field's `alias[0]` if it has one; `null` on a `fields` element that declares none |
| `required` | fields with `required: true`, spelled `alias[0] ?? name`, preceded by the enclosing row's parameter for a nested array |
| `optional` | every other field, same spelling rule, plus `custom_<name>` for each `allow_custom` enum |
| `actions` | `element.actions`; default `["add","update","remove"]` on a list, `["update"]` on a `fields` element, `["add","remove"]` on a strings element |
| `valid_values` | each `enum` field's `values`, unless it says `off_contract: ["values"]` |
| `field_defaults` | each field's `default`, unless it says `off_contract: ["default"]` |
| `exclusive_fields` | fields with `exclusive: true` |
| `parent` | `element.parent` on a nested array |
| `description` | `element.description` (or the variant's) |

`ui_only` fields are dropped from the contract entirely. `write_only` fields are
in it and render nowhere. `$comment` is never shipped to a client.

### `list`, the wart

`element.list` is the stored array's own name as today's contract reports it. It
is redundant with the node's `path` and not derivable from it: only 5 of the 42
shipped entities carry it, and which 5 follows no rule — `interest` at path
`interests` has it, `goal` at path `goals` does not. A new pack does not need it.
If you are editing a pack that already declares it, keep it: the key is part of
what `get_schema` reports today, so removing it changes the MCP contract, which
is never a side effect of an edit made for some other reason.

### `mcp_entities`

One top-level key holds hand-written entities: the two whose storage path is
computed at runtime, so no node shape can imply them (`knowledge.knowledge`
writes into `knowledge[category]` with the client choosing the category, and
`preferences.preference` is a generic key-value store). It is not an escape
hatch. A hand-authored entity beside a derived one is the exact drift this
format exists to stop, so a third entry needs an argument, not a commit.

## The field descriptor

`name` is the only required key, and it is the **stored key**. Everything else
is optional.

| Key | Means |
|---|---|
| `name` | The stored key. Not an MCP input spelling — those are `alias`. |
| `label` | Heading or control label. Defaults to a title-cased `name` (`detail_level` → "Detail level"), so declare it only where that reads wrong. On a `strings`/`list` field it does more — see "labelled arrays are blocks". |
| `type` | One of the eight below. Default `text`. |
| `values` | The vocabulary. Required if and only if `type` is `enum`. |
| `default` | Prefilled in the form, and applied by the MCP write path. Not restricted to strings; a `bool` field's default is a boolean. |
| `placeholder` | A concrete example earns its place here; a restatement of the label does not. |
| `suggestions` | Offered as chips in the add dialog. Only the title field's are read — a suggestion is a proposed row, not a proposed value for some other key. |
| `required` | Derives the entity's `required`. Default false. |
| `role` | `"title"` — the field that names a row. Exactly one per element; a list row must have one. |
| `show` | Where it draws. An array of positions; default `["form"]`. |
| `format` | `"date"` or `"datetime"`, display only. The stored value is untouched and an unparseable one is shown verbatim. |
| `alias` | Accepted MCP input spellings. `alias[0]` is the primary one and is what the derived contract reports. |
| `off_contract` | Which of `values` / `default` the MCP contract does NOT carry. |
| `ui_only` | Rendered and stored, in no MCP vocabulary. |
| `write_only` | In the MCP contract, rendered nowhere. |
| `exclusive` | At most one row in the list may hold this. Derives `exclusive_fields`. |
| `allow_custom` | `enum` only: adds the "other" free-text box, and `custom_<name>` to the contract's `optional`. |
| `pin` | `bool` only: `{title, empty, noun}`. Lifts the one row holding this field above the list. |
| `control` | Overrides the control `type` would pick. Meaningful on a `strings` field: `"chips"` (default) or `"input"`. |
| `element` | One member of this field's array. Required if `type` is `list`, optional if `type` is `strings`, rejected on every other type. |
| `$comment` | A note for the next author. |

### The eight types

| `type` | Stores | Renders as |
|---|---|---|
| `text` (default) | string | one-line input |
| `longtext` | string | textarea |
| `enum` | one of `values` | segmented control, or a select once there are too many options |
| `date` | string | date input |
| `time` | string | time input |
| `bool` | boolean | switch |
| `strings` | array of strings | chips, or one editable row per string with `control: "input"` |
| `list` | array of objects | a nested list editor |

**`longtext` must be declared.** There used to be a name heuristic —
a field called `notes`, `why` or `description` became a textarea whether or not
the manifest said so — and it is gone. Nothing downstream decides "is this long
text" by looking at a field's name any more, so a field that wants a textarea
says `"type": "longtext"`. A `notes` field that omits it gets a one-line input,
silently and correctly.

### `show` — where a field appears

| Value | Position |
|---|---|
| `form` (the default) | a control in the edit form and the Add dialog |
| `badge` | a chip on the collapsed row, drawn from the stored value |
| `row` | the faded secondary line on the collapsed row |
| `count` | an "N topics" chip on the collapsed row; needs an array-valued field |
| `pin` | drawn as the star that claims the pinned slot, and nowhere else |

It is an array because one field can hold several positions at once — `status`
is a badge on the collapsed row and a control in the expanded one. Order within
a position comes from the order of the `fields` array, so one list of
descriptors fixes the form order and the badge order together.

`show: []` means **stored, drawn nowhere**, and it is legal in exactly two
cases. The first is a field the app writes and never shows: knowledge's
`created_at` is timestamped on save and displayed nowhere, because its two
writers disagree about the timezone. Say `ui_only: true` alongside it, or the
loader rejects the node — a field with no position, no label and no `ui_only` is
one nothing can read and nothing can write. The second is a **labelled** array,
which draws its own block below the row and therefore needs no position on it.

A field that is in the tool vocabulary and on no screen is not this. It says
`write_only: true` and carries no `show` at all.

### Labelled arrays are blocks

A `strings` or `list` field **with a `label`** is not an inline control. It is a
titled block under the row, with its own add and remove, and the `label` is that
block's heading. That is the whole rule, and the label is deliberately what
decides it: `topics` (an unlabelled `strings` field on a coursework row) is a
chip input inside the detail grid, while `highlights` (a labelled `strings`
field on an education row) is a heading with its own editable rows beneath it.
Both store an array of strings at a key on the row. The only difference is
whether the manifest gave it a name to sit under.

Two consequences. A block may not also claim the `form` position — the block IS
its control, and an inline input beside it would draw a text box over an array —
so the loader rejects that combination rather than letting the renderer throw
the position away. And a block's `placeholder`, `control` and `default` describe
the block's own input, not anything on the parent row, so they follow it down.

`show` on a block is about the ROW, and the two are independent: `references` is
a titled block under the row AND a "3 references" chip on it.

### `alias`, `write_only`, `ui_only`

Three keys for three different audiences, and mixing them up is the mistake that
cost this migration the most debugging.

`alias` is a list of **input spellings MCP accepts for a field that is
rendered**. `course` is an alias of profile Coursework's `name`; the client says
`course`, the app stores `name`, and no second control appears. `alias[0]` is
the primary spelling and is what the derived contract reports.

`write_only: true` is a field that is **in the contract and never rendered**:
`conversation_metadata` and `related_entries` on learning_log entries, and
lifestyle's `day_type`. It is the one place an input spelling may legitimately be
a field's `name`, because no control binds it.

`ui_only: true` is the mirror — **rendered and stored, in no MCP vocabulary**.
All four in the shipped packs are server-written timestamps a client must not
set: knowledge's `added_date` and `last_updated`, projects' `added_date`,
learning_log's `timestamp`.

### `off_contract`

The uncommon case, and worth understanding before you reach for it. The MCP
write path **rejects** a value outside `valid_values` and **applies**
`field_defaults`. So a form that offers a closed vocabulary or prefills a
default where today's contract carries neither would start enforcing and writing
things it does not today. `off_contract: ["values"]` / `["default"]` says the
contract does not carry that attribute. Five fields in the shipped packs need
it; a new pack normally declares nothing, and its form and its contract agree.

### Nested arrays, and `parent`

A nested list is a field with `type: "list"` and an `element` of its own. There
is no separate child-node concept: a `list` field's `element` and a `list`
node's `element` mean the same thing, and as a field inside a row's `fields` the
only possible reading is that it binds against the row.

A nested element's **`parent` must name the enclosing row's identifier**. It is
the MCP parameter a client passes to say which row it means, and it is not
derivable from the identifier: `domain`'s identifier is the stored key `name`,
while a reference beneath it is addressed as `domain_name`. Two spellings are
legal — the enclosing element's identifier bare (`education_highlight`'s parent
is `institution`, which is `education`'s identifier), or that identifier
prefixed by the enclosing entity's name (`project_tag`'s parent is
`project_name`, where `project`'s identifier is `name`).

Get this wrong and the manifest is still internally consistent, which is exactly
how it shipped wrong once: profile's Education block declared `work_highlight`
with parent `company` and Work Experience declared `education_highlight` with
parent `institution` — swapped — and nothing noticed, because each block's own
entity and parent agreed with each other, just not with the row they sat under.
The loader now checks the pair against the enclosing element.

### `variants`

Two MCP names over one stored array, differing in the client-facing description
and in nothing else — same array, same fields, same identifier, same actions.
`preferences` needs it: `like` and `dislike` are two entities over one
`likes_dislikes` list. Anything that differs by more than a name and a
description is a second element shape, not a variant.

## The rules the loader checks

A manifest that breaks any of these raises `PackError` at startup and names the
pack and the node. Every one of them describes a mistake that used to be silent.

1. `element.identifier` must name a declared field of that element. (A strings
   element is exempt: its identifier is an MCP parameter name, and there are no
   fields to check it against.)
2. Exactly one field per element may carry `role: "title"`, and a **list** row
   must have one, or a collapsed row would have no name. A `fields` element is
   one record with no collapsed row, so for it the rule is at most one.
3. Every `facets` entry must name a declared field whose `type` is `enum` — the
   chips are built from the vocabulary — and `sort.field` must name a declared
   field.
4. No two fields in one element may share a `name`, and no `alias` may collide
   with another field's `name` or with another field's `alias` in the same
   element.
5. At most one field per element may declare `pin`, and the schema confines
   `pin` to a `bool` field.
6. `show: []` is legal only with `ui_only`, or on a field with a `label` that
   draws its own block.
7. A labelled `strings`/`list` field may not claim the `form` position.
8. A nested element's `parent` must name the enclosing row: the enclosing
   element's `identifier`, or `<enclosing entity>_<identifier>`.
9. Entity names are unique across the whole pack, `variants` included. One name
   may be declared twice only if both declarations derive the *same* entity —
   lifestyle's two sleep nodes do — because otherwise the contract would depend
   on which node was read last.
10. Every `id_lists` key must be a list in `defaults` **and** be bound by a
    top-level `list` node.
11. Every `scope_contributions` scope name must be a real scope, and every key
    it names must be a key of `defaults`, or it contributes nothing to context
    output. `full` is rejected for the same reason even though it is a real
    scope: `get_context(scope: "full")` returns every enabled section's whole
    file, and the resolver returns before it reads any pack's contributions, so
    an entry there can never have an effect. Name the four scopes a pack can
    actually contribute to — `minimal`, `professional`, `personal`, `learning`.
12. `key` must equal the pack's directory name.

The schema states the rest structurally: `values` if and only if `type` is
`enum`; `element` required on a `list` field, optional on a `strings` field and
rejected on every other type; `allow_custom` only on an `enum`; `pin` only on a
`bool`; a non-empty `path` on `list` and `strings`; `title` and `sections` on a
`group`, and no `path` there.

Across packs, `load_packs` additionally rejects a duplicate entity name or a
duplicate `id_lists` prefix, so a new pack cannot shadow an existing one.

## Worked example: the `goals` pack, end to end

The smallest shipped pack, complete. It is one list of objects, so it is one
`list` node.

The metadata first. `defaults` is the empty shape a new persona starts with,
`id_lists` gives the array an id prefix so rows can be addressed, and
`scope_contributions` names the top-level stored keys each read scope includes.

```json
{
  "$schema": "../meta_schema.json",
  "key": "goals",
  "title": "Goals",
  "description": "What you're working toward — type, status, and target date",
  "core": false,
  "position": 15,
  "defaults": { "goals": [] },
  "id_lists": [["goals", "goal"]],
  "scope_contributions": {
    "minimal": ["goals"],
    "professional": ["goals"],
    "personal": ["goals"],
    "learning": ["goals"]
  },
  "sections": [ … ]
}
```

`key` equals the directory name. A contributed pack sets `core: false` and
`default_enabled: false`, so users opt in from the Sections manager.

Then the one node. The stored value at `goals` is an array of objects, so
`kind` is `list`, and `element` describes one goal:

```json
{
  "kind": "list",
  "path": ["goals"],
  "element": {
    "entity": "goal",
    "identifier": "title",
    "fields": [
      { "name": "title", "required": true, "role": "title" },
      { "name": "target_date", "type": "date" },
      { "name": "why", "type": "longtext" },
      { "name": "notes", "type": "longtext" },
      { "name": "type", "type": "enum",
        "values": ["career", "learning", "personal", "health", "financial",
                   "creative", "other"],
        "allow_custom": true, "show": ["badge"] },
      { "name": "status", "type": "enum",
        "values": ["active", "achieved", "paused", "dropped"],
        "show": ["badge"] }
    ]
  }
}
```

Six fields, each declared once. `title` names a row (`role: "title"`) and is
also the field an MCP client identifies one by (`identifier`). `why` and `notes`
say `longtext` outright — nothing infers a textarea from a name. `type` and
`status` draw as chips on the collapsed row instead of only in the form, so they
say `show: ["badge"]`; the other four say nothing and get the default,
`["form"]`. `allow_custom` on `type` is what puts a free-text box under the
"other" option.

The node has no `title`, `description` or `info`, because the pack's own title
and description already say what the one list is. It has no `search`, `facets`
or `sort` either: those are for a list long enough to need them.

That manifest is the whole pack. This is the contract it derives, which nobody
wrote:

```json
{
  "goal": {
    "actions": ["add", "update", "remove"],
    "required": ["title"],
    "optional": ["target_date", "why", "notes", "type", "status", "custom_type"],
    "identifier": "title",
    "valid_values": {
      "type": ["career", "learning", "personal", "health", "financial",
               "creative", "other"],
      "status": ["active", "achieved", "paused", "dropped"]
    }
  }
}
```

`required` and `optional` come from the six descriptors, `identifier` from
`element.identifier`, `valid_values` from the two enums, `custom_type` from
`allow_custom`, and `actions` from the default for a list. Change a field name
and this changes with it, which is the point.

For a heavier example read `backend/section_packs/profile/manifest.json`: it
exercises nested lists, labelled string blocks, aliases, `off_contract`,
`write_only`, variants, and a `fields` node at `path: []`.

## Getting it in

1. `cp -r backend/section_packs/_template backend/section_packs/<key>`
2. Edit `manifest.json`. The directory name and the file's `key` must agree.
3. Boot the server — `cd backend && python main.py`. An invalid manifest raises
   a `PackError` naming your pack and the offending key. Fix, repeat.
4. Read your derived contract with the command above, and check every name in it
   is a name you meant.
5. `npm run fixtures` in `frontend/` — `src/__fixtures__/packs.json` is
   generated from the manifests, so it is stale the moment you edit one. Do this
   before the next step: `tests/test_pack_fixture_current.py` fails on a stale
   fixture, and so does CI.
6. `python -m pytest -q` in `backend/`.
7. Open a PR containing exactly one new directory under
   `backend/section_packs/`.

### An invalid pack stops the server

A manifest that violates `meta_schema.json` or any rule above **raises and halts
startup** for the packs this repo ships. It is not skipped with a warning.

That changed deliberately. Warn-and-skip meant a single mistyped key removed an
entire section silently: the pack vanished, and the first symptom appeared much
later and nowhere near the cause — a client being told an entity type was
unknown. It happened twice. Failing at boot puts the error where the mistake is.

Warn-and-skip survives only for pack directories the server does not own.

### Rules

- **Declarative only.** Community packs cannot ship Python or React. If
  something cannot be expressed in the manifest, that is a renderer-kit change,
  not a pack change.
- **New packs default off.** Set `default_enabled: false`; users opt in from the
  Sections manager. `core` is `false` for anything contributed.
- **Names and prefixes are globally unique.** Entity names and id prefixes are
  unique across every pack, so a new pack cannot shadow an existing one.
- **Keep entries small.** Every field costs context tokens for every user who
  enables the pack. MyGist describes a person; it does not manage their tasks.
- **Comment non-obvious decisions.** Nodes and fields accept a `$comment`, which
  the loader ignores and no client ever sees. The shipped packs use it heavily,
  and they use it to say *why*.

### Checklist

- [ ] Directory name and `key` agree
- [ ] `default_enabled: false`, `core: false`
- [ ] Every `kind` matches the shape of the value actually stored at its `path`
- [ ] Every field name is the key you meant to store, checked against the
      derived contract
- [ ] Every field that wants a textarea says `type: "longtext"`
- [ ] Entity names and the id prefix are unique across all packs
- [ ] Scope contributions are as small as you can justify
- [ ] `python -m pytest -q` passes in `backend/`
- [ ] `npm run fixtures` produces no diff in `frontend/`
- [ ] Exactly one new directory under `backend/section_packs/`
