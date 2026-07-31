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


def list_pending(kind: str, mark_seen: bool = True) -> list[dict]:
    """Pending proposals of one kind, newest first.

    Marks them seen by default, which is what protects a row from eviction.
    Pass mark_seen=False to look without touching -- a pending-count badge
    must not quietly make its rows evictable just by rendering.
    """
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            f"select {_COLUMNS} from persona_proposals"
            " where user_id = %s and kind = %s and status = 'pending'"
            " order by created_at desc",
            (user_id, kind),
        ).fetchall()
        if rows and mark_seen:
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
