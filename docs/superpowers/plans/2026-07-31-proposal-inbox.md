# Proposal Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `suggest_persona_update`'s keyword heuristics with `propose_update` — an agent-authored proposal that the server validates and persists to a review queue the user resolves.

**Architecture:** One new table (`persona_proposals`) behind one new module (`backend/proposals_store.py`), exposed as one MCP tool (write-only, never touches the persona) and four REST endpoints. Approving an entity proposal routes through the existing `execute_modify`, so there is no second write path. The ~1,000-line capture pipeline moves to `backend/archive/` last, once the replacement is green.

**Tech Stack:** FastMCP, FastAPI, psycopg 3, Alembic, pytest, React 18 + Vite, Vitest + Testing Library, Tailwind + shadcn-style primitives in `frontend/src/components/ui/`.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-31-proposal-inbox-design.md`. Where this plan and the spec disagree, the spec wins.
- `propose_update` **never writes to the persona.** No confidence threshold auto-applies anything.
- The proposals queue is **never exposed over MCP**. Agents propose; they cannot list, read, or resolve.
- Notes contribute to **no scope** — not `minimal`, `professional`, `personal`, `learning`, or `full`.
- Column is `note`, not `note_text` or `text`.
- `proposed_by` is `not null`. The `client` argument is required; the call is rejected without it.
- Note window: 50 rows. Unseen-row backstop: 100 rows. Eviction order: `(seen_at is null), seen_count asc, created_at asc`.
- Fingerprint tombstones cover `status in ('pending', 'rejected', 'promoted')`.
- Branch is `feat/proposal-inbox`, already checked out. Commit per task.
- Tests need Postgres on `postgresql://mygist:mygist@localhost:5433/mygist_test` (see `backend/tests/conftest.py`). Run backend tests from `backend/` with `python -m pytest`.

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/migrations/versions/0004_proposals.py` | create the table and its indexes |
| `backend/proposals_store.py` | all proposal persistence: fingerprinting, dedupe, eviction, listing, resolution. No MCP or HTTP concerns. |
| `backend/server.py` | `propose_update` tool only — argument validation, schema check, delegation to `proposals_store` |
| `backend/main.py` | four REST endpoints, delegating to `proposals_store` and `server.execute_modify` |
| `frontend/src/components/ProposalsPanel.jsx` | both review surfaces |
| `frontend/src/lib/api.js` | four client functions |
| `backend/archive/capture_heuristics.py` | the retired pipeline, imported by nothing |

---

### Task 1: Migration and test fixture

**Files:**
- Create: `backend/migrations/versions/0004_proposals.py`
- Modify: `backend/tests/conftest.py:44-50` (the table drop list)
- Test: `backend/tests/test_proposals_migration.py`

**Interfaces:**
- Produces: table `persona_proposals` with columns `id, user_id, kind, action, entity, data, note, section_hint, rationale, evidence, confidence, proposed_by, fingerprint, status, seen_count, seen_at, created_at, resolved_at, promoted_to`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_proposals_migration.py`:

```python
"""The proposals table exists after migration and survives a replay."""
import db


def _columns():
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select column_name, is_nullable from information_schema.columns"
            " where table_name = 'persona_proposals'"
        ).fetchall()
    return {r["column_name"]: r["is_nullable"] for r in rows}


def test_table_has_the_designed_columns(clean_database):
    cols = _columns()
    for name in (
        "id", "user_id", "kind", "action", "entity", "data", "note",
        "section_hint", "rationale", "evidence", "confidence", "proposed_by",
        "fingerprint", "status", "seen_count", "seen_at", "created_at",
        "resolved_at", "promoted_to",
    ):
        assert name in cols, f"missing column {name}"


def test_proposed_by_and_rationale_are_required(clean_database):
    cols = _columns()
    assert cols["proposed_by"] == "NO"
    assert cols["rationale"] == "NO"


def test_note_column_is_not_named_text(clean_database):
    assert "text" not in _columns()


def test_migration_is_replayable(clean_database, rerun_migrations):
    rerun_migrations()
    assert "fingerprint" in _columns()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_proposals_migration.py -v`
Expected: FAIL — `missing column id` (the table does not exist, so `_columns()` returns `{}`)

- [ ] **Step 3: Write the migration**

Create `backend/migrations/versions/0004_proposals.py`:

```python
"""persona_proposals

Revision ID: 0004_proposals
Revises: 0003_better_auth_schema
Create Date: 2026-07-31

A pending proposal is not persona data. Filing it in persona_data would drag
it into /api/export, the search index, the pack registry and the editor, all
of which would be wrong -- it is a queue, and it lives in its own table.

Every statement is idempotent, matching the baseline revision's standing rule.
"""
from alembic import op

revision = "0004_proposals"
down_revision = "0003_better_auth_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists persona_proposals (
            id           uuid primary key default gen_random_uuid(),
            user_id      uuid not null references users(id) on delete cascade,
            kind         text not null,
            action       text,
            entity       text,
            data         jsonb,
            note         text,
            section_hint text,
            rationale    text not null,
            evidence     text,
            confidence   real,
            proposed_by  text not null,
            fingerprint  text not null,
            status       text not null default 'pending',
            seen_count   int  not null default 1,
            seen_at      timestamptz,
            created_at   timestamptz not null default now(),
            resolved_at  timestamptz,
            promoted_to  text
        );
    """)
    op.execute(
        "create index if not exists persona_proposals_queue_idx"
        " on persona_proposals (user_id, kind, status, created_at desc);"
    )
    # The tombstone. A claim already pending, already rejected, or already
    # promoted must not be raised a second time -- re-suggesting something the
    # user declined is the single largest cause of abandoned review queues.
    op.execute(
        "create unique index if not exists persona_proposals_fingerprint_idx"
        " on persona_proposals (user_id, fingerprint)"
        " where status in ('pending', 'rejected', 'promoted');"
    )


def downgrade() -> None:
    op.execute("drop index if exists persona_proposals_fingerprint_idx;")
    op.execute("drop index if exists persona_proposals_queue_idx;")
    op.execute("drop table if exists persona_proposals;")
```

- [ ] **Step 4: Add the table to the test fixture's drop list**

In `backend/tests/conftest.py`, inside the `clean_database` fixture, add the drop **before** `persona_data` (it references `users`, so it must go before the users drop):

