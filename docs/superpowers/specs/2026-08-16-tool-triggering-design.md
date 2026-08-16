# Getting the tools called without being asked — design

Date: 2026-08-16
Status: designed, not implemented

## Why

MyGist is forgotten until someone names it. An assistant with the server
connected will answer a question about the user's own work from general
knowledge, write in a voice it has never checked, and let a month-old fact go
by without proposing it. The user then says "check MyGist first", and it works
perfectly — which is the tell. Nothing is broken. It is simply never reached
for.

That is not a small annoyance. A persona nobody reads is a persona nobody
updates, and automatic learning is the product.

Context7 is the counterexample worth studying, because it fires reliably in the
same clients with no prompting at all.

## The diagnosis

### Context7 triggers on a noun. MyGist triggers on a moment.

Every message that should reach Context7 contains a library name. "How do I do
X in Next.js" carries its own trigger, sitting in the user's own words. Tool
selection behaves largely like retrieval: the tool whose description shares
surface with the message wins.

MyGist's stated trigger conditions are `"Start of any conversation (always)"`
and `"When you need user preferences"`. Neither is a token. There is nothing in
*"help me write a bash script"* that resembles "persona", "scope" or
"preferences". The model has to notice something about the conversation's
**structure** rather than its **content**, and it has to do so while a fully
answerable question pulls the other way.

All three failures share this shape:

| Tool | Fires on | Why that is hard |
|---|---|---|
| `get_context` | the start of a conversation | a structural fact, not a word in the message |
| `search_context` | realising a slice was too thin | requires noticing an absence |
| `propose_update` | hearing something durable | a moment mid-conversation, with no cue |

### Failing to call is invisible

When Context7 does not fire you get a wrong API and the user corrects you. When
MyGist does not fire you get a fluent, generic answer and nobody says anything.
There is no correction signal in the conversation, so nothing self-repairs.

### The trigger material is in the wrong channel

Three channels reach a model, and they are not equal:

| Channel | Reaches the model | Verifiable |
|---|---|---|
| Tool descriptions | every client, every turn, unconditionally | yes — it is in `tools/list` |
| Tool results | always read, high attention — but only after a call | yes |
| Server `instructions` | variably: injected, summarised, cached or dropped | no |

The concrete triggers — *"we've switched to X"* → `domain`, *"I got the job"* →
`work_experience` — live **only** in the `instructions` string at
`server.py:2805`. Meanwhile `propose_update`'s description spends eighty lines
on `KINDS`, `HOW MUCH TO SEND IN data` and `REQUIRED ON EVERY PROPOSAL`. Its
*when* is real but sits at line 45 of 50, under the schema, and is abstract:
*"something still true next month"*. Nothing a model can match against a
sentence somebody just typed.

**Mechanics are in the channel that always arrives. Triggers are in the channel
that might not.** That single inversion explains all three failures, and
correcting it is mostly moving prose between files.

### The instructions may not be arriving at all

A session connected to `https://mygist.thuradev.qzz.io/mcp` on 2026-08-16
received the **pre-`b756039`** instructions string — the ten-line version that
re-lists six tools and ends "Always call get_context at the start of
conversations to personalize responses". Not the 44-line rewrite that shipped
on 2026-08-14.

Either production is stale or the client cached it. `/api/version` is behind
auth, so it could not be settled from outside. Either way the point stands: the
channel carrying every trigger is the one nobody can check.

## What this does not change

Renaming the tools was considered and rejected for now.

`get_context` is the most overloaded name in agent tooling, and when a client
defers tool schemas — Claude Code does — the bare name is all the model sees.
`resolve-library-id` can only mean one thing; `get_context` means nothing.

Against that: roughly 330 references across the repository (43 in docs MDX, 85
in backend Python, 36 in the four skills, 9 in the frontend, 268 in tests), the
tool names drawn into the six rendered chat figures, and every user's
`settings.json` permission allow-list. Aliasing is not a soft landing either —
two near-identical tools in one list dilute selection, which is the problem
being solved.

It is also the least measurable change available. Descriptions and footers ship
in one deploy and are reversible; if triggering is still poor afterwards, that
is evidence the name was never the issue. Revisit then, and only for
`get_context` — `propose_update`, `search_context` and `persona_modify` are
already distinctive.

Client-side distribution (the plugin, layer 3 of the skill-distribution spec)
stays declined. It reaches one client; everything here reaches all of them.

## The design

### 1. `get_context` — argument first, packs second

