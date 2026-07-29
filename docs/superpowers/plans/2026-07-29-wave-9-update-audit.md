# Wave 9 — the audit covers `update`

**Date:** 2026-07-29
**Branch:** `feat/wave-9-update-audit`
**Predecessor:** [wave 8](2026-07-29-wave-8-stored-key-audit.md), which built the
stored-key audit and swept `add`

Wave 8 closed the phantom-key hole on `add` and said plainly what it had not
closed:

> The audit probes `add` only. `update` has its own divergences — wave 7's
> `work_experience.update` dropping `highlights` was exactly that shape, and it
> was found by reading, not by a guard.

This wave extends the same probe to `update`. It needed no new machinery, exactly
as predicted: vary one field through two different values, diff the stored blob.
The only extra step is that `update` needs a row to target, so each probe seeds
one first.

---

## 1. Why `update` is not redundant with `add`

A branch can honour a field on the way in and ignore it on every subsequent edit.
The field then looks entirely real — `get_schema` declares it, `add` stores it,
reading it back returns it — right up until someone tries to change it, at which
point the write silently does nothing.

That is not a hypothetical: it is what `work_experience.highlights` did until
wave 7, and what six more fields did until this one. **Six of the seven were in
entities whose `add` path was already clean**, so no amount of sweeping `add`
would have found them.

Two fields are excluded automatically rather than by allowlist: the `identifier`
and the `parent`. On `update` they select the row instead of changing it, which
is what `identifier` means. Everything else needs a reason in
`ALLOWED_UNSTORED_ON_UPDATE`, which currently holds two category selectors.

## 2. What it found

### 2.1 Six fields `update` refused to write

| Field | Only other path |
|---|---|
| `profile.education.highlights` | `education_highlight` — appends only |
| `profile.education.coursework` | `coursework` — appends only |
| `profile.education.clubs` | `club` — appends only |
| `knowledge.domain.references` | `domain_reference` — appends only |
| `knowledge.knowledge.references` | none |
| `goals.goal.custom_type` | reachable only when `type` was sent alongside it |

The first five now replace wholesale when a list is supplied — the same treatment
`work_experience` gives its lists, so `[]` clears. `goal.custom_type` becomes
settable on its own: correcting the label on an existing `other`/`custom_type`
goal used to require re-sending the type as well.

### 2.2 `mood_override` declared `update` and had no branch for it

`actions` listed `add`, `update`, `remove`. Only `add` and `remove` existed, so an
`update` call fell through to the generic write path, which does not know this
entity's shape.

The fix is small because the behaviour was already there: `add` onto an existing
mood *is* an update, so the two actions now share that path, with `update`
refusing to create a row that does not exist.

### 2.3 Two more unhandled crashes

Same class as wave 8's twelve — `.lower()` on a value that came off an MCP payload
and is not guaranteed to be a string:

- `mood_override.mood`
- `learning_entry.topic`

Both now read a non-string as absent, so the branch's own "requires X" error
answers instead of an unhandled 500. Their stored sides are guarded too, since a
legacy row can hold anything.

## 3. `sleep.day_type` is not a defect

The consolidation spec has cited `sleep.day_type` since wave 4 as the standing
example of a field the guards could not verify — "a router that is never stored
and passes both checks". Building this audit settled it.

`day_type` selects which sub-object (`weekday` / `weekend`) receives the write. It
is never stored as a key, and it is correctly declared as the entity's
`identifier`. It is a router in the same sense as `knowledge.category`, and the
audit's question — *does this field determine what gets stored?* — answers yes.

There is nothing to fix. It is recorded in the audit's module docstring so it
stops being hunted.

## 4. Verification

- **648 backend tests** (646 before; 2 new, each sweeping all 27 update-capable
  entities), **398 frontend**, build clean.
- `registry_golden.json` did **not** move: no entity's declared vocabulary
  changed this wave. Every fix was to a branch, not to a manifest — which is the
  difference between wave 9 and waves 6–8.

## 5. What remains

Both write actions are swept. `remove` is not, and deliberately: `remove` takes an
identifier and a parent and writes nothing else, so there is no field for it to
drop. A `remove`-specific audit would assert only that the row disappears, which
the existing per-entity tests already cover.

The audit now stands on all 42 entities across both write actions, and picks up
new entities without anyone wiring them in.

Unchanged from the consolidation spec, and now the whole of what is left:
`ListRenderer.jsx` at ~560 lines against a ~200 budget; `describeGuards` unable to
address a nested list; no Storybook story for any migrated section.
