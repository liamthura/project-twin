# Lean context reads — design

Date: 2026-10-02
Status: designed, not implemented

## Why

`get_context` was built when a persona was a page of facts. A year of use has
turned the biggest one into 143k characters, and the read tools still behave as
if it were a page.

- `get_context(scope="full")` on Liam's persona is 148k characters, about 37k
  tokens. Claude Code's cap is 25k, so the result is saved to a file and the
  model gets a path instead of the persona.
- The learning log is 53% of that: 52 entries, one of them 8k characters on its
  own. It is the largest section on every account on prod (average 25k
  characters, maximum 76k).
- `detail="titles"` already exists, but it isn't the default.

Only one of eleven personas on prod is large today (median 372 characters, 90th
percentile 10.5k). It is the one that gets used every day, and it is what an
active persona grows into.

## What the review found

The layering is right. MyGist reveals the persona in three levels: `minimal`
plus per-section counts, then titles, then `get_entity`. That's the same tiered
pattern Agent Skills, Letta's memory blocks, ChatGPT's saved memories and
Claude's memory tool use. Nobody in that survey dumps the archive into every
call.

The defaults and limits are what's wrong.

1. **Nothing caps a single response.** A scope decides *which* sections come
   back, never *how much* of them. Topic reads can return up to 100 full
   entries, a `get_entity` batch can return 25 long ones, and the `full` index
   grows with every entry.
2. **Claude Code cuts every tool description at 2,048 characters.**
   `get_context`'s is 3,129, so its whole ARGS block is lost, `detail` included.
   That's the likely reason titles mode goes unused. `propose_update`'s is
   6,278 and loses 4,230 characters; `persona_modify`'s is 2,255 and loses
   207. Confirmed in a live session: the description arrived ending
   "personal Life … [truncated]".
3. **The learning log is read like a profile section.** Only the global
   `learning` scope limits it to 60 days. `scope="learning_log"` and `full`
   return every entry.
4. **Titles mode is too thin, and timestamps are inconsistent.** Stubs drop
   `status`, so an index can't tell active work from finished work.
   `updated_at` appears on stubs but not on full entries.
5. **Every result arrives double-encoded.** FastMCP gives each `-> str` tool an
   auto-generated `{"result": string}` output schema, so each result goes out
   twice: once as text, and once as `structuredContent` with the payload as an
   escaped JSON string. Claude Code passes the structured copy on, so models
   read `{\"scope\": ...}`.
6. **No tool carries annotations.** ChatGPT treats a tool without
   `readOnlyHint` as a write and asks the user to confirm it. Claude's connector
   directory requires `title` plus `readOnlyHint` or `destructiveHint`.
7. **Drill-down results are padded.** `search_context` and `get_entity` use
   `indent=2` and ASCII escaping. Each hit carries `score`, `fts_hit`,
   `distance` and `<b>` tags, and its snippet repeats the title.

Prod usage since 16 Aug: `get_context` 55 calls, `search_context` 35,
`get_entity` 15, `get_raw` 7. Search-then-fetch already happens; it just isn't
what a model reaches for first.

### Sources

- Claude Code MCP limits (10k warning, 25k cap, file spill,
  `anthropic/maxResultSizeChars`): https://code.claude.com/docs/en/mcp
- Anthropic, "Writing effective tools for agents": a concise/detailed switch
  (206 → 72 tokens), default limits, and telling the agent how to get the rest
  when truncating. https://www.anthropic.com/engineering/writing-tools-for-agents
- MCP spec 2025-06-18: `structuredContent`, `outputSchema`, `resource_link`.
  Tool annotations arrived in 2025-03-26.
  https://modelcontextprotocol.io/specification/2025-06-18/changelog
- claude.ai connectors (~150k character result cap; directory requires
  annotations): https://claude.com/docs/connectors/building
- ChatGPT treats tools without `readOnlyHint` as writes:
  https://developers.openai.com/api/docs/guides/developer-mode
