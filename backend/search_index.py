"""Search index for persona entities: flattening, hash-diff sync, hybrid
query (FTS + optional pgvector), lazy heal. Derived data — every failure
here is logged and swallowed so persona writes/reads never break (spec)."""

import hashlib
import logging

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
