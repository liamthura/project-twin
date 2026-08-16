# Tool Triggering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move MyGist's trigger material out of the server `instructions` string — a channel measured to be stale in every live client — and into tool descriptions and tool results, which are fetched per session.

**Architecture:** Six changes in `backend/`. One generated string (the section list, rendered from loaded packs at import time) feeds `get_context`'s description, which is passed to `@mcp.tool(description=...)` rather than left as a docstring. `propose_update` and `search_context` are restructured in place. `get_scoped_context`'s payload loses `token_estimate` and gains `not_in_this_scope` + `note`, backed by one new `SELECT ... GROUP BY` in `search_index`. The `instructions` string shrinks to a pointer. `/api/instance` gains a commit stamp.

**Tech Stack:** Python 3.11, FastMCP 2.14.2, FastAPI, psycopg, pytest.

## Global Constraints

- **Nothing may live only in the `instructions` string.** It may summarise and it may point; it may not be the sole carrier of a behaviour. Measured: every Claude Code session on this machine in the last fortnight received the pre-`b756039` copy while production served the current one.
- **The section list is generated from loaded packs** (`sections.PACK_META`), never hand-written, and never from a user's *enabled* sections — a tool description is public and identical for every caller on an instance.
- **No token counts in any description.** Persona sizes vary per user; any number baked into a static string is wrong for nearly everyone.
- **`get_schema` is not touched.** The propose mechanics stay in `propose_update`'s own description.
- **No tool renames.** ~330 references across docs, tests, skills and frontend; out of scope.
- Tests run from `backend/` with `pytest`.

---

### Task 1: The generated section block

**Files:**
- Modify: `backend/sections.py` (append after `toggleable_sections`)
- Test: `backend/tests/test_tool_descriptions.py` (create)

**Interfaces:**
- Produces: `sections.describe_sections(indent: str = "    ") -> str` — one line per loaded pack, `f"{indent}{key:<width}  {description}"`, in pack (position) order.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_tool_descriptions.py`:

```python
"""The tool descriptions are the only channel that reaches every client every
session. The server `instructions` string is not -- see
docs/superpowers/specs/2026-08-16-tool-triggering-design.md. These guards exist
so trigger material cannot drift back into the channel that does not arrive.
"""
import sections


def test_section_block_names_every_loaded_pack():
    block = sections.describe_sections()
    for key, meta in sections.PACK_META.items():
        assert key in block, f"pack '{key}' loads but is invisible to get_context"
        assert meta["description"] in block


def test_section_block_is_indented_and_aligned():
    lines = sections.describe_sections().splitlines()
    assert len(lines) == len(sections.PACK_META)
    assert all(line.startswith("    ") for line in lines)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && python -m pytest tests/test_tool_descriptions.py -v`
Expected: FAIL — `AttributeError: module 'sections' has no attribute 'describe_sections'`

- [ ] **Step 3: Implement**

Append to `backend/sections.py`:

```python
def describe_sections(indent: str = "    ") -> str:
    """One line per loaded pack: its scope key, and the pack's own description.

    Rendered into get_context's tool description at import time so the list
    cannot go stale the first time somebody installs a pack -- a section present
    in the data and absent from the only text telling a model to look for it is
    a silent hole.

    Built from LOADED packs, never from a user's enabled sections: a tool
    description is public and identical for every caller on an instance, which
    is the same reason skill:// resources are not scope-gated while the tools
    are. The key doubles as the `scope` argument.
    """
    width = max(len(key) for key in PACK_META)
    return "\n".join(
        f"{indent}{key.ljust(width)}  {meta['description']}"
        for key, meta in PACK_META.items()
    )
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_tool_descriptions.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/sections.py backend/tests/test_tool_descriptions.py
git commit -m "feat(mcp): render the section list from loaded packs"
```

---

### Task 2: `get_context` — argument first, packs second

**Files:**
- Modify: `backend/server.py:2867-2913` (the `get_context` tool)
- Test: `backend/tests/test_tool_descriptions.py`

**Interfaces:**
- Consumes: `sections.describe_sections()` from Task 1.
- Produces: `server._GET_CONTEXT_DESCRIPTION: str`, passed as `@mcp.tool(description=...)`. `server.get_context.description` is the string an MCP client receives.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_tool_descriptions.py`:

