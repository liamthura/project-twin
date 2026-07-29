# Wave 6 storage keys — `profile`

Committed reading of `backend/server.py::execute_modify` for `profile`'s ten
entities, done before writing the `ui` block. Same purpose as the
[wave 4](2026-07-28-wave-4-storage-keys-reference.md) and
[wave 5](2026-07-29-wave-5-storage-keys-reference.md) references: `entities` is
an **MCP input vocabulary**, not a storage schema.

Read at `ee63f1c`. 373 lines across 10 branches.

**This is the wave where the vocabulary turned out to be substantially wrong.**
`profile.entities` declares **seven field names that nothing stores** and omits
**seven keys that are stored**. Neither `ui` guard can catch any of it: every
phantom sits in an entity's `optional` (so the spelling check accepts it), and
seven of the ten entities are absent from `FIELD_ALIASES` (so the alias check
skips them wholesale).

---

## 1. Two corrections to what this project believed

### 1.1 The two-level child list is real — and reading only the backend denied it

**An earlier draft of this document got this wrong, and the mistake is the most
instructive thing in it.**

`execute_modify`'s `coursework` branch appends the **bare string**
(`coursework.append(course)`), so a reading of the backend alone concludes
`education.coursework` is `string[]` with no second level. That is what the
first draft concluded, and it contradicted the spec's wave table, which has
said "two levels of child list" since wave 0.

The wave table was right. `ProfileEditor.jsx` wrote and read **objects**:
`{name, topics: []}` for coursework and `{name, activities_involved: []}` for
clubs. So `education → coursework → topics` is two levels, and the UI has been
the real author of that shape all along.

**The disagreement between the two writers was itself a live bug** (§3.8). And
because the first draft trusted only the backend, the migration bound both
lists as chip controls — which throw *"Objects are not valid as a React child"*
on real data. The fixture used bare strings, so every test passed while the
actual stored shape was never exercised.

**The rule this establishes: read both writers.** `execute_modify` is one
author of a section's shape; the editor being replaced is the other, and where
they disagree neither alone is the truth.

| Child | Shape | Node |
|---|---|---|
| `work_experience.highlights` | `string[]` | `strings`, `item_control: "input"` |
| `education.highlights` | `string[]` | `strings`, `item_control: "input"` |
| `education.coursework` | `[{name, topics: []}]` | `list` + nested `topics` |
| `education.clubs` | `[{name, activities_involved: []}]` | `list` + nested activities |

### 1.2 `profile` is not "entirely `kind: fields`"

Only the seven top-level scalars are. The rest is five lists.

---

## 2. `profile.json` structure

```
{ name, preferred_name, current_role, organisation, location, nationality, bio,
  languages_spoken: [ {name, fluency} ],
  work_experience:  [ {role, company, type, period, location, description,
                       skills: [str], highlights: [str]} ],
  education:        [ {institution, degree_level, field_of_study, start_year,
                       end_year, status, highlights: [str],
                       coursework: [ {name, topics: [str]} ],
                       clubs:      [ {name, activities_involved: [str]} ]} ],
  contact: { emails: [ {address, purpose} ], links: [ {url, label} ] } }
```

---

## 3. Per entity

### 3.1 `basic_info` — `fields` at `path: []` (`server.py:1648-1662`)

```python
fields = ["name", "preferred_name", "current_role", "organisation",
          "location", "nationality", "bio"]
for field in fields:
    if data.get(field):
        profile[field] = data[field]
```

**The one entity whose vocabulary is exactly right** — the seven declared
`optional` names are the seven written keys, verbatim, with no aliasing.
`update`-only, `identifier: null`.

Note `if data.get(field)` — a falsy value is skipped, so **no field can be
cleared over MCP**. The UI can clear them (it PUTs the section directly). Not a
wave 6 problem; recorded in §5.

### 3.2 `language` → `languages_spoken` (`:1466-1495`)

Writes `{"name": name, "fluency": fluency}`.

| Manifest says | Stored | |
|---|---|---|
| `name` (required) | `name` | ✅ |
| `proficiency` (optional) | — | ❌ **phantom** |
| — | `fluency` | ❌ **omitted** |

`proficiency` is the third member of `get_field(data, "fluency", "level",
"proficiency")` — an input alias. `ProfileEditor.jsx:28-33` already documents
this and correctly writes `fluency`.