```
Load the user's persona before you answer.

You have never met this user. Nothing in your training data contains
them, and nothing in this conversation will tell you what you are
missing -- an answer built on a guess about them reads perfectly fine,
so it is never corrected. That is the failure this tool prevents.

CALL THIS the moment the conversation is about them rather than about
the world: anything they call "my", anything they have done, use,
decided, plan, or care about. Their persona covers --
    profile        Name, bio, work history, education
    projects       What they are building, and what state it is in
    knowledge      Skills and domains, and how deep each goes
    preferences    How they want answers written
    circle         People and relationships
    lifestyle      Hobbies, interests and values
    learning_log   What they have been learning, dated
    goals          What they are working towards

Call it too before any task where a wrong guess about them ends up in
the output: writing in their voice, recommending a tool, planning their
week, reviewing their code, drafting something they will send.

Start with "minimal" -- the smallest scope, and enough for most
questions.

DO NOT CALL for general knowledge, or for code that has nothing to do
with them. To find one entry, use search_context then get_entity --
never widen the scope to go looking.
```

`SCOPES`, `SECTION SCOPES`, `ARGS` and `RETURNS` stay, below this.

Three things are load-bearing:

**The deficiency argument leads.** Context7's most effective line is not an
instruction, it is an argument about the model's own gap: *"Use even when you
think you know the answer — your training data may not reflect recent
changes."* That reframes not-calling as being wrong. "Call this FIRST at
conversation start" is a rule with no stated cost for breaking it, and rules
lose to the pull of answering.

**"About them rather than about the world"** is the line that generalises. It
holds whatever section packs are installed, and it is the only sentence here
that would still be right for a pack nobody has written yet.

**No token estimate.** An earlier draft said `minimal` is "~150 tokens". Persona
sizes vary enormously between users, so any number in a static description is
wrong for nearly everyone. The description makes the relative claim instead —
"the smallest scope". See §4 for why the runtime number is not the answer
either.

#### The section list is generated, not written

Every manifest in `backend/section_packs/*/manifest.json` already carries `key`,
`title` and a one-line `description` in the right register — *"People and
relationships"*, *"Visual styles, palettes, and influences you prefer or
avoid"*. The same strings the Sections manager shows.

The block is rendered from those at startup. A hand-written list would go stale
the first time somebody installs a pack, and the failure would be silent: a
section present in the data and absent from the only text telling a model to
look for it.

Rendered from **loaded packs**, not from a user's **enabled sections**. Which
sections an individual has switched on is their configuration, and a tool schema
is public — the same reason `skill://` resources are not scope-gated while the
tools are. It also keeps the description static per instance, which is what
FastMCP's registration-time descriptions want.

The `key` column earns its place by doubling as the `scope` argument.

### 2. `propose_update` — invert it

The hardest trigger, because it fires on a moment with no lexical cue. It gets
all three treatments.

**Top: the quoted trigger phrases**, moved out of `instructions`.

```
"we've switched to X" / "I've started using X"      -> domain, work_skill
"I've been doing X for a month"                     -> domain level, hobby
"we shipped it" / "that's done" / "I've parked it"  -> project status
"always give me X first" / "stop doing Y"           -> response_format
"I can't stand X" / "I love X"                      -> dislike, like
"my sister just started a PhD"                      -> connection
"I want to be running 10k by March"                 -> goal
"I got the job" / "I've left"                       -> work_experience
```

This is the only pattern-matchable material MyGist has, and it currently sits
in the channel least likely to arrive.

**Middle: the rule.** Asked writes (`persona_modify`), inferred proposes. No
third case. Every proposal needs evidence in the user's own words — if you
cannot quote them, do not send it.

**Bottom: a skeleton, and a pointer.** The full `HOW MUCH TO SEND IN data`
prose — the add/update/remove rules about which fields to send — moves into
`get_schema`'s digest, which exists to answer "what shape" and already carries
usage instructions (`server.py:2611`). The description keeps only the two
`KINDS` skeletons and one line: call `get_schema` for the entity vocabulary and
the field rules.

That material is already half-duplicated — the current description ends the
section with *"This is the same shape get_schema's examples show for
persona_modify"* — so this removes a second copy that can drift, as well as
clearing the trigger's path.

**The risk, stated:** a model that decides to propose and does **not** call
`get_schema` first will guess the field rules and send an over-padded `update`.
Two things contain it. `propose_update` already validates per item and returns
`invalid` without sinking the batch (`server.py:3631`). And the failure is
visible to the user — an over-padded proposal shows up as a review row carrying
values already on record, which is a legible symptom rather than a silent one.
If it turns out to be common, the field rules come back as three lines, not
thirty.

### 3. `search_context` — a when, not a comparison