```python
        cur.execute("drop table if exists persona_proposals;")  # references users
        cur.execute("drop table if exists persona_search;")  # references users
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_proposals_migration.py tests/test_migrations.py -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/versions/0004_proposals.py backend/tests/conftest.py backend/tests/test_proposals_migration.py
git commit -m "feat: a table for proposals the user has not resolved yet"
```

---

### Task 2: proposals_store — fingerprint, dedupe, eviction

**Files:**
- Create: `backend/proposals_store.py`
- Test: `backend/tests/test_proposals_store.py`

**Interfaces:**
- Consumes: `db.get_pool()`, `db.current_user_id` (Task 1's table)
- Produces:
  - `NOTE_WINDOW = 50`, `NOTE_BACKSTOP = 100`
  - `fingerprint(kind: str, entity: str | None, identifier: str | None, note: str | None) -> str`
  - `create(kind, *, client, rationale, evidence=None, confidence=None, action=None, entity=None, identifier=None, data=None, note=None, section_hint=None) -> dict` → `{"result": str, "id": str | None}` where `result` is `stored` | `duplicate_pending` | `previously_rejected`
  - `list_pending(kind: str) -> list[dict]` — marks `seen_at` on returned rows
  - `get(proposal_id: str) -> dict | None`
  - `resolve(proposal_id: str, status: str, promoted_to: str | None = None) -> bool`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_proposals_store.py`:

```python
"""Dedupe, tombstones, and the rolling note window."""
import proposals_store as ps


def _note(text, client="Cursor"):
    return ps.create(
        "note", client=client, rationale="durable", evidence="they said so",
        note=text, section_hint="preferences",
    )


def _entity(name, client="Claude Desktop"):
    return ps.create(
        "entity", client=client, rationale="durable", evidence="they said so",
        action="update", entity="domain", identifier=name,
        data={"name": name, "level": "advanced"},
    )


def test_a_new_proposal_is_stored(clean_database, as_user):
    assert _entity("Datadog")["result"] == "stored"


def test_the_same_claim_twice_bumps_seen_count(clean_database, as_user):
    _entity("Datadog")
    assert _entity("Datadog", client="Codex")["result"] == "duplicate_pending"
    [row] = ps.list_pending("entity")
    assert row["seen_count"] == 2


def test_fingerprint_ignores_case_and_spacing(clean_database, as_user):
    _note("Wants  the  recommendation FIRST.")
    assert _note("wants the recommendation first.")["result"] == "duplicate_pending"


def test_a_rejected_claim_is_never_raised_again(clean_database, as_user):
    pid = _entity("Datadog")["id"]
    ps.resolve(pid, "rejected")
    assert _entity("Datadog")["result"] == "previously_rejected"


def test_a_promoted_claim_is_never_raised_again(clean_database, as_user):
    pid = _note("Prefers recommendation first")["id"]
    ps.resolve(pid, "promoted", promoted_to="domain_abc")
    assert _note("Prefers recommendation first")["result"] == "previously_rejected"


def test_an_approved_claim_may_be_raised_again(clean_database, as_user):
    # Approved entity proposals leave the tombstone set: the entity now exists,
    # so a later change to it is a legitimate new proposal.
    pid = _entity("Datadog")["id"]
    ps.resolve(pid, "approved")
    assert _entity("Datadog")["result"] == "stored"


def test_listing_marks_rows_as_seen(clean_database, as_user):
    _note("something")
    assert ps.list_pending("note")[0]["seen_at"] is None
    assert ps.list_pending("note")[0]["seen_at"] is not None


def test_the_note_window_holds_fifty(clean_database, as_user):
    for i in range(ps.NOTE_WINDOW + 10):
        _note(f"observation number {i}")
    assert len(ps.list_pending("note")) == ps.NOTE_WINDOW


def test_unseen_notes_survive_eviction(clean_database, as_user):
    # The oldest row is seen; the rest are not. Eviction must take the seen one
    # even though newer rows exist, because silently dropping something the
    # user never had a chance to look at is the failure mode that matters.
    _note("the seen one")
    ps.list_pending("note")
    for i in range(ps.NOTE_WINDOW):
        _note(f"unseen {i}")
    texts = {r["note"] for r in ps.list_pending("note")}
    assert "the seen one" not in texts


def test_eviction_prefers_the_least_corroborated(clean_database, as_user):
    _note("raised once")
    _note("raised twice")
    _note("raised twice", client="Codex")  # seen_count -> 2
    ps.list_pending("note")  # mark both seen so seen_at is not the tiebreaker
    for i in range(ps.NOTE_WINDOW):
        _note(f"filler {i}")
        ps.list_pending("note")
    texts = {r["note"] for r in ps.list_pending("note")}
    assert "raised twice" in texts
    assert "raised once" not in texts


def test_entity_proposals_are_not_evicted(clean_database, as_user):
    for i in range(ps.NOTE_WINDOW + 10):
        _entity(f"Tool{i}")
    assert len(ps.list_pending("entity")) == ps.NOTE_WINDOW + 10


def test_proposals_are_scoped_to_their_user(clean_database, as_user):
    import db
    _note("mine")
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "insert into users (username, token_hash) values ('u2', 'y') returning id"
        ).fetchone()
    token = db.current_user_id.set(str(row["id"]))
    try:
        assert ps.list_pending("note") == []
    finally:
        db.current_user_id.reset(token)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_proposals_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'proposals_store'`

- [ ] **Step 3: Write the implementation**

Create `backend/proposals_store.py`:

```python
"""Persistence for proposals the user has not resolved yet.

A proposal is a claim an agent made about the user, not persona data. It lives
here until the user approves, rejects, or promotes it, and this module is the
only thing that touches the table. No MCP or HTTP concerns belong in here.
"""
import hashlib
import json
import logging
import re

import db

logger = logging.getLogger(__name__)

# Notes are bounded by a rolling window rather than a hard cap. A hard cap
# would block capture to punish the user's inaction -- silently, so nobody
# would notice for weeks. Losing an observation is worse than having fifty.
NOTE_WINDOW = 50
# ...but a runaway client must not grow the table without bound, so unseen
# rows are protected only up to here.
NOTE_BACKSTOP = 100

_TOMBSTONED = ("pending", "rejected", "promoted")

