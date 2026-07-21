"""Search index for persona entities: flattening, hash-diff sync, hybrid
query (FTS + optional pgvector), lazy heal. Derived data — every failure
here is logged and swallowed so persona writes/reads never break (spec)."""

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress

import db
import embeddings
import sections

logger = logging.getLogger(__name__)

TITLE_FIELDS = ("name", "title", "topic", "institution", "language", "degree")
TEXT_FIELDS = ("description", "notes", "content", "details", "role", "status",
               "relationship", "source", "level", "category", "url")
NESTED_LIST_FIELDS = ("references", "highlights", "specifics", "coursework",
                      "clubs", "tags")


def flatten_entity(entity):
    title = next(
        (entity[f] for f in TITLE_FIELDS
         if isinstance(entity.get(f), str) and entity[f].strip()), "")
    parts = [title] if title else []
    for f in TEXT_FIELDS:
        v = entity.get(f)
        if isinstance(v, str) and v.strip() and v != title:
            parts.append(v)
    for f in NESTED_LIST_FIELDS:
        for item in entity.get(f) or []:
            if isinstance(item, str) and item.strip():
                parts.append(item)
            elif isinstance(item, dict):
                for sub in ("name", "title", "url", "description"):
                    sv = item.get(sub)
                    if isinstance(sv, str) and sv.strip():
                        parts.append(sv)
    return title, "\n".join(parts)


def flatten_section(file_type, data):
    spec = sections.SECTION_REGISTRY.get(file_type)
    if spec is None:
        return []
    rows = []
    for list_key, _prefix in spec.id_lists:
        for entity in data.get(list_key) or []:
            if not isinstance(entity, dict) or not entity.get("id"):
                continue
            title, text = flatten_entity(entity)
            if text:
                rows.append((entity["id"], title, text))
    return rows


def _prefix_map():
    m = {}
    for spec in sections.SECTION_REGISTRY.values():
        for list_key, prefix in spec.id_lists:
            m[prefix + "_"] = (spec.key, list_key)
    return m


_PREFIXES = sorted(_prefix_map().items(), key=lambda kv: len(kv[0]), reverse=True)


def entity_location(entity_id):
    for prefix, loc in _PREFIXES:
        if isinstance(entity_id, str) and entity_id.startswith(prefix):
            return loc
    return None


def content_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# One background worker: embedding batches are small and ordering per user
# doesn't matter (rows are keyed; a stale worker just overwrites NULL).
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")


def sync_index(user_id, file_type, data, embed_sync=False):
    rows = flatten_section(file_type, data)
    desired = {eid: (title, text, content_hash(text)) for eid, title, text in rows}
    with db.get_pool().connection() as conn:
        existing = {
            r["entity_id"]: r["content_hash"]
            for r in conn.execute(
                "select entity_id, content_hash from persona_search"
                " where user_id = %s and file_type = %s",
                (user_id, file_type),
            ).fetchall()
        }
        changed = []
        for eid, (title, text, h) in desired.items():
            if existing.get(eid) == h:
                continue
            changed.append((eid, text))
            if db.VECTOR_AVAILABLE:
                conn.execute(
                    """
                    insert into persona_search (user_id, file_type, entity_id, title, text, content_hash, updated_at)
                    values (%s, %s, %s, %s, %s, %s, now())
                    on conflict (user_id, file_type, entity_id) do update
                      set title = excluded.title, text = excluded.text,
                          content_hash = excluded.content_hash,
                          embedding = null, updated_at = now()
                    """,
                    (user_id, file_type, eid, title, text, h),
                )
            else:
                conn.execute(
                    """
                    insert into persona_search (user_id, file_type, entity_id, title, text, content_hash, updated_at)
                    values (%s, %s, %s, %s, %s, %s, now())
                    on conflict (user_id, file_type, entity_id) do update
                      set title = excluded.title, text = excluded.text,
                          content_hash = excluded.content_hash, updated_at = now()
                    """,
                    (user_id, file_type, eid, title, text, h),
                )
        gone = set(existing) - set(desired)
        if gone:
            conn.execute(
                "delete from persona_search where user_id = %s and file_type = %s"
                " and entity_id = any(%s)",
                (user_id, file_type, list(gone)),
            )
    if changed and db.VECTOR_AVAILABLE and embeddings.get_provider() is not None:
        if embed_sync:
            _embed_rows(user_id, file_type, changed)
        else:
            _EXECUTOR.submit(_embed_rows, user_id, file_type, changed)


def _embed_rows(user_id, file_type, rows):
    """Best-effort: failures leave embedding NULL (FTS ranks alone; retried
    on next content change or via the backfill script)."""
    provider = embeddings.get_provider()
    if provider is None or not db.VECTOR_AVAILABLE:
        return
    try:
        vectors = provider.embed([text for _eid, text in rows], input_type="document")
    except embeddings.EmbeddingError as exc:
        logger.warning("embedding batch failed (%s rows): %s", len(rows), exc)
        return
    with suppress(Exception):
        with db.get_pool().connection() as conn:
            for (eid, _text), vec in zip(rows, vectors):
                conn.execute(
                    "update persona_search set embedding = %s"
                    " where user_id = %s and file_type = %s and entity_id = %s",
                    (str(vec), user_id, file_type, eid),
                )
