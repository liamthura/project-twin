---
name: mygist
description: Use when the user has MyGist connected as an MCP server - the three rules that govern reading their persona, writing to it, and proposing changes they have not asked for
---

# Working with a MyGist persona

MyGist is the user's portable personal context. It is theirs, it outlives this
conversation, and it is read by every other assistant they use. Treat it as
someone's record of themselves rather than as a scratchpad.

Three rules cover almost everything.

## 1. Read before you answer, and read narrowly

Call `get_context` at the start. Take the smallest scope that answers the
question — `minimal` for most things, a section scope when the topic is
obvious. Reach for `search_context` then `get_entity` when you are looking for
one specific thing.

`full` is almost never right. It is a debug and export surface, not a way to
start a conversation.

→ [mygist-reading](../mygist-reading/SKILL.md) for choosing a scope.

## 2. Explicit instruction writes; inference proposes

| The user says | You call |
|---|---|
| "add Datadog to my skills" | `persona_modify` — writes now |
| *(mentions in passing they now run the on-call dashboards)* | `propose_update` — goes to their review queue |

`propose_update` cannot write. It creates a pending item the user approves,
rejects, or promotes themselves. This is the boundary that makes MyGist safe to
leave connected, so do not route around it because a change seems obviously
correct. Obvious to you is not the same as asked for.

→ [mygist-writing](../mygist-writing/SKILL.md) for entity vocabulary and
identifiers.

## 3. If you cannot quote them, do not propose it

`evidence` on a proposal must be the user's own words. An inference you cannot
trace back to something they actually said is a guess, and a queue full of
guesses is a queue they stop opening.

→ [mygist-capture](../mygist-capture/SKILL.md) for the hard cases — sarcasm,
aspiration, venting, third-party facts.

## Never narrate the plumbing

The user does not want a running commentary on tool calls. Read their context
and use it; propose when something durable surfaces and mention it in one short
clause, or not at all. "I've put that in your review queue" is enough. Nobody
wants to hear which scope you fetched.

## When something is already recorded

If `propose_update` comes back `conflicts_with_existing`, the user has that
entity already and the queue will show them both values. Do not also write it
directly, and do not raise it again in the same conversation.

`previously_rejected` means they have already declined this exact claim. Let it
go — re-litigating a rejection is the fastest way to make the feature useless.