```python
import server


def test_get_context_leads_with_the_deficiency_argument():
    desc = server.get_context.description
    assert desc.startswith("Load the user's persona before you answer.")
    assert "never met this user" in desc
    assert "about them rather than about the world" in desc
    # No token count: persona sizes vary per user, so any number here is wrong
    # for nearly everyone.
    assert "tokens" not in desc


def test_get_context_description_carries_the_generated_section_block():
    assert sections.describe_sections() in server.get_context.description
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && python -m pytest tests/test_tool_descriptions.py -v`
Expected: FAIL on `startswith` — the description is still the old docstring.

- [ ] **Step 3: Implement**

In `backend/server.py`, immediately above `@mcp.tool()` for `get_context`, add the constant, and change the decorator to `@mcp.tool(description=_GET_CONTEXT_DESCRIPTION)`. Replace the existing docstring with a one-line internal note.

```python
# The description an MCP client actually receives. Built here rather than left
# as a docstring for one reason: the section list is generated from the loaded
# packs (see sections.describe_sections), and a docstring cannot interpolate.
#
# It leads with an ARGUMENT rather than a rule. "Call this FIRST at conversation
# start" states no cost for not calling, and a rule with no stated cost loses to
# the pull of answering the question in front of you. Context7's most effective
# line is the same shape -- "use even when you think you know the answer, your
# training data may not reflect recent changes" -- and it fires reliably in
# clients where this tool does not.
_GET_CONTEXT_DESCRIPTION = f"""Load the user's persona before you answer.

You have never met this user. Nothing in your training data contains them, and
nothing in this conversation will tell you what you are missing -- an answer
built on a guess about them reads perfectly fine, so it is never corrected.
That is the failure this tool prevents.

CALL THIS the moment the conversation is about them rather than about the
world: anything they call "my", anything they have done, use, decided, plan or
care about. Their persona covers --
{sections.describe_sections()}

Call it too before any task where a wrong guess about them ends up in the
output: writing in their voice, recommending a tool, planning their week,
reviewing their code, drafting something they will send.

Start with "minimal" -- the smallest scope, and enough for most questions.

DO NOT CALL for general knowledge, or for code that has nothing to do with
them. To find one entry, use search_context then get_entity -- never widen the
scope to go looking.

SCOPES (global):
    minimal       Quick questions, greetings, code help: name, bio, top_of_mind, preferences
    professional  Career, projects, technical: profile, skills, projects, code_style
    personal      Life advice, hobbies, wellness: hobbies, personality, connections
    learning      Skill development, roadmaps: skills, learning_log (last 60 days)
    full          Complete dump -- prefer a targeted scope plus search_context

SECTION SCOPES: any key in the list above. A section scope returns that whole
section plus the always-on preferences (tone, detail_level, likes_dislikes,
learning_style). Pass a list to union scopes, e.g. ["lifestyle", "circle"].

ARGS:
    scope: a global scope name, a section key, or a list of them
    topic: Filter to items matching this topic (e.g. "react", "cooking")
    include_inactive: Include inactive/paused items
    days: Limit learning_log to last N days
    limit: Max learning_log entries to return
    detail: "full" (default) or "titles" -- titles mode reduces every id-list
        entity to a lightweight {{"id", "title"}} stub for browsing before
        pulling full detail via get_entity

RETURNS:
    The scoped persona, plus `not_in_this_scope`: per-section counts of what
    this scope left behind, and a note on how to reach it.
"""


@mcp.tool(description=_GET_CONTEXT_DESCRIPTION)
def get_context(
    scope: Union[str, List[str]] = "minimal",
    topic: Optional[str] = None,
    include_inactive: bool = False,
    days: Optional[int] = None,
    limit: Optional[int] = None,
    detail: str = "full"
) -> str:
    """Internal. Clients see _GET_CONTEXT_DESCRIPTION above, not this."""
    result = get_scoped_context(scope, topic, include_inactive, days, limit, detail)
    return json.dumps(result, ensure_ascii=False)
```

Note the doubled braces `{{"id", "title"}}` — the constant is an f-string.

- [ ] **Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_tool_descriptions.py tests/test_context_efficiency.py -v`
Expected: the four description tests PASS. `test_context_efficiency` still passes (Task 5 changes it).

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_tool_descriptions.py
git commit -m "feat(mcp): get_context argues its case before it states a rule"
```

---

### Task 3: `propose_update` inverted, `search_context` given a when