- Chroma context rot: a focused ~300-token prompt beat the full ~113k on every
  model tested. https://www.trychroma.com/research/context-rot
- LongMemEval: models lose 30–60% accuracy when handed the whole history
  instead of the relevant evidence. https://arxiv.org/html/2410.10813

## Decisions

### 1. Read path

#### 1.1 A cap on every read result

`RESULT_BUDGET_CHARS = 32_000`, about 8k tokens, measured on the compact JSON
the client receives. That stays under Claude Code's 10k warning and well inside
every other known cap.

**`get_context`** checks the cap after every existing filter and hook, and
after stubbing. Over it, the result is cut down in steps, re-measured after
each, until it fits:

1. If the read is in full detail, cut id-lists down to titles, largest first.
2. Shorten id-lists, largest first, to their newest 5 entries: by `updated_at`,
   or by `timestamp` for the learning log. Entries with neither sort last.
3. Shorten those lists to an empty list, leaving only the count in `trimmed`.

"Largest" means the most serialised characters. One helper applies the cap and
writes `trimmed`, and both `get_context` and the section resource (4.1) call
it.

Every cut is recorded under a top-level `trimmed` key, which says what was cut
and which call gets it back:

```json
"trimmed": {
  "learning_log.entries": {
    "shown": 5, "total": 52, "detail": "titles",
    "more": "get_context(scope=\"learning_log\", days=30) or search_context(query)"
  }
}
```

The footer note mentions `trimmed` whenever it is present. Nothing is cut
without being listed.

**Topic reads** go through `get_context`, so they get the same cap.

**`get_entity`** batches add entries in request order until the next one would
pass the cap. The remaining ids come back in place as
`{"entity_id": "...", "deferred": true}`, with a note to fetch them in another
call. A single entry is always returned whole, even if it passes the cap by
itself, because cutting text the user wrote would lose data. Known ceiling: one entry larger
than the cap still goes past it. The code marks this with a `ponytail:` comment.

**`search_context`** needs no cap. 25 hits of trimmed snippets come to about 10k
characters.

**`get_raw`** is exempt. It is the export surface, and its description says so.

#### 1.2 Titles by default, except `minimal`

`get_context`'s `detail` parameter becomes `Optional[str] = None`. The tool
resolves it as follows:

| Call | Resolved `detail` |
|---|---|
| `scope="minimal"` (the bare string) | `"full"`, exactly as today |
| any other scope, list or section | `"titles"` |
| explicit `detail="full"` or `"titles"` | as given |

The resolving happens in the tool, not in `get_scoped_context`, whose default
stays `"full"`, so its callers and tests don't move. Preferences, bio, wellness
and every other field that isn't an entry list stay in full, as titles mode
already does.

#### 1.3 Stub shape

`{id, title, status?, stance?, reaction?, updated_at?}`

`status` joins `stance` and `reaction` in surviving stubbing, and like them
only appears when the entry has it. Without it, "what am I working on" means
fetching every project to tell the active ones from the finished ones.

#### 1.4 `updated_at` in full mode too

Full-detail entries gain `updated_at` from the same single
`entity_update_times` lookup the stubs use. Both modes now carry the same
timestamps.

#### 1.5 The learning log is a log

When `learning_log` is in the result and the call passes no `days`, `limit` or
`topic`:

| Scope | Default window |
|---|---|
| `learning`, alone or in a list | last 60 days (unchanged) |
| anything else carrying it: `learning_log`, `full`, lists | newest 10 entries |

`days` and `limit` override the window, as they do today. With titles as the
default, the newest 10 cost about 800 characters.

### 2. Tool surface

#### 2.1 Descriptions under 2,048 characters

Every tool description stays at or under 2,048 characters, with what a model
needs to choose the tool in the first ~500. A test asserts the cap for every
registered tool, so it holds as tools change.

