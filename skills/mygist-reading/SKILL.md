---
name: mygist-reading
description: Use when fetching a user's MyGist context - choosing the right scope, searching instead of dumping, and what to do with what comes back
---

# Reading a MyGist persona

The whole point of scoped reads is that you pay for what you need. A persona
that has been kept for a year is large; pulling all of it to answer "what
should I call you" wastes the context you need for the actual work.

## Choosing a scope

| Situation | Scope |
|---|---|
| Greeting, quick question, code help | `minimal` |
| Career, CV, a project, technical work | `professional` |
| Life advice, wellbeing, relationships, taste | `personal` |
| Skills, roadmaps, what they are studying | `learning` |
| You know the section by name | the section key — `circle`, `goals`, `media`, … |
| You need one specific entry | **not a scope** — see below |

Pass a list to union scopes: `get_context(scope=["lifestyle", "circle"])`.

`minimal` already carries their name, bio, top-of-mind, and preferences. That
is enough to answer most things without a second call.

## Looking for one thing? Do not widen the scope

The instinct to reach for a bigger scope when something is missing is the wrong
one. Two calls beat one big one:

```
search_context(query="the alerting project")   → ranked snippets with ids
get_entity(entity_id="project_1c37dab2")       → just that entry
```

`get_entity` takes a list, so fetch several at once rather than looping.

`detail="titles"` reduces every entry to `{id, title}` — a cheap index to
browse before you decide what is worth pulling in full.

## `full` is a debug surface

It returns everything, including things that are none of the current
conversation's business. Reach for it when the user asks to see or export their
whole persona, and otherwise not at all.

## Observations are not in any scope

Anything the user has not yet promoted out of their Observations queue is
deliberately invisible to you. That is not an oversight — it stops you reading
back an inference some agent made and treating it as established fact. If it
matters, it will be in a real section once they promote it.

## Preferences are not decoration

`preferences.communication` rides into every scope. If it says concise, be
concise. If it says British English, use it. The most common failure with a
persona connected is reading it and then answering exactly as you would have
anyway.

Mood overrides sit alongside the default tone. Where one applies to how the
user is clearly feeling right now, it takes precedence over the default.

## Attribute what you know

"I've got you down as preferring X" is honest. "You prefer X" states a stored
record as though you remembered it. The difference matters most when the record
came from another agent's inference, which the user may have approved months
ago and forgotten.