**Files:**
- Modify: `backend/server.py:3573-3632` (`propose_update` docstring), `backend/server.py:2959-2979` (`search_context` docstring)
- Test: `backend/tests/test_tool_descriptions.py`

**Interfaces:**
- Produces: `server.propose_update.description` carries the quoted trigger phrases; `server.search_context.description` opens with a `CALL THIS` clause.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_tool_descriptions.py`:

```python
# The quoted phrases are the only pattern-matchable trigger material MyGist has.
# They lived in the `instructions` string, which is the channel measured not to
# arrive. They belong in a tool description, and in exactly one place.
TRIGGER_PHRASES = [
    "we've switched to X",
    "I've been doing X for a month",
    "we shipped it",
    "always give me X first",
    "I can't stand X",
    "my sister just started a PhD",
    "I want to be running 10k by March",
    "I got the job",
]


def test_propose_update_leads_with_the_trigger_phrases():
    desc = server.propose_update.description
    head = desc[: desc.index("ARGS:")]
    for phrase in TRIGGER_PHRASES:
        assert phrase in head, f"{phrase!r} is not in propose_update's opening"
    assert "asked writes, inferred proposes" in desc.lower()


def test_propose_update_keeps_the_field_rules_and_does_not_defer_to_get_schema():
    desc = server.propose_update.description
    assert "ONLY what changes" in desc
    assert "mygist-writing" in desc


def test_search_context_opens_with_a_when_not_a_comparison():
    desc = server.search_context.description
    assert "CALL THIS when" in desc.split("Args:")[0]
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && python -m pytest tests/test_tool_descriptions.py -v`
Expected: FAIL — the phrases are in `instructions`, not here.

- [ ] **Step 3: Replace `propose_update`'s docstring**

`backend/server.py`, the docstring of `propose_update`, in full:

```python
    """Propose durable persona changes you inferred from the conversation.

    PROPOSE WHEN YOU HEAR:
        "we've switched to X" / "I've started using X"      -> domain, work_skill
        "I've been doing X for a month"                     -> domain level, hobby
        "we shipped it" / "that's done" / "I've parked it"  -> project status
        "always give me X first" / "stop doing Y"           -> response_format
        "I can't stand X" / "I love X"                      -> dislike, like
        "my sister just started a PhD"                      -> connection
        "I want to be running 10k by March"                 -> goal
        "I'm useless after 3pm"                             -> energy_peak, sleep
        "I got the job" / "I've left"                       -> work_experience
    Anything about them still true in a month is a candidate. Send ONE call with
    a list, not one call per item. An empty review queue usually means nobody was
    looking, not that there was nothing to say.

    THE RULE: asked writes, inferred proposes. They asked you to record it ->
    persona_modify. You worked it out from what they said -> here. No third case;
    "they would obviously want this" is the inferred case in disguise. This tool
    NEVER writes -- every proposal lands in the user's review queue and they
    approve, reject or promote it themselves, which is what makes MyGist safe to
    leave connected.

    DO NOT PROPOSE session summaries, moods, one-off task instructions, things
    the user only asked about, praise, or anything you would struggle to quote
    them on. When in doubt, do not propose -- an unreviewed queue helps nobody.

    ARGS:
        proposals (required): list of proposal objects, see KINDS below
        client (required): the product you are running in, as a user would
            name it -- "Claude Desktop", "Cursor", "Codex", "Hermes",
            "OpenClaw". Not a model name. The user sees this on every row and
            uses it to tell which of their tools proposed what.

    KINDS:
        entity -- typed and schema-valid; you know where it belongs.
            {kind: "entity", action: "add"|"update"|"remove", entity: "domain",
             data: {...}, rationale: "...", evidence: "...", confidence: 0.7}
            Call get_schema if unsure of the entity vocabulary.

        note -- durable but ambiguous; nothing in the schema holds it.
            {kind: "note", section_hint: "preferences", text: "...",
             rationale: "...", evidence: "...", confidence: 0.6}

    REQUIRED ON EVERY PROPOSAL:
        rationale -- why this is durable, in your words. ONE SENTENCE. The user
            reads it while deciding, next to a dozen others, so it has to be the
            reason -- not a restatement of the change.
        evidence -- the user's own words that prompted it. Quote them, briefly.
            If you cannot quote them, you have inferred too far and should not
            propose.

    HOW MUCH TO SEND IN `data`:
        add    -- every required field, plus any optional field you actually know.
        update -- the identifier (and parent, if it has one), plus ONLY what changes.
        remove -- the identifier and parent. Nothing else is read.
        Why, with worked examples: skill://mygist/mygist-writing/SKILL.md

    RETURN:
        {"results": [{n, result, ...}]} where result is one of:
        stored | duplicate_pending | previously_rejected |
        conflicts_with_existing | invalid
        An invalid item never sinks the batch; the valid ones still land.
    """
