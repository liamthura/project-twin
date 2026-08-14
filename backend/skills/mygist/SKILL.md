---
name: mygist
description: Use whenever MyGist is connected as an MCP server. Read the persona before answering; write what the user asked for; propose everything else. Load this the moment a user says something durable about themselves - "I've started", "I've switched to", "I now", "we've moved to", "I prefer", "that project is done", "I've been learning" - or at the end of any exchange where something like that came up.
---

# Working with a MyGist persona

MyGist is the user's portable personal context. It is theirs, it outlives this
conversation, and every other assistant they use reads it. Treat it as someone's
record of themselves, not a scratchpad.

Four rules. Rule 3 is the one that gets skipped.

## 1. Read first, and read narrowly

Call `get_context` before your first substantive answer. Take the smallest scope
that answers the question — `minimal` for most things, a section key when the
topic is obvious. To find one specific entry, use `search_context` then
`get_entity`; do not widen the scope to go looking.

`full` is a debug and export surface. Use it when the user asks to see their
whole persona, and otherwise never.

→ [mygist-reading](../mygist-reading/SKILL.md)

## 2. Asked writes. Inferred proposes.

| The user says | You call |
|---|---|
| "add Datadog to my skills" | `persona_modify` — writes now |
| "log that in my learning log" | `persona_modify` — writes now |
| *(mentions in passing they now run the on-call dashboards)* | `propose_update` — review queue |

`propose_update` cannot write. It creates a pending item the user approves,
rejects, or promotes themselves. That boundary is what makes MyGist safe to
leave connected, so do not route around it because a change looks obviously
correct. Obvious to you is not the same as asked for.

There is no third case. "They would clearly want this" is the inferred case
wearing a disguise.

→ [mygist-writing](../mygist-writing/SKILL.md)

## 3. Propose when these fire

**This is the rule that fails in practice, and it fails in one direction.** An
empty queue is not evidence of good judgement — it usually means nobody was
looking. The quality bar is rule 4, not silence.

Any of these in the user's own words is a trigger. Send the proposal.

| What you hear | Where it goes |
|---|---|
| "we've switched to X", "I've started using X" | `domain`, or `work_skill` on the current role |
| "I've been doing X most evenings for a month" | `domain` level, `hobby`, `interest` |
| "we shipped it", "that's done", "I've parked that one" | `project` — `update` the `status` |
| "I'm building X" (a new named thing, not a task) | `project` |
| "always give me the recommendation first", "stop apologising" | `response_format`, `communication_default` |
| "I can't stand X", "I love X" | `dislike`, `like` |
| "my sister just started a PhD", "my manager is X" | `connection` in `circle` |
| "I'm reading X", "just finished X" | `media_item` |
| "I want to be running 10k by March" | `goal` |
| "I keep meaning to look into X" | `mental_tab` |
| "I'm useless after 3pm", "I never sleep before 1am" | `energy_peak`, `sleep` |
| "standups make me anxious" | `stress_trigger` |
| "I got the job", "I've left that company" | `work_experience` |
| a fact about them that will still be true in a month | ask which entity holds it |

**Checkpoint.** Before your final message in an exchange where the user told you
something about themselves, ask once: *did anything durable surface?* If yes,
propose it in the same turn. Do not save it for later — later is a different
conversation with none of this context.

**One pass, one call.** `proposals` is a list. Send everything you found in a
single `propose_update`, not one call per item.

→ [mygist-capture](../mygist-capture/SKILL.md) for what does **not** qualify.

## 4. If you cannot quote them, do not send it

`evidence` must be the user's own words, quoted. An inference you cannot trace
to something they actually said is a guess, and a queue of guesses is a queue
they stop opening.

This rule is what makes rule 3 safe to follow readily. Recall comes from the
trigger list; precision comes from here. Neither substitutes for the other.

## Never narrate the plumbing

Read their context and use it. Propose when something durable surfaces and
mention it in one short clause, or not at all. "I've put that in your review
queue" is enough. Nobody wants to hear which scope you fetched, and nobody wants
a paragraph explaining that you considered proposing something and decided not
to.

## When something is already recorded

`conflicts_with_existing` — queued, with the current value attached for the user
to compare. Do not also write it directly, and do not raise it again this
conversation.

`previously_rejected` — they have already declined this exact claim. Drop it.
Re-litigating a rejection is the fastest way to make the queue useless.

`duplicate_pending` — already queued; the counter went up. Nothing more to do.