_COLUMNS = (
    "id, kind, action, entity, data, note, section_hint, rationale, evidence,"
    " confidence, proposed_by, fingerprint, status, seen_count, seen_at,"
    " created_at, resolved_at, promoted_to"
)


def _normalise(value: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace. Two phrasings of the
    same claim must hash alike or the tombstone leaks."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", (value or "").lower())).strip()


def fingerprint(kind: str, entity: str | None, identifier: str | None,
                note: str | None) -> str:
    if kind == "note":
        basis = f"note|{_normalise(note)}"
    else:
        basis = f"entity|{_normalise(entity)}|{_normalise(identifier)}"
    return hashlib.sha256(basis.encode()).hexdigest()


def create(kind, *, client, rationale, evidence=None, confidence=None,
           action=None, entity=None, identifier=None, data=None, note=None,
           section_hint=None) -> dict:
    """Store a proposal, or report why it was not stored."""
    user_id = db.current_user_id.get()
    fp = fingerprint(kind, entity, identifier, note)

    with db.get_pool().connection() as conn:
        existing = conn.execute(
            "select id, status from persona_proposals"
            " where user_id = %s and fingerprint = %s and status = any(%s)",
            (user_id, fp, list(_TOMBSTONED)),
        ).fetchone()

        if existing and existing["status"] == "pending":
            # Three agents noticing the same thing is signal, not clutter.
            conn.execute(
                "update persona_proposals set seen_count = seen_count + 1"
                " where id = %s", (existing["id"],),
            )
            return {"result": "duplicate_pending", "id": str(existing["id"])}
        if existing:
            return {"result": "previously_rejected", "id": None}

        row = conn.execute(
            "insert into persona_proposals"
            " (user_id, kind, action, entity, data, note, section_hint,"
            "  rationale, evidence, confidence, proposed_by, fingerprint)"
            " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
            " returning id",
            (user_id, kind, action, entity,
             json.dumps(data) if data is not None else None,
             note, section_hint, rationale, evidence, confidence, client, fp),
        ).fetchone()

    if kind == "note":
        _evict(user_id)
    return {"result": "stored", "id": str(row["id"])}


def _evict(user_id: str) -> None:
    """Trim pending notes back to the window. Seen rows go first; unseen rows
    are only touched past the backstop."""
    with db.get_pool().connection() as conn:
        total = conn.execute(
            "select count(*) as n from persona_proposals"
            " where user_id = %s and kind = 'note' and status = 'pending'",
            (user_id,),
        ).fetchone()["n"]
        if total <= NOTE_WINDOW:
            return
        seen_only = total <= NOTE_BACKSTOP
        victims = conn.execute(
            "select id from persona_proposals"
            " where user_id = %s and kind = 'note' and status = 'pending'"
            + (" and seen_at is not null" if seen_only else "") +
            " order by (seen_at is null), seen_count asc, created_at asc"
            " limit %s",
            (user_id, total - NOTE_WINDOW),
        ).fetchall()
        for v in victims:
            row = conn.execute(
                "update persona_proposals set status = 'evicted', resolved_at = now()"
                " where id = %s"
                " returning seen_count, extract(epoch from now() - created_at) as age_s",
                (v["id"],),
            ).fetchone()
            # Nobody knows the real note rate yet. A month of these lines
            # answers whether NOTE_WINDOW is set anywhere near right.
            logger.info(
                "proposal evicted: id=%s seen_count=%s age_seconds=%.0f",
                v["id"], row["seen_count"], row["age_s"],
            )


def list_pending(kind: str) -> list[dict]:
    """Pending proposals of one kind, newest first. Marks them seen."""
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            f"select {_COLUMNS} from persona_proposals"
            " where user_id = %s and kind = %s and status = 'pending'"
            " order by created_at desc",
            (user_id, kind),
        ).fetchall()
        if rows:
            conn.execute(
                "update persona_proposals set seen_at = now()"
                " where user_id = %s and kind = %s and status = 'pending'"
                "   and seen_at is null",
                (user_id, kind),
            )
    return [dict(r, id=str(r["id"])) for r in rows]


def get(proposal_id: str) -> dict | None:
    with db.get_pool().connection() as conn:
        row = conn.execute(
            f"select {_COLUMNS} from persona_proposals where user_id = %s and id = %s",
            (db.current_user_id.get(), proposal_id),
        ).fetchone()
    return dict(row, id=str(row["id"])) if row else None


def resolve(proposal_id: str, status: str, promoted_to: str | None = None) -> bool:
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "update persona_proposals"
            " set status = %s, resolved_at = now(), promoted_to = %s"
            " where user_id = %s and id = %s and status = 'pending'"
            " returning id",
            (status, promoted_to, db.current_user_id.get(), proposal_id),
        ).fetchone()
    return row is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_proposals_store.py -v`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/proposals_store.py backend/tests/test_proposals_store.py
git commit -m "feat: proposals dedupe, tombstone, and evict the stalest first"
```

---

### Task 3: The propose_update MCP tool

**Files:**
- Modify: `backend/server.py` — add the tool after `persona_batch` (`server.py:4279`)
- Test: `backend/tests/test_propose_update.py`

**Interfaces:**
- Consumes: `proposals_store.create`, `ENTITY_SCHEMA`, `normalize_data`, `_section_for_entity`, `get_entity_schema`
- Produces: MCP tool `propose_update(proposals: list, client: str) -> str` returning JSON `{"results": [{"n": int, "result": str, ...}]}`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_propose_update.py`:

```python
"""propose_update validates, never writes, and always names its client."""
import json

import server


def _call(proposals, client="Claude Desktop"):
    return json.loads(server.propose_update.fn(proposals=proposals, client=client))


def _entity_proposal(**over):
    base = {
        "kind": "entity", "action": "update", "entity": "domain",
        "data": {"name": "Datadog", "level": "advanced"},
        "rationale": "Runs the on-call dashboards unaided now.",
        "evidence": "I rebuilt the whole alerting setup myself",
        "confidence": 0.7,
    }
    base.update(over)
    return base


def _note_proposal(**over):
    base = {
        "kind": "note", "section_hint": "preferences",
        "text": "Wants the recommendation first, then the reasoning.",
        "rationale": "Said so repeatedly across sessions.",
        "evidence": "just tell me which one you'd pick",
    }
    base.update(over)
    return base