```

- [ ] **Step 4: Give `search_context` a when-clause**

Replace the first paragraph of `search_context`'s docstring (the `PREFERRED way to find...` block) with:

```python
    """Search the persona for relevant entries by meaning and keywords.

    CALL THIS when they refer to something they told you before, or ask what
    they decided, tried, read, used, chose, or are working on. Those verbs mean
    a stored entry probably exists, and this is far cheaper than widening a
    get_context scope to go looking for it.

    Returns small ranked snippets rather than whole sections. Follow up with
    get_entity(entity_id) for full detail on a hit. Modes: "hybrid" (FTS +
    embeddings) or "fts" (no embedding provider configured).
```

The `days` paragraph and `Args:` block below it are unchanged.

- [ ] **Step 5: Run tests**

Run: `cd backend && python -m pytest tests/test_tool_descriptions.py -v`
Expected: PASS (7 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/server.py backend/tests/test_tool_descriptions.py
git commit -m "feat(mcp): the trigger phrases move into propose_update"
```

---

### Task 4: The `instructions` string shrinks

**Files:**
- Modify: `backend/server.py:2794-2849`
- Test: `backend/tests/test_skill_resources.py:124-143`, `backend/tests/test_tool_descriptions.py`

**Interfaces:**
- Consumes: Task 3 — the phrases must already be in `propose_update` before they leave here.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_tool_descriptions.py`:

```python
from pathlib import Path


def _instructions_source() -> str:
    source = (Path(server.__file__).parent / "server.py").read_text()
    start = source.index('instructions="""')
    return source[start + len('instructions="""') : source.index('"""', start + 16)]


def test_the_triggers_are_in_the_description_and_not_in_the_instructions():
    """Two assertions, so the material cannot end up in both places or neither.

    `instructions` is written once by the server and delivered whenever by the
    client -- measured stale in every live session on 2026-08-16 while
    production served the current copy. Anything it is the SOLE carrier of is
    something an unknown share of users will never see.
    """
    instructions = _instructions_source()
    for phrase in TRIGGER_PHRASES:
        assert phrase in server.propose_update.description
        assert phrase not in instructions
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && python -m pytest tests/test_tool_descriptions.py::test_the_triggers_are_in_the_description_and_not_in_the_instructions -v`
Expected: FAIL — `"we've switched to X"` is still in `instructions`.

- [ ] **Step 3: Rewrite the string and its comment**

Replace `backend/server.py:2794-2849` with:

```python
# This string is injected into the system prompt of EVERY conversation in every
# client that connects, which makes it the most expensive prose in the codebase.
#
# It is also the LEAST RELIABLE channel the server has, and that is a measured
# fact rather than a suspicion: on 2026-08-16 production served the current copy
# while every Claude Code session on the author's machine for the previous
# fortnight -- including one connected to a server verified serving it -- still
# carried the version from before commit b756039. `tools/list` is fetched per
# session; this evidently is not.
#
# So: NOTHING MAY LIVE ONLY HERE. It may summarise and it may point; it may not
# be the only place a behaviour is specified. The trigger phrases moved to
# propose_update's description for exactly that reason. Keep it under about
# forty lines, and see
# docs/superpowers/specs/2026-08-16-tool-triggering-design.md.
mcp = FastMCP(
    "mygist",
    instructions="""MyGist is the user's portable personal context. It is theirs, it
outlives this conversation, and every other assistant they use reads it.

Call get_context before your first substantive answer, at the smallest scope that
answers the question. Then act on what you read: reading a persona and answering
exactly as you would have anyway is the most common failure with one connected.

THE RULE
Asked writes, inferred proposes.
- They asked you to record something -> persona_modify (or persona_batch).
- You worked it out from what they said -> propose_update, which cannot write and
  puts it in their review queue.
No third case. That queue is what makes MyGist safe to leave connected, and
propose_update's own description lists what to listen for.

SKILLS
Four skills cover the above in full, at skill://mygist/<name>/SKILL.md, or
skill://index.json for the list. Prefer a plugin's copy where one is installed.
- mygist            the rules, and the full trigger list
- mygist-reading    choosing a scope, filtering, what to do with preferences
- mygist-writing    entity vocabulary, identifiers, how much to send on an update
- mygist-capture    what is worth proposing, with worked examples

Do not narrate any of this. Use their context, propose what surfaces, and mention
it in one short clause or not at all."""
)
```

- [ ] **Step 4: Re-check the budget floor**

Run: `cd backend && python -m pytest tests/test_skill_resources.py -v`

If `test_instructions_stay_within_their_budget` fails on the floor, the string is genuinely shorter — lower the floor rather than padding the string. In `tests/test_skill_resources.py`, replace the assertion and its comment with:

```python
    # A floor as well as a ceiling. Without it, a slicing mistake that extracted
    # an empty string would satisfy the ceiling and this test would pass for the
    # rest of its life while checking nothing. Lowered from 20 in the tool-
    # triggering work: the trigger phrases moved into propose_update's
    # description, which is the channel that actually arrives, and the floor
    # must not be a reason to pad this string back out.
    assert 15 <= len(instructions.splitlines()) <= 45
