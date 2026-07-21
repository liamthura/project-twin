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

TITLE_FIELDS = ("name", "title", "topic", "idea", "goal", "role",
                "institution", "language", "degree_level", "degree")
TEXT_FIELDS = ("description", "notes", "content", "details", "role", "status",
               "relationship", "source", "level", "category", "url",
               "company", "note", "context", "field_of_study")
NESTED_LIST_FIELDS = ("references", "highlights", "specifics", "coursework",
                      "clubs", "tags", "traits")


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
# Note: ThreadPoolExecutor registers an atexit handler that JOINS pending
# workers at interpreter shutdown -- it can slow shutdown in the worst case,
# but it does not drop queued work.
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
    try:
        with db.get_pool().connection() as conn:
            for (eid, _text), vec in zip(rows, vectors):
                conn.execute(
                    "update persona_search set embedding = %s"
                    " where user_id = %s and file_type = %s and entity_id = %s",
                    (str(vec), user_id, file_type, eid),
                )
    except Exception:
        logger.warning(
            "embedding write-back failed (%s rows) for user=%s file_type=%s",
            len(rows), user_id, file_type, exc_info=True,
        )


RRF_K = 60
# Per-leg candidate pool for the FTS/vector CTEs below. A topic filter (file_type
# = any(sections_pred)) narrows each leg's `where`, so a heavily-filtered query
# can return well under CANDIDATES matches even though up to CANDIDATES rows are
# scanned per leg -- worst case ~2×CANDIDATES rows reach the merge before the
# outer `limit`. The window+limit CTE pattern here relies on the planner picking
# an index scan bounded by `limit`; behavior (and cost) is plan-dependent and
# should be re-checked with EXPLAIN if persona_search grows much larger.
CANDIDATES = 40


def lazy_heal(user_id):
    """Build FTS rows for a user whose persona predates the index (spec:
    self-healing; embeddings follow in the background)."""
    import persona_store
    for file_type in sections.SECTION_REGISTRY:
        with suppress(Exception):
            data = persona_store.load(file_type)
            if isinstance(data, dict) and "error" not in data:
                sync_index(user_id, file_type, data)


def search(user_id, query, section_filter, limit, exclude_sections=None):
    """Hybrid FTS + (optional) vector search over one user's persona_search
    rows. Invariant: `user_id` must equal the bound `db.current_user_id` --
    lazy_heal loads persona data via that contextvar, not via `user_id`
    directly, so a mismatch would heal/read the wrong user's data."""
    with db.get_pool().connection() as conn:
        have_rows = conn.execute(
            "select exists(select 1 from persona_search where user_id = %s) as e",
            (user_id,),
        ).fetchone()["e"]
        need_heal = False
        if not have_rows:
            have_data = conn.execute(
                "select exists(select 1 from persona_data where user_id = %s"
                " and file_type != '_settings') as e",
                (user_id,),
            ).fetchone()["e"]
            need_heal = have_data
    # lazy_heal opens its own pool connection(s); it must run OUTSIDE the
    # `with` block above so this call can't starve the pool by holding one
    # connection while requesting another (deadlock under max_size=1 pools).
    if need_heal:
        lazy_heal(user_id)

    sections_pred = list(section_filter) if section_filter else [
        s for s in sections.SECTION_REGISTRY]
    if exclude_sections:
        sections_pred = [s for s in sections_pred if s not in exclude_sections]

    qvec = None
    provider = embeddings.get_provider()
    if provider is not None and db.VECTOR_AVAILABLE:
        try:
            qvec = provider.embed([query], input_type="query")[0]
        except embeddings.EmbeddingError as exc:
            logger.warning("query embedding failed, FTS-only for this call: %s", exc)

    with db.get_pool().connection() as conn:
        if qvec is None:
            rows = conn.execute(
                """
                with fts as (
                    select user_id, file_type, entity_id,
                           row_number() over (order by ts_rank_cd(tsv, q) desc) as r
                    from persona_search, websearch_to_tsquery('english', %(query)s) q
                    where user_id = %(uid)s and file_type = any(%(sections)s)
                      and tsv @@ q
                    limit %(cand)s
                )
                select p.entity_id, p.file_type, p.title,
                       ts_headline('english', p.text,
                                   websearch_to_tsquery('english', %(query)s)) as snippet,
                       1.0 / (%(k)s + fts.r) as score
                from fts join persona_search p using (user_id, file_type, entity_id)
                order by score desc limit %(limit)s
                """,
                {"query": query, "uid": user_id, "sections": sections_pred,
                 "cand": CANDIDATES, "k": RRF_K, "limit": limit},
            ).fetchall()
            mode = "fts"
        else:
            rows = conn.execute(
                """
                with fts as (
                    select user_id, file_type, entity_id,
                           row_number() over (order by ts_rank_cd(tsv, q) desc) as r
                    from persona_search, websearch_to_tsquery('english', %(query)s) q
                    where user_id = %(uid)s and file_type = any(%(sections)s)
                      and tsv @@ q
                    limit %(cand)s
                ), vec as (
                    select user_id, file_type, entity_id,
                           embedding <=> %(qvec)s as dist,
                           row_number() over (order by embedding <=> %(qvec)s) as r
                    from persona_search
                    where user_id = %(uid)s and file_type = any(%(sections)s)
                      and embedding is not null
                    order by embedding <=> %(qvec)s
                    limit %(cand)s
                ), merged as (
                    select coalesce(fts.user_id, vec.user_id) as user_id,
                           coalesce(fts.file_type, vec.file_type) as file_type,
                           coalesce(fts.entity_id, vec.entity_id) as entity_id,
                           coalesce(1.0 / (%(k)s + fts.r), 0)
                         + coalesce(1.0 / (%(k)s + vec.r), 0) as score,
                           fts.r is not null as fts_hit,
                           vec.dist as distance
                    from fts full outer join vec
                      using (user_id, file_type, entity_id)
                )
                select p.entity_id, p.file_type, p.title, m.score,
                       m.fts_hit, m.distance,
                       case when m.fts_hit then
                           ts_headline('english', p.text,
                                       websearch_to_tsquery('english', %(query)s))
                       else left(p.text, 160) end as snippet
                from merged m join persona_search p using (user_id, file_type, entity_id)
                order by m.score desc limit %(limit)s
                """,
                {"query": query, "uid": user_id, "sections": sections_pred,
                 "cand": CANDIDATES, "k": RRF_K, "limit": limit,
                 "qvec": str(qvec)},
            ).fetchall()
            mode = "hybrid"

    return {
        "mode": mode,
        "results": [
            {"entity_id": r["entity_id"], "section": r["file_type"],
             "title": r["title"], "snippet": r["snippet"],
             "score": float(r["score"]),
             "fts_hit": bool(r["fts_hit"]) if "fts_hit" in r.keys() else True,
             "distance": float(r["distance"])
                 if "distance" in r.keys() and r["distance"] is not None else None}
            for r in rows
        ],
    }
