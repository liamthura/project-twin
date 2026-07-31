---
name: mygist-writing
description: Use when recording something in a user's MyGist persona - which write tool is correct, finding the entity vocabulary, identifiers, and what the advisories mean
---

# Writing to a MyGist persona

## Which tool

Ask one question: **did the user ask for this?**

- **Yes** — `persona_modify` for one change, `persona_batch` for several. Writes
  immediately.
- **No, I worked it out** — `propose_update`. Goes to their review queue.

There is no third case. "They would obviously want this" is the inferred case
wearing a disguise.

## Find the vocabulary before you guess at it

`get_schema()` lists every entity. `get_schema(entity="domain")` gives one
entity's required and optional fields, its enum values, and copy-paste
examples.

Do this rather than inventing field names. A rejected write costs a round trip;
a write that succeeds with the wrong shape costs the user a wrong record they
have to find later.

## Identifiers

Every entity has an `identifier` — the field `update` and `remove` look it up
by. Include it, matching the existing entry exactly.

**Never send `id`.** Stable ids are assigned on save. Refer to entries by their
identifier; use ids only with `get_entity` and `link`.

Nested entities also need their parent's identifier — `project_highlight` needs
`{project_name, highlight}`.

## Read the result, do not just fire and forget

`persona_modify` returns a message, and sometimes an advisory:

- **A duplicate warning** means something very similar already exists. Do not
  add a second one; `update` the existing entry instead.
- **A cross-section nudge** means the thing you added may belong somewhere
  else too.

For `propose_update`, the per-item results tell you what happened:

| Result | What it means |
|---|---|
| `stored` | in the queue |
| `duplicate_pending` | already queued; the counter went up, no second row |
| `previously_rejected` | the user declined this before. Drop it. |
| `conflicts_with_existing` | queued, with the current value attached for them to compare |
| `invalid` | your payload was wrong; the reply says how |

An `invalid` item does not sink the batch — the valid ones still land. Fix that
one item rather than resending everything.

## Removing things

Be reluctant. A persona is a record, and people keep records of things that are
over — a finished project, a former job, a hobby they have paused. Prefer
`update` with a status change over `remove`, unless the user asks for it gone
or the entry is plainly wrong.

## Linking

`persona_modify(action="link", entity="link", data={entity_id, related: [ids]})`
connects two existing entries. Links are one-directional and capped at ten per
entry, so link from the entry a reader would start at. `get_entity`'s `similar`
list suggests candidates.