```

- [ ] **Step 5: Run the full suite for this area**

Run: `cd backend && python -m pytest tests/test_skill_resources.py tests/test_tool_descriptions.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/server.py backend/tests/test_skill_resources.py backend/tests/test_tool_descriptions.py
git commit -m "refactor(mcp): the instructions string stops being load-bearing"
```

---

### Task 5: Result footers in, `token_estimate` out

**Files:**
- Modify: `backend/search_index.py` (append after `entity_update_times`), `backend/server.py:466-495`, `backend/server.py:3004-3005`
- Test: `backend/tests/test_context_efficiency.py:39,94`, `backend/tests/test_context_titles.py:47-51`, `backend/tests/test_topic_rewire.py:29`

**Interfaces:**
- Produces: `search_index.section_counts(user_id) -> dict[str, int]`; `server._not_in_this_scope(result: dict) -> dict[str, int]`.
- `get_scoped_context`'s payload keys become `{scope, scope_description, topic_filter, context, note}` plus the optional `advisories` and `not_in_this_scope`.

These ship together because they touch the same payload builder; splitting them means editing `get_scoped_context` and its three test files twice.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_context_footer.py`:

```python
"""get_context's footer: what the scope did NOT return, and what to do about it.

A token estimate used to sit in this slot. It measured the payload the model was
already holding -- a receipt for a purchase that cannot be returned. These counts
point the other way, at what has not been paid for yet, with an action attached.
"""
import json

import server
from sections import SECTION_REGISTRY
import persona_store as store


def _seed():
    store.save("projects", {
        **SECTION_REGISTRY["projects"].default,
        "projects": [
            {"id": "proj_a", "name": "Ledger", "description": "Double-entry books"},
            {"id": "proj_b", "name": "Ferris", "description": "Rust CLI tool"},
        ],
    })
    store.save("circle", {
        **SECTION_REGISTRY["circle"].default,
        "connections": [
            {"id": "conn_a", "name": "Ada", "relationship": "colleague"},
        ],
    })


def test_token_estimate_is_gone(as_user):
    _seed()
    out = server.get_scoped_context("professional")
    assert "token_estimate" not in out


def test_the_note_is_always_there_and_names_both_follow_ups(as_user):
    _seed()
    out = server.get_scoped_context("minimal")
    assert "search_context" in out["note"]
    assert "propose_update" in out["note"]
    assert "not narrate" in out["note"]


def test_a_narrow_scope_reports_what_it_left_behind(as_user):
    _seed()
    out = server.get_scoped_context("professional")
    # `circle` is not in the professional scope, and one connection is indexed.
    assert out["not_in_this_scope"]["circle"] == 1
    # `projects` came back in full, so it is not reported as left behind.
    assert "projects" not in out["not_in_this_scope"]


def test_full_scope_leaves_nothing_behind(as_user):
    _seed()
    out = server.get_scoped_context("full")
    assert out.get("not_in_this_scope", {}) == {}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && python -m pytest tests/test_context_footer.py -v`
Expected: FAIL — `token_estimate` is present, `note` is missing.

- [ ] **Step 3: Add the count query**

Append to `backend/search_index.py`:

