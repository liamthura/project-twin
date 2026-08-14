---
name: mygist-reading
description: Use when fetching a user's MyGist context - choosing the scope, filtering with topic and days, searching instead of dumping, and what to actually do with the preferences that come back.
---

# Reading a MyGist persona

Scoped reads mean you pay for what you need. A persona kept for a year is large;
pulling all of it to answer "what should I call you" spends the context you need
for the actual work.

## Choosing a scope

| Situation | Scope |
|---|---|
| Greeting, quick question, code help | `minimal` |
| Career, CV, a project, technical work | `professional` |
| Life advice, wellbeing, relationships, taste | `personal` |
| Skills, roadmaps, what they are studying | `learning` |
| You know the section by name | the section key — see below |
| You need one specific entry | **not a scope** — see below |

Pass a list to union scopes: `get_context(scope=["lifestyle", "circle"])`.

**Any file key from `get_schema()` works as a scope**, not only the seven that
`get_context`'s own description lists: `profile`, `goals`, `knowledge`,
`preferences`, `projects`, `lifestyle`, `media`, `aesthetics`, `circle`,
`learning_log`. `goals`, `media` and `aesthetics` are missing from that list and
resolve fine — checked, not assumed.

`minimal` already carries their name, bio, top-of-mind and preferences. That
answers most things without a second call. A section scope also returns the
always-on preferences, so you never lose the tone by narrowing.

## Filter before you widen

`get_context` takes more than a scope, and reaching for these beats reaching for
a bigger scope:

```
get_context(scope="learning_log", days=30, limit=15)
get_context(scope="knowledge", topic="react")
get_context(scope="projects", detail="titles")
get_context(scope="projects", include_inactive=true)   # paused and archived
```

`detail="titles"` reduces every entry to `{id, title}` — a cheap index to browse
before deciding what is worth pulling in full.

## Looking for one thing? Do not widen the scope

The instinct to reach for a bigger scope when something is missing is the wrong
one. Two targeted calls beat one big one:

```
search_context(query="the alerting project")   → ranked snippets with ids
get_entity(entity_id="project_1c37dab2")       → just that entry
```

`get_entity` takes a list, so fetch several at once rather than looping. It also
returns a `similar` list, which is where link candidates come from.

## `full` is a debug surface

It returns everything, including things that are none of this conversation's
business. Use it when the user asks to see or export their whole persona.
Otherwise, not at all.

## Observations are not in any scope

Anything the user has not promoted out of their Observations queue is
deliberately invisible to you. That is not an oversight — it stops you reading
back an inference some agent made and treating it as established fact. If it
matters, it will be in a real section once they promote it.

This cuts both ways: you cannot check the queue to see whether something is
already proposed. `propose_update` answering `duplicate_pending` or
`previously_rejected` is how you find out, which is why those results are worth
reading.

## Preferences are not decoration

`preferences.communication` rides into every scope. If it says concise, be
concise. If it says British English, use it. If `response_format` says lead with
the recommendation, lead with the recommendation.

**The most common failure with a persona connected is reading it and then
answering exactly as you would have anyway.** A fetched preference that changes
nothing about your output was a wasted call.

Mood overrides sit alongside the default tone. Where one matches how the user is
clearly feeling right now, it takes precedence over the default.

## Attribute what you know

"I've got you down as preferring X" is honest. "You prefer X" states a stored
record as though you remembered it yourself. The difference matters most when the
record came from another agent's inference — which the user may have approved
months ago and forgotten.