def test_a_valid_entity_proposal_is_stored(clean_database, as_user):
    assert _call([_entity_proposal()])["results"][0]["result"] == "stored"


def test_a_valid_note_is_stored(clean_database, as_user):
    assert _call([_note_proposal()])["results"][0]["result"] == "stored"


def test_the_persona_is_not_touched(clean_database, as_user):
    _call([_entity_proposal()])
    assert server.load_json("knowledge.json").get("domains", []) == []


def test_the_client_argument_is_required(clean_database, as_user):
    out = _call([_entity_proposal()], client="  ")
    assert "error" in out
    assert out["results"] == []


def test_missing_rationale_is_invalid(clean_database, as_user):
    p = _entity_proposal()
    del p["rationale"]
    assert _call([p])["results"][0]["result"] == "invalid"


def test_missing_evidence_is_invalid(clean_database, as_user):
    p = _entity_proposal()
    del p["evidence"]
    assert _call([p])["results"][0]["result"] == "invalid"


def test_an_unknown_entity_is_invalid_and_returns_the_schema(clean_database, as_user):
    r = _call([_entity_proposal(entity="vibe")])["results"][0]
    assert r["result"] == "invalid"
    assert "valid_entities" in r


def test_one_invalid_item_does_not_sink_the_batch(clean_database, as_user):
    p = _entity_proposal()
    del p["rationale"]
    results = _call([p, _note_proposal()])["results"]
    assert results[0]["result"] == "invalid"
    assert results[1]["result"] == "stored"


def test_repeat_proposals_report_duplicate(clean_database, as_user):
    _call([_entity_proposal()])
    assert _call([_entity_proposal()])["results"][0]["result"] == "duplicate_pending"


def test_a_conflicting_value_is_stored_with_the_current_one_attached(clean_database, as_user):
    server.execute_modify("add", "domain", {"name": "Datadog", "level": "beginner"})
    r = _call([_entity_proposal()])["results"][0]
    assert r["result"] == "conflicts_with_existing"
    assert r["existing_entity"]["title"] == "Datadog"


def test_the_queue_is_not_readable_over_mcp(clean_database, as_user):
    names = {t.lower() for t in dir(server)}
    for forbidden in ("list_proposals", "get_proposals", "resolve_proposal"):
        assert forbidden not in names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_propose_update.py -v`
Expected: FAIL — `AttributeError: module 'server' has no attribute 'propose_update'`

- [ ] **Step 3: Write the implementation**

Add to `backend/server.py`, immediately after `persona_batch` ends (`server.py:4279`):

```python
_REQUIRED_PROPOSAL_FIELDS = ("rationale", "evidence")


def _validate_proposal(p: dict) -> tuple[dict | None, dict | None]:
    """Return (normalised_kwargs, error). Exactly one is None."""
    kind = p.get("kind")
    if kind not in ("entity", "note"):
        return None, {"result": "invalid", "reason": "kind must be 'entity' or 'note'"}

    for field in _REQUIRED_PROPOSAL_FIELDS:
        if not str(p.get(field) or "").strip():
            return None, {
                "result": "invalid",
                "reason": f"'{field}' is required and must be non-empty",
            }

    common = {
        "rationale": p["rationale"],
        "evidence": p["evidence"],
        "confidence": p.get("confidence"),
    }

    if kind == "note":
        if not str(p.get("text") or "").strip():
            return None, {"result": "invalid", "reason": "'text' is required for a note"}
        return dict(common, note=p["text"], section_hint=p.get("section_hint")), None

    entity = str(p.get("entity") or "").lower()
    section = _section_for_entity(entity)
    if section is None:
        return None, {
            "result": "invalid",
            "reason": f"unknown entity '{entity}'",
            "valid_entities": sorted(
                e for spec in ENTITY_SCHEMA.values() for e in spec
            ),
        }
    if p.get("action") not in ENTITY_SCHEMA[section][entity].get("actions", []):
        return None, {
            "result": "invalid",
            "reason": f"action '{p.get('action')}' is not valid for '{entity}'",
            "valid_actions": ENTITY_SCHEMA[section][entity].get("actions", []),
        }

    data = normalize_data(p.get("data") or {}, entity)
    identifier_field = ENTITY_SCHEMA[section][entity].get("identifier")
    return dict(
        common, action=p["action"], entity=entity, data=data,
        identifier=str(data.get(identifier_field, "")),
    ), None


@mcp.tool()
def propose_update(proposals: list, client: str) -> str:
    """Propose durable persona changes you inferred from the conversation.

    This NEVER writes. Every proposal lands in the user's review queue, and
    they approve, reject, or promote it themselves. To write immediately --
    only when the user has explicitly asked you to record something -- use
    persona_modify instead.

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
        rationale -- why this is durable, in your words. The user reads this
            when deciding, so make it the reason, not a restatement.
        evidence -- the user's own words that prompted it. If you cannot quote
            them, you have inferred too far and should not propose.

    PROPOSE when the user reveals something still true next month: a skill
    level that has actually moved, a project's real status, a person who
    matters to them, a standing preference about how they want to be answered.

    DO NOT PROPOSE session summaries, moods, one-off task instructions, things
    the user only asked about, praise, or anything you would struggle to quote
    them on. When in doubt, do not propose -- an unreviewed queue helps nobody.

    RETURN:
        {"results": [{n, result, ...}]} where result is one of:
        stored | duplicate_pending | previously_rejected |
        conflicts_with_existing | invalid
        An invalid item never sinks the batch; the valid ones still land.
    """
    if not str(client or "").strip():
        return json.dumps({
            "error": "'client' is required: name the product you run in, "
                     "e.g. 'Claude Desktop', 'Cursor', 'Codex'.",
            "results": [],
        }, ensure_ascii=False)
    if not proposals:
        return json.dumps({"error": "No proposals provided", "results": []},
                          ensure_ascii=False)

    results = []
    for i, p in enumerate(proposals, start=1):
        kwargs, error = _validate_proposal(p if isinstance(p, dict) else {})
        if error:
            results.append(dict(error, n=i))
            continue

        outcome = proposals_store.create(p["kind"], client=client.strip(), **kwargs)
        entry = {"n": i, "result": outcome["result"], "id": outcome["id"]}

        # A proposal that contradicts a value already on record is still
        # stored -- the user decides -- but they should not have to go and
        # look up what it currently says.
        if outcome["result"] == "stored" and p["kind"] == "entity":
            match = _find_strong_match(
                _section_for_entity(kwargs["entity"]), kwargs["data"]
            )
            if match:
                entry["result"] = "conflicts_with_existing"
                entry["existing_entity"] = {
                    "entity_id": match["entity_id"], "title": match["title"],
                }
        results.append(entry)

    return json.dumps({"results": results}, ensure_ascii=False)