```python
def section_counts(user_id) -> dict:
    """{file_type: indexed entity count} for one user, in one query.

    The denominator behind get_context's `not_in_this_scope`: how much of each
    section exists at all, measured against how much a given scope returned.

    persona_search is deliberately the source rather than the stored files. It
    holds exactly the entries search_context can find, so the counts describe
    what the accompanying note actually tells the caller to reach for -- and a
    section that has never been indexed contributes nothing rather than a number
    that would send the model looking for something it cannot get.
    """
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select file_type, count(*) as n from persona_search"
            " where user_id = %s group by file_type",
            (user_id,),
        ).fetchall()
    return {r["file_type"]: r["n"] for r in rows}
```

- [ ] **Step 4: Build the footer and drop the estimate**

In `backend/server.py`, add above `get_scoped_context`:

```python
def _not_in_this_scope(result: dict) -> dict:
    """Per-section counts of indexed entries this payload does not carry.

    Counted the same way the index is built (top-level id_lists only, entries
    with an id), so the two halves of the subtraction are comparable. Any
    negative difference -- an entry indexed but no longer stored, or an entry
    with no indexable text -- is dropped rather than reported.
    """
    totals = search_index.section_counts(db.current_user_id.get())
    enabled = settings_store.enabled_sections()
    out = {}
    for key, total in totals.items():
        spec = SECTION_REGISTRY.get(key)
        if spec is None or key not in enabled:
            continue
        section = result.get(key)
        returned = 0
        if isinstance(section, dict):
            for list_key, _prefix in spec.id_lists:
                returned += sum(
                    1 for entity in (section.get(list_key) or [])
                    if isinstance(entity, dict) and entity.get("id")
                )
        if total - returned > 0:
            out[key] = total - returned
    return out
```

Then in `get_scoped_context`, drop `"token_estimate": 0,` from the payload literal (`server.py:476`) and replace the estimate assignment (`server.py:491-494`) with:

```python
    # What this scope did NOT return, and the two follow-ups that reach it. A
    # tool result is the one place where "was this worth calling" is already
    # settled and attention is high, which makes it the only moment
    # propose_update can be reminded of at all. One short static string: a
    # footer that escalated with how well the model was behaving would be a
    # footer that nags. See the design spec, section 4.
    left_behind = _not_in_this_scope(result)
    if left_behind:
        payload["not_in_this_scope"] = left_behind
    payload["note"] = (
        "search_context(query) then get_entity(id) reaches anything not here. "
        "Heard something durable? propose_update. Do not narrate either."
    )
    return payload
```

Delete the now-stale comment at `server.py:2911-2912` inside `get_context` (it referred to the estimate).

- [ ] **Step 5: Give `search_context` the same footer**

In `backend/server.py`, replace `out["query"] = query.strip()` with:

```python
    out["query"] = query.strip()
    # Read tools only. persona_modify and propose_update already return
    # receipts, and a nudge on a write is a nudge to write more.
    out["note"] = ("get_entity(id) for full detail on a hit. Heard something "
                   "durable? propose_update. Do not narrate either.")
```

- [ ] **Step 6: Run the new tests**

Run: `cd backend && python -m pytest tests/test_context_footer.py -v`
Expected: PASS (4 passed)

- [ ] **Step 7: Update the three tests that read the removed field**

`backend/tests/test_context_efficiency.py:39` — the shape assertion becomes a required-plus-optional check, because `not_in_this_scope` and `advisories` depend on seeded data:

```python
        required = {"scope", "scope_description", "topic_filter", "context", "note"}
        optional = {"not_in_this_scope", "advisories"}
        assert required <= set(out.keys()) <= required | optional
```

`backend/tests/test_context_efficiency.py:94` — delete `test_token_estimate_reflects_returned_payload` entirely; the field it asserted about no longer exists.

`backend/tests/test_context_titles.py:47-51` — the test was using the estimate as a proxy for size. Assert on size directly:

```python
def test_titles_mode_returns_a_smaller_payload_than_full(as_user):
    _seed()
    full = server.get_context.fn(scope="professional", detail="full")
    titles = server.get_context.fn(scope="professional", detail="titles")
    assert len(titles) < len(full)
```

`backend/tests/test_topic_rewire.py:29` — the comment lists the payload keys. Replace `token_estimate` with `note` in that comment.

- [ ] **Step 8: Run everything**

