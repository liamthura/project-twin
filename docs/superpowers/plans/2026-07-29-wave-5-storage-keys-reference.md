# Wave 5 storage keys — `lifestyle` and `preferences`

Committed reading of `backend/server.py::execute_modify` and
`backend/persona_store.py::_normalize`, done before writing the wave 5 `ui`
blocks. Same purpose as
[`2026-07-28-wave-4-storage-keys-reference.md`](2026-07-28-wave-4-storage-keys-reference.md):
`entities` is an **MCP input vocabulary**, not a storage schema, so the only
authority on what a key is actually called on disk is the branch that writes
it. Every line below carries its citation.

Read at `eff0d9d`.

---

## 1. `lifestyle.json`

### 1.1 `hobbies` — `list`, entity `hobby` (`server.py:1703-1751`)

Written at `:1717-1720`:

```python
new_hobby = {
    "id": generate_entity_id("hobby"), "name": name,
    "status": status, "notes": notes,
    "specifics": data.get("specifics", []), "references": []
}
if skill_level:
    new_hobby["skill_level"] = skill_level
```

| Stored key | Bindable | Note |
|---|---|---|
| `id` | no | generated |
| `name` | yes | identifier; `FIELD_ALIASES["hobby"][0]`, convention holds |
| `status` | yes | **see 1.1.1 — the declared enum is not the stored enum** |
| `notes` | yes | |
| `skill_level` | yes | only written when truthy, so absent on most rows |
| `specifics` | yes | `string[]` — child `strings` node, entity `hobby_specific` |
| `references` | yes | `object[]` — child `list` node, entity `hobby_reference` |
| `last_updated` | no | stamped by update at `:1743`, not user-editable |

`update` (`:1731-1745`) gates each field on the raw `data` key rather than the
resolved value, so `notes` can be cleared to `""` only through the UI, never
over MCP (`if notes:` at `:1739`). Not a wave 5 problem — recorded because the
UI is about to become the only writer that *can* clear it.

#### 1.1.1 `status` — declared enum ≠ stored enum

`lifestyle/manifest.json` declares `valid_values.status = ["active",
"inactive", "paused"]`. The branch (`:1708-1712`) does:

```python
status = get_field(data, "status", "state", "is_active", default="active")
if status in ["inactive", "stopped", "paused", "not_active", "false", False]:
    status = "inactive"
else:
    status = "active"
```

**`"paused"` is collapsed to `"inactive"` on write.** The current editor offers
all three values (`LifestyleEditor.jsx:42`) and the frontend PUTs section JSON
directly, so a user's "paused" persists — until any AI edit to that hobby
rewrites it to "inactive". A silent, invisible value change, and exactly the
class of bug the alias guard cannot see: `status` is spelled correctly and sits
in `optional`, so both checks pass.

The **read** path already disagrees with the write path: `"paused"` is a member
of `INACTIVE_STATUSES` (`server.py:1074`), annotated "goals, lifestyle.hobby,
projects". `_filter_inactive` therefore already treats a paused hobby as a real,
distinct status while `execute_modify` refuses to store one. The collapse is the
defect, not the intent.

**Wave 5 fixes the branch** so the stored vocabulary matches the declared one
(task 1). `_filter_inactive` needs no change — a paused hobby is filtered from
context before and after, identically.

### 1.2 `interests` — `list`, entity `interest`

Already carries the only `ui` block `lifestyle` ships today:
`{title_field: "name", badges: ["kind"], detail_fields: ["notes"]}`. Stored
keys `name`, `kind` (`passion` | `curiosity`), `notes`. `passion`/`curiosity`
are **input-only aliases** that forward here (`:1753-1760`) — already recorded
in `CANONICAL_STORED_KEY`, both mapping to `name`.

### 1.3 `personality_traits` — `strings` (`server.py:1762-1781`)

`traits.append(item)` at `:1772` — a **bare string array**, not objects. Entity
`personality_trait` declares `required: ["trait"]`, but `trait` is an *input
field name*, not a stored key: there is no key at all, only the string.

Any `ui` node naming `trait` as a field would be naming something that is never
stored. This is the `kind: "strings"` case, and it takes `path` only.

### 1.4 `values` — `strings` (`server.py:1783-1801`)

Identical shape: `values.append(item)` at `:1793`. Bare strings.

