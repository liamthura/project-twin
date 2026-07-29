# Wave 8 — the stored-key audit

**Date:** 2026-07-29
**Branch:** `feat/wave-8-stored-key-audit`
**Closes:** the backend reconciliation the consolidation spec has carried as a
sequel since wave 4

Every wave from 3 onward found defects by *reading* `execute_modify` against the
manifest. Twelve follow-ups accumulated that way, and the guards caught none of
them — because every existing check on the entity vocabulary is a **spelling**
check. It asks whether a declared name matches something. It never asks whether
anything writes it.

That is the phantom-key hole. A field can sit in an entity's `optional` forever,
be advertised to every MCP client by `get_schema`, and be discarded on arrival.
Wave 6 found seven such fields in `profile` alone.

This wave closes it, and the closing is a **guard**, not a list.

---

## 1. Why the audit is empirical

The obvious implementation is a table: for each of the 38 branches, write down
what it stores. That table would be a **second copy of the truth**, free to drift
from the first — which is the bug, not the fix. It would also have to be updated
by hand for every new entity, which is exactly the discipline that has failed
twelve times already.

So the audit measures instead. For each declared field it runs `add` twice with
two **different** values and diffs the stored blob. If the blob comes out
identical either way, nothing in the branch read the field.

Diffing two live values — rather than present-versus-absent — is what makes it
immune to defaults: a field seeded with the same value the probe happened to send
would look "written" under a presence test. The probe pairs are chosen to defeat
the three ways a branch can quietly ignore an input:

| Pair | Catches |
|---|---|
| `"probe_alpha"` vs `["probe_beta"]` | `if isinstance(v, list)` guards |
| `True` vs `False` | bool coercion — both of the above are truthy |
| `enum[0]` vs `enum[-1]` | fields whose values are constrained |

A field surviving all three unchanged is not stored.

**New entities are audited automatically.** Nothing has to be registered. Adding
an entity to a manifest adds it to the sweep on the next test run.

## 2. The three tests

`backend/tests/test_stored_key_audit.py`:

1. **`test_every_declared_field_is_actually_stored`** — the phantom-key guard.
2. **`test_declared_required_is_enough_to_add`** — the divergence in the other
   direction: an `add` built from exactly the declared `required` fields must
   succeed.
3. **`test_no_payload_shape_raises`** — `execute_modify` returns errors; it must
   never raise.

Two allowlists carry the legitimate exceptions, each entry with a reason:

- **`ALLOWED_UNSTORED`** — 16 fields that are declared and deliberately not
  stored. Every one is a *router*: a value the branch reads to decide **where**
  to write. Thirteen parent selectors on nested entities, two category
  selectors, and `link.new_label` (a rename input whose stored key is `label`).
  They cannot be deleted from the vocabulary — a client has to send them.
- **`CONDITIONAL_REQUIRED`** — `preferences.mood_override`, whose branch wants
  "at least one of tone/detail_level". `required` is a flat list of names: it can
  say "all of these", never "one of these". Recording it is more honest than
  over-declaring (which would make `get_schema` demand both) or under-declaring
  (the divergence test 2 exists to catch).

## 3. What it found

Nine defects, none of them previously recorded. Every one was verified by hand
before being fixed — the probe is a tool, not an authority.

### 3.1 Two real phantom fields

- **`lifestyle.hobby.references`** — declared `optional`; `add` hardcoded
  `"references": []`, discarding the input, while `specifics` beside it honoured
  its own. A client that sent references on `add` had them silently dropped and
  had to re-send every one through `hobby_reference`. `update` had always
  accepted them.
- **`circle.connection.contact`** — this one is not a lost field. `contact` is an
  **input spelling for `name`** (`FIELD_ALIASES["connection"]`), and the entity
  listed it in `optional` next to `notes` and `traits`, as though it were a place
  to put someone's contact details. A value sent under it either named the
  connection or was discarded. Aliases are input vocabulary, not stored keys.
  Removed from `optional`.

### 3.2 Four `required` declarations that did not match the branch

| Entity | Declared | Branch demands |
|---|---|---|
| `profile.work_experience` | `["company"]` | role, company, type, period |
| `profile.language` | `["name"]` | name, fluency |
| `projects.project` | `["name"]` | name, description |
| `preferences.mood_override` | `["mood"]` | mood + one of tone/detail_level |

An MCP client following `get_schema` got a rejection it had no way to predict.
The first three are now declared correctly; the fourth is in
`CONDITIONAL_REQUIRED` because `required` cannot express it.

`work_experience` surfaced *as a bug in the probe* — every payload was being
rejected and the harness looked broken. It was the contract.

### 3.3 Three classes of unhandled crash

`execute_modify` is supposed to return an error string. These raised, which means
an unhandled 500 reachable from any MCP payload:

- **`AttributeError: 'list' object has no attribute 'lower'`** — `find_in_array`
  and `_find_course` called `.lower()` on the identifier. **Twelve entities.** A
  client sending `{"company": ["Acme"]}` crashed the server instead of getting
  "not found". Both now coerce; a non-string identifier matches nothing, which is
  the honest answer — no row has a list for a name. The stored side is coerced
  too, since a legacy row can hold anything.
- **`TypeError: unhashable type: 'list'`** — `knowledge.category` and
  `preference.category`/`key` are used as dict keys. Now rejected with a message.
- **`TypeError: 'bool' object is not iterable`** — `list(data.get(x) or [])` in
  three places. It looked equivalent to a coercion and was not: a bool or int
  raises, and a bare string silently explodes into one entry per character. New
  `_as_list` helper rescues the lone-string case (clients send `topics: "AI"`
  meaning one topic) and returns `[]` for the rest. `_as_text` does the same job
  for `.strip()`/`.lower()` call sites in the `goal` branch.

## 4. Verification

- **646 backend tests** (643 before wave 8; 3 new, each sweeping all 42
  entities), **398 frontend**, build clean.
- `registry_golden.json` moved for exactly four entities — `circle.connection`,
  `profile.language`, `profile.work_experience`, `projects.project` — and nothing
  else. Diffed entity by entity before regenerating, per the fixture's own rule.

## 5. What this does and does not close

**Closed.** The phantom-key hole, for `add`. A declared field that nothing stores
now fails CI, for every entity, including ones written after this document.

**Not closed.** The audit probes `add` only. `update` has its own divergences —
wave 7's `work_experience.update` dropping `highlights` was exactly that shape,
and it was found by reading, not by a guard. Extending the same two-value diff to
`update` is the natural next step and needs no new machinery: seed a row, then
vary one field through `update` instead of `add`.

`sleep.day_type`, the standing example throughout this spec, is an `update`-only
entity — so it is **still unaudited**. That is the honest state: the hole is
closed on the action where twelve of twelve recorded defects lived, and open on
the one where the thirteenth will.

Also unchanged from the consolidation spec: `ListRenderer.jsx` at ~560 lines
against a ~200 budget; `describeGuards` unable to address a nested list; no
Storybook story for any migrated section.
