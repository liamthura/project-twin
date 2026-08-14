# Shipping the skills with the MCP server — design

Date: 2026-08-14
Status: shipped (layers 1 and 2). Layers 3–5 deferred by decision, not pending.

## Why

Four skills teach an agent how to use MyGist well — which scope to read, when to
write versus propose, what a proposal needs. They currently live in
`~/.claude/skills/` on one laptop. **Their audience is one person.** Every user
who connects MyGist gets the tool schemas and nothing else, which is why
`propose_update` is the least-used tool in the product.

The skills are only useful if they travel with the server.

## What the reference implementation does

Figma's plugin was read rather than recalled — it is installed in this machine's
plugin cache and its resources were listed live. It ships five layers:

| Layer | Artefact | Reaches |
|---|---|---|
| 1 | the MCP `instructions` string | every client, no install |
| 2 | skills as MCP resources at `skill://…` | every client that reads resources |
| 3 | `.claude-plugin/plugin.json` + `.mcp.json` + `skills/` | Claude Code, one command |
| 4 | `gemini-extension.json`, `.cursor-plugin/`, `server.json` | Gemini CLI, Cursor, MCP registry |
| 5 | in-product prompt | people already connecting a client |

**This spec covers layers 1 and 2 only**, at the owner's direction. They are the
two that reach every client without anyone installing anything, and MyGist's
whole proposition is that every assistant reads the same persona — so a
Claude-Code-only channel is the wrong place to start.

Layers 3–5 are recorded here so the next spec does not re-derive them. **They were
then declined outright, not shelved for the end of this piece of work** — layers 1
and 2 reach every client, and a plugin adds a second place to keep the same four
files in sync for the benefit of one client that can already read them.

One consequence to know about: the instructions say *"Prefer a plugin's copy where
one is installed"*, and no plugin exists. That reads oddly today and is deliberate
— it is a conditional that is simply false for now and becomes true the day layer
3 ships, with no change needed here.

## Layer 1: the `instructions` string

`server.py:2794` currently reads:

```
MyGist is your portable personal context for AI.

Available tools:
- get_context: Retrieve scoped persona context (minimal/professional/…)
- get_raw: Get raw JSON file data for detailed inspection
… four more …

Always call get_context at the start of conversations to personalize responses.
```

Six of its ten lines re-list tools **the client already has in its tool schema**.
This string is injected into the system prompt of every conversation in every
client that connects. Spending that budget on a list the model can already see is
the single most wasteful paragraph in the codebase.

What replaces it, in order:

1. One line on what MyGist is.
2. **Start here** — `get_context` first, smallest scope, `full` is a debug
   surface.
3. **The rule** — asked writes (`persona_modify`), inferred proposes
   (`propose_update`), no third case.
4. **Propose when you hear** — a compressed trigger list. This is the part that
   changes behaviour; everything above it is already implied by the tool
   descriptions.
5. **Skills** — the four names, and how to load them: prefer a plugin's copy if
   one is installed, otherwise read the `skill://` resource.
6. One line: do not narrate the plumbing.

**Capped at 45 lines, enforced by a test.** The first draft of this spec said
"about forty"; the written string came out at 44 and everything left in it is
load-bearing, so the number moved rather than the content — trimming further would
have cut trigger rows, which are the whole reason for the rewrite. The cap exists
to stop drift, and 45 does that job as well as 40 would have.

It is a pointer to the skills, not a replacement for them. The moment it tries to
be both, it stops being cheap enough to send every time.

## Layer 2: skills as MCP resources

### Where the files live

`backend/skills/<name>/SKILL.md`. The `Dockerfile` does `COPY backend/ .`
(line 79), so anything under `backend/` ships in the image with no build change.

**The repo becomes the single source of truth.** `~/.claude/skills/` then holds a
copy, which will drift. Accepted for now and stated rather than hidden: the fix
is a symlink or a sync script, and it belongs with layer 3, which needs the same
files in a third place.

### URI shape

```
skill://mygist/mygist/SKILL.md
skill://mygist/mygist-reading/SKILL.md
skill://mygist/mygist-writing/SKILL.md
skill://mygist/mygist-capture/SKILL.md
skill://index.json
```

`skill://mygist/<name>/SKILL.md` rather than `file://`, matching what Figma
serves, so a client that already understands one understands the other.

### Registered statically, one per skill

Verified with an in-memory FastMCP client on the pinned 2.14.2:

- a custom `skill://` scheme passes URI validation
- a static resource appears in `list_resources()` with its `name` and `mimeType`
- a templated `skill://mygist/{name}/SKILL.md` resolves on read but **does not
  appear in `list_resources()`** — it is only in `list_resource_templates()`

That last point decides the design. A template alone would make the skills
invisible to anyone browsing what the server offers, which is the entire goal.
So: scan `backend/skills/` at import and register one static resource per file,
with `name` and `description` read from the file's own frontmatter.

`skill://index.json` carries the same list machine-readably, for a client that
would rather fetch one thing than list everything.

### Frontmatter parsing

There is no YAML dependency in `backend/requirements.txt` and this does not
justify adding one. The frontmatter is two flat single-line keys, `name` and
`description`, and a twelve-line parser handles it: take the block between the
first two `---` lines, split each line on its **first** colon. Anything else in
the block is ignored rather than guessed at.

If a skill file has no parseable `name`, that is a build-time mistake, and the
test suite fails rather than the server serving an unnamed resource.

### Not scope-gated, deliberately

`mcp_scopes.py` filters the tool list per grant. Resources are not filtered, and
should not be: a skill file is public documentation about how to call an API. It
contains no persona data, and a client that cannot read anyone's persona still
benefits from knowing how the tools work.