### 1.5 `wellness.sleep` — `fields`, entity `sleep` (`server.py:2278-2302`)

```python
sleep = wellness.setdefault("sleep", {
    "weekday": {"bedtime": "", "wakeup": ""},
    "weekend": {"bedtime": "", "wakeup": ""}
})
```

Not a list. `day_type` is a **router, not a stored key** — it selects which of
the two fixed sub-objects to write, and is never persisted (`:2295-2299` writes
only `bedtime`/`wakeup` into `sleep[day_type]`). The two day keys are fixed;
`:2292` rejects anything else.

So this is two `kind: "fields"` nodes, at `["wellness","sleep","weekday"]` and
`["wellness","sleep","weekend"]`, each binding `bedtime` and `wakeup`. A node
binding `day_type` would bind a field nothing stores.

Values are free-text times, not `yyyy-mm-dd` — `date_fields` does not apply.

### 1.6 `wellness.energy_peaks` — `strings` (`server.py:2304-2325`)

`peaks.append(item)` at `:2314`. Bare strings, like 1.3/1.4.

### 1.7 `wellness.stress_triggers` — `strings`, **no MCP write path**

Seeded by `persona_store._normalize:267` as `[]`. There is **no
`stress_trigger` entity and no `execute_modify` branch** — no AI client can
read into or write this key.

The current editor already binds it (`LifestyleEditor.jsx:1118-1122`), so the
UI is its only writer *today*; the migration inherits that rather than creating
it. Wave 5 binds it as a `strings` node and records the asymmetry in the
node's `$comment`; §4 carries the backend follow-up.

---

## 2. `preferences.json`

### 2.1 `communication.default` — `fields`, entity `communication_default` (`server.py:2206-2226`)

```python
comm = preferences.setdefault("communication", {})
default = comm.setdefault("default", {"tone": "", "detail_level": "", "locale": "British English"})
```

Stored keys: `tone`, `detail_level`, `locale`. All three are bound directly,
no aliasing (`:2211-2219` reads `data["tone"]` etc. literally, not via
`get_field`). `identifier: null` — a genuine singleton, `update`-only.

`kind: "fields"` at `["communication","default"]`. This node **does** have an
entity, so the alias/spelling guards can cover it once they stop skipping
non-list nodes — see §3.

### 2.2 `communication.mood_overrides` — `list`, entity `mood_override` (`server.py:2228-2276`)

`overrides.append(override)` at `:2251` where `override = {"mood": mood}` plus
`tone`/`detail_level` **only when truthy** (`:2245-2249`). Stored keys: `mood`
(identifier), `tone`, `detail_level` — the latter two frequently absent.

`add` on an existing mood silently updates it (`:2238-2244`) rather than
erroring or duplicating. The UI's own duplicate handling is independent of
this; noted so a reviewer does not read the branch as an add/update bug.

### 2.3 `likes_dislikes` — `list`, entities `like` / `dislike`

Two entities sharing one list, discriminated by `stance`. `find_in_persona`'s
`search_paths` maps `"dislike": ("preferences", "likes_dislikes")`
(`server.py:431`), with the comment at `:425-427` recording that the separate
`dislikes` list was retired. `_normalize` strips a resurrected `dislikes` key
(`persona_store.py:232`).

Stored keys: `item`, `stance`. Both entities declare `identifier: "item"` and
`optional: []` — **`stance` is in neither list for either entity**, yet it is
the key that decides which entity a row *is*. A `ui` node naming `stance` would
be flagged by the spelling guard as a field absent from the entity vocabulary.
That is a false positive against a real stored key, and it is the second
independent instance (after `timestamp` in wave 3) of the guard being
anti-correlated with the risk.

**Wave 5 binds `stance` as a facet/enum and declares the divergence** via the
mechanism `test_declared_divergence_is_accepted_by_the_schema`
(`test_ui_schema.py:598`) already provides.

### 2.4 `code_style.*` and `learning_style.*` — `strings`, **no MCP write path**

The editor binds `code_style.preferred_languages`, `code_style.frameworks`,
`code_style.tools` (`PreferencesEditor.jsx:156,166,174`) and
`learning_style.preferred`, `learning_style.avoid` (`:387,395`). All five are
bare string arrays.

