---
name: mygist-writing
description: Use when recording anything in a user's MyGist persona - choosing between persona_modify, persona_batch and propose_update, finding the entity vocabulary, identifiers, how much to send on an update, and what the advisories mean.
---

# Writing to a MyGist persona

## Which tool

One question: **did the user ask for this?**

- **Yes, one change** — `persona_modify(action, entity, data)`. Writes now.
- **Yes, several** — `persona_batch([...])`. Writes now.
- **No, I worked it out** — `propose_update(proposals, client)`. Review queue.

There is no third case. "They would obviously want this" is the inferred case
wearing a disguise.

Same entity vocabulary either way, so everything below applies to both.

## Find the vocabulary before you guess at it

`get_schema()` returns a digest: every file, its entities, each entity's
`identifier` and `required` fields. `get_schema(entity="domain")` returns one
entity in full — required, optional, `valid_values` for its enums, and
copy-paste examples.

Call it rather than inventing field names. A rejected write costs a round trip; a
write that succeeds with the wrong shape costs the user a wrong record they have
to find later.

Enums are closed. `domain.level` is one of beginner, learning, intermediate,
advanced, expert; `project.status` is one of active, paused, completed, archived,
idea. Do not send a synonym.

## Identifiers

Most entities have an `identifier` — the field `update` and `remove` look them up
by. It varies: `name` for `domain`, `hobby`, `project`, `connection`; `title` for
`goal`, `media_item`, `mental_tab`; `topic` for `learning_entry`; `address` for
`email`; `item` for `like`, `dislike`, `response_format`, `top_of_mind`. Check
rather than assume.

`basic_info` and `communication_default` have no identifier at all — they are
singletons, and `update` is their only action. `sleep` is also update-only but
does take an identifier: `day_type`, which is `weekday` or `weekend`.

**Never send `id`.** Stable ids are assigned on save. Refer to entries by
identifier; ids are for `get_entity` and `link` only.

Nested entities need the parent's identifier too:

```
project_highlight  → {project_name, highlight}
work_skill         → {company, skill}
coursework         → {institution, course}
hobby_specific     → {hobby_name, specific}
domain_reference   → {domain_name, ref_name}
```

## How much to send in `data`

This is the most common mistake, and the user sees the result.

- **add** — every required field, plus any optional field you actually know. Do
  not invent values to fill out the shape.
- **update** — the identifier, the parent if it has one, and **only the fields
  that change**. Resending unchanged fields pads a review row with values already
  on record, which makes the user read the whole thing to find what moved.
- **remove** — identifier and parent only. Nothing else is read.

```jsonc
// Good: one field moved.
{ "action": "update", "entity": "domain",
  "data": { "name": "Datadog", "level": "advanced" } }

// Bad: three of these are already on record.
{ "action": "update", "entity": "domain",
  "data": { "name": "Datadog", "level": "advanced",
            "notes": "monitoring", "references": [] } }
```

## Read the result

`persona_modify` returns a message and sometimes an advisory:

- **Duplicate warning** — something very similar exists. Do not add a second;
  `update` the existing entry.
- **Cross-section nudge** — what you added may belong somewhere else too.

`propose_update` returns a result per item:

| Result | What it means |
|---|---|
| `stored` | in the queue |
| `duplicate_pending` | already queued; the counter went up, no second row |
| `previously_rejected` | they declined this before. Drop it, do not rephrase it. |
| `conflicts_with_existing` | queued, with the current value attached to compare |
| `invalid` | your payload was wrong; the reply says how |

An `invalid` item does not sink the batch — the valid ones still land. Fix that
one item and resend it alone, not the whole set.

## Every proposal needs three things

`rationale` (why it is durable, one sentence, in your words), `evidence` (their
words, quoted), `confidence` (0.5–0.9). A proposal missing the quote is a guess.

→ [mygist-capture](../mygist-capture/SKILL.md) for worked examples and the
calibration.

## Removing things

Be reluctant. A persona is a record, and people keep records of things that are
over — a finished project, a former job, a paused hobby. Prefer `update` with a
status change over `remove`, unless the user asks for it gone or the entry is
plainly wrong.

`project` has `completed`, `archived` and `paused` for exactly this. Reaching for
`remove` throws away the history those statuses exist to keep.

## Linking

```
persona_modify(action="link", entity="link",
               data={entity_id: "goal_abc123", related: ["project_def456"]})
```

`entity` is ignored for link and unlink; `"link"` is convention. Links are
one-directional — stored on the source only — and capped at ten per entry, so
link from the entry a reader would start at. `get_entity`'s `similar` list
suggests candidates. `action="unlink"` removes them the same way.