```

- [ ] **Step 4: Add the import**

In `backend/server.py`, alongside the other local imports (`server.py:41-45`):

```python
import proposals_store
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_propose_update.py -v`
Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/server.py backend/tests/test_propose_update.py
git commit -m "feat: agents propose, quoting the user, and never write"
```

---

### Task 4: REST endpoints

**Files:**
- Modify: `backend/main.py` — add after the export/import routes (`main.py:535`)
- Test: `backend/tests/test_proposals_api.py`

**Interfaces:**
- Consumes: `proposals_store`, `server.execute_modify`
- Produces: `GET /api/proposals?kind=`, `POST /api/proposals/{id}/approve`, `/reject`, `/promote`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_proposals_api.py`:

```python
"""The four review endpoints."""
import json

import pytest
from fastapi.testclient import TestClient

import main
import proposals_store as ps
import server


@pytest.fixture
def client(clean_database, as_user):
    import db
    user_id = db.current_user_id.get()

    async def _override():
        db.current_user_id.set(user_id)
        return user_id

    main.app.dependency_overrides = getattr(main.app, "dependency_overrides", {})
    with TestClient(main.app) as c:
        yield c


def _seed_entity():
    return ps.create(
        "entity", client="Cursor", rationale="r", evidence="e",
        action="add", entity="domain", identifier="Datadog",
        data={"name": "Datadog", "level": "advanced"},
    )["id"]


def _seed_note():
    return ps.create(
        "note", client="Cursor", rationale="r", evidence="e",
        note="Wants recommendations first", section_hint="preferences",
    )["id"]


def test_listing_returns_only_the_requested_kind(client):
    _seed_entity()
    _seed_note()
    entities = client.get("/api/proposals?kind=entity").json()["proposals"]
    assert len(entities) == 1
    assert entities[0]["kind"] == "entity"


def test_listing_exposes_the_proposing_client(client):
    _seed_entity()
    assert client.get("/api/proposals?kind=entity").json()["proposals"][0]["proposed_by"] == "Cursor"


def test_approving_writes_the_entity(client):
    pid = _seed_entity()
    assert client.post(f"/api/proposals/{pid}/approve").status_code == 200
    domains = server.load_json("knowledge.json")["domains"]
    assert [d["name"] for d in domains] == ["Datadog"]


def test_approving_with_edits_writes_the_edited_data(client):
    pid = _seed_entity()
    client.post(f"/api/proposals/{pid}/approve",
                json={"data": {"name": "Datadog", "level": "intermediate"}})
    [domain] = server.load_json("knowledge.json")["domains"]
    assert domain["level"] == "intermediate"


def test_approving_removes_it_from_the_queue(client):
    pid = _seed_entity()
    client.post(f"/api/proposals/{pid}/approve")
    assert client.get("/api/proposals?kind=entity").json()["proposals"] == []


def test_rejecting_leaves_the_persona_alone(client):
    pid = _seed_entity()
    client.post(f"/api/proposals/{pid}/reject")
    assert server.load_json("knowledge.json").get("domains", []) == []


def test_promoting_a_note_creates_the_entity_and_tags_it(client):
    pid = _seed_note()
    r = client.post(f"/api/proposals/{pid}/promote", json={
        "entity": "domain",
        "data": {"name": "Communication style", "level": "advanced"},
    })
    assert r.status_code == 200
    [domain] = server.load_json("knowledge.json")["domains"]
    assert "agent-observation" in domain.get("tags", [])


def test_promoting_clears_it_from_the_queue(client):
    pid = _seed_note()
    client.post(f"/api/proposals/{pid}/promote", json={
        "entity": "domain", "data": {"name": "X", "level": "beginner"}})
    assert client.get("/api/proposals?kind=note").json()["proposals"] == []


def test_approving_an_unknown_id_is_404(client):
    r = client.post("/api/proposals/00000000-0000-0000-0000-000000000000/approve")
    assert r.status_code == 404


def test_promoting_an_entity_proposal_is_rejected(client):
    pid = _seed_entity()
    r = client.post(f"/api/proposals/{pid}/promote", json={
        "entity": "domain", "data": {"name": "X", "level": "beginner"}})
    assert r.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_proposals_api.py -v`
Expected: FAIL — 404 on `/api/proposals`

- [ ] **Step 3: Write the implementation**

Add to `backend/main.py` after the import route (`main.py:535`). Add `import proposals_store` at the top alongside the other local imports:

```python
class ResolveRequest(BaseModel):
    """Optional overrides supplied when resolving a proposal.

    `data` lets the user correct an entity proposal before approving it --
    agents get details slightly wrong often enough that edit-then-approve is
    the difference between a usable queue and an abandoned one.
    `entity` names the destination when promoting a note.
    """
    data: dict | None = None
    entity: str | None = None


@app.get("/api/proposals")
async def list_proposals(kind: str = "entity"):
    """Pending proposals of one kind. Listing marks them seen, which protects
    them from eviction."""
    if kind not in ("entity", "note"):
        raise HTTPException(status_code=400, detail="kind must be 'entity' or 'note'")
    return {"proposals": proposals_store.list_pending(kind)}


def _load_pending(proposal_id: str) -> dict:
    proposal = proposals_store.get(proposal_id)
    if proposal is None or proposal["status"] != "pending":
        raise HTTPException(status_code=404, detail="proposal not found")
    return proposal


@app.post("/api/proposals/{proposal_id}/approve")
async def approve_proposal(proposal_id: str, body: ResolveRequest | None = None):
    """Approve an entity proposal, writing it through the same path
    persona_modify uses so every existing validation and advisory applies."""
    proposal = _load_pending(proposal_id)
    if proposal["kind"] != "entity":
        raise HTTPException(status_code=400, detail="notes are promoted, not approved")

    data = (body.data if body and body.data else proposal["data"]) or {}
    result = server.execute_modify(proposal["action"], proposal["entity"], data)
    if result.startswith("❌"):
        raise HTTPException(status_code=400, detail=result)

    proposals_store.resolve(proposal_id, "approved")
    return {"status": "approved", "result": result}