- **`get_context`** keeps its generated section list, the scopes and every
  argument, `detail` included. The opening argument for calling it, which the
  tool-triggering spec chose deliberately, stays but gets shorter. The section
  list grows by one line per pack. If a new pack ever pushes the description
  over the cap, the test fails, and that's the time to shorten the list.
- **`propose_update`** keeps its trigger list, the asked-writes/inferred-proposes
  rule and the VOICE rule. The entity vocabulary and field rules move to
  `get_schema()` and the `mygist-capture` skill.
- **`persona_modify`** loses an example or two.

Detail that comes out of the descriptions goes into the skills (4.3), which
clients read on demand.

#### 2.2 Annotations and titles

| Tool | `title` | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
|---|---|---|---|---|
| `get_context` | Read persona | true | | false |
| `search_context` | Search persona | true | | false |
| `get_entity` | Fetch persona entries | true | | false |
| `get_raw` | Export persona | true | | false |
| `get_schema` | Persona schema | true | | false |
| `whoami` | Connection details | true | | false |
| `persona_modify` | Edit persona | false | true | false |
| `persona_batch` | Edit persona in bulk | false | true | false |
| `propose_update` | Suggest a persona update | false | false | false |

`propose_update` sets `destructiveHint: false` explicitly, because the spec's
default for a non-read-only tool is `true` and it only adds to the review queue.

**Visible effect:** clients that auto-approve read-only tools (claude.ai
directory connectors, ChatGPT) will stop asking before reads. That's intended.

#### 2.3 Server instructions

