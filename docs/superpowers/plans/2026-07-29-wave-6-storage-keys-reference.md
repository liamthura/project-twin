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

### 1.1 There is no two-level child list

The spec's wave table has said "singleton plus two lists plus two levels of
child list" since wave 0, and wave 4's review made untested nesting depth a
wave 6 entry criterion. The reading says otherwise.

`education.coursework` is a **bare string array** — `coursework.append(course)`
at `server.py:2588`, appending the string itself. It is not a list of objects,
so it has no second level. `coursework_topic` (`:2597`) is a **verbatim
duplicate** of the `coursework` branch writing the same array through a
different alias list; its own comment says so.

So every child in `profile` is `kind: "strings"`, one level deep:
`work_experience.highlights`, `education.highlights`, `education.coursework`,
`education.clubs`. Wave 6 carries **no untested nesting depth at all**.

### 1.2 `profile` is not "entirely `kind: fields`"

Only the seven top-level scalars are. The rest is five lists.

---

## 2. `profile.json` structure

```
{ name, preferred_name, current_role, organisation, location, nationality, bio,
  languages_spoken: [ {name, fluency} ],
  work_experience:  [ {role, company, type, period, highlights: [str]} ],
  education:        [ {institution, degree_level, field_of_study, start_year,
                       end_year, status, coursework: [str], clubs: [str],
                       highlights: [str]} ],
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

### 3.7 `work_highlight`, `education_highlight` — child `strings`

Both append into the parent row's `highlights` string array
(`:1541`, `:2559`). No object, no key. `work_highlight` accepts a `highlights`
array or a single `highlight`; `education_highlight` takes only `highlight`.

### 3.8 `coursework` / `coursework_topic` — child `strings`, duplicated

Both append into the parent's `coursework` string array. `coursework_topic` is
a verbatim copy differing only in its alias list (`topic` vs `class`) and its
messages. §5 carries the deduplication.

### 3.9 `education.clubs` — child `strings`, **no MCP write path**

Seeded by the `education` add and readable, but there is **no `club` entity and
no branch**. Like `lifestyle.wellness.stress_triggers` (wave 5 §1.7), the UI is
its only writer. The current editor binds it, so wave 6 inherits that rather
than creating it.

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

Not wave 6 work unless explicitly scoped in:

1. **Seven phantom fields in `profile.entities`** (§3.2, 3.3, 3.5, 3.6):
   `language.proficiency`, `email.label`, `work_experience.location`,
   `work_experience.description`, `education.degree`, `education.field`,
   `education.period`. `get_schema` advertises all seven to every AI client;
   values sent under them are silently discarded. **This is the largest single
   defect any wave has surfaced.**
2. **Seven stored keys the vocabulary omits**: `language.fluency`,
   `email.purpose`, `education.degree_level`, `field_of_study`, `start_year`,
   `end_year`, `status`.
3. **`email.add` requires `purpose`**, which the contract never mentions — an
   MCP client following `get_schema` cannot add an email.
4. **`coursework_topic` duplicates `coursework`** verbatim (§3.8).
5. **`link` has no `update`** (§3.4).
6. **`basic_info` cannot clear a field** — `if data.get(field)` skips falsy
   values (§3.1).
7. **`work_experience.update` cannot change `highlights`**, though `add` sets
   them; `work_highlight` is the only path.

These accrete toward
[`2026-07-28-entity-field-schema-design.md`](../specs/2026-07-28-entity-field-schema-design.md).