`CANONICAL_STORED_KEY["language"]` is `"name"`, which covers the *identifier*
only. `FIELD_ALIASES["language"]` is the name-alias list, so the alias guard
never looks at `fluency`/`proficiency` — and `proficiency` is in `optional`, so
the spelling guard accepts it. **A node binding `proficiency` passes both
guards and writes to a key nothing reads.**

### 3.3 `email` → `contact.emails` (`:1411-1442`)

Writes `{"address": address, "purpose": purpose}`.

| Manifest says | Stored | |
|---|---|---|
| `address` (required) | `address` | ✅ |
| `label` (optional) | — | ❌ **phantom** |
| — | `purpose` | ❌ **omitted, and the branch REQUIRES it** |

`add` returns `"❌ Email requires 'address' and 'purpose'"` for a missing
`purpose` — a key the tool contract does not mention at all. An MCP client
following `get_schema` cannot successfully add an email.

### 3.4 `link` → `contact.links` (`:1444-1465`)

Writes `{"url": url, "label": label}`. Vocabulary correct. **No `update`
action** — add and remove only, so a link is edited by removing and re-adding.
The UI can edit in place.

### 3.5 `work_experience` (`:1496-1527`)

`add` writes `{role, company, type, period, highlights}`. `update` writes
`role`, `type`, `period` only.

| Manifest says | Stored | |
|---|---|---|
| `company` (required) | `company` | ✅ identifier |
| `role`, `period`, `type`, `highlights` | same | ✅ |
| `location` (optional) | — | ❌ **phantom** |
| `description` (optional) | — | ❌ **phantom** |

`period` is a real stored key **here** and a phantom on `education` (§3.6).
The same name means different things on two entities in the same section.

### 3.6 `education` (`:1664-1699`)

```python
education.append({
    "institution": ..., "degree_level": ..., "field_of_study": ...,
    "start_year": ..., "end_year": ..., "status": ...,
    "coursework": [], "clubs": [], "highlights": []
})
```

| Manifest says | Stored | |
|---|---|---|
| `institution` (required) | `institution` | ✅ identifier |
| `highlights`, `coursework`, `clubs` | same | ✅ |
| `degree` (optional) | `degree_level` | ❌ **phantom** |
| `field` (optional) | `field_of_study` | ❌ **phantom** |
| `period` (optional) | `start_year` + `end_year` | ❌ **phantom** |
| — | `status` | ❌ **omitted** (defaults `"current"`) |

Three phantoms and one omission in one entity — and the guards are **perfectly
anti-correlated**: they accept all three phantoms (in `optional`) and would
reject `status`, the real key. The fourth instance of this pattern, after
`timestamp` (wave 3), `ref_name` (wave 5) and `stance` (wave 5).

`period` is also not a rename of one key: it maps to **two** stored keys. No
node can bind it.

### 3.6b `work_experience.skills` — child `strings`, added in wave 6

Not a migration: a new field, requested alongside it. Bare strings on the
parent row, the same shape as `highlights`, seeded by `work_experience.add` and
replaceable wholesale by `update` (guarded on `isinstance(..., list)` rather
than truthiness, so an empty list really does clear it).

Given its own entity `work_skill` (add/remove, mirroring `work_highlight`)
rather than left UI-only. A field no AI client can read into or out of is half
a feature in a project whose point is portable context — and UI-only was
exactly the asymmetry `clubs` had before this wave closed it.

Rendered as **chips**, not `item_control: "input"`: skills are short,
word-like values you add and drop but never revise, and chips show many at a
glance. A highlight is a sentence where a typo means retyping the lot.

### 3.7 `work_highlight`, `education_highlight` — child `strings`

Both append into the parent row's `highlights` string array
(`:1541`, `:2559`). No object, no key. `work_highlight` accepts a `highlights`
array or a single `highlight`; `education_highlight` takes only `highlight`.

### 3.8 `coursework` / `coursework_topic` — child `list` of objects

Both write into the parent's `coursework` list. Until wave 6 both appended a
bare **string** while the editor wrote and read `{name, topics}` **objects**
into that same list, so:

- an AI-added course rendered as "Untitled Course" — the editor reads
  `course.name`, which a string does not have; and