The generic `preference` entity (`:2185-2204`) writes
`preferences[category][key] = value` where `value` is a **scalar string**
(`get_field(data, "value", "setting_value", default="")`). It cannot produce an
array. So `preference` can reach `preferences["code_style"]["frameworks"]` only
by *overwriting the list with a string* — it is not a write path for these, it
is a way to corrupt them.

Five `strings` nodes, no entity, UI-only writers. Same asymmetry as 1.7, and
the same §4 follow-up.

### 2.5 The `preference` category router — deliberately not bound

`preferences[category][key] = value` over arbitrary `category`. Wave 4 decided
to leave this alone and wave 5 does not revisit it: it has no fixed key set, so
there is nothing for a manifest node to declare. It remains MCP-only.

---

## 3. What this wave does to the guards

Waves 2–4 bound only `kind: "list"` nodes, every one of which carries an
`entity`, so both guards in `test_ui_schema.py` saw every field the UI bound.

Wave 5 introduces **eleven** nodes that are not lists (§1.3, 1.4, 1.5 ×2, 1.6,
1.7, 2.1, 2.4 ×5). Both guards read `node.get("entity")` and skip when it is
absent (`test_ui_schema.py:763, 801`), and neither is reached for a non-list
node at all. Left as-is, wave 5 would be the first wave to ship storage-key
bindings covered by nothing.

Two of those eleven have a real entity — `communication_default` (2.1) and
`sleep` (1.5). The fix is proportionate and does not need a storage-key
authority to exist:

1. **Declare `entity` on the `fields` nodes that have one** and extend both
   guards to non-list nodes. `communication_default`'s three keys and `sleep`'s
   two then get exactly the coverage a list node's fields get today.
2. **The nine entity-less `strings` nodes bind a `path`, not field names** —
   there is nothing for a spelling check to compare against. Require a
   `$comment` on each recording the branch (or its absence) that writes it, so
   the reading is carried in the manifest rather than only here.

`sleep` is the useful test of (1): its entity declares `day_type`, which §1.5
establishes is a router and never stored. A node binding `day_type` **should**
be rejected, and under (1) the spelling guard accepts it — `day_type` is in the
entity vocabulary. So (1) closes the alias hole, not the phantom-key hole. That
limit is real and worth stating plainly rather than claiming coverage the
change does not deliver.

`profile` (wave 6) is entirely `kind: "fields"`, so this work is load-bearing
beyond wave 5.

---

## 4. Backend follow-ups this reading surfaced

Not wave 5 work — recorded so they are not rediscovered. **All five are now
closed**; the strikethroughs are kept rather than deleted so the list stays
readable as a record of what a single wave's reading turns up.

1. ~~**`hobby.status` (§1.1.1)**~~ — **taken into wave 5 as task 1**, not
   deferred: the branch stops collapsing `"paused"`, so all three declared
   values become storable.
2. ~~**`stress_triggers` (§1.7)** has no entity and no branch~~ — **closed in
   wave 7**: a `stress_trigger` entity mirroring `energy_peak`, plus its
   `execute_modify` branch. It was a stored key with a UI node and no MCP write
   path at all.
3. ~~**`code_style.*` / `learning_style.*` (§2.4)** — `preference` can overwrite
   these arrays with a scalar~~ — **closed in wave 7** with the guard, not with
   dedicated entities: replacing a stored list is still allowed, doing it with a
   scalar is not, and `remove` is the escape hatch.
4. ~~**`like`/`dislike` omit `stance` (§2.3)**~~ — **closed in wave 7**:
   `stance` is `optional` on both entities with its two valid values, and an
   explicit value now beats the entity-implied default, so `update` can flip a
   row without the client switching entity to do it. The UI node's
   `fields_outside_entity` declaration went away with it.
5. ~~**`hobby.notes` cannot be cleared over MCP (§1.1)**~~ — **closed in wave
   7**: presence, not truthiness, across all three input spellings.

These accreted toward
[`2026-07-28-entity-field-schema-design.md`](../specs/2026-07-28-entity-field-schema-design.md),
per the agreed approach of reading each wave rather than scheduling the schema
project up front. Wave 7 took the whole accumulated list —
[`2026-07-29-wave-7-mcp-contract-gaps.md`](2026-07-29-wave-7-mcp-contract-gaps.md).