@app.post("/api/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: str):
    """Reject it. The row becomes a tombstone so no agent raises it again."""
    _load_pending(proposal_id)
    proposals_store.resolve(proposal_id, "rejected")
    return {"status": "rejected"}


@app.post("/api/proposals/{proposal_id}/promote")
async def promote_proposal(proposal_id: str, body: ResolveRequest):
    """Turn a note into typed data. The entity carries an agent-observation
    tag so that months from now the user can still tell which parts of their
    persona they stated and which an agent inferred."""
    proposal = _load_pending(proposal_id)
    if proposal["kind"] != "note":
        raise HTTPException(status_code=400, detail="only notes are promoted")
    if not body.entity or not body.data:
        raise HTTPException(status_code=400, detail="entity and data are required")

    data = dict(body.data)
    tags = list(data.get("tags") or [])
    if "agent-observation" not in tags:
        tags.append("agent-observation")
    data["tags"] = tags

    result = server.execute_modify("add", body.entity, data)
    if result.startswith("❌"):
        raise HTTPException(status_code=400, detail=result)

    proposals_store.resolve(proposal_id, "promoted", promoted_to=body.entity)
    return {"status": "promoted", "result": result}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_proposals_api.py -v`
Expected: PASS (10 tests)

If `tags` is rejected for `domain`, check `backend/section_packs/knowledge/manifest.json` — add `tags` to the entity's `optional` list and re-run. The tag is a spec requirement, so the manifest yields, not the test.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_proposals_api.py backend/section_packs/
git commit -m "feat: approve, reject, and promote from the review queue"
```

---

### Task 5: The review UI

**Files:**
- Create: `frontend/src/components/ProposalsPanel.jsx`
- Create: `frontend/src/components/ProposalsPanel.test.jsx`
- Modify: `frontend/src/lib/api.js:285` (the export block)
- Modify: `frontend/src/App.jsx:526` (add the tab trigger and content)

**Interfaces:**
- Consumes: `GET /api/proposals`, the three POST routes from Task 4
- Produces: `<ProposalsPanel />`, and `listProposals(kind)`, `approveProposal(id, data)`, `rejectProposal(id)`, `promoteProposal(id, entity, data)` from `api.js`

- [ ] **Step 1: Add the API client functions**

In `frontend/src/lib/api.js`, before the `export {` block at line 285:

```javascript
async function listProposals(kind) {
  const data = await api(`/proposals?kind=${encodeURIComponent(kind)}`);
  return data.proposals || [];
}

async function approveProposal(id, data) {
  return api(`/proposals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify(data ? { data } : {}),
  });
}

async function rejectProposal(id) {
  return api(`/proposals/${id}/reject`, { method: "POST" });
}

async function promoteProposal(id, entity, data) {
  return api(`/proposals/${id}/promote`, {
    method: "POST",
    body: JSON.stringify({ entity, data }),
  });
}
```

Add all four names to the `export { ... }` list at the end of the file.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/ProposalsPanel.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProposalsPanel from "./ProposalsPanel";

vi.mock("@/lib/api", () => ({
  listProposals: vi.fn(),
  approveProposal: vi.fn(() => Promise.resolve({ status: "approved" })),
  rejectProposal: vi.fn(() => Promise.resolve({ status: "rejected" })),
  promoteProposal: vi.fn(() => Promise.resolve({ status: "promoted" })),
}));

import * as api from "@/lib/api";

const ENTITY = {
  id: "p1", kind: "entity", action: "update", entity: "domain",
  data: { name: "Datadog", level: "advanced" },
  rationale: "Runs the on-call dashboards unaided now.",
  evidence: "I rebuilt the whole alerting setup myself",
  proposed_by: "Cursor", seen_count: 2, confidence: 0.7,
};

const NOTE = {
  id: "p2", kind: "note", note: "Wants the recommendation first.",
  section_hint: "preferences", rationale: "Said so repeatedly.",
  evidence: "just tell me which one you'd pick",
  proposed_by: "Claude Desktop", seen_count: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listProposals.mockImplementation((kind) =>
    Promise.resolve(kind === "entity" ? [ENTITY] : [NOTE]),
  );
});

describe("ProposalsPanel", () => {
  it("shows the rationale and the evidence, not just the change", async () => {
    render(<ProposalsPanel />);
    expect(await screen.findByText(/Runs the on-call dashboards unaided/)).toBeInTheDocument();
    expect(screen.getByText(/I rebuilt the whole alerting setup myself/)).toBeInTheDocument();
  });

  it("names the tool that proposed it", async () => {
    render(<ProposalsPanel />);
    expect(await screen.findByText(/Cursor/)).toBeInTheDocument();
  });

  it("shows how many tools raised the same thing", async () => {
    render(<ProposalsPanel />);
    expect(await screen.findByText(/seen 2×/)).toBeInTheDocument();
  });

  it("approves and drops the row", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /approve/i }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1", undefined));
    await waitFor(() =>
      expect(screen.queryByText(/Runs the on-call dashboards/)).not.toBeInTheDocument(),
    );
  });

  it("rejects without writing anything", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /reject/i }));
    await waitFor(() => expect(api.rejectProposal).toHaveBeenCalledWith("p1"));
    expect(api.approveProposal).not.toHaveBeenCalled();
  });

  it("offers promote and delete on observations, never approve", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(screen.getByRole("button", { name: /observations/i }));
    expect(await screen.findByRole("button", { name: /promote/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("says the queue is empty rather than showing nothing", async () => {
    api.listProposals.mockResolvedValue([]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ProposalsPanel.test.jsx`
Expected: FAIL — cannot resolve `./ProposalsPanel`

- [ ] **Step 4: Write the component**

Create `frontend/src/components/ProposalsPanel.jsx`:

```jsx
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  listProposals, approveProposal, rejectProposal, promoteProposal,
} from "@/lib/api";

const KINDS = [
  { key: "entity", label: "Inbox" },
  { key: "note", label: "Observations" },
];

/**
 * Two review surfaces over one queue.
 *
 * The split is by how much thought an item needs, not by lifecycle stage.
 * Inbox items are a two-second approve or reject. Observations need a
 * decision about where something belongs. A queue that mixes fast and slow
 * items gets abandoned at the slow ones.
 */
export default function ProposalsPanel() {
  const [kind, setKind] = useState("entity");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(async (which) => {
    try {
      setRows(await listProposals(which));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { refresh(kind); }, [kind, refresh]);

  async function act(id, fn) {
    setBusy(id);
    try {
      await fn();
      setRows((current) => current.filter((r) => r.id !== id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {KINDS.map((k) => (
          <Button
            key={k.key}
            variant={kind === k.key ? "default" : "outline"}
            size="sm"
            onClick={() => setKind(k.key)}
          >
            {k.label}
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          Nothing waiting. Agents propose changes here as they notice them.
        </EmptyState>
      ) : (
        rows.map((row) => (
          <Card key={row.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{row.proposed_by}</Badge>
              {row.seen_count > 1 && (
                <span className="text-xs text-muted-foreground">
                  seen {row.seen_count}×
                </span>
              )}
              {row.section_hint && (
                <span className="text-xs text-muted-foreground">
                  → {row.section_hint}
                </span>
              )}
            </div>

            <p className="text-sm font-medium">
              {row.kind === "entity"
                ? `${row.action} ${row.entity}: ${JSON.stringify(row.data)}`
                : row.note}
            </p>

            <p className="text-sm text-muted-foreground">{row.rationale}</p>
            {row.evidence && (
              <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
                “{row.evidence}”
              </blockquote>
            )}

            <div className="flex gap-2">
              {row.kind === "entity" ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, () => approveProposal(row.id, undefined))}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, () => rejectProposal(row.id))}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() =>
                      act(row.id, () =>
                        promoteProposal(row.id, row.section_hint === "knowledge"
                          ? "domain" : "mental_tab", { name: row.note }))
                    }
                  >
                    Promote
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() => act(row.id, () => rejectProposal(row.id))}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ProposalsPanel.test.jsx`
Expected: PASS (7 tests)

- [ ] **Step 6: Wire it into App.jsx**

Import at the top of `frontend/src/App.jsx`:

```jsx
import ProposalsPanel from "@/components/ProposalsPanel";
```

Add a trigger next to the existing `sections` trigger (`App.jsx:526`):

```jsx
          <TabsTrigger value="review" className={TAB_TRIGGER_CLASS}>
            Review
          </TabsTrigger>
```

And the content, next to the `sections` content (`App.jsx:548`):

```jsx
          <TabsContent value="review">
            <ProposalsPanel />
          </TabsContent>
```

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (no regressions in `App.test.jsx`)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ProposalsPanel.jsx frontend/src/components/ProposalsPanel.test.jsx frontend/src/lib/api.js frontend/src/App.jsx
git commit -m "feat: a place to see what your agents noticed"
```

---

### Task 6: Retire the capture pipeline

**Files:**
- Create: `backend/archive/capture_heuristics.py`
- Modify: `backend/server.py` — delete `:65-557`, `:3256-3648`, `:4282-4405`
- Delete: `backend/tests/test_suggest_dedupe.py`
- Modify: `backend/tests/test_tool_docstrings.py`, `backend/tests/test_mcp_contract_gaps.py` if they reference the removed tool
- Test: `backend/tests/test_capture_retired.py`

**Interfaces:**
- Consumes: nothing. This task only removes.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_capture_retired.py`:

```python
"""The keyword pipeline is gone, and stays gone.

It decided what was worth remembering by substring-matching a closed list of
~90 technology names. Datadog sat in knowledge.json at 'advanced' and was not
on the list. IGNORE_PATTERNS scanned the whole message and discarded anything
containing "ok" -- including "ok so I've decided to drop Neon and self-host".
"""
import server


def test_the_old_tool_is_gone():
    assert not hasattr(server, "suggest_persona_update")


def test_the_keyword_tables_are_gone():
    for name in ("CAPTURE_TRIGGERS", "IGNORE_PATTERNS", "KNOWN_SKILLS",
                 "KNOWN_CONCEPTS", "SKILL_HIERARCHY", "ENTITY_THRESHOLDS",
                 "SENTIMENT_MULTIPLIERS", "TRIGGER_STRENGTH_BOOSTS",
                 "EXPLICIT_STATE_PATTERNS", "PRONOUNS"):
        assert not hasattr(server, name), f"{name} survived"


def test_the_scoring_helpers_are_gone():
    for name in ("analyze_message_for_capture", "determine_skill_level",
                 "detect_explicit_state_changes", "calculate_evidence_boost",
                 "calculate_final_confidence_v2", "get_action_from_confidence",
                 "deduplicate_suggestions", "is_pronoun",
                 "resolve_pronoun_references", "find_in_persona",
                 "cross_reference_persona", "is_same_data",
                 "consolidate_suggestions_for_ux", "ConversationContext",
                 "conversation_context"):
        assert not hasattr(server, name), f"{name} survived"


def test_the_replacement_is_present():
    assert hasattr(server, "propose_update")


def test_the_archive_is_not_importable_as_a_dependency():
    # The museum piece must not be wired into anything.
    import pathlib
    src = pathlib.Path(server.__file__).read_text()
    assert "capture_heuristics" not in src
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_capture_retired.py -v`
Expected: FAIL — `CAPTURE_TRIGGERS survived`

- [ ] **Step 3: Move the code to the archive**

Create `backend/archive/capture_heuristics.py` containing, verbatim, the blocks removed below, under this header:

```python
"""MyGist's first capture pipeline. Retired 2026-07-31, kept as a record.

This decided what was worth remembering by matching substrings against
hand-written English word lists: ~90 technology names in KNOWN_SKILLS, 15
business terms in KNOWN_CONCEPTS, and a set of trigger idioms. It could not
see Datadog, which sat in knowledge.json at 'advanced' the whole time it ran,
and IGNORE_PATTERNS discarded any message containing "ok" or "explain" before
any other analysis ran.

Replaced by propose_update, where the calling agent -- which has already read
the conversation, knows the referents, and holds the persona -- authors the
proposal, and the server validates and persists it instead of guessing.

Imported by nothing. Excluded from test collection. Do not revive; read
docs/superpowers/specs/2026-07-31-proposal-inbox-design.md for why.
"""
```