Run: `cd backend && python -m pytest -q`
Expected: PASS. Any remaining `token_estimate` reference is a miss — `grep -rn token_estimate backend/ --include=*.py` should return only `backend/archive/mcp_server.py`.

- [ ] **Step 9: Commit**

```bash
git add backend/search_index.py backend/server.py backend/tests/
git commit -m "feat(mcp): read tools report what they left behind, not what they cost"
```

---

### Task 6: Make build drift visible

**Files:**
- Modify: `backend/main.py:521-541`, `Dockerfile` (stage 3, after `COPY backend/ .`)
- Test: `backend/tests/test_instance_endpoint.py` (create)

**Interfaces:**
- Produces: `main.build_commit() -> str`; `/api/instance` gains a `commit` key.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_instance_endpoint.py`:

```python
"""/api/instance answers "what is this instance" without a credential.

`commit` is here because the first hour of the tool-triggering investigation
went on a question -- is production even running this code? -- that should have
cost one unauthenticated GET and instead needed a bearer token and a JSON-RPC
handshake. The next investigation gets the cheap version.
"""
import main


def test_commit_prefers_app_commit(monkeypatch):
    monkeypatch.setenv("APP_COMMIT", "abc1234")
    monkeypatch.setenv("SOURCE_COMMIT", "def5678")
    assert main.build_commit() == "abc1234"


def test_commit_falls_back_to_source_commit(monkeypatch):
    monkeypatch.delenv("APP_COMMIT", raising=False)
    monkeypatch.setenv("SOURCE_COMMIT", "def5678")
    assert main.build_commit() == "def5678"


def test_commit_is_dev_when_unstamped(monkeypatch):
    monkeypatch.delenv("APP_COMMIT", raising=False)
    monkeypatch.delenv("SOURCE_COMMIT", raising=False)
    assert main.build_commit() == "dev"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && python -m pytest tests/test_instance_endpoint.py -v`
Expected: FAIL — `AttributeError: module 'main' has no attribute 'build_commit'`

- [ ] **Step 3: Implement**

In `backend/main.py`, above `@app.get("/api/instance")`:

```python
def build_commit() -> str:
    """The commit this image was built from, or "dev" when nothing stamped it.

    Both names are accepted because both are in use: APP_COMMIT is what the
    Dockerfile declares, SOURCE_COMMIT is what Coolify injects. The frontend's
    version label already reads the same pair at build time; this is the same
    answer for anyone who cannot open the UI.
    """
    return os.getenv("APP_COMMIT") or os.getenv("SOURCE_COMMIT") or "dev"
```

And add to the returned dict in `instance()`:

```python
    return {
        "invite_only": invite_only(),
        "mcp_oauth": jwt_auth.mcp_resource_configured(),
        "commit": build_commit(),
    }
```

Extend that endpoint's docstring with one line:

```
    `commit` is the build stamp, so "is this deploy live" costs one GET rather
    than a token and a handshake.
```

- [ ] **Step 4: Carry the build args into the runtime stage**

The `ARG`/`ENV` pair in `Dockerfile` today is in stage 1 only, so nothing reaches the running process. Add after `COPY backend/ .` in stage 3:

```dockerfile
# The same stamp the web stage bakes into the UI's version label, carried into
# the runtime environment so /api/instance can report it without a credential.
# ARG does not cross a FROM, so this pair is declared again rather than reused.
ARG APP_COMMIT
ARG SOURCE_COMMIT
ENV APP_COMMIT=$APP_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
```

- [ ] **Step 5: Run tests**

Run: `cd backend && python -m pytest tests/test_instance_endpoint.py -v`
Expected: PASS (3 passed)

- [ ] **Step 6: Full suite, then commit**

```bash
cd backend && python -m pytest -q
git add backend/main.py backend/tests/test_instance_endpoint.py Dockerfile
git commit -m "feat(api): /api/instance reports the build it is running"
```

---

## After the last task

One deploy. Then reconnect a client (`/mcp` in Claude Code) and confirm from a **fresh session** that the new descriptions arrive. They should — `tools/list` is fetched per session — but this investigation found one channel that is not, so it is worth seeing rather than assuming.

`curl -s https://your-instance/api/instance` is now the one-step check that the deploy is live.

**Not in scope, recorded so the next spec does not re-derive it:** a per-tool call counter, which would turn "`propose_update` is the least-used tool" from an impression into a number that can be watched across a deploy. Triggering is otherwise invisible from the server — you see the calls that happened, never the ones that should have.