Worth being explicit because the file's own docstring says the middleware exists
to decide "which of the eight tools it may see and use" — resources were simply
not in its scope, and this adds the first ones.

## New code

| File | Holds |
|---|---|
| `backend/skills/*/SKILL.md` | the four skills, moved from `~/.claude/skills` |
| `backend/skill_resources.py` | the scan, the frontmatter parser, the registration |
| `backend/tests/test_skill_resources.py` | the tests below |

`skill_resources.py` is its own module rather than more of `server.py`, which is
already past 3,600 lines.

## Testing

- The four skills are listed, each with a non-empty name and description and
  `mimeType: text/markdown`.
- Each reads back the file's real bytes.
- `skill://index.json` lists exactly the directories on disk — so adding a skill
  without it appearing is impossible.
- Frontmatter parsing: a description containing a colon survives; a file with no
  frontmatter fails loudly.
- **Every skill named in the `instructions` string exists on disk.** This is the
  test worth having. The failure it prevents is instructions that point an agent
  at a skill nobody shipped.

## Verified against the running preview

The in-process tests use FastMCP's in-memory client, which bypasses HTTP, the
auth middleware and the scope filter — so they say nothing about whether a real
client can reach any of this. Driven over `/mcp` against
`scripts/local-preview.sh` on this branch, with a read-only token minted in the
container:

- `initialize` returns the new instructions: 44 lines, trigger table present,
  `skill://mygist` pointer present, `Available tools:` gone.
- `capabilities` advertises `resources`, which it did not before.
- `resources/list` returns all five with the right `mimeType` and `name`.
- `resources/read` on `skill://mygist/mygist-capture/SKILL.md` returns 6,205
  bytes of the real file, worked examples included.
- `skill://index.json` parses and lists the four.
- A **`persona:read`-only** grant reaches all of it, which is the intended
  behaviour: skills are documentation, not persona data.

Probe token revoked afterwards, and confirmed dead — the same request now
answers 401.

## Out of scope

- Layers 3–5.
- `references/` sub-resources. Figma serves them; none of these four skills has
  one yet, and inventing the hierarchy before there is a second file to put in it
  is speculative.
- MCP prompts, which would surface as slash commands. Worth considering with
  layer 3, not before.
- `_meta.ideToolTitles`, which belongs in a `.mcp.json` — layer 3.
- Deduplicating `~/.claude/skills/` against the repo copy.

## Follow-up: MCP prompts, 2026-08-14

Added after a critique of this spec's own reasoning. The five-layer plan was
copied from Figma, whose MCP server **is** a coding-agent product — design to
code, Code Connect, `.figma.ts` files. MyGist's schema is `aesthetics`, `media`,
`circle`, `sleep`, `personality_trait`. The audience is a person talking to a
chat assistant, so a plugin aimed at Claude Code was the distribution strategy of
a product whose users are the inverse of MyGist's. Layers 3–5 stay declined, and
prompts take their place — server-side, client-agnostic, no install.

### Why prompts repair the weak part of layer 2

Layer 2 was verified at the protocol level and **not** at the uptake level. A
`skill://` resource only helps if a client autonomously fetches it, and in a chat
client resources are generally surfaced for the *user* to attach rather than read
by the model unprompted. So the skills may sit there unread.

A prompt fixes that from the other end. It is user-invoked — it appears in the
client's own UI — and its text can instruct the agent to read the skill first. The
user picking "Catch up my persona" is what makes the skill load, in any client,
with no plugin. That turns layer 2 from *hope the agent looks* into *the user can
make it look*, which is a materially different claim.

### The three

Three, not eight. A menu of actions nobody uses is noise, and each one has to earn
its row.

| Prompt | Needs | What it is for |
|---|---|---|
| `catch_up` | `persona:propose` | "Review this conversation and propose anything durable." The under-proposing problem, solved from the user's side rather than by hoping the agent noticed. Tells the agent to read `mygist-capture` first. |
| `whats_on_file` | `persona:read` | Optional `topic`. "Show me what you have on me, and where it came from." Transparency for someone who has no idea what is stored, and it enforces the attribution rule rather than restating records as memories. |
| `log_learning` | `persona:write` | "Record what I worked out here in my learning log." An explicit instruction, so `persona_modify` is correct — which makes this the one prompt that demonstrates the asked/inferred boundary rather than describing it. |

### Scope-filtered, like the tools

`catch_up` tells the agent to call `propose_update`. On a `persona:read` grant that
tool is not even visible, so offering the prompt would be a broken promise —
an action in the menu that cannot do what it says.

`PROMPT_SCOPES` in `scopes.py` mirrors `TOOL_SCOPES`, and `ScopeMiddleware` gains
`on_list_prompts` and `on_get_prompt` alongside the two tool hooks it already has.
Same fail-closed behaviour: no grant on the request means an empty list.

### Not mentioned in the `instructions`

Deliberate. The instructions are at 44 of their 45 lines, and prompts are a
**client UI surface aimed at the user**, not a tool the model chooses. The client
lists them; the model does not need telling they exist. If that turns out wrong —
if an agent should be suggesting them — the honest fix is to raise the cap on
purpose, not to squeeze them in.

## Risks

- **The skills are now published.** They are written for an agent, not a reader,
  and anyone can fetch them. Nothing in them is secret, but they should be read
  once with that audience in mind before this ships.
- **`instructions` is in every conversation's context.** Growing it later is
  cheap to do and expensive to notice. The ~40-line ceiling is the point of
  writing it down.
- **fastmcp is pinned at 2.14.2** with a comment saying bumps must be deliberate.
  This adds a second reason: the resource API and the custom-scheme tolerance were
  verified against that version and nothing else.
