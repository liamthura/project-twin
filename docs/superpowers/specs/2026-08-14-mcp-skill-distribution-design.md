# Shipping the skills with the MCP server — design

Date: 2026-08-14
Status: approved, implementing

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

Layers 3–5 are recorded here so the next spec does not re-derive them.

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