Then delete from `backend/server.py`, in this order so line numbers stay valid:

1. `:4282-4405` — the `suggest_persona_update` tool body
2. `:3256-3648` — `CAPTURE_TRIGGERS`, `IGNORE_PATTERNS`, `KNOWN_SKILLS`, `KNOWN_CONCEPTS`, `analyze_message_for_capture`
3. `:65-557` — the conversation-context and scoring block, from the `# CONVERSATION CONTEXT` banner comment down to just before the commented-out middleware at `:559`

Keep `_find_strong_match`, `normalize_data`, `ENTITY_SCHEMA`, `_section_for_entity`, `ADVISORY_ENTITIES`, and `_augment_add_result` — `persona_modify` and `propose_update` both use them.

- [ ] **Step 4: Delete the obsolete test**

```bash
git rm backend/tests/test_suggest_dedupe.py
```

- [ ] **Step 5: Exclude the archive from collection**

Confirm `backend/archive/` is not collected. If `pytest` picks it up, add to `backend/pytest.ini` or the `[tool.pytest.ini_options]` block:

```ini
norecursedirs = archive venv
```

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS. If `test_tool_docstrings.py` or `test_mcp_contract_gaps.py` assert on `suggest_persona_update`, update them to assert on `propose_update` instead — its docstring must still satisfy whatever shape `test_tool_docstrings.py` enforces.

- [ ] **Step 7: Commit**

```bash
git add -A backend/
git commit -m "refactor: retire a thousand lines of guessing at what mattered"
```

---

### Task 7: Documentation and the capture skill

**Files:**
- Create: `.claude/skills/mygist-capture/SKILL.md`
- Modify: `docs-site/content/docs/use/capture.mdx`
- Modify: `README.md` — the "What it does" list

**Interfaces:**
- Consumes: the tool contract from Task 3.

- [ ] **Step 1: Write the skill**

Create `.claude/skills/mygist-capture/SKILL.md`:

```markdown
---
name: mygist-capture
description: Use when talking with a user who has MyGist connected, to decide what is worth proposing to their persona and what is not - covers sarcasm, aspiration, venting, and third-party facts
---

# Proposing to a MyGist persona

`propose_update` never writes. Everything you send lands in a queue the user
reviews by hand, so the cost of a bad proposal is their attention, and the
cost of a missed one is that they repeat themselves next week.

## Every proposal needs a quote

`evidence` must be the user's own words. If you cannot quote them, you have
inferred too far. This is the single rule that keeps the queue worth opening.

## The hard cases

**Sarcasm and self-deprecation.** "I'm terrible at CSS", said right after
shipping a polished interface, is not a skill level. Propose what they did,
not what they called themselves.

**Aspiration versus fact.** "I should really learn Rust" is a wish. "I've been
doing the Rust book most evenings for a month" is a fact. Only the second is
durable.

**Venting that reads as a state change.** "I'm done with this project", said
in frustration mid-debug, is not a status change. Wait for it to hold.

**Third-party facts.** "My flatmate started a Masters in Data Science"
belongs in `circle` as a note on that person, not in the user's own
`education`.

**True today, not next month.** "I'm on a train" is not persona data. Ask
whether it will still be true in a month.

**Restating, not learning.** If the user just told you something because you
asked, you have not learned it about them - they answered a question.

## Attribution

When you use something from the observations surface, say where it came from.
"I've got you down as preferring the recommendation first" is honest. "You
prefer the recommendation first" states an inference as their own words.

## Naming yourself

`client` is the product you run in as the user would name it - "Claude
Desktop", "Cursor", "Codex", "Hermes", "OpenClaw". Not a model name. They use
it to tell which of their tools is proposing what.
```

- [ ] **Step 2: Update the docs page**

Rewrite `docs-site/content/docs/use/capture.mdx` so it documents `propose_update` and the two review surfaces rather than `suggest_persona_update`. Cover: the tool never writes; `rationale` and `evidence` are required; the Inbox is approve/reject and Observations is promote/delete; rejected claims are never raised again; observations are staging and feed no scope until promoted.

- [ ] **Step 3: Update the README**

In `README.md`, under "What it does", replace any mention of message analysis with:

```markdown
- **Proposals, not guesses.** Agents propose durable changes with their
  reasoning and a quote from you; nothing reaches your persona until you
  approve it.
```

- [ ] **Step 4: Verify docs build and links resolve**

Run: `cd docs-site && npm run build`
Expected: PASS — the internal-link check in CI (`.github/workflows`) must stay green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/mygist-capture/SKILL.md docs-site/content/docs/use/capture.mdx README.md
git commit -m "docs: what to propose, and what to leave alone"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: table and indexes → 1; fingerprint, tombstones, rolling window, eviction logging → 2; tool contract, required `client`, per-item results, `conflicts_with_existing` → 3; four REST routes, edit-then-approve, `agent-observation` tag on promotion → 4; two surfaces → 5; the ~1,000-line removal and the archive → 6; docstring and skill → 7.

**Deviations from the spec, both deliberate:**

1. The spec says "two tabs". The implementation puts one top-level **Review** tab in `App.jsx`'s strip with an in-panel toggle, because that strip already carries eleven packs plus Sections and two more top-level tabs would crowd it on a phone. Two surfaces, one tab slot.
2. Task 5's Promote button files against a guessed entity derived from `section_hint`. That is thin — the spec calls for opening the entity editor prefilled. The REST endpoint takes an arbitrary `entity` and `data`, so the full picker is a UI-only follow-up that needs no backend change. **Flagged rather than hidden:** if promotion feels crude in use, that is why.

**Type consistency.** `proposals_store.create` takes `identifier=` (used to build the fingerprint) and is called with it in Tasks 3 and 4's seeds. `list_pending`/`get` return `id` as `str`. `resolve(id, status, promoted_to=None)` is called with `"approved"`, `"rejected"`, `"promoted"`, and `"evicted"` is set directly in `_evict`. The React functions match the `api.js` names exactly.

**Known risk carried from the spec:** whether agents call `propose_update` at all is the design's central bet, and no test can settle it. Measure the proposal rate after a week of real use before tuning `NOTE_WINDOW`.