- it could **never be removed**: `if course in coursework` compares a string
  against a dict and never matches, so `remove` failed and a repeat `add`
  duplicated it.

Wave 6 makes both branches write `{name, topics}`, matching the editor, and
`persona_store._normalize` coerces legacy bare strings into that shape on read
— lossless and idempotent: the string becomes the name and the nested list
starts empty, which is exactly what the string carried. `server._find_course`
stays shape-tolerant so a write reaching an un-normalised blob still finds its
entry rather than duplicating it.

`coursework_topic` remains a verbatim alias; §5 carries the deduplication.

### 3.9 `education.clubs` — child `list` of objects, new entity in wave 6

`[{name, activities_involved: []}]`, written by the editor. Before wave 6 there
was **no `club` entity and no branch at all**, so no AI client could read into
or out of it — the same asymmetry as `lifestyle.wellness.stress_triggers`
(wave 5 §1.7), but here wave 6 closes it rather than inheriting it: the entity
and its branch are added, and legacy bare strings are coerced alongside
coursework.

---

## 4. What this means for the `ui` block

Bind the **stored** column, never the manifest column:

- `language` → `fluency`, not `proficiency`
- `email` → `purpose`, not `label`
- `education` → `degree_level`, `field_of_study`, `start_year`, `end_year`,
  `status` — not `degree`, `field`, `period`
- `work_experience` → no `location`, no `description`

Every one of those is a real storage key the entity vocabulary omits, so each
node needs `fields_outside_entity` — the same mechanism `hobby_reference` and
`stance` used in wave 5. Wave 6 will declare more divergences than every prior
wave combined, which is the honest signal that `profile.entities` needs fixing
rather than working around.

---

## 5. Backend follow-ups this reading surfaced

Not wave 6 work unless explicitly scoped in. **All eight are now closed** — 0–3
inside wave 6 itself, 4–7 in wave 7. Struck through rather than deleted, so the
list stays readable as a record of what one wave's reading turns up.

0. ~~**`coursework`/`clubs` shape conflict (§3.8)**~~ — **taken into wave 6**,
   not deferred: the branches now write objects, `clubs` gains an entity, and
   legacy strings are coerced on read. Listed first because it was a live,
   data-visible defect rather than a contract one.
1. ~~**Seven phantom fields in `profile.entities`** (§3.2, 3.3, 3.5, 3.6):
   `language.proficiency`, `email.label`, `work_experience.location`,
   `work_experience.description`, `education.degree`, `education.field`,
   `education.period`~~ — **closed in wave 6**. `get_schema` advertised all
   seven to every AI client and values sent under them were silently discarded.
   **This is the largest single defect any wave has surfaced.**
2. ~~**Seven stored keys the vocabulary omits**: `language.fluency`,
   `email.purpose`, `education.degree_level`, `field_of_study`, `start_year`,
   `end_year`, `status`~~ — **closed in wave 6**.
3. ~~**`email.add` requires `purpose`**, which the contract never mentions~~ —
   **closed in wave 6**. An MCP client following `get_schema` could not add an
   email.
4. ~~**`coursework_topic` duplicates `coursework`** verbatim (§3.8)~~ —
   **closed in wave 7**: one branch, two entity names, and the alias lists
   merged. The entity stays in the vocabulary because clients call it; it no
   longer stays as a copy.
5. ~~**`link` has no `update`** (§3.4)~~ — **closed in wave 7**, with
   `new_label` for the rename, since `label` identifies the row.
6. ~~**`basic_info` cannot clear a field** — `if data.get(field)` skips falsy
   values (§3.1)~~ — **closed in wave 7**: presence, not truthiness. `name`
   keeps the old guard, being what most readers title the persona with.
7. ~~**`work_experience.update` cannot change `highlights`**, though `add` sets
   them; `work_highlight` is the only path~~ — **closed in wave 7**, with the
   same wholesale replacement `skills` gets, so `[]` clears.

These accreted toward
[`2026-07-28-entity-field-schema-design.md`](../specs/2026-07-28-entity-field-schema-design.md).
Wave 7 took the whole accumulated list —
[`2026-07-29-wave-7-mcp-contract-gaps.md`](2026-07-29-wave-7-mcp-contract-gaps.md).