No change. They are 1,315 characters, under the cap, and the first 512 already
make sense on their own (ChatGPT's guidance).

### 3. Structured results

#### 3.1 Read tools return real structured content

The six read tools declare an output schema and return the payload itself as
`structuredContent`. The text block carries the same payload as compact JSON
(`separators=(",", ":")`, `ensure_ascii=False`). Clients get one encoding of
the data, not JSON inside a string.

Schemas describe the top-level keys only and allow extra properties, so a new
section pack or footer field doesn't break them. The MCP spec requires
`structuredContent` to conform to a declared schema, and a test checks every
read tool's real output against its schema.

#### 3.2 Write tools return plain text

`persona_modify`, `persona_batch` and `propose_update` set `output_schema=None`.
Their receipts ("✅ Added…") arrive as text, without the `{"result": ...}`
wrapper.

#### 3.3 Errors use `isError`

A failure the model must not mistake for data is raised as `ToolError`, which
MCP returns with `isError: true`. The message keeps its wording without the ❌.

| Tool | Raises `ToolError` | Stays as data |
|---|---|---|
| `get_context` | unknown scope, unknown detail, disabled section | |
| `search_context` | empty query, unknown or all-disabled sections, bad `days` | |
| `get_entity` (one id) | unknown prefix, disabled section, not found | |
| `get_entity` (list) | empty list, more than 25 ids | per-id `{"entity_id", "error"}` |
| `get_raw` | unknown or disabled file | |
| `get_schema` | unknown entity or file | |
| `persona_modify` | any whole-call failure that returns a ❌ string today | advisories on a success |
| `persona_batch` | a malformed `operations` argument | each operation's result line |
| `propose_update` | a malformed `proposals` argument | per-proposal outcomes (`duplicate_pending`, `previously_rejected`, …) |

Read tools have to raise because a declared schema can't carry an error string.
Write tools follow the same rule because a failed write read as a success is
the worse outcome.

#### 3.4 Lean search hits

A hit becomes `{entity_id, section, title, snippet, updated_at}`.

- `score`, `fts_hit` and `distance` go. They mean nothing to the model, and
  `_filter_by_topic` reads them from `search_index.search` directly, not from
  the tool output.
- The `<b>…</b>` highlight tags are removed from snippets.
- A snippet that starts with the hit's own title line has that line removed.
- Top-level `mode` stays (one field, and the docs refer to it).

#### 3.5 Compact serialisation everywhere

`indent=2` comes out of every tool. Compact JSON with non-ASCII left as is is
the one format.

### 4. Resources, links and skills

#### 4.1 Persona resource templates

| URI template | Returns |
|---|---|
| `mygist://entity/{entity_id}` | the same payload as `get_entity(entity_id)`, read count bumped too |
| `mygist://section/{key}` | `get_scoped_context(key, detail="titles")`, under the same cap |

Both are `application/json`, and both are read with the caller's own user id,
which the HTTP layer already sets on every `/mcp` request.

**Gating.** Unlike the `skill://` resources, these hold persona data.
`ScopeMiddleware` gains three hooks:

- `on_list_resource_templates`: hides `mygist://` templates when there is no
  `persona:read` grant.
- `on_read_resource`: refuses `mygist://` URIs without `persona:read`.
- `on_list_resources`: unchanged.

With no grant, both hooks fail closed: nothing listed, read refused. `skill://`
URIs stay public, as today.

**Errors.** A disabled section, an unknown section key, or an id that doesn't
resolve raises a resource error, with the same wording as the matching tool
error.

#### 4.2 Resource links only for what a result left out

- `get_context` adds one `resource_link` per section that `trimmed` or
  `not_in_this_scope` names (one link per section, even if both name it), pointing at `mygist://section/<key>`, with a
  description like "47 entries not included". With 11 sections that's at most
  11 links, under Claude Code's limit of 50 per result.
- `get_entity` adds one `resource_link` per deferred id, pointing at
  `mygist://entity/<id>`.
- Search hits get **no** links. Each would add a line per hit and repeat an id
  that's already in the hit.

Every link sits next to a tool call that does the same thing (the `more`
strings, and the deferred note). A client that ignores resources loses nothing.
Claude Code passes resource-link blocks on alongside `structuredContent`.

#### 4.3 Skills

- **`mygist-reading`** is rewritten around the new flow: read the index, fetch
  by id, what a `trimmed` notice means and how to follow it, the two resource
  URIs, and the learning-log window. It picks up whatever the `get_context`
  description loses.
- **`mygist-capture` / `mygist-writing`** pick up the entity vocabulary and
  field rules that leave `propose_update`'s description.
- **`mygist`** keeps its trigger list. Only lines that describe changed
  behaviour get edited.
- The skill resources gain the annotation `audience: ["assistant"]`.
- `test_skills_match_the_tools.py` keeps guarding tool names. A new check
  asserts that every `mygist://` URI a skill mentions matches a registered
  template.

#### 4.4 The official skills extension waits

`io.modelcontextprotocol/skills` (SEP-2640) needs the `skills/list` and
`skills/get` methods from protocol 2026-07-28. The pinned fastmcp 2.14.2 and
mcp 1.25.0 stop at 2025-11-25. No Claude client supports the extension yet: the
support matrix lists ChatGPT (partial) and a few developer tools
(https://modelcontextprotocol.io/extensions/client-matrix).

`skill://mygist/<name>/SKILL.md` already follows its layout rule that the
parent directory matches `name`, so adopting it later is mostly a version
upgrade.

## Versions: no upgrade in this change

Everything above runs on the pinned fastmcp 2.14.2 and mcp 1.25.0. Checked in
the installed source: tool `title`/`annotations`/`output_schema`/`meta`,
`ToolResult(content, structured_content)`, `ResourceLink`, resource templates,
and the middleware hooks.

FastMCP is now at 4.0.10, two majors ahead. Protocol 2026-07-28 removes
`initialize` and sessions, which the auth context, `ScopeMiddleware` and
`mcp_activity` (which reads `clientInfo` from `initialize`) all rely on.
`requirements.txt` already warns that a FastMCP bump needs re-testing. Folding
that into a behaviour change would make any regression hard to trace.

**Follow-up:** a separate spec for fastmcp 4 / mcp 2 and protocol 2026-07-28,
taken with this change's tests as the safety net. The skills extension follows
it.

## Not doing

| Not doing | Why | When |
|---|---|---|
| A paging cursor | The `trimmed` notice, `days`/`limit` and search reach everything. | When one section's titles alone pass the cap, around 375 entries. |
| A cap on `get_raw` | It's the export path. | If clients start calling it for ordinary reads. |
| Raising Claude Code's limit with `anthropic/maxResultSizeChars` | It works against everything above, and only Claude Code supports it. | Never. |
| ChatGPT `search`/`fetch` compatibility | A separate feature: ChatGPT's deep research only uses tools in that shape. | Its own spec. |
| A summary or digest of the learning log | Summaries lost accuracy as the thing retrieved (LongMemEval, LoCoMo), and a generated one would have to go through the review queue. | If an orientation layer is ever wanted. |
| A cap on `likes_dislikes` | It rides in full in every scope and has no upper limit, but the largest today has 2 entries. | `# ponytail:` comment at `ALWAYS_ON`; add a cap when one passes ~30. |

## Expected effect on Liam's persona

| Call | Today | After (estimate) |
|---|---|---|
| `minimal` | unchanged | unchanged, plus `updated_at` |
| `professional` | ~30k chars, ~8k tokens | ~10k chars, ~2.5k tokens |
| `full` | 148k chars, saved to a file | ~20k chars (~5k tokens), titles |
| `learning_log` section | ~76k chars, every entry | ~3.5k chars: newest 10 titles plus the always-on preferences |
| `search_context`, 10 hits | pretty-printed, escaped | roughly 40% smaller |

## Testing

All in `backend/tests`, against the test database the suite already uses.

**Read path:**
- A synthetic large persona (200 learning entries of ~2k characters, 60
  projects) stays at or under the cap.
- The `trimmed` records have the right shown and total counts, and the newest
  entries survive.
- Explicit `detail="full"` falls back to titles first.
- `get_entity` defers the right ids, and one oversized entity is still returned
  whole.

**Defaults:**
- The resolution table in 1.2, cell by cell.
- `get_scoped_context` still defaults to full.

**Stubs:** `status`/`stance`/`reaction` survive only where present, and full
mode carries `updated_at`.

**Learning log:** the window in 1.5 for each scope, and overrides with `days`,
`limit` and `topic`.

**Tool surface:**
- Every description is at or under 2,048 characters.
- Each tool's annotations and title match the table in 2.2.

**Structured results:**
- Each read tool's output validates against its declared schema.
- The text block equals the compact serialisation of `structuredContent`.
- Write tools have no output schema and return text.

**Errors:** each "raises" cell in 3.3 comes back as `isError`, and each
"stays as data" cell doesn't.

**Search:** hits have exactly the five keys, no `<b>` tags, and no leading
title line.

**Resources:**
- Templates are listed only with `persona:read`.
- A read without the grant is refused.
- A disabled section is refused.
- Two-user isolation, following `test_tenant_isolation.py`: user A cannot read
  user B's entity by URI.
- `get_context` and `get_entity` emit links only where 4.2 says.

**Skills:** URIs mentioned in skills match registered templates, and the
tool-name guard still passes.

**End to end:**
1. JSON-RPC against the local preview, following the "verify MCP against the
   running preview" procedure. Check the `structuredContent` shape, `isError`,
   annotations in `tools/list`, and a `resources/read` with and without
   `persona:read`.
2. Claude Code against staging, whose database is a 24 Sep copy of prod and so
   includes Liam's persona. Confirm `full` arrives inline with no file spill,
   the description arrives whole, and a `trimmed` notice is followed correctly.

## Rollout

- **Docs:** `docs-site/content/docs/use/reading.mdx` (its scope-size table and
  the titles example) and a changelog entry describing the behaviour change for
  connected clients.
- **Version:** decided at release, following the current numbering.
- **No migration.**