It currently claims to be the *"PREFERRED way to find specific persona
content"*. That is a claim relative to other tools, not to anything a user
says.

It gains a trigger: call it when they refer to something they told you before,
or ask what they decided, tried, read, used or chose. Those verbs are the cue
that a stored entry exists.

### 4. Result footers, on the two read tools only

`get_context` returns what it left behind:

```json
"not_in_this_scope": { "learning_log": 31, "projects": 14 },
"note": "search_context(query) then get_entity(id) to pull any of those. Heard something durable? propose_update. Do not narrate either."
```

A tool result is the one place where the "was this worth calling" question is
already settled, and where attention is high. The counts are the
`search_context` trigger delivered at the only moment the model is already
thinking about the persona, and the reminder is the closest `propose_update`
can get to firing on a moment.

#### `token_estimate` comes out

`server.py:494` currently appends
`token_estimate = len(json.dumps(payload)) // 4` to every `get_context`
payload. It goes.

It measures the payload the model is **already holding**. By the time it can
read the number it has paid for every token counted, and there is no decision
left to make with it — it cannot un-load a scope. It is a receipt for a
purchase that cannot be returned.

`not_in_this_scope` is the same idea pointed the other way, which is what makes
it worth its bytes: it describes what has **not** been paid for yet, and there
is an action attached.

Removal is contained. Nothing in the frontend or the docs site reads it. Three
tests do:

| Test | What it actually asserts | Becomes |
|---|---|---|
| `test_context_titles.py:47` | titles mode is smaller than full | assert on serialised length directly |
| `test_context_efficiency.py:94` | the estimate matches the payload | deleted with the field |
| `test_context_efficiency.py:39`, `test_topic_rewire.py:29` | exact key set | drop the key |

The scope sizes quoted on `/use/reading` are prose figures, not derived from
this field, and that page already calls them indicative. They stay.

Constraints that keep it from becoming noise:

- **One short static string.** No session state, no escalation, no counting how
  many turns since the last proposal. A footer that varies with how well the
  model is behaving is a footer that nags.
- **"Do not narrate either"** is in the text, because the `instructions`
  already forbid narrating the plumbing and a footer is exactly the thing that
  invites it.
- **Read tools only.** `persona_modify` and `propose_update` already return
  receipts, and a nudge on a write is a nudge to write more.

### 5. The `instructions` string shrinks

With `PROPOSE WHEN YOU HEAR` moved into `propose_update`, the string returns to
what the comment at `server.py:2795` says it should be: a pointer to the skills
and nothing the tool descriptions already carry.

`test_skill_resources.py:138` asserts `20 <= len(lines) <= 45`. The rewrite will
land near the floor, so the assertion needs checking rather than assuming —
lower the floor if the shortened string is genuinely complete, and do not pad
it to satisfy a test.

### 6. Make deploy drift visible

`/api/instance` (`main.py:521`) is unauthenticated and already returns
`invite_only` and `mcp_oauth`. It gains the commit stamp the image is built
with.

Small, and directly caused by this investigation: the reason nobody noticed
production might be serving a two-day-old instructions string is that there was
no way to ask.

### 7. Guards

The existing test at `test_skill_resources.py:124` proves this kind of guard
works — it is what stopped the old tool-listing string coming back.

- Every tool description opens with a when-clause, not a capability blurb.
- The generated section block names every loaded pack. A pack that loads and
  does not appear is a silent hole.
- `propose_update`'s description carries the trigger phrases, and the
  `instructions` string no longer does. Two assertions, so the material cannot
  end up in both places or neither.

## What this cannot do

It cannot tell you whether it worked.

Triggering is invisible from the server. You see the calls that happened, never
the ones that should have, and the failure leaves no trace in the conversation
either. Every claim in this document about what will improve behaviour is a
judgement, not a measurement.

A per-tool call counter on the instance would turn "`propose_update` is the
least-used tool" from an impression into a number that can be watched across a
deploy. It was raised during design and is **not in scope here** — recorded so
the next spec does not re-derive it.

## Order of work

1. `/api/instance` commit stamp, and settle whether production is stale. Doing
   anything else first risks writing prose for a channel that is not arriving.
2. Generated section block, with its guard.
3. `get_context` description.
4. `propose_update` restructure, `search_context` when-clause.
5. `instructions` shrink, and the floor on its test.
6. Result footers, and `token_estimate` out in the same change — they touch the
   same payload builder, and shipping them apart means editing
   `get_scoped_context` and its tests twice.

Steps 2–6 are one deploy. Step 1 is worth landing on its own so the answer to
"is this live" exists before there is something to check.
