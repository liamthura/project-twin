---
name: mygist-reading
description: Use when fetching a user's MyGist context - choosing the scope, filtering with topic and days, searching instead of dumping, and what to actually do with the preferences that come back.
---

# Reading a MyGist persona

Scoped reads mean you pay for what you need. A persona kept for a year is large;
pulling all of it to answer "what should I call you" spends the context you need
for the actual work.

## Read the index, then fetch what you need

Every scope except `minimal` returns an **index**: each entry as
`{id, title, status, updated_at}`, plus the user's preferences in full. That is
enough to see what exists, what is active and what is recent. Then fetch only
the entries the question needs:

```
get_context(scope="projects")                     → titles, with status
get_entity(entity_id=["project_1c37dab2",
                      "project_9f00ab12"])         → just those, in full
```

`get_entity` takes up to 25 ids, so fetch several at once rather than looping.
Pass `detail="full"` when you really do need every entry of a section in full,
such as writing a CV from `professional`.

`minimal` is the exception: it comes back in full, because it is small and
curated (name, bio, top of mind, a few goals, preferences). It answers most
things without a second call.

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

**Any file key from `get_schema()` works as a scope**: `profile`, `goals`,
`knowledge`, `preferences`, `projects`, `lifestyle`, `media`, `aesthetics`,
`inventory`, `circle`, `learning_log`. A section scope also returns the
always-on preferences, so you never lose the tone by narrowing.

## Filter before you widen

`get_context` takes more than a scope, and reaching for these beats reaching for
a bigger scope:

```
get_context(scope="learning_log", days=30, limit=15)
get_context(scope="knowledge", topic="react")
get_context(scope="projects", include_inactive=true)   # paused and archived
```

## The learning log is a log

It only ever grows, and it is the biggest section on almost every persona. So
every scope that carries it shows the **newest 10**, as titles. `learning` shows
the last 60 days instead. Ask for more by time or count, or search it:

```
get_context(scope="learning_log", days=30)
search_context(query="proxmox", sections="learning_log")
```

## Looking for one thing? Do not widen the scope

The instinct to reach for a bigger scope when something is missing is the wrong
one. Two targeted calls beat one big one:

```
search_context(query="the alerting project")   → ranked snippets with ids
get_entity(entity_id="project_1c37dab2")       → just that entry
```

Pass `days` to `search_context` whenever the question is about now ("lately",
"currently"): ranking is relevance-only and has no idea what recent means.
`get_entity(..., include_related=true)` adds a `similar` list, which is where
link candidates come from.

## When a result says `trimmed`

No read returns more than about 8k tokens. When a result would, the largest
lists are cut down — to titles first, then to their newest few — and the result
says so:

```json
"trimmed": {"learning_log.entries": {"shown": 5, "total": 52,
            "more": "get_context(scope=\"learning_log\", days=30) or search_context(...)"}}
```

`more` is the call that reaches the rest. A `get_entity` batch that would pass
the cap returns what fits and marks the rest `{"entity_id": ..., "deferred":
true}`: fetch those in another call. Nothing is ever cut without being listed,
so if there is no `trimmed`, you have everything the scope holds.

## Resources, if your client reads them

The same reads are addressable by URI, and some results link to them:

- `mygist://entity/{id}` is one entry in full, as `get_entity` returns it.
- `mygist://section/{key}` is one section's index of titles.

Every link sits next to a tool call that does the same thing, so a client
without resource support loses nothing.

## `full` is a debug surface

It returns every section as an index, including things that are none of this
conversation's business. Use it when the user asks to see their whole persona;
`get_raw` is the export. Otherwise, not at all.

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
