---
name: mygist-capture
description: Use when talking with a user who has MyGist connected, to decide what is worth proposing to their persona and what is not - covers sarcasm, aspiration, venting, and third-party facts
---

# Proposing to a MyGist persona

The judgement half of [`mygist-writing`](../mygist-writing/SKILL.md): that one
covers which tool and what shape, this one covers whether the thing is worth
proposing at all.

`propose_update` never writes. Everything you send lands in a queue the user
reviews by hand, so the cost of a bad proposal is their attention, and the cost
of a missed one is that they repeat themselves next week.

## Every proposal needs a quote

`evidence` must be the user's own words. If you cannot quote them, you have
inferred too far. This is the single rule that keeps the queue worth opening.

`rationale` is why it is durable, in your words — the reason, not a restatement
of the change. "Level was intermediate; they now run it unaided" is a rationale.
"They are advanced at Datadog" is a restatement.

## The two kinds

**`entity`** — you know where it goes. Call `get_schema` if unsure of the
vocabulary. Prefer this whenever something fits.

**`note`** — durable but nothing in the schema holds it. Use sparingly. A note
is a bet that the user will find somewhere to put it; too many and the queue
becomes a chore.

## The hard cases

**Sarcasm and self-deprecation.** "I'm terrible at CSS", said right after
shipping a polished interface, is not a skill level. Propose what they did, not
what they called themselves.

**Aspiration versus fact.** "I should really learn Rust" is a wish. "I've been
doing the Rust book most evenings for a month" is a fact. Only the second is
durable.

**Venting that reads as a state change.** "I'm done with this project", said in
frustration mid-debug, is not a status change. Wait for it to hold across a
conversation, or for them to say it calmly.

**Third-party facts.** "My flatmate started a Masters in Data Science" belongs
in `circle` as a note on that person, not in the user's own `education`.

**True today, not next month.** "I'm on a train", "I'm stuck on this bug" — ask
whether it will still be true in a month. If not, say nothing.

**Restating, not learning.** If the user told you something because you asked,
you have not learned it about them — they answered a question. Propose when
something surfaces on its own.

**Correction, not addition.** If they contradict something already in their
persona, propose an `update` to that entity rather than an `add` that leaves
both versions standing.

## Do not propose

Session summaries. Moods. One-off task instructions ("use tabs in this file").
Things they only asked about. Praise or personality observations with no
consequence. Anything you would struggle to quote them on.

When in doubt, do not propose. An unreviewed queue helps nobody.

## Attribution

When you use something the user approved from an observation, say where it came
from. "I've got you down as preferring the recommendation first" is honest.
"You prefer the recommendation first" states an inference as their own words.

## Naming yourself

`client` is the product you run in, as the user would name it — "Claude
Desktop", "Cursor", "Codex", "Hermes", "OpenClaw". Not a model name. They use it
to tell which of their tools is proposing what, and to spot one that is
over-proposing.
