---
name: mygist-capture
description: Use the moment a user with MyGist connected mentions a change in what they do, use, want, own, prefer, or have finished - "I've started", "I've switched to", "we've moved to", "I now", "I prefer", "that's done", "I've been learning" - and before your final message in any exchange where something like that came up. Decides what to send with propose_update and what to leave alone.
---

# Proposing to a MyGist persona

The judgement half of [`mygist-writing`](../mygist-writing/SKILL.md): that one
covers which tool and what shape, this covers whether to send it at all.

`propose_update` never writes. Everything lands in a queue the user reviews by
hand. So a bad proposal costs their attention for a few seconds, and a missed one
costs them repeating themselves next week to an assistant that should have known.

Those costs are not equal, and the second one is the one that actually happens.

## Send it when it is durable and quotable

Two tests, both required:

1. **Will it still be true in a month?** Not "I'm on a train", not "I'm stuck on
   this bug". Yes to "we've moved to Postgres", "I've left that job".
2. **Can you quote them saying it?** Their words go in `evidence`. If you are
   paraphrasing an impression, you have inferred too far.

Pass both and you send it. There is no third hurdle, and no requirement that the
change feel important — a `response_format` line about wanting the answer first
is small and worth more over a year than most projects.

## Worked examples

The entity vocabulary is real; check any you are unsure of with
`get_schema(entity="...")` before sending.

**A skill level moved.** They said: *"I set up the alert routing myself this
time, no hand-holding."*

```json
{
  "kind": "entity", "action": "update", "entity": "domain",
  "data": { "name": "Datadog", "level": "advanced" },
  "rationale": "Was intermediate on record; they now configure it unaided.",
  "evidence": "I set up the alert routing myself this time, no hand-holding.",
  "confidence": 0.8
}
```

Note `data` carries the identifier and the one field that changed. Nothing else.

**A project ended.** They said: *"we shipped the migration on Friday, that one's
off my plate."*

```json
{
  "kind": "entity", "action": "update", "entity": "project",
  "data": { "name": "Postgres migration", "status": "completed" },
  "rationale": "Shipped and closed out, so the active status is now wrong.",
  "evidence": "we shipped the migration on Friday, that one's off my plate",
  "confidence": 0.9
}
```

**A preference about your own output.** They said: *"just lead with what you'd
do, I'll ask if I want the alternatives."*

```json
{
  "kind": "entity", "action": "add", "entity": "response_format",
  "data": { "item": "Lead with the recommendation; list alternatives only if asked." },
  "rationale": "Stated as a standing instruction, not a preference for this one answer.",
  "evidence": "just lead with what you'd do, I'll ask if I want the alternatives",
  "confidence": 0.85
}
```

**Durable but homeless.** Use `note` only when nothing in the schema holds it. A
note is a bet the user will find somewhere to put it, so keep them rare.

```json
{
  "kind": "note", "section_hint": "preferences",
  "text": "Reviews code by reading the tests first.",
  "rationale": "Described as how they always approach a review.",
  "evidence": "I go to the test file before the diff, every time",
  "confidence": 0.6
}
```

`confidence` is a convention for the user's own reading, not something the server
enforces: **0.9** they said it plainly, **0.7** they clearly implied it, **0.5**
you are reasonably sure. Below 0.5, do not send it — you are failing the quote
test.

## `rationale` is the reason, not the change

The user reads it while deciding, next to a dozen others. One sentence.

- **Good:** "Was intermediate on record; they now configure it unaided."
- **Bad:** "They are advanced at Datadog." *(restates the change)*
- **Bad:** "The user discussed their Datadog experience in this conversation."
  *(summarises the chat)*

## The hard cases

These are the ones that look like triggers and are not. Recognise them and move
on — do not let them talk you out of the ones that do qualify.

**Sarcasm and self-deprecation.** "I'm terrible at CSS", said right after
shipping a polished interface, is not a skill level. Propose what they did, not
what they called themselves.

**Aspiration versus fact.** "I should really learn Rust" is a wish. "I've been
doing the Rust book most evenings for a month" is a fact. Only the second.

**Venting that reads as a state change.** "I'm done with this project", said in
frustration mid-debug, is not a status change. Wait for it to hold across a
conversation, or for them to say it calmly.

**Third-party facts.** "My flatmate started a Masters in Data Science" is a
`connection` in `circle`, not the user's own `education`.

**Restating, not learning.** If they told you because you asked, you have not
learned something about them — they answered a question. That said, an answer to
your question can still qualify if it is durable and they volunteered more than
the question needed.

**Correction, not addition.** If they contradict something already on record,
propose `update` to that entity. An `add` leaves both versions standing and the
next reader cannot tell which is current.

## Do not propose

Session summaries. Moods. One-off task instructions ("use tabs in this file").
Things they only asked about. Praise or personality observations with no
consequence. Anything you cannot quote.

## Attribution

When you use something the user approved, say where it came from. "I've got you
down as preferring the recommendation first" is honest. "You prefer the
recommendation first" states a stored inference as their own words — and it may
be one another agent made months ago that they approved and forgot.

## Naming yourself

`client` is the product you run in, as the user would name it — "Claude Code",
"Claude Desktop", "Cursor", "Codex", "Hermes", "OpenClaw". Not a model name. They
see it on every row and use it to tell which of their tools proposed what, and to
spot one that is over-proposing.
