#!/usr/bin/env python3
"""
MyGist MCP Server - FastMCP Edition

Your portable personal context for AI.
Migrated to FastMCP for HTTP transport with Bearer token authentication.

Usage:
    # Development (stdio)
    python server.py
    
    # Production (HTTP with SSE)
    uvicorn server:app --host 0.0.0.0 --port 1120

Environment Variables:
    MYGIST_API_TOKEN: Bearer token for authentication (required in production)
    PERSONA_DATA_DIR: Path to persona data directory (default: ../mygist_data)
"""

import json
import os
import sys
import re
import secrets
import logging
# import zipfile
# import io
# import shutil
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Literal, Union, List
import uuid

from fastmcp import FastMCP
# from starlette.middleware.base import BaseHTTPMiddleware
# from starlette.requests import Request
# from starlette.responses import JSONResponse, Response
# from starlette.routing import Route
from dotenv import load_dotenv

import db
import persona_store
import proposals_store
import search_index
import mcp_activity
import mcp_prompts
import sections
import settings_store
import skill_resources
from persona_store import FILE_MAP, generate_entity_id, get_all as get_all_persona_data
from sections import SECTION_REGISTRY

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(
    stream=sys.stderr,
    level=logging.DEBUG if os.getenv("DEBUG", "false").lower() == "true" else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Persona data is now stored in Postgres, scoped to the current request's user.
# FILE_MAP / get_all_persona_data come from persona_store (imported above);
# load_json / save_json below are thin delegators onto it.



# =============================================================================
# BEARER TOKEN AUTHENTICATION MIDDLEWARE
# =============================================================================
# TODO: commented out here
# class BearerAuthMiddleware(BaseHTTPMiddleware):
#     """
#     Middleware that validates Bearer token on all requests.
#     Skips authentication for health check endpoints.
#     """
    
#     SKIP_AUTH_PATHS = frozenset({"/", "/health", "/healthz"})
    
#     def __init__(self, app, token: str | None = None):
#         super().__init__(app)
#         self.token = token
#         self._auth_enabled = bool(token)
        
#         if not self._auth_enabled:
#             logger.warning(
#                 "⚠️  MYGIST_API_TOKEN not set - authentication disabled! "
#                 "Set this env var in production."
#             )
    
#     async def dispatch(self, request: Request, call_next) -> Response:
#         # Skip auth for health endpoints
#         if request.url.path in self.SKIP_AUTH_PATHS:
#             return await call_next(request)
        
#         # Skip auth if no token configured (dev mode)
#         if not self._auth_enabled:
#             return await call_next(request)
        
#         # Extract and validate Authorization header
#         auth_header = request.headers.get("Authorization", "")
        
#         if not auth_header:
#             logger.warning(f"Missing Authorization header from {request.client.host}")
#             return JSONResponse(
#                 status_code=401,
#                 content={"error": "Unauthorized", "message": "Missing Authorization header"}
#             )
        
#         parts = auth_header.split(" ", 1)
#         if len(parts) != 2 or parts[0].lower() != "bearer":
#             return JSONResponse(
#                 status_code=401,
#                 content={"error": "Unauthorized", "message": "Invalid Authorization header format. Use: Bearer <token>"}
#             )
        
#         # Timing-safe comparison
#         if not secrets.compare_digest(parts[1], self.token):
#             logger.warning(f"Invalid token from {request.client.host}")
#             return JSONResponse(
#                 status_code=401,
#                 content={"error": "Unauthorized", "message": "Invalid bearer token"}
#             )
        
#         return await call_next(request)


# =============================================================================
# CORE DATA FUNCTIONS
# =============================================================================

def load_json(filename: str) -> dict:
    """Load JSON data for the current user. `filename` is the historical
    "<type>.json" form used throughout this file; persona_store works in
    bare type names."""
    file_type = filename[:-5] if filename.endswith(".json") else filename
    return persona_store.load(file_type)

def save_json(filename: str, data: dict) -> bool:
    file_type = filename[:-5] if filename.endswith(".json") else filename
    return persona_store.save(file_type, data)

def get_nested_value(data: dict, path: str):
    """Get a value from nested dict using dot notation path"""
    keys = path.split(".")
    current = data
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        elif isinstance(current, list):
            found = next((item for item in current if isinstance(item, dict) and item.get("name", "").lower() == key.lower()), None)
            if found:
                current = found
            else:
                try:
                    current = current[int(key)]
                except (ValueError, IndexError):
                    return None
        else:
            return None
        if current is None:
            return None
    return current

def set_nested_value(data: dict, path: str, value, create_missing: bool = True):
    """Set a value in nested dict using dot notation path"""
    keys = path.split(".")
    current = data
    
    for i, key in enumerate(keys[:-1]):
        if isinstance(current, dict):
            if key not in current and create_missing:
                current[key] = {}
            current = current.get(key)
        elif isinstance(current, list):
            found = next((item for item in current if isinstance(item, dict) and item.get("name", "").lower() == key.lower()), None)
            if found:
                current = found
            else:
                return False
        if current is None:
            return False
    
    final_key = keys[-1]
    if isinstance(current, dict):
        current[final_key] = value
        return True
    return False

def _as_list(value) -> list:
    """Coerce an MCP-supplied value to a list without raising.

    `list(value or [])` looked equivalent and was not: a bool or an int raises
    TypeError ("'bool' object is not iterable"), and a bare string silently
    explodes into one entry per character. Both are reachable from any payload,
    so both were unhandled 500s or silent corruption rather than a stored value.
    A lone string is the one shape worth rescuing -- clients send `topics: "AI"`
    when they mean a single topic -- so it becomes a one-item list.
    """
    if value is None or value is False or value is True:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _as_text(value) -> str:
    """An MCP-supplied value as text, or "" if it is not a string.

    Guards `.strip()`/`.lower()` calls on payload values. A non-string reads as
    absent rather than raising, which lets the surrounding validation produce its
    own error instead of an unhandled 500.
    """
    return value if isinstance(value, str) else ""


def _find_course(entries, name):
    """Locate an object-shaped entry (coursework, clubs) by its `name`.

    Tolerates the legacy bare-string shape both lists could hold: before wave 6
    `execute_modify` appended strings while the editor wrote objects, so a real
    record can contain either. persona_store._normalize coerces on read, but
    this stays shape-tolerant so a write reaching an un-normalised blob still
    finds its entry rather than silently duplicating it.

    Non-string names match nothing rather than raising, on the same grounds as
    `find_in_array`: `name` arrives off an MCP payload and is not guaranteed to
    be a string.
    """
    if not name or not isinstance(name, str):
        return None
    target = name.lower()
    for entry in entries:
        if isinstance(entry, dict):
            entry_name = entry.get("name")
            if isinstance(entry_name, str) and entry_name.lower() == target:
                return entry
        elif isinstance(entry, str) and entry.lower() == target:
            return entry
    return None


def find_in_array(array: list, identifier: str, id_field: str = "name") -> tuple:
    """Find an item in array by identifier. Returns (index, item) or (-1, None)

    Both sides are coerced before comparison because neither is guaranteed to be
    a string. `identifier` comes straight off an MCP payload, so a client sending
    `{"company": ["Acme"]}` used to raise AttributeError here -- an unhandled 500
    out of twelve entities rather than the branch's own "not found" message. The
    stored side is coerced for the same reason: a legacy row can hold anything.

    A non-string identifier now matches nothing, so the caller returns its normal
    not-found error. That is the honest answer: no row has a list for a name.
    """
    def _key(value):
        return value.lower() if isinstance(value, str) else None

    target = _key(identifier)
    if target is None:
        return (-1, None)
    for i, item in enumerate(array):
        if isinstance(item, dict):
            if _key(item.get(id_field)) == target:
                return (i, item)
        elif isinstance(item, str) and item.lower() == target:
            return (i, item)
    return (-1, None)

def get_field(data: dict, *field_names, default=None):
    """Get a field value trying multiple possible field names."""
    for name in field_names:
        if data.get(name) is not None:
            return data[name]
    return default


# =============================================================================
# SCOPED CONTEXT SYSTEM
# =============================================================================

# Canonical file order for context output — reproduces the historical
# CONTEXT_SCOPES key order exactly (preferences first, then the rest).
_CONTEXT_FILE_ORDER = ("preferences", "profile", "goals", "lifestyle", "knowledge", "circle", "projects", "learning_log")


def _merge_fields(target: dict, addition: dict) -> None:
    """Union a {file: [fields]} addition into target in place, preserving order
    and de-duplicating."""
    for file_key, field_list in addition.items():
        existing = target.setdefault(file_key, [])
        for f in field_list:
            if f not in existing:
                existing.append(f)


def _resolve_scope_fields(scope: str):
    """Resolve one scope token to its {file_key: [fields]} selection, or "all"
    for the full scope. Accepts a global scope name or a section key; the
    ALWAYS_ON bundle is folded into every non-full result. Keys are emitted in
    _CONTEXT_FILE_ORDER so context output byte-matches the legacy key order."""
    if scope == "full":
        return "all"
    matched: dict = {}
    _merge_fields(matched, sections.ALWAYS_ON)  # always-on first so its field order wins
    if scope in sections.SECTION_REGISTRY and scope not in sections.SCOPES:
        # Section scope: the whole section, all its default fields.
        _merge_fields(matched, {scope: list(sections.SECTION_REGISTRY[scope].default.keys())})
    else:
        # Global scope: each section's declared fields for this scope.
        for spec in sections.SECTION_REGISTRY.values():
            if scope in spec.context_fields:
                _merge_fields(matched, {spec.key: list(spec.context_fields[scope])})
    ordered_keys = [k for k in _CONTEXT_FILE_ORDER if k in matched]
    ordered_keys += [k for k in matched if k not in _CONTEXT_FILE_ORDER]
    return {k: matched[k] for k in ordered_keys}

def _resolve_scope_fields_multi(scopes):
    """Resolve one scope (str) or several (list) into a single {file: [fields]}
    selection, or "all" if any token is the full scope. Unknown tokens raise
    ValueError so the caller can surface a friendly error."""
    tokens = [scopes] if isinstance(scopes, str) else list(scopes)
    valid = set(sections.all_scope_names())
    merged: dict = {}
    for tok in tokens:
        if tok not in valid:
            raise ValueError(tok)
        resolved = _resolve_scope_fields(tok)
        if resolved == "all":
            return "all"
        _merge_fields(merged, resolved)
    return merged

def _files_for_scope(fields) -> list[str]:
    """Return the persona file keys a scope actually needs. ``fields`` is the
    resolved selection from _resolve_scope_fields: the string "all" needs every
    file; a {file: fields} dict needs only its keys."""
    if fields == "all":
        return list(persona_store.VALID_FILES)
    return list(fields.keys())

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


def get_scoped_context(
    scope: Union[str, List[str]] = "minimal",
    topic: str = None,
    include_inactive: bool = False,
    days: int = None,
    limit: int = None,
    detail: str = "full"
) -> dict:
    """Get persona context filtered by scope(s) and optional topic. `scope` is a
    global scope name, a section key, or a list mixing them (unioned).
    `detail="titles"` reduces every id-list entity to its `{"id", "title"}`
    stub (non-entity fields are untouched) — a lightweight index for browsing
    before pulling full detail via get_entity."""
    if detail not in ("full", "titles"):
        return {"error": f"Unknown detail '{detail}'. Valid: full, titles"}

    try:
        fields = _resolve_scope_fields_multi(scope)
    except ValueError as e:
        return {"error": f"Unknown scope '{e.args[0]}'. Valid: {sections.all_scope_names()}"}

    enabled = settings_store.enabled_sections()
    # A section scope that names a disabled section is an explicit error.
    for tok in ([scope] if isinstance(scope, str) else scope):
        if tok in sections.SECTION_REGISTRY and tok not in enabled:
            return {"error": f"Section '{tok}' is disabled. Enable it in settings."}

    if fields == "all":
        needed = [ft for ft in persona_store.VALID_FILES if ft in enabled]
    else:
        # Global/list scopes silently omit disabled sections.
        fields = {fk: fl for fk, fl in fields.items() if fk in enabled}
        needed = _files_for_scope(fields)

    all_data = {ft: load_json(FILE_MAP[ft]) for ft in needed}
    result = {}

    if fields == "all":
        result = all_data
    else:
        for file_key, field_list in fields.items():
            data = all_data.get(file_key, {})
            if not data or "error" in data:
                continue
            result[file_key] = {}
            for field in field_list:
                if field == "communication_default":
                    comm = data.get("communication", {})
                    if isinstance(comm, dict) and "default" in comm:
                        result[file_key]["communication"] = {"default": comm["default"]}
                elif field in data:
                    result[file_key][field] = data[field]
    
    if topic:
        result = _filter_by_topic(result, topic.lower())
    
    if "learning_log" in result and not topic:
        is_learning = scope == "learning" or (not isinstance(scope, str) and "learning" in scope)
        effective_days = days if days is not None else (60 if is_learning else None)
        if effective_days and effective_days > 0:
            result = _filter_learning_log_by_time(result, effective_days, limit)
        elif limit and limit > 0:
            result = _filter_learning_log_by_time(result, None, limit)
    elif "learning_log" in result and topic and limit and limit > 0:
        result = _filter_learning_log_by_time(result, None, limit)
    
    tokens = [scope] if isinstance(scope, str) else list(scope)
    if not include_inactive:
        # Goals/media hook (1/2): these section scopes show every status.
        exempt = frozenset({"goals", "media"} & set(tokens))
        result = _filter_inactive(result, exempt)

    # `related` is stored-link bookkeeping, not context payload (like `_meta`):
    # strip it from every id-list entry regardless of include_inactive/detail.
    # get_entity and get_raw are the surfaces that resolve/return it.
    result = _strip_related(result)
    result = _mark_stale(result)

    # Goals hook (2/2): when no goal-bearing scope was requested (i.e. goals
    # rode in via minimal only), reduce to ≤5 active-goal {id, title} stubs.
    def _goal_stub(g):
        stub = {"id": g.get("id"), "title": search_index.flatten_entity(g)[0]}
        if "updated_at" in g:
            stub["updated_at"] = g["updated_at"]
        return stub

    _goals_full_tokens = {"professional", "personal", "learning", "goals", "full"}
    if "goals" in result and not any(t in _goals_full_tokens for t in tokens):
        glist = result["goals"].get("goals")
        if isinstance(glist, list):
            result["goals"]["goals"] = [
                _goal_stub(g) if isinstance(g, dict) else g
                for g in glist[:5]
            ]

    # Aesthetics hook, mirroring the goals one above. `styles` rides into
    # `minimal` so an AI client knows the user's design language at conversation
    # start -- but only the ONE entry marked `primary`, never the whole list,
    # which on a real record is several long prose entries and would roughly
    # double the minimal payload.
    #
    # A section the user has not enabled never reaches here (disabled sections
    # are dropped above), and a record with no primary entry contributes
    # nothing rather than an arbitrary first item: absent is a truthful answer
    # to "what is your design language", a guess is not.
    _aesthetics_full_tokens = {"personal", "aesthetics", "full"}
    if "aesthetics" in result and not any(t in _aesthetics_full_tokens for t in tokens):
        styles = result["aesthetics"].get("styles")
        if isinstance(styles, list):
            primary = next(
                (a for a in styles if isinstance(a, dict) and a.get("primary") is True),
                None,
            )
            if primary is None:
                result["aesthetics"].pop("styles", None)
                if not result["aesthetics"]:
                    result.pop("aesthetics", None)
            else:
                result["aesthetics"]["styles"] = [primary]

    # Last, so it stubs whatever the hooks above chose to keep -- which is what
    # _stub_titles' own docstring has always claimed ("applied after all other
    # filters"). It used to run before these two, and the aesthetics hook then
    # read `primary` off an entry already reduced to {id, title, updated_at},
    # found none, and dropped the section: `minimal` silently lost the user's
    # design language for any client that asked for titles. The goals hook
    # survived the old order only by accident, because its own stub carries a
    # `title` that flatten_entity happens to read.
    if detail == "titles":
        result = _stub_titles(result)

    scope_label = scope if isinstance(scope, str) else ",".join(scope)
    scope_desc = (
        sections.SCOPES.get(scope, f"{scope} section only")
        if isinstance(scope, str)
        else "Combined scopes"
    )
    payload = {
        "scope": scope_label,
        "scope_description": scope_desc,
        "topic_filter": topic,
        "context": result
    }
    # Freshness advisory: top-of-mind is the one list that silently rots.
    tom = result.get("projects", {}).get("top_of_mind") if isinstance(result.get("projects"), dict) else None
    if isinstance(tom, list) and tom:
        ids = [t.get("id") for t in tom if isinstance(t, dict)]
        times = search_index.entity_update_times(db.current_user_id.get(), ids)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
        stale = sum(1 for i in ids if i in times and times[i] <= cutoff)
        if stale:
            payload["advisories"] = [
                f"{stale} top-of-mind item(s) unchanged for over 30 days — "
                "consider reviewing or removing them"
            ]
    # What this scope did NOT return, and the two follow-ups that reach it. A
    # tool result is the one place where "was this worth calling" is already
    # settled and attention is high, which makes it the only moment
    # propose_update can be reminded of at all. One short static string: a
    # footer that escalated with how well the model was behaving would be a
    # footer that nags.
    #
    # A token estimate used to sit in this slot. It measured the payload the
    # model was already holding -- by the time it could read the number it had
    # paid for every token counted, and it cannot un-load a scope. These counts
    # point the other way, at what has NOT been paid for yet, with an action
    # attached. See the design spec, section 4.
    left_behind = _not_in_this_scope(result)
    if left_behind:
        payload["not_in_this_scope"] = left_behind
    payload["note"] = (
        "search_context(query) then get_entity(id) reaches anything not here. "
        "Heard something durable? propose_update. Do not narrate either."
    )
    return payload

def _parse_learning_ts(timestamp) -> datetime:
    """Parse a learning_log timestamp into a timezone-aware UTC datetime.

    Handles both ``Z``-suffixed UTC (``2025-12-09T19:56:00Z``) and naive
    microsecond ISO (``2026-03-21T03:32:26.410768``) formats. Naive values are
    assumed to be UTC. A missing or unparseable timestamp fails *closed*: it is
    treated as the minimum datetime so such entries sort LAST and never jump the
    recency window.
    """
    if not isinstance(timestamp, str) or not timestamp.strip():
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        s = timestamp.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _filter_learning_log_by_time(data: dict, days: Optional[int] = None, limit: Optional[int] = None) -> dict:
    """Filter learning_log entries by time and/or count, newest-first.

    Accepts either the wrapped shape ``{"learning_log": {"entries": [...]}}``
    (as passed by ``get_scoped_context``) or a bare blob ``{"entries": [...]}``.
    Entries are sorted newest-first by parsed timestamp; ``days`` applies a
    UTC recency window and ``limit`` keeps the NEWEST N. Entries with a
    missing/unparseable timestamp sort last and are dropped by any date window.
    """
    if (
        isinstance(data.get("learning_log"), dict)
        and "entries" in data["learning_log"]
    ):
        blob = data["learning_log"]
        wrapped = True
    elif "entries" in data:
        blob = data
        wrapped = False
    else:
        return data

    all_entries = blob["entries"]
    filter_parts = []

    # Pair each entry with its parsed timestamp and sort newest-first. Sorting
    # by the key alone (not the tuple) avoids comparing the entry dicts on ties.
    parsed = [(_parse_learning_ts(e.get("timestamp")), e) for e in all_entries]
    parsed.sort(key=lambda pair: pair[0], reverse=True)

    if days and days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        parsed = [pair for pair in parsed if pair[0] >= cutoff]
        filter_parts.append(f"last {days} days")

    if limit and limit > 0 and len(parsed) > limit:
        parsed = parsed[:limit]
        filter_parts.append(f"newest {limit}")

    filtered_entries = [entry for _, entry in parsed]

    if filter_parts:
        filter_desc = (
            " + ".join(filter_parts)
            + f" ({len(filtered_entries)}/{len(all_entries)} entries, newest first)"
        )
    else:
        filter_desc = "no filter applied (newest first)"

    new_blob = {**blob, "entries": filtered_entries, "_filter": filter_desc}
    if wrapped:
        result = dict(data)
        result["learning_log"] = new_blob
        return result
    return new_blob

# Cosine distance cutoff for the vector half of hybrid-mode topic filtering.
# pgvector's KNN has no built-in similarity threshold -- it always returns the
# nearest CANDIDATES rows regardless of how dissimilar they actually are, so
# without a cutoff every entity "matches" once a corpus has fewer than
# CANDIDATES items. Related concepts typically land under ~0.5 cosine distance
# for real embedding models; unrelated/orthogonal vectors (including this
# suite's one-hot fakes) sit at 1.0.
TOPIC_VECTOR_DISTANCE_CUTOFF = 0.5

def _filter_by_topic(data: dict, topic: str) -> dict:
    """Keep only id-list items relevant to `topic`, via the search index
    (hybrid when embeddings are configured, FTS otherwise). Non-id-list
    fields pass through untouched."""
    import search_index

    present_sections = [ft for ft in data if ft in sections.SECTION_REGISTRY]
    id_sections = [ft for ft in present_sections
                   if sections.SECTION_REGISTRY[ft].id_lists]
    if not id_sections:
        return data
    user_id = db.current_user_id.get()
    hits = search_index.search(user_id, topic, id_sections, 100)
    matched = {
        r["entity_id"] for r in hits["results"]
        if r["fts_hit"] or (r["distance"] is not None
                             and r["distance"] <= TOPIC_VECTOR_DISTANCE_CUTOFF)
    }
    for ft in id_sections:
        spec = sections.SECTION_REGISTRY[ft]
        section_data = data.get(ft)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            if list_key in section_data and isinstance(section_data[list_key], list):
                section_data[list_key] = [
                    item for item in section_data[list_key]
                    if isinstance(item, dict) and item.get("id") in matched
                ]
    return data

def _stub_titles(data: dict) -> dict:
    """Reduce every id-list entity in `data` to a `{"id", "title",
    "updated_at"}` stub (updated_at day-precision, omitted for entries the
    search index doesn't know). Applied after all other filters so stubbing
    operates on the already-filtered result. Polarity fields (stance,
    reaction) survive stubbing — a dislike must never read as a like."""
    import search_index

    stub_lists = []  # (section_data, list_key)
    for ft in [k for k in data if k in sections.SECTION_REGISTRY]:
        spec = sections.SECTION_REGISTRY[ft]
        section_data = data.get(ft)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            if list_key in section_data and isinstance(section_data[list_key], list):
                def _stub(e):
                    if not isinstance(e, dict):
                        return e
                    stub = {"id": e.get("id"), "title": search_index.flatten_entity(e)[0]}
                    if "stance" in e:
                        stub["stance"] = e["stance"]
                    if "reaction" in e:
                        stub["reaction"] = e["reaction"]
                    return stub
                section_data[list_key] = [_stub(e) for e in section_data[list_key]]
                stub_lists.append((section_data, list_key))
    all_ids = [s["id"] for sd, lk in stub_lists for s in sd[lk]
               if isinstance(s, dict) and s.get("id")]
    times = search_index.entity_update_times(db.current_user_id.get(), all_ids)
    for sd, lk in stub_lists:
        for s in sd[lk]:
            if isinstance(s, dict) and s.get("id") in times:
                s["updated_at"] = times[s["id"]]
    return data

def _mark_stale(data: dict) -> dict:
    """Flag entities that have sat unchanged past their section's window.

    Reads persona_search.updated_at, the same per-entity timestamp the `days`
    filter uses -- no new storage, and the threshold is manifest-owned
    (`stale_after_days`), so a section that declares nothing never goes stale.
    That is the default: a name or a taste does not expire on a timer.

    A field on the entity rather than a line in the footer. The footer is one
    short static string by design (a footer that varies with how well the model
    is behaving nags); a field varies with the DATA, as `not_in_this_scope`'s
    counts already do, and costs nothing on the entities where it does not fire.

    Note the separate top-of-mind advisory in get_scoped_context is not this and
    is not redundant with it: that list rots on a 30-day clock of its own, which
    is a tighter promise than the section's window for `project` entities.
    """
    targets = []
    for ft in [k for k in data if k in sections.SECTION_REGISTRY]:
        spec = sections.SECTION_REGISTRY[ft]
        if not spec.stale_after_days:
            continue
        section_data = data.get(ft)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            for item in section_data.get(list_key) or []:
                if isinstance(item, dict) and item.get("id"):
                    targets.append((item, item["id"], spec.stale_after_days))
    if not targets:
        return data
    try:
        times = search_index.entity_update_times(
            db.current_user_id.get(), [eid for _i, eid, _w in targets])
    except Exception:
        # Derived data. A marker that fails to compute must not fail the read.
        logger.warning("staleness lookup failed", exc_info=True)
        return data
    today = datetime.now(timezone.utc).date()
    for item, entity_id, window in targets:
        when = times.get(entity_id)
        if when and (today - date.fromisoformat(when)).days > window:
            item["stale"] = True
    return data


def _strip_related(data: dict) -> dict:
    """Strip the `related` key from every id-list entity in `data` (token
    discipline for scope reads, like `_meta` -- stored links are surfaced
    via get_entity/get_raw instead). Entries that carry `related` are
    rebuilt as new dicts (`related` dropped) rather than deleted from in
    place: `data`'s item dicts are the same objects `load_json` just handed
    back from persona_store.load, and this mirrors `_stub_titles`'/
    `_filter_by_topic`'s existing pattern of reassigning a fresh list rather
    than mutating entries destructively."""
    for ft in [k for k in data if k in sections.SECTION_REGISTRY]:
        spec = sections.SECTION_REGISTRY[ft]
        section_data = data.get(ft)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            items = section_data.get(list_key)
            if isinstance(items, list):
                section_data[list_key] = [
                    {k: v for k, v in item.items() if k != "related"}
                    if isinstance(item, dict) and "related" in item else item
                    for item in items
                ]
    return data


# Statuses meaning "not a current concern", hidden from context.
#
# A DENY-list, deliberately. This was an allow-list of active statuses, which
# meant every status not on it was dropped -- so adding a status value to a
# manifest silently hid those items from every AI client, with no error and
# nothing to notice. That is exactly what happened to `idea`: it replaced
# `planning` on projects (ProjectsEditor.jsx records the rename), `planning`
# was on the allow-list, `idea` was not, and every idea-stage project became
# invisible. Worse, the `if active_items` below drops the field entirely when
# everything is filtered, so someone whose projects were all at the idea stage
# appeared to have no projects at all.
#
# Inverted, a status nobody anticipated defaults to VISIBLE. The failure mode
# becomes showing something that could have been hidden, rather than hiding
# something the user wrote.
INACTIVE_STATUSES = frozenset({
    "paused",     # goals, lifestyle.hobby, projects
    "archived",   # knowledge.mental_tab, projects
    "inactive",   # lifestyle.hobby
    "closed",     # knowledge.mental_tab
    "dropped",    # goals, media
    "achieved",   # goals -- see note below
})
# `achieved` sits here only to preserve existing behaviour exactly. It is
# arguably inconsistent that a `completed` project is shown while an
# `achieved` goal is not; goals are exempt whenever the goals scope is
# requested by name, so this only bites in a broader scope. Left alone
# deliberately rather than changed as a side effect of a bug fix.


def _filter_inactive(data: dict, exempt: frozenset = frozenset()) -> dict:
    """Remove inactive/paused items from context. Sections named in `exempt`
    pass through unfiltered (the goals section scope shows every status)."""
    filtered = {}

    for key, section in data.items():
        if key in exempt or not isinstance(section, dict):
            filtered[key] = section
            continue
        filtered[key] = {}
        for field, value in section.items():
            if isinstance(value, list):
                active_items = []
                for item in value:
                    if isinstance(item, dict):
                        status = item.get("status", "active")
                        if status not in INACTIVE_STATUSES:
                            active_items.append(item)
                    else:
                        active_items.append(item)
                if active_items:
                    filtered[key][field] = active_items
            else:
                filtered[key][field] = value
        if not filtered[key]:
            del filtered[key]
    
    return filtered


# =============================================================================
# FIELD ALIASES & NORMALIZATION
# =============================================================================

FIELD_ALIASES = {
    "name": ["name", "title", "label", "value", "item"],
    "hobby": ["name", "hobby", "hobby_name", "title", "activity"],
    "project": ["name", "project", "project_name", "title"],
    "domain": ["name", "domain", "domain_name", "area", "topic"],
    "language": ["name", "language", "language_name", "lang"],
    "email": ["address", "email", "email_address", "mail"],
    "link": ["url", "link", "href", "website"],
    "aspiration": ["aspiration", "goal", "career_goal", "objective", "aim"],
    "curiosity": ["topic", "curiosity", "subject", "interest", "name"],
    "value": ["value", "core_value", "belief", "principle", "name"],
    "trait": ["trait", "personality_trait", "characteristic", "quality", "name"],
    "passion": ["name", "passion", "interest", "topic"],
    "mental_tab": ["name", "mental_tab", "topic", "title", "subject"],
    "learning_item": ["topic", "subject", "item", "name", "learning"],
    "top_of_mind": ["topic", "item", "subject", "thought", "name"],
    "connection": ["name", "person", "contact", "connection_name"],
    # The four *_reference entities. Every one of them accepts four spellings
    # for its identifier and persists exactly one -- `name` -- so `ref_name`,
    # the spelling all four manifests declare as `identifier`, is an INPUT
    # ALIAS and nothing else. Recorded here transcribed from each branch's own
    # get_field call, in that call's order:
    #   hobby_reference       server.py:2097 -> writes {"name": ...} at :2102
    #   project_reference     server.py:2328 -> writes {"name": ...} at :2333
    #   domain_reference      server.py:2441 -> writes {"name": ...} at :2446
    #   mental_tab_reference  server.py:2481 -> writes {"name": ...} at :2486
    # (mental_tab_reference's fourth spelling is "reference", not "title" --
    # transcribed, not assumed symmetric.)
    #
    # These four entries are INERT for normalize_data, which is the table's
    # only runtime consumer. Every branch below looks the table up by a
    # HARDCODED literal key, never by the entity being normalised, and all
    # four reference entities are routed to their PARENT's alias list --
    # hobby_reference to "hobby" (:1149), project_reference to "project"
    # (:1151), mental_tab_reference to "mental_tab" (:1169), domain_reference
    # to "domain" (:1173). So no lookup anywhere can reach a key added here.
    # Asserted executably, by deleting each entry and diffing normalize_data's
    # output, in tests/test_section_bindings.py.
    #
    # They exist so that tests/test_section_bindings.py's alias guard -- which is
    # inert for any entity this table does not name -- can see them. Without
    # them a `ui` child node binding `ref_name` fails NOTHING on the backend:
    # `ref_name` sits in each entity's `required`, so the spelling check waves
    # it through too.
    "hobby_reference": ["ref_name", "name", "reference_name", "title"],
    "project_reference": ["ref_name", "name", "reference_name", "title"],
    "domain_reference": ["ref_name", "name", "reference_name", "title"],
    "mental_tab_reference": ["ref_name", "name", "reference_name", "reference"],
}

def _identifier_aliases(entity: str) -> set:
    """Every spelling this entity's identifier is accepted under.

    Shared with normalize_data rather than restated beside it: the proposal
    validator needs to know whether a missing identifier was really missing or
    merely sent under another name, and two copies of this table would answer
    that differently the first time one of them gained an alias.
    """
    if entity in ("link", "basic_info"):
        return set()
    return set(_name_aliases_for(entity))


def _name_aliases_for(entity: str) -> list:
    """The alias list normalize_data resolves an entity's identifier from."""
    if entity in ["hobby", "hobby_reference", "hobby_specific"]:
        name_aliases = FIELD_ALIASES.get("hobby", FIELD_ALIASES["name"])
    elif entity in ["project", "project_tag", "project_reference"]:
        name_aliases = FIELD_ALIASES.get("project", FIELD_ALIASES["name"])
    elif entity == "email":
        name_aliases = FIELD_ALIASES.get("email", ["address"])
    elif entity in ("link", "basic_info"):
        return []
    elif entity == "language":
        name_aliases = FIELD_ALIASES.get("language", FIELD_ALIASES["name"])
    elif entity == "curiosity":
        name_aliases = FIELD_ALIASES.get("curiosity", ["topic"])
    elif entity in ["value", "core_value"]:
        name_aliases = FIELD_ALIASES.get("value", ["value"])
    elif entity in ["trait", "personality_trait"]:
        name_aliases = FIELD_ALIASES.get("trait", ["trait"])
    elif entity == "passion":
        name_aliases = FIELD_ALIASES.get("passion", FIELD_ALIASES["name"])
    elif entity in ["mental_tab", "mental_tab_reference"]:
        name_aliases = FIELD_ALIASES.get("mental_tab", FIELD_ALIASES["name"])
    elif entity == "domain" or entity == "knowledge":
        name_aliases = FIELD_ALIASES.get("domain", FIELD_ALIASES["name"])
    elif entity == "domain_reference":
        name_aliases = FIELD_ALIASES.get("domain", FIELD_ALIASES["name"])
    elif entity == "current_learning":
        name_aliases = FIELD_ALIASES.get("learning_item", ["topic"])
    elif entity == "top_of_mind":
        name_aliases = FIELD_ALIASES.get("top_of_mind", ["topic"])
    elif entity == "connection":
        name_aliases = FIELD_ALIASES.get("connection", FIELD_ALIASES["name"])
    else:
        name_aliases = FIELD_ALIASES["name"]

    return name_aliases


def normalize_data(data: dict, entity: str) -> dict:
    """Normalize field names in data to canonical form based on entity type."""
    if not isinstance(data, dict):
        return data

    normalized = dict(data)
    name_aliases = _name_aliases_for(entity)
    if not name_aliases:
        return normalized

    if "name" not in normalized:
        for alias in name_aliases:
            if alias in normalized and alias != "name":
                normalized["name"] = normalized[alias]
                break
    
    if entity == "email" and "address" not in normalized:
        for alias in FIELD_ALIASES["email"]:
            if alias in normalized and alias != "address":
                normalized["address"] = normalized[alias]
                break
    
    return normalized


# Allowed related_entries link types -> (file, list_key) they must resolve into.
_RELATED_ENTRY_TYPES = {
    "domain": ("knowledge.json", "domains"),
    "project": ("projects.json", "projects"),
    "hobby": ("lifestyle.json", "hobbies"),
}

def _validate_related_entries(links):
    """Return an error string if any link is malformed or dangling, else None."""
    if not isinstance(links, list):
        return "❌ related_entries must be a list of {type, id} objects"
    for link in links:
        if not isinstance(link, dict) or not link.get("type") or not link.get("id"):
            return f"❌ Malformed related entry (need type and id): {link}"
        spec = _RELATED_ENTRY_TYPES.get(link["type"])
        if spec is None:
            valid = ", ".join(sorted(_RELATED_ENTRY_TYPES))
            return f"❌ Unknown related entry type '{link['type']}' (valid: {valid})"
        file_name, list_key = spec
        items = load_json(file_name).get(list_key, [])
        if not any(isinstance(i, dict) and i.get("id") == link["id"] for i in items):
            return f"❌ Related {link['type']} not found: {link['id']}"
    return None


# =============================================================================
# EXECUTE MODIFY - Core entity modification logic
# =============================================================================

def _generic_entity_spec(entity: str):
    """(section, list_key, entity_spec) for schema entities the generic write
    branch can handle: top-level id-list entities with an identifier, no
    parent, and a resolvable list (explicit `list` field, or the section's
    sole id_list). Bespoke elif branches always win — this is only consulted
    for entities none of them claimed."""
    section = _section_for_entity(entity)
    if section is None:
        return None
    espec = ENTITY_SCHEMA[section][entity]
    if espec.get("parent") or not espec.get("identifier"):
        return None
    list_key = espec.get("list")
    if not list_key:
        id_lists = sections.SECTION_REGISTRY[section].id_lists
        if len(id_lists) != 1:
            return None
        # Ambiguous when more than one entity in the section could plausibly
        # own that sole id-list (no explicit `list`, no parent, has an
        # identifier) -- e.g. lifestyle's `hobbies` id-list sits beside
        # personality_trait/value/sleep/energy_peak, none of which actually
        # write into `hobbies` (`interest` is unambiguous regardless: it
        # carries an explicit `list`, so it never reaches this fallback).
        # Only fall back to the sole id-list when exactly one such entity
        # exists in the section.
        candidates = [e for e, s in ENTITY_SCHEMA[section].items()
                      if not s.get("parent") and s.get("identifier") and not s.get("list")]
        if len(candidates) != 1:
            return None
        list_key = id_lists[0][0]
    if not any(lk == list_key for lk, _ in sections.SECTION_REGISTRY[section].id_lists):
        return None
    return section, list_key, espec


def _execute_link(action: str, data: dict) -> str:
    """Entity-agnostic link/unlink (action="link"/"unlink" on persona_modify):
    writes/removes ids in a source entry's `related` array. Works on any
    id-carrying entry via search_index.entity_location, so needs no
    per-entity code -- the `entity` argument execute_modify was called with
    is ignored here entirely (accept anything; entity="link" is documented
    as the convention). Links are one-directional: stored on the source
    entry only, never mirrored onto the target(s).

    data shape: {"entity_id" (or "id"/"source"): <source id>,
                 "related" (or "targets"): [<target id>, ...] or a single id}.
    """
    entity_id = get_field(data, "entity_id", "id", "source")
    if not entity_id:
        return "❌ link/unlink requires 'entity_id' (or 'id'/'source')"

    targets = data.get("related")
    if targets is None:
        targets = data.get("targets")
    if targets is None:
        targets = []
    if isinstance(targets, str):
        targets = [targets]

    prefixes = sorted({p for p, _ in search_index._PREFIXES})

    # Source resolution mirrors _resolve_entity's loop (entity_location +
    # blob scan) -- strict: unknown prefix / not found / disabled section
    # all reject before either action touches anything.
    loc = search_index.entity_location(entity_id)
    if loc is None:
        return ("❌ Unknown entity id prefix for '" + entity_id +
                "'. Valid prefixes: " + ", ".join(prefixes))
    file_type, list_key = loc
    disabled = settings_store.get_disabled_sections()
    if file_type in disabled:
        return f"❌ Section '{file_type}' is disabled. Enable it in settings."
    blob = load_json(file_type)
    entry = next((e for e in blob.get(list_key) or []
                  if isinstance(e, dict) and e.get("id") == entity_id), None)
    if entry is None:
        return f"❌ Entity {entity_id} not found in {file_type}.{list_key}"

    if action == "link":
        if not targets:
            return "❌ link requires at least one target id ('related' or 'targets')"

        enabled = settings_store.enabled_sections()
        for tid in targets:
            if tid == entity_id:
                return f"❌ Cannot link {entity_id} to itself"
            tloc = search_index.entity_location(tid)
            if tloc is None:
                return ("❌ Unknown entity id prefix for target '" + tid +
                        "'. Valid prefixes: " + ", ".join(prefixes))
            t_file_type, t_list_key = tloc
            if t_file_type not in enabled:
                return (f"❌ Cannot link to {tid}: section '{t_file_type}' "
                        "is disabled.")
            t_blob = blob if t_file_type == file_type else load_json(t_file_type)
            t_exists = any(isinstance(e, dict) and e.get("id") == tid
                           for e in t_blob.get(t_list_key) or [])
            if not t_exists:
                return f"❌ Target {tid} not found in {t_file_type}.{t_list_key}"

        related = entry.setdefault("related", [])
        seen = set(related)
        new_ids = []
        for tid in targets:
            if tid not in seen:
                seen.add(tid)
                new_ids.append(tid)
        if len(related) + len(new_ids) > 10:
            return "❌ related is capped at 10 links per entry"
        if new_ids:
            related.extend(new_ids)
            save_json(file_type, blob)

        titles_map = search_index.resolve_titles(db.current_user_id.get(), targets)
        named = [f'{tid} "{titles_map[tid]["title"]}"' if tid in titles_map else tid
                 for tid in targets]
        return f"✅ Linked {entity_id} to: {', '.join(named)}"

    elif action == "unlink":
        if not targets:
            return "❌ unlink requires at least one target id ('related' or 'targets')"

        related = entry.get("related") or []
        removed = [tid for tid in targets if tid in related]
        missing = [tid for tid in targets if tid not in related]
        parts = []
        if removed:
            remaining = [rid for rid in related if rid not in removed]
            if remaining:
                entry["related"] = remaining
            else:
                entry.pop("related", None)
            save_json(file_type, blob)
            parts.append(f"✅ Unlinked {entity_id} from: {', '.join(removed)}")
        if missing:
            parts.append(f"ℹ️ Not linked: {', '.join(missing)}")
        return " ".join(parts)

    return f"❌ Unknown link action: {action}"


def execute_modify(action: str, entity: str, data: dict) -> str:
    """Execute a single modify operation. Returns result message."""
    if action in ("link", "unlink"):
        return _execute_link(action, data)
    section = _section_for_entity(entity)
    if section is not None and section not in settings_store.enabled_sections():
        return f"❌ Section '{section}' is disabled; enable it in settings to modify it."

    entity = entity.lower()
    data = normalize_data(data, entity)
    
    # === PROFILE-BASED ENTITIES ===
    if entity == "email":
        profile = load_json("profile.json")
        emails = profile.setdefault("contact", {}).setdefault("emails", [])
        address = get_field(data, "address", "email", "email_address")
        purpose = get_field(data, "purpose", "type", "category")
        
        if action == "add":
            if not address or not purpose:
                return "❌ Email requires 'address' and 'purpose'"
            if any(e.get("address", "").lower() == address.lower() for e in emails):
                return f"ℹ️ Email '{address}' already exists"
            emails.append({"address": address, "purpose": purpose})
            save_json("profile.json", profile)
            return f"✅ Added email: {address}"
        elif action == "update":
            idx, email = find_in_array(emails, address or "", "address")
            if idx == -1:
                return f"❌ Email '{address}' not found"
            new_address = get_field(data, "new_address", "new_email")
            if new_address:
                email["address"] = new_address
            if purpose:
                email["purpose"] = purpose
            save_json("profile.json", profile)
            return f"✅ Updated email"
        elif action == "remove":
            idx, _ = find_in_array(emails, address or "", "address")
            if idx == -1:
                return f"❌ Email '{address}' not found"
            emails.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed email: {address}"
    
    elif entity == "link":
        profile = load_json("profile.json")
        links = profile.setdefault("contact", {}).setdefault("links", [])
        url = get_field(data, "url", "link", "href", "website")
        label = get_field(data, "label", "name", "title", "platform")
        
        if action == "add":
            if not url or not label:
                return "❌ Link requires 'url' and 'label'"
            if any(l.get("label", "").lower() == label.lower() for l in links):
                return f"ℹ️ Link '{label}' already exists"
            links.append({"url": url, "label": label})
            save_json("profile.json", profile)
            return f"✅ Added link: {label}"
        elif action == "update":
            # `label` identifies the row, so a rename needs a second key --
            # `new_label` -- otherwise it is indistinguishable from an edit to
            # a row that does not exist yet. Without this action the only way
            # to fix a typo'd URL was remove + re-add, which loses position.
            idx, link = find_in_array(links, label or "", "label")
            if idx == -1:
                return f"❌ Link '{label}' not found"
            new_label = get_field(data, "new_label", "new_name", "new_title")
            updated = []
            if url:
                link["url"] = url
                updated.append(f"url={url}")
            if new_label:
                link["label"] = new_label
                updated.append(f"label={new_label}")
            if not updated:
                return "❌ Link update requires 'url' or 'new_label'"
            save_json("profile.json", profile)
            return f"✅ Updated link {link['label']}: {', '.join(updated)}"
        elif action == "remove":
            idx, _ = find_in_array(links, label or "", "label")
            if idx == -1:
                return f"❌ Link '{label}' not found"
            links.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed link: {label}"
    
    elif entity == "language":
        profile = load_json("profile.json")
        languages = profile.setdefault("languages_spoken", [])
        name = get_field(data, "name", "language", "language_name", "lang")
        fluency = get_field(data, "fluency", "level", "proficiency")
        
        if action == "add":
            if not name or not fluency:
                return "❌ Language requires 'name' and 'fluency'"
            if any(l.get("name", "").lower() == name.lower() for l in languages):
                return f"ℹ️ Language '{name}' already exists"
            languages.append({"name": name, "fluency": fluency})
            save_json("profile.json", profile)
            return f"✅ Added language: {name} ({fluency})"
        elif action == "update":
            idx, lang = find_in_array(languages, name or "", "name")
            if idx == -1:
                return f"❌ Language '{name}' not found"
            if fluency:
                lang["fluency"] = fluency
            save_json("profile.json", profile)
            return f"✅ Updated {name} fluency"
        elif action == "remove":
            idx, _ = find_in_array(languages, name or "", "name")
            if idx == -1:
                return f"❌ Language '{name}' not found"
            languages.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed language: {name}"
    
    elif entity == "work_experience":
        profile = load_json("profile.json")
        work = profile.setdefault("work_experience", [])
        
        if action == "add":
            if not all(data.get(f) for f in ["role", "company", "type", "period"]):
                return "❌ Work experience requires 'role', 'company', 'type', 'period'"
            work.append({
                "role": data["role"],
                "company": data["company"],
                "type": data["type"],
                "period": data["period"],
                # `location` and `description` were declared in this entity's
                # tool contract and written by NOTHING -- not this branch, not
                # the editor -- so every value an MCP client sent under them was
                # discarded on arrival. Seeded like the other optional keys so a
                # row always carries them and the UI never renders `undefined`.
                "location": data.get("location", ""),
                "description": data.get("description", ""),
                "skills": data.get("skills", []),
                "highlights": data.get("highlights", [])
            })
            save_json("profile.json", profile)
            return f"✅ Added work experience: {data['role']} at {data['company']}"
        elif action == "update":
            idx, exp = find_in_array(work, data.get("company", ""), "company")
            if idx == -1:
                return f"❌ Work experience at '{data.get('company')}' not found"
            for field in ["role", "type", "period", "location", "description"]:
                if data.get(field):
                    exp[field] = data[field]
            # A list is replaced wholesale when supplied. `work_skill` is the
            # incremental path; this is the "set them all at once" path, and
            # `add` already accepts `skills` the same way.
            if isinstance(data.get("skills"), list):
                exp["skills"] = data["skills"]
            # `highlights` was declared optional on this entity and honoured by
            # `add`, but not here -- so once a row existed, `work_highlight` was
            # the only way to touch them, and it only appends. Same wholesale
            # replacement as `skills`, which means `[]` clears.
            if isinstance(data.get("highlights"), list):
                exp["highlights"] = data["highlights"]
            save_json("profile.json", profile)
            return f"✅ Updated work experience at {data['company']}"
        elif action == "remove":
            idx, _ = find_in_array(work, data.get("company", ""), "company")
            if idx == -1:
                return f"❌ Work experience at '{data.get('company')}' not found"
            work.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed work experience at {data['company']}"
    
    elif entity == "work_highlight":
        profile = load_json("profile.json")
        work = profile.get("work_experience", [])
        company = get_field(data, "company", "work", "employer", "organization", default="")
        if not company:
            return "❌ Work highlight requires 'company' to identify which work experience"
        idx, exp = find_in_array(work, company, "company")
        if idx == -1:
            return f"❌ Work experience at '{company}' not found"
        highlights = exp.setdefault("highlights", [])
        if action == "add":
            new_highlights = data.get("highlights", [])
            if not new_highlights:
                single = get_field(data, "highlight", "item", "achievement", default="")
                if single:
                    new_highlights = [single]
            if not new_highlights:
                return "❌ Work highlight requires 'highlight' or 'highlights'"
            added = []
            for h in new_highlights:
                if h and h not in highlights:
                    highlights.append(h)
                    added.append(h)
            save_json("profile.json", profile)
            if len(added) == 1:
                return f"✅ Added highlight to {company}: {added[0]}"
            return f"✅ Added {len(added)} highlights to {company}"
        elif action == "remove":
            highlight = get_field(data, "highlight", "item", default="")
            if highlight in highlights:
                highlights.remove(highlight)
                save_json("profile.json", profile)
                return f"✅ Removed highlight from {company}"
            return f"❌ Highlight not found"
    
    elif entity == "work_skill":
        profile = load_json("profile.json")
        work = profile.get("work_experience", [])
        company = get_field(data, "company", "work", "employer", "organization", default="")
        if not company:
            return "❌ Work skill requires 'company' to identify which work experience"
        idx, exp = find_in_array(work, company, "company")
        if idx == -1:
            return f"❌ Work experience at '{company}' not found"
        skills = exp.setdefault("skills", [])
        # Mirrors `work_highlight`: bare strings on a parent row, accepting
        # either a list or a single value, and deduped case-sensitively the
        # same way. Without this the field would be UI-only -- the asymmetry
        # wave 6 just closed for `clubs`.
        if action == "add":
            # `_as_list` rather than the raw value: iterating it directly raised
            # TypeError on a bool or an int, and turned a bare string into one
            # entry per character.
            new_skills = _as_list(data.get("skills"))
            if not new_skills:
                single = get_field(data, "skill", "item", "technology", default="")
                if single:
                    new_skills = _as_list(single)
            if not new_skills:
                return "❌ Work skill requires 'skill' or 'skills'"
            added = []
            for sk in new_skills:
                if sk and sk not in skills:
                    skills.append(sk)
                    added.append(sk)
            save_json("profile.json", profile)
            if len(added) == 1:
                return f"✅ Added skill to {company}: {added[0]}"
            return f"✅ Added {len(added)} skills to {company}"
        elif action == "remove":
            skill = get_field(data, "skill", "item", default="")
            if skill in skills:
                skills.remove(skill)
                save_json("profile.json", profile)
                return f"✅ Removed skill from {company}"
            return f"❌ Skill not found"

    elif entity == "goal":
        blob = load_json("goals.json")
        goals = blob.setdefault("goals", [])
        title = get_field(data, "title", "name", "goal")

        def _coerce_type(raw, custom):
            """Unknown types become other/custom_type — never an error."""
            # `_as_text`: a non-string type reads as absent rather than raising
            # AttributeError. Consistent with this helper's own contract that an
            # unusable type is never an error.
            t = _as_text(raw).strip().lower()
            if t and t not in GOAL_TYPES:
                return "other", (custom or raw), f" (type '{raw}' stored as other/custom_type)"
            return t, custom, ""

        if action == "add":
            if not title:
                return "❌ Goal requires 'title'"
            idx, _ = find_in_array(goals, title, "title")
            if idx != -1:
                return f"ℹ️ Goal '{title}' already exists"
            gtype, custom_type, note = _coerce_type(
                get_field(data, "type", "category"), get_field(data, "custom_type", "type_label"))
            raw_status = get_field(data, "status")
            if raw_status is not None and not isinstance(raw_status, str):
                return f"❌ Goal 'status' must be a string. Valid: {sorted(GOAL_STATUSES)}"
            status = (raw_status or "active").strip().lower()
            if status not in GOAL_STATUSES:
                return f"❌ Invalid status '{status}'. Valid: {sorted(GOAL_STATUSES)}"
            item = {"title": title, "status": status}
            if gtype:
                item["type"] = gtype
            if custom_type:
                item["custom_type"] = custom_type
            for f in ("target_date", "why", "notes"):
                v = get_field(data, f)
                if v:
                    item[f] = v
            goals.append(item)
            save_json("goals.json", blob)
            return f"✅ Added goal: {title}{note}"

        elif action == "update":
            idx, goal = find_in_array(goals, title or "", "title")
            if idx == -1:
                return f"❌ Goal '{title}' not found"
            note = ""
            if get_field(data, "type", "category") is not None:
                gtype, custom_type, note = _coerce_type(
                    get_field(data, "type", "category"), get_field(data, "custom_type", "type_label"))
                if gtype:
                    goal["type"] = gtype
                    if gtype != "other":
                        goal.pop("custom_type", None)
                if custom_type:
                    goal["custom_type"] = custom_type
            else:
                # `custom_type` used to be reachable only alongside `type`, so
                # correcting the label on an existing other/custom_type goal
                # meant re-sending the type as well. It is a declared optional
                # field in its own right.
                own_custom = get_field(data, "custom_type", "type_label")
                if own_custom is not None:
                    goal["custom_type"] = own_custom
            status = get_field(data, "status")
            if status:
                if not isinstance(status, str):
                    return f"❌ Goal 'status' must be a string. Valid: {sorted(GOAL_STATUSES)}"
                status = status.strip().lower()
                if status not in GOAL_STATUSES:
                    return f"❌ Invalid status '{status}'. Valid: {sorted(GOAL_STATUSES)}"
                goal["status"] = status
            for f in ("target_date", "why", "notes"):
                v = get_field(data, f)
                if v is not None:
                    goal[f] = v
            new_title = get_field(data, "new_title")
            if new_title:
                goal["title"] = new_title
            save_json("goals.json", blob)
            return f"✅ Updated goal: {goal['title']}{note}"

        elif action == "remove":
            idx, _ = find_in_array(goals, title or "", "title")
            if idx == -1:
                return f"❌ Goal '{title}' not found"
            goals.pop(idx)
            save_json("goals.json", blob)
            return f"✅ Removed goal: {title}"

    elif entity == "career_aspiration":
        # Back-compat alias: aspirations are goals now (type=career).
        asp = get_field(data, "aspiration", "goal", "title", "career_goal", "objective", "aim")
        if not asp:
            return "❌ career_aspiration requires 'aspiration'"
        result = execute_modify(action, "goal", {"title": asp, "type": "career"})
        if result.startswith("✅"):
            result += " — career_aspiration is stored as a goal now; use entity 'goal'"
        return result

    elif entity == "basic_info":
        profile = load_json("profile.json")
        if action == "update":
            fields = ["name", "preferred_name", "current_role", "organisation",
                      "location", "nationality", "bio"]
            updated = []
            for field in fields:
                # Presence, not truthiness. `if data.get(field)` skipped the
                # empty string, so every one of these could be set over MCP and
                # then never cleared again -- a `bio` written once was
                # permanent. `name` is the one field a blank would ruin, since
                # it is what most readers title the persona with, so it keeps
                # the old guard.
                if field not in data:
                    continue
                value = data[field]
                if field == "name" and not value:
                    return "❌ basic_info 'name' cannot be cleared"
                profile[field] = value
                updated.append(f"{field}={value}" if value else f"{field} cleared")
            if not updated:
                return f"❌ basic_info update requires at least one of: {', '.join(fields)}"
            save_json("profile.json", profile)
            return f"✅ Updated profile: {', '.join(updated)}"
        return "❌ basic_info only supports 'update' action"

    elif entity == "education":
        profile = load_json("profile.json")
        education = profile.setdefault("education", [])
        if action == "add":
            if not data.get("institution"):
                return "❌ Education requires 'institution'"
            if any(e.get("institution", "").lower() == data["institution"].lower() for e in education):
                return f"ℹ️ Education at '{data['institution']}' already exists"
            education.append({
                "institution": data["institution"],
                "degree_level": data.get("degree_level", ""),
                "field_of_study": data.get("field_of_study", ""),
                "start_year": data.get("start_year", ""),
                "end_year": data.get("end_year", ""),
                "status": data.get("status", "current"),
                "coursework": data.get("coursework", []),
                "clubs": data.get("clubs", []),
                "highlights": data.get("highlights", [])
            })
            save_json("profile.json", profile)
            return f"✅ Added education: {data['institution']}"
        elif action == "update":
            idx, edu = find_in_array(education, data.get("institution", ""), "institution")
            if idx == -1:
                return f"❌ Education at '{data.get('institution')}' not found"
            for field in ["degree_level", "field_of_study", "start_year", "end_year", "status"]:
                if data.get(field):
                    edu[field] = data[field]
            # `highlights`, `coursework` and `clubs` are all declared optional on
            # this entity and all three were honoured by `add` and ignored here,
            # so once a row existed the only way to change them was the
            # per-item entities -- which can only append. Replaced wholesale when
            # supplied, the same treatment `work_experience` gives its lists, so
            # `[]` clears.
            for field in ["highlights", "coursework", "clubs"]:
                if isinstance(data.get(field), list):
                    edu[field] = data[field]
            save_json("profile.json", profile)
            return f"✅ Updated education: {data['institution']}"
        elif action == "remove":
            idx, _ = find_in_array(education, data.get("institution", ""), "institution")
            if idx == -1:
                return f"❌ Education not found"
            education.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed education: {data['institution']}"
    
    # === LIFESTYLE-BASED ENTITIES ===
    elif entity == "hobby":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.setdefault("hobbies", [])
        name = get_field(data, "name", "hobby", "hobby_name", "title", "activity")
        skill_level = get_field(data, "skill_level", "level", "proficiency")
        status = get_field(data, "status", "state", "is_active", default="active")
        # "paused" is a status in its own right: the manifest declares it, the
        # editor offers it, and _filter_inactive has always treated it as
        # distinct (INACTIVE_STATUSES, :1074). It used to be folded into
        # "inactive" here, so a user's "paused" -- which the frontend PUTs
        # directly and therefore stores fine -- survived only until the next
        # AI edit to that hobby silently rewrote it.
        if status in ["paused", "on_hold"]:
            status = "paused"
        elif status in ["inactive", "stopped", "not_active", "false", False]:
            status = "inactive"
        else:
            status = "active"
        notes = get_field(data, "notes", "description", "details", default="")

        if action == "add":
            if not name:
                return "❌ Hobby requires a name"
            if any(h.get("name", "").lower() == name.lower() for h in hobbies):
                return f"ℹ️ Hobby '{name}' already exists"
            # `references` used to be hardcoded to [] here while `specifics`
            # beside it honoured its input, so a client that sent references on
            # `add` had them silently dropped and had to re-send every one
            # through `hobby_reference`. `update` has always accepted them.
            new_hobby = {
                "id": generate_entity_id("hobby"), "name": name,
                "status": status, "notes": notes,
                "specifics": data.get("specifics", []),
                "references": data.get("references", []),
            }
            if skill_level:
                new_hobby["skill_level"] = skill_level
            hobbies.append(new_hobby)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added hobby: {name} (status: {status})"
        elif action == "update":
            idx, hobby = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            if data.get("skill_level") or data.get("level") or data.get("proficiency"):
                hobby["skill_level"] = skill_level
            if data.get("status") or data.get("state") or data.get("is_active") is not None:
                hobby["status"] = status
            # Presence, not truthiness: `if notes:` meant a hobby's notes could
            # be written but never emptied. `notes` above has already collapsed
            # the aliases, so the presence test has to check all three of them.
            if any(k in data for k in ("notes", "description", "details")):
                hobby["notes"] = notes
            if "specifics" in data:
                hobby["specifics"] = data["specifics"]
            if "references" in data:
                hobby["references"] = data["references"]
            hobby["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("lifestyle.json", lifestyle)
            return f"✅ Updated hobby: {name}"
        elif action == "remove":
            idx, _ = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            hobbies.pop(idx)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed hobby: {name}"
    
    elif entity in ("passion", "curiosity"):
        name = get_field(data, "name", "passion", "topic", "curiosity", "interest")
        if not name:
            return f"❌ {entity} requires 'name'"
        result = execute_modify(action, "interest", {"name": name, "kind": entity})
        if result.startswith("✅"):
            result += f" — {entity}s are stored as interests now; use entity 'interest'"
        return result

    elif entity == "personality_trait":
        lifestyle = load_json("lifestyle.json")
        traits = lifestyle.setdefault("personality_traits", [])
        item = get_field(data, "trait", "personality_trait", "characteristic", "quality", "name", default="")
        if action == "add":
            if not item:
                return "❌ Personality trait requires 'trait' or 'name'"
            if item in traits:
                return f"ℹ️ '{item}' already in traits"
            traits.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added trait: {item}"
        elif action == "remove":
            found = next((t for t in traits if t.lower() == item.lower()), None)
            if not found:
                return f"❌ Trait not found"
            traits.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed trait: {item}"
    
    elif entity == "value":
        lifestyle = load_json("lifestyle.json")
        values = lifestyle.setdefault("values", [])
        item = get_field(data, "value", "core_value", "belief", "principle", "name", default="")
        if action == "add":
            if not item:
                return "❌ Value requires 'value' or 'name'"
            if item in values:
                return f"ℹ️ '{item}' already in values"
            values.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added value: {item}"
        elif action == "remove":
            found = next((v for v in values if v.lower() == item.lower()), None)
            if not found:
                return f"❌ Value not found"
            values.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed value: {item}"
    
    # === KNOWLEDGE-BASED ENTITIES ===
    elif entity == "domain":
        knowledge = load_json("knowledge.json")
        domains = knowledge.setdefault("domains", [])
        name = get_field(data, "name", "domain", "domain_name", "area", "topic")
        level = get_field(data, "level", "proficiency", "skill_level", default="learning")
        notes = get_field(data, "notes", "description", "details", default="")
        
        if action == "add":
            if not name:
                return "❌ Domain requires 'name' or 'domain'"
            if any(d.get("name", "").lower() == name.lower() for d in domains):
                return f"ℹ️ Domain '{name}' already exists"
            domains.append({
                "id": generate_entity_id("domain"), "name": name, "level": level,
                "notes": notes, "references": data.get("references", [])
            })
            save_json("knowledge.json", knowledge)
            return f"✅ Added domain: {name}"
        elif action == "update":
            idx, domain = find_in_array(domains, name or "", "name")
            if idx == -1:
                return f"❌ Domain '{name}' not found"
            if level != "learning" or data.get("level"):
                domain["level"] = level
            if notes:
                domain["notes"] = notes
            # Declared optional and stored by `add`, ignored here until wave 9:
            # `domain_reference` was the only way to change them, and it only
            # appends.
            if isinstance(data.get("references"), list):
                domain["references"] = data["references"]
            save_json("knowledge.json", knowledge)
            return f"✅ Updated domain: {name}"
        elif action == "remove":
            idx, _ = find_in_array(domains, name or "", "name")
            if idx == -1:
                return f"❌ Domain not found"
            domains.pop(idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed domain: {name}"
    
    elif entity == "mental_tab":
        knowledge = load_json("knowledge.json")
        tabs = knowledge.setdefault("mental_tabs", [])
        topic = get_field(data, "title", "topic", "name", "mental_tab", "subject")
        context = get_field(data, "context", "notes", "description", "details", default="")
        status = get_field(data, "status", "state", default="open")
        
        if action == "add":
            if not topic:
                return "❌ Mental tab requires 'title' or 'topic'"
            if any((t.get("title", "") or t.get("topic", "")).lower() == topic.lower() for t in tabs):
                return f"ℹ️ Mental tab '{topic}' already exists"
            tabs.append({
                "title": topic, "notes": context, "tags": data.get("tags", []),
                "status": status, "references": data.get("references", []),
                "created_at": datetime.now().isoformat() + "Z"
            })
            save_json("knowledge.json", knowledge)
            return f"✅ Added mental tab: {topic}"
        elif action == "update":
            idx, tab = find_in_array(tabs, topic or "", "title")
            if idx == -1:
                idx, tab = find_in_array(tabs, topic or "", "topic")
            if idx == -1:
                return f"❌ Mental tab '{topic}' not found"
            if context:
                tab["notes"] = context
            if status != "open" or data.get("status"):
                tab["status"] = status
            if data.get("tags"):
                tab["tags"] = data["tags"]
            save_json("knowledge.json", knowledge)
            return f"✅ Updated mental tab: {topic}"
        elif action == "remove":
            idx, _ = find_in_array(tabs, topic or "", "title")
            if idx == -1:
                idx, _ = find_in_array(tabs, topic or "", "topic")
            if idx == -1:
                return f"❌ Mental tab not found"
            tabs.pop(idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed mental tab: {topic}"
    
    # === PROJECTS-BASED ENTITIES ===
    elif entity == "project":
        projects = load_json("projects.json")
        project_list = projects.setdefault("projects", [])
        name = get_field(data, "name", "project", "project_name", "title")
        description = get_field(data, "description", "desc", "summary", default="")
        status = get_field(data, "status", "state", "progress", default="active")
        notes = get_field(data, "notes", "details", default="")
        
        if action == "add":
            if not name or not description:
                return "❌ Project requires 'name' and 'description'"
            if any(p.get("name", "").lower() == name.lower() for p in project_list):
                return f"ℹ️ Project '{name}' already exists"
            project_list.append({
                "id": generate_entity_id("project"), "name": name, "description": description,
                "status": status, "tags": data.get("tags", []), "references": data.get("references", []),
                "highlights": data.get("highlights", []), "notes": notes,
                "added_date": datetime.now().strftime("%Y-%m-%d")
            })
            save_json("projects.json", projects)
            return f"✅ Added project: {name}"
        elif action == "update":
            idx, project = find_in_array(project_list, name or "", "name")
            if idx == -1:
                return f"❌ Project '{name}' not found"
            for field in ["description", "status", "url", "tags", "references", "highlights", "notes", "challenges", "goals"]:
                if data.get(field):
                    project[field] = data[field]
            project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("projects.json", projects)
            return f"✅ Updated project: {name}"
        elif action == "remove":
            idx, _ = find_in_array(project_list, name or "", "name")
            if idx == -1:
                return f"❌ Project '{name}' not found"
            project_list.pop(idx)
            save_json("projects.json", projects)
            return f"✅ Removed project: {name}"
    
    elif entity == "current_learning":
        topic = get_field(data, "topic", "name", "title")
        if not topic:
            return "❌ current_learning requires 'topic'"
        payload = {"title": topic, "type": "learning"}
        context = get_field(data, "context", "why")
        if context:
            payload["why"] = context
        result = execute_modify(action, "goal", payload)
        if result.startswith("✅"):
            result += " — current learning is stored as a goal (type: learning) now; use entity 'goal'"
        return result

    elif entity == "top_of_mind":
        projects = load_json("projects.json")
        tom = projects.setdefault("top_of_mind", [])
        item = get_field(data, "item", "topic", "thought", "subject", "name", "idea", default="")
        note = data.get("note", "")
        
        def get_idea_text(t):
            return t.get("idea", "") if isinstance(t, dict) else t
        
        if action == "add":
            if not item:
                return "❌ Top of mind requires 'item', 'idea', or 'topic'"
            existing = next((t for t in tom if get_idea_text(t).lower() == item.lower()), None)
            if existing:
                return f"ℹ️ '{item}' already top of mind"
            tom.append({"idea": item, "note": note})
            save_json("projects.json", projects)
            return f"✅ Added to top of mind: {item}"
        elif action == "remove":
            found = next((t for t in tom if get_idea_text(t).lower() == item.lower()), None)
            if not found:
                return f"❌ '{item}' not in top of mind"
            tom.remove(found)
            save_json("projects.json", projects)
            return f"✅ Removed from top of mind: {item}"
    
    # === PREFERENCES ===
    elif entity in ("like", "dislike"):
        blob = load_json("preferences.json")
        items = blob.setdefault("likes_dislikes", [])
        item = get_field(data, "item", "name", "dislike", "like")
        # The entity name is the default stance -- that is what it has always
        # meant -- but `stance` is a real stored key, and is now declared on
        # both entities rather than being invisible to `get_schema`. An
        # explicit value therefore wins, which lets `update` flip a row without
        # the client having to know it must switch entity to do it.
        stance = get_field(data, "stance", default=entity)
        if stance not in ("like", "dislike"):
            return f"❌ stance must be 'like' or 'dislike', got '{stance}'"
        if action == "add":
            if not item:
                return f"❌ {entity} requires 'item'"
            idx, existing = find_in_array(items, item, "item")
            if idx != -1:
                if existing.get("stance") != stance:
                    existing["stance"] = stance
                    save_json("preferences.json", blob)
                    return f"✅ Updated stance: {item} is now a {stance}"
                return f"ℹ️ '{item}' already recorded as a {stance}"
            items.append({"item": item, "stance": stance})
            save_json("preferences.json", blob)
            return f"✅ Added {stance}: {item}"
        elif action == "update":
            idx, entry = find_in_array(items, item or "", "item")
            if idx == -1:
                return f"❌ '{item}' not found in likes_dislikes"
            new_item = get_field(data, "new_item")
            if new_item:
                entry["item"] = new_item
            entry["stance"] = stance
            save_json("preferences.json", blob)
            return f"✅ Updated {stance}: {entry['item']}"
        elif action == "remove":
            idx, _ = find_in_array(items, item or "", "item")
            if idx == -1:
                return f"❌ '{item}' not found in likes_dislikes"
            items.pop(idx)
            save_json("preferences.json", blob)
            return f"✅ Removed: {item}"
    
    # === CIRCLE ===
    elif entity == "connection":
        circle = load_json("circle.json")
        if "error" in circle:
            circle = {"connections": []}
        connections = circle.setdefault("connections", [])
        name = get_field(data, "name", "person", "contact", "connection_name")
        relationship = get_field(data, "relationship")
        traits = data.get("traits", [])
        notes = data.get("notes", "")
        
        if action == "add":
            if not name:
                return "❌ Connection requires 'name'"
            if any(c.get("name", "").lower() == name.lower() for c in connections):
                return f"ℹ️ Connection '{name}' already exists"
            new_connection = {"id": generate_entity_id("connection"), "name": name}
            if relationship:
                new_connection["relationship"] = relationship
            if traits:
                new_connection["traits"] = traits if isinstance(traits, list) else [traits]
            if notes:
                new_connection["notes"] = notes
            connections.append(new_connection)
            save_json("circle.json", circle)
            return f"✅ Added connection: {name}"
        elif action == "update":
            idx, connection = find_in_array(connections, name or "", "name")
            if idx == -1:
                return f"❌ Connection '{name}' not found"
            if relationship:
                connection["relationship"] = relationship
            if "traits" in data:
                connection["traits"] = traits if isinstance(traits, list) else [traits]
            if "notes" in data:
                connection["notes"] = notes
            save_json("circle.json", circle)
            return f"✅ Updated connection: {name}"
        elif action == "remove":
            idx, _ = find_in_array(connections, name or "", "name")
            if idx == -1:
                return f"❌ Connection '{name}' not found"
            connections.pop(idx)
            save_json("circle.json", circle)
            return f"✅ Removed connection: {name}"
    
    # === LEARNING LOG ===
    elif entity == "learning_entry":
        log = load_json("learning_log.json")
        if "error" in log:
            log = {"entries": []}
        entries = log.setdefault("entries", [])
        
        if action == "add":
            if not data.get("topic") or not data.get("details"):
                return "❌ Learning entry requires 'topic' and 'details'"
            if data.get("related_entries"):
                err = _validate_related_entries(data["related_entries"])
                if err:
                    return err
            entry_id = f"learn_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:6]}"
            entry = {
                "id": entry_id, "topic": data["topic"], "details": data["details"],
                "source": data.get("source", "conversation"), "tags": data.get("tags", []),
                "timestamp": datetime.now().isoformat()
            }
            if data.get("conversation_metadata"):
                entry["conversation_metadata"] = data["conversation_metadata"]
            if data.get("key_decisions"):
                entry["key_decisions"] = data["key_decisions"]
            if data.get("followup_items"):
                entry["followup_items"] = data["followup_items"]
            if data.get("related_entries"):
                entry["related_entries"] = data["related_entries"]
            entries.append(entry)
            save_json("learning_log.json", log)
            return f"✅ Logged learning: {data['topic']} (id: {entry_id})"
        elif action == "update":
            entry_id = data.get("id", "")
            # `_as_text`: `topic` is compared with `.lower()`, so a non-string
            # one raised AttributeError instead of falling through to the
            # "requires 'id' or 'topic'" error below.
            topic = _as_text(data.get("topic", ""))
            if not entry_id and not topic:
                return "❌ Learning log update requires 'id' or 'topic'"
            target = None
            for entry in reversed(entries):
                stored_topic = entry.get("topic")
                if (entry_id and entry.get("id") == entry_id) or \
                   (not entry_id and topic and isinstance(stored_topic, str)
                    and stored_topic.lower() == topic.lower()):
                    target = entry
                    break
            if target is None:
                return f"❌ Learning entry not found: {entry_id or topic}"
            if data.get("related_entries"):
                err = _validate_related_entries(data["related_entries"])
                if err:
                    return err
            updated = []
            for field in ("details", "source", "tags", "key_decisions",
                          "followup_items", "conversation_metadata", "related_entries"):
                if data.get(field):
                    target[field] = data[field]
                    updated.append(field)
            if data.get("new_topic"):
                target["topic"] = data["new_topic"]
                updated.append("topic")
            if not updated:
                return ("❌ Learning log update requires at least one of: details, source, tags, "
                        "key_decisions, followup_items, conversation_metadata, related_entries, new_topic")
            save_json("learning_log.json", log)
            return f"✅ Updated learning entry: {target.get('topic', entry_id)} ({', '.join(updated)})"
        elif action == "remove":
            topic = data.get("topic", "")
            entry_id = data.get("id", "")
            for i in range(len(entries) - 1, -1, -1):
                if (entry_id and entries[i].get("id") == entry_id) or \
                   (topic and entries[i].get("topic", "").lower() == topic.lower()):
                    removed = entries.pop(i)
                    save_json("learning_log.json", log)
                    return f"✅ Removed learning entry: {removed.get('topic', entry_id)}"
            return f"❌ Learning entry not found: {topic or entry_id}"
    
    # === HOBBY EXTRAS (references and specifics) ===
    elif entity == "hobby_reference":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.get("hobbies", [])
        hobby_name = get_field(data, "hobby_name", "hobby", "parent", "for_hobby")
        idx, hobby = find_in_array(hobbies, hobby_name or "", "name")
        if idx == -1:
            return f"❌ Hobby '{hobby_name}' not found"
        
        refs = hobby.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "title")
        
        if action == "add":
            if not ref_name:
                return "❌ Reference requires 'ref_name' or 'name'"
            refs.append({
                "name": ref_name,
                "url": get_field(data, "url", "link", "href", default=""),
                "notes": get_field(data, "notes", "description", default="")
            })
            hobby["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added reference to {hobby_name}"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference '{ref_name}' not found"
            for field in ["url", "notes"]:
                if data.get(field):
                    ref[field] = data[field]
            new_name = get_field(data, "new_name", "new_ref_name")
            if new_name:
                ref["name"] = new_name
            save_json("lifestyle.json", lifestyle)
            return f"✅ Updated reference in {hobby_name}"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference '{ref_name}' not found"
            refs.pop(ref_idx)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed reference from {hobby_name}"
    
    elif entity == "hobby_specific":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.get("hobbies", [])
        hobby_name = get_field(data, "hobby_name", "hobby", "parent", "for_hobby")
        idx, hobby = find_in_array(hobbies, hobby_name or "", "name")
        if idx == -1:
            return f"❌ Hobby '{hobby_name}' not found"
        
        specifics = hobby.setdefault("specifics", [])
        specific_val = get_field(data, "specific", "value", "item", "detail")
        if action == "add":
            if specific_val:
                specifics.append(specific_val)
                save_json("lifestyle.json", lifestyle)
                return f"✅ Added specific to {hobby_name}"
            return "❌ Specific requires 'specific' or 'value'"
        elif action == "remove":
            if specific_val in specifics:
                specifics.remove(specific_val)
                save_json("lifestyle.json", lifestyle)
                return f"✅ Removed specific from {hobby_name}"
            return f"❌ Specific not found"
    
    # === GENERAL PREFERENCE (key-value category system) ===
    elif entity == "preference":
        preferences = load_json("preferences.json")
        category = get_field(data, "category", "type", default="general")
        key = get_field(data, "key", "setting", "option", "preference")
        value = get_field(data, "value", "setting_value", default="")
        # Both are used as dict keys, so a non-string one raised TypeError:
        # unhashable type before any of the checks below could reject it.
        if not isinstance(category, str):
            return "❌ Preference 'category' must be a string"
        if key is not None and not isinstance(key, str):
            return "❌ Preference 'key' must be a string"
        cat_prefs = preferences.setdefault(category, {})

        if action in ["add", "update"]:
            if not key:
                return "❌ Preference requires 'key'"
            # This is the generic escape hatch: it writes any key under any
            # category, which is exactly why it could replace a stored LIST --
            # code_style.tools, learning_style.preferred -- with a bare string.
            # No reader expects that shape and no other branch can produce it.
            # Replacing a list is still allowed; doing it with a scalar is not.
            existing = cat_prefs.get(key)
            if isinstance(existing, list) and not isinstance(value, list):
                return (f"❌ {category}.{key} holds a list -- pass 'value' as a "
                        f"list to replace it, or use 'remove' to drop the key")
            cat_prefs[key] = value
            save_json("preferences.json", preferences)
            return f"✅ Set {category}.{key}"
        elif action == "remove":
            if key not in cat_prefs:
                return f"❌ Preference '{key}' not found in {category}"
            del cat_prefs[key]
            save_json("preferences.json", preferences)
            return f"✅ Removed {category}.{key}"
    
    # === COMMUNICATION PREFERENCES ===
    elif entity == "communication_default":
        preferences = load_json("preferences.json")
        comm = preferences.setdefault("communication", {})
        default = comm.setdefault("default", {"tone": "", "detail_level": "", "locale": "British English"})
        
        if action == "update":
            updated = []
            if data.get("tone"):
                default["tone"] = data["tone"]
                updated.append(f"tone={data['tone']}")
            if data.get("detail_level"):
                default["detail_level"] = data["detail_level"]
                updated.append(f"detail_level={data['detail_level']}")
            if data.get("locale"):
                default["locale"] = data["locale"]
                updated.append(f"locale={data['locale']}")
            if not updated:
                return "❌ communication_default update requires 'tone', 'detail_level', or 'locale'"
            save_json("preferences.json", preferences)
            return f"✅ Updated default communication: {', '.join(updated)}"
        return f"❌ communication_default only supports 'update' action"
    
    elif entity == "response_format":
        preferences = load_json("preferences.json")
        items = preferences.setdefault("response_format", [])
        # Bare strings, like lifestyle's energy_peaks. Was five fixed booleans
        # until wave 6; free text says what a boolean cannot ("code blocks for
        # anything over three lines").
        if not isinstance(items, list):
            items = []
            preferences["response_format"] = items
        item = get_field(data, "item", "format", "preference", "value", default="")

        if action == "add":
            if not item:
                return "❌ response_format requires 'item'"
            if any(isinstance(i, str) and i.lower() == item.lower() for i in items):
                return f"ℹ️ '{item}' already in response format"
            items.append(item)
            save_json("preferences.json", preferences)
            return f"✅ Added response format: {item}"
        elif action == "remove":
            found = next(
                (i for i in items if isinstance(i, str) and i.lower() == item.lower()), None
            )
            if found is None:
                return f"❌ Response format '{item}' not found"
            items.remove(found)
            save_json("preferences.json", preferences)
            return f"✅ Removed response format: {item}"

    elif entity == "mood_override":
        preferences = load_json("preferences.json")
        comm = preferences.setdefault("communication", {})
        overrides = comm.setdefault("mood_overrides", [])
        # `_as_text`: `mood` is compared with `.lower()` below, so a non-string
        # one used to raise AttributeError. Reading as absent lets the branch's
        # own "requires 'mood'" check answer instead.
        mood = _as_text(get_field(data, "mood", "feeling", "state", "when", default=""))

        def _find_override(value):
            return next((o for o in overrides
                         if isinstance(o.get("mood"), str)
                         and o["mood"].lower() == value.lower()), None)

        if action in ("add", "update"):
            if not mood:
                return "❌ mood_override requires 'mood' (e.g., 'stressed', 'tired', 'excited')"
            existing = _find_override(mood)
            # `update` is declared on this entity and had no branch: it fell
            # through to the generic path, which does not know this shape. The
            # `add`-onto-an-existing-row path below already IS an update, so the
            # two actions share it.
            if existing is None and action == "update":
                return f"❌ No mood override for '{mood}'"
            if existing:
                if data.get("tone"):
                    existing["tone"] = data["tone"]
                if data.get("detail_level"):
                    existing["detail_level"] = data["detail_level"]
                save_json("preferences.json", preferences)
                return f"✅ Updated mood override for '{mood}'"
            override = {"mood": mood}
            if data.get("tone"):
                override["tone"] = data["tone"]
            if data.get("detail_level"):
                override["detail_level"] = data["detail_level"]
            if len(override) == 1:
                return "❌ mood_override needs at least 'tone' or 'detail_level'"
            overrides.append(override)
            save_json("preferences.json", preferences)
            return f"✅ Added mood override: when {mood} → {override}"
        elif action == "remove":
            if not mood:
                return "❌ mood_override remove requires 'mood'"
            found = _find_override(mood)
            if not found:
                return f"❌ No mood override for '{mood}'"
            overrides.remove(found)
            save_json("preferences.json", preferences)
            return f"✅ Removed mood override for '{mood}'"
        elif action == "update":
            if not mood:
                return "❌ mood_override update requires 'mood'"
            existing = next((o for o in overrides if o.get("mood", "").lower() == mood.lower()), None)
            if not existing:
                return f"❌ No mood override for '{mood}' to update"
            if data.get("tone"):
                existing["tone"] = data["tone"]
            if data.get("detail_level"):
                existing["detail_level"] = data["detail_level"]
            save_json("preferences.json", preferences)
            return f"✅ Updated mood override for '{mood}'"
    
    # === WELLNESS ENTITIES ===
    elif entity == "sleep":
        lifestyle = load_json("lifestyle.json")
        wellness = lifestyle.setdefault("wellness", {})
        sleep = wellness.setdefault("sleep", {
            "weekday": {"bedtime": "", "wakeup": ""},
            "weekend": {"bedtime": "", "wakeup": ""}
        })
        day_type = get_field(data, "day_type", "type", "day", "when", default="weekday")
        bedtime = get_field(data, "bedtime", "bed_time", "sleep_time", "sleep", default=None)
        wakeup = get_field(data, "wakeup", "wake_up", "wake_time", "wake", "rise", default=None)
        
        if action == "update":
            if day_type not in ["weekday", "weekend"]:
                return f"❌ day_type must be 'weekday' or 'weekend', got '{day_type}'"
            day_sleep = sleep.setdefault(day_type, {"bedtime": "", "wakeup": ""})
            if bedtime is not None:
                day_sleep["bedtime"] = bedtime
            if wakeup is not None:
                day_sleep["wakeup"] = wakeup
            save_json("lifestyle.json", lifestyle)
            updated = []
            if bedtime: updated.append(f"bedtime={bedtime}")
            if wakeup: updated.append(f"wakeup={wakeup}")
            return f"✅ Updated {day_type} sleep: {', '.join(updated)}"
        return f"❌ Sleep only supports 'update' action"
    
    elif entity == "energy_peak":
        lifestyle = load_json("lifestyle.json")
        wellness = lifestyle.setdefault("wellness", {})
        peaks = wellness.setdefault("energy_peaks", [])
        item = get_field(data, "peak", "energy_peak", "time", "when", "name", default="")
        
        if action == "add":
            if not item:
                return "❌ Energy peak requires 'peak' or 'time'"
            if any(p.lower() == item.lower() for p in peaks):
                return f"ℹ️ '{item}' already in energy peaks"
            peaks.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added energy peak: {item}"
        elif action == "remove":
            found = next((p for p in peaks if p.lower() == item.lower()), None)
            if not found:
                return f"❌ Energy peak '{item}' not found"
            peaks.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed energy peak: {item}"

    elif entity == "stress_trigger":
        # `wellness.stress_triggers` had a seeded key, a UI node and an editor,
        # but no entity and no branch: the UI was its only writer, so an AI
        # client could see the value in context and never change it. Mirrors
        # `energy_peak` above -- same sub-object, same bare-string list.
        lifestyle = load_json("lifestyle.json")
        wellness = lifestyle.setdefault("wellness", {})
        triggers = wellness.setdefault("stress_triggers", [])
        item = get_field(data, "trigger", "stress_trigger", "item", "name", default="")

        if action == "add":
            if not item:
                return "❌ Stress trigger requires 'trigger'"
            if any(t.lower() == item.lower() for t in triggers):
                return f"ℹ️ '{item}' already in stress triggers"
            triggers.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added stress trigger: {item}"
        elif action == "remove":
            found = next((t for t in triggers if t.lower() == item.lower()), None)
            if not found:
                return f"❌ Stress trigger '{item}' not found"
            triggers.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed stress trigger: {item}"


    # === PROJECT EXTRAS ===
    elif entity == "project_tag":
        projects = load_json("projects.json")
        project_list = projects.get("projects", [])
        project_name = get_field(data, "project_name", "project", "for_project")
        idx, project = find_in_array(project_list, project_name or "", "name")
        if idx == -1:
            return f"❌ Project '{project_name}' not found"
        
        tags = project.setdefault("tags", [])
        tag = get_field(data, "tag", "label", "value")
        if action == "add":
            if tag and tag not in tags:
                tags.append(tag)
                save_json("projects.json", projects)
                return f"✅ Added tag '{tag}' to {project_name}"
            return f"ℹ️ Tag '{tag}' already exists"
        elif action == "remove":
            if tag in tags:
                tags.remove(tag)
                save_json("projects.json", projects)
                return f"✅ Removed tag '{tag}' from {project_name}"
            return f"❌ Tag not found"
    
    elif entity == "project_reference":
        projects = load_json("projects.json")
        project_list = projects.get("projects", [])
        project_name = get_field(data, "project_name", "project", "for_project")
        idx, project = find_in_array(project_list, project_name or "", "name")
        if idx == -1:
            return f"❌ Project '{project_name}' not found"
        
        refs = project.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "title")
        ref_url = get_field(data, "url", "link", "href", default="")
        ref_notes = get_field(data, "notes", "description", default="")
        
        if action == "add":
            refs.append({"name": ref_name or "", "url": ref_url, "notes": ref_notes})
            save_json("projects.json", projects)
            return f"✅ Added reference to {project_name}"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            if ref_url:
                ref["url"] = ref_url
            if ref_notes:
                ref["notes"] = ref_notes
            save_json("projects.json", projects)
            return f"✅ Updated reference"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            refs.pop(ref_idx)
            save_json("projects.json", projects)
            return f"✅ Removed reference"
    
    elif entity == "project_highlight":
        projects = load_json("projects.json")
        project_list = projects.get("projects", [])
        project_name = get_field(data, "project_name", "project", "for_project", "parent")
        if not project_name:
            return "❌ Project highlight requires 'project_name' to identify which project"
        idx, project = find_in_array(project_list, project_name, "name")
        if idx == -1:
            return f"❌ Project '{project_name}' not found"
        
        highlights = project.setdefault("highlights", [])
        if action == "add":
            new_highlights = data.get("highlights", [])
            if not new_highlights:
                single = get_field(data, "highlight", "item", "achievement", default="")
                if single:
                    new_highlights = [single]
            if not new_highlights:
                return "❌ Project highlight requires 'highlight' or 'highlights'"
            added = []
            for h in new_highlights:
                if h and h not in highlights:
                    highlights.append(h)
                    added.append(h)
            project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("projects.json", projects)
            if len(added) == 1:
                return f"✅ Added highlight to {project_name}: {added[0]}"
            return f"✅ Added {len(added)} highlights to {project_name}"
        elif action == "remove":
            highlight = get_field(data, "highlight", "item", default="")
            if highlight in highlights:
                highlights.remove(highlight)
                project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
                save_json("projects.json", projects)
                return f"✅ Removed highlight from {project_name}"
            return f"❌ Highlight not found"
    
    # === KNOWLEDGE EXTRAS ===
    elif entity == "knowledge":
        knowledge = load_json("knowledge.json")
        category = get_field(data, "category", "type", default="domains")
        # `category` is used as a dict key, so a non-string one raised
        # TypeError: unhashable type before it could be rejected.
        if not isinstance(category, str):
            return "❌ Knowledge 'category' must be a string"
        items = knowledge.setdefault(category, [])
        name = get_field(data, "name", "topic", "domain", "subject", "area")
        level = get_field(data, "level", "proficiency", "skill_level", default="learning")
        notes = get_field(data, "notes", "description", "details", default="")
        
        if action == "add":
            if not name:
                return "❌ Knowledge requires 'name' or 'topic'"
            if any(isinstance(k, dict) and k.get("name", "").lower() == name.lower() for k in items):
                return f"ℹ️ '{name}' already exists in {category}"
            items.append({
                "name": name, "level": level, "notes": notes,
                "references": data.get("references", []),
                "added_date": datetime.now().strftime("%Y-%m-%d")
            })
            save_json("knowledge.json", knowledge)
            return f"✅ Added {name} to {category}"
        elif action == "update":
            idx, item = find_in_array(items, name or "", "name")
            if idx == -1:
                return f"❌ '{name}' not found in {category}"
            if level != "learning" or data.get("level"):
                item["level"] = level
            if notes:
                item["notes"] = notes
            # Same gap as `domain.update`, which this branch mirrors.
            if isinstance(data.get("references"), list):
                item["references"] = data["references"]
            item["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("knowledge.json", knowledge)
            return f"✅ Updated {name} in {category}"
        elif action == "remove":
            idx, _ = find_in_array(items, data.get("name", ""), "name")
            if idx == -1:
                return f"❌ '{name}' not found in {category}"
            items.pop(idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed {name} from {category}"
    
    elif entity == "domain_reference":
        knowledge = load_json("knowledge.json")
        domains = knowledge.get("domains", [])
        domain_name = get_field(data, "domain_name", "domain", "for_domain", "parent")
        idx, domain = find_in_array(domains, domain_name or "", "name")
        if idx == -1:
            return f"❌ Domain '{domain_name}' not found"
        
        refs = domain.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "title")
        ref_url = get_field(data, "url", "link", "href", default="")
        ref_notes = get_field(data, "notes", "description", default="")
        
        if action == "add":
            refs.append({"name": ref_name or "", "url": ref_url, "notes": ref_notes})
            save_json("knowledge.json", knowledge)
            return f"✅ Added reference to {domain_name}"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            if ref_url:
                ref["url"] = ref_url
            if ref_notes:
                ref["notes"] = ref_notes
            new_name = get_field(data, "new_name", "new_ref_name")
            if new_name:
                ref["name"] = new_name
            save_json("knowledge.json", knowledge)
            return f"✅ Updated reference in {domain_name}"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            refs.pop(ref_idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed reference"
    
    elif entity == "mental_tab_reference":
        knowledge = load_json("knowledge.json")
        tabs = knowledge.get("mental_tabs", [])
        topic = get_field(data, "title", "topic", "mental_tab", "for_tab", "parent")
        idx, tab = find_in_array(tabs, topic or "", "title")
        if idx == -1:
            idx, tab = find_in_array(tabs, topic or "", "topic")
        if idx == -1:
            return f"❌ Mental tab '{topic}' not found"
        
        refs = tab.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "reference")
        ref_url = get_field(data, "url", "link", "href", default="")
        ref_notes = get_field(data, "notes", "description", default="")
        
        if action == "add":
            refs.append({"name": ref_name or "", "url": ref_url, "notes": ref_notes})
            save_json("knowledge.json", knowledge)
            return f"✅ Added reference to mental tab"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            if ref_url:
                ref["url"] = ref_url
            if ref_notes:
                ref["notes"] = ref_notes
            new_name = get_field(data, "new_name", "new_ref_name")
            if new_name:
                ref["name"] = new_name
            save_json("knowledge.json", knowledge)
            return f"✅ Updated reference"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            refs.pop(ref_idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed reference"
    
    # === EDUCATION EXTRAS ===
    elif entity == "education_highlight":
        profile = load_json("profile.json")
        education = profile.get("education", [])
        idx, edu = find_in_array(education, data.get("institution", ""), "institution")
        if idx == -1:
            return f"❌ Education at '{data.get('institution')}' not found"
        
        highlights = edu.setdefault("highlights", [])
        if action == "add":
            highlight = data.get("highlight", "")
            if highlight and highlight not in highlights:
                highlights.append(highlight)
                save_json("profile.json", profile)
                return f"✅ Added highlight to {data['institution']}"
            return "❌ Highlight requires 'highlight' field"
        elif action == "remove":
            if data.get("highlight") in highlights:
                highlights.remove(data["highlight"])
                save_json("profile.json", profile)
                return f"✅ Removed highlight"
            return f"❌ Highlight not found"
    
    elif entity == "club":
        profile = load_json("profile.json")
        education = profile.get("education", [])
        idx, edu = find_in_array(education, data.get("institution", ""), "institution")
        if idx == -1:
            return f"❌ Education at '{data.get('institution')}' not found"

        clubs = edu.setdefault("clubs", [])
        name = get_field(data, "name", "club", "society", "activity")
        # Objects, like coursework: {"name": ..., "activities_involved": [...]}.
        # Before wave 6 `clubs` had no entity and no branch at all -- the editor
        # was its only writer, so no AI client could read into or out of it.
        if action == "add":
            if not name:
                return "❌ Club requires 'name'"
            if _find_course(clubs, name) is not None:
                return f"ℹ️ '{name}' already in clubs"
            clubs.append({
                "name": name,
                "activities_involved": _as_list(data.get("activities_involved")),
            })
            save_json("profile.json", profile)
            return f"✅ Added club: {name}"
        elif action == "remove":
            existing = _find_course(clubs, name)
            if existing is not None:
                clubs.remove(existing)
                save_json("profile.json", profile)
                return f"✅ Removed club: {name}"
            return f"❌ Club not found"

    elif entity in ("coursework", "coursework_topic"):
        # One branch, two entity names. `coursework_topic` used to be a second
        # branch duplicating this one verbatim -- same file, same list, same
        # object shape -- which meant every future fix had to be made twice or
        # the two would drift. It stays in the vocabulary because clients call
        # it; it no longer stays as a copy.
        noun = "coursework" if entity == "coursework" else "coursework topic"
        profile = load_json("profile.json")
        education = profile.get("education", [])
        idx, edu = find_in_array(education, data.get("institution", ""), "institution")
        if idx == -1:
            return f"❌ Education at '{data.get('institution')}' not found"

        coursework = edu.setdefault("coursework", [])
        # The union of the two branches' alias lists. `course` is first either
        # way, so a client sending both `course` and `topic` gets what it got
        # before; the only behaviour change is that each entity now also
        # answers to the other's spelling.
        course = get_field(data, "course", "coursework", "class", "topic", "subject")

        # A course is an OBJECT: {"name": ..., "topics": [...]}. This branch
        # used to append the bare string, while the editor wrote and read
        # objects -- so an AI-added course rendered as "Untitled Course" and
        # could never be removed, because `course in coursework` compares a
        # string against a dict and never matches. Legacy bare strings are
        # coerced on read by persona_store._normalize.
        if action == "add":
            if not course:
                return f"❌ {noun.capitalize()} requires 'course' or 'topic'"
            if _find_course(coursework, course) is not None:
                return f"ℹ️ '{course}' already in coursework"
            coursework.append({"name": course, "topics": _as_list(data.get("topics"))})
            save_json("profile.json", profile)
            return f"✅ Added {noun}: {course}"
        elif action == "remove":
            existing = _find_course(coursework, course)
            if existing is not None:
                coursework.remove(existing)
                save_json("profile.json", profile)
                return f"✅ Removed {noun}: {course}"
            return f"❌ {noun.capitalize()} not found"

    elif (_gspec := _generic_entity_spec(entity)) is not None:
        section, list_key, espec = _gspec
        blob = load_json(f"{section}.json")
        items = blob.setdefault(list_key, [])

        def _enforce_exclusive(payload, keep):
            """Clear an entity's `exclusive_fields` on every item but `keep`.

            Declared once on the entity so both writers honour it; enforcing it
            in the renderer alone would leave an MCP client free to create a
            second `primary` aesthetic, which is exactly the write the minimal
            context scope reads.
            """
            for field in espec.get("exclusive_fields") or []:
                if payload.get(field) is not True:
                    continue
                for other in items:
                    if other is not keep and isinstance(other, dict):
                        other.pop(field, None)
        ident = espec["identifier"]
        value = get_field(data, ident, "name", "title")

        def _validate_enums(payload: dict):
            for f, allowed in espec.get("valid_values", {}).items():
                if f in payload and payload[f] not in allowed:
                    return f"❌ Invalid {f} '{payload[f]}'. Valid: {allowed}"
            return None

        fields = [f for f in espec["required"] + espec["optional"] if f != ident]

        if action == "add":
            if not value:
                return f"❌ {entity} requires '{ident}'"
            idx, _ = find_in_array(items, value, ident)
            if idx != -1:
                return f"ℹ️ {entity} '{value}' already exists"
            item = {ident: value}
            for f in fields:
                v = get_field(data, f)
                if v is not None:
                    item[f] = v
            for f, default in espec.get("field_defaults", {}).items():
                item.setdefault(f, default)
            missing = [f for f in espec["required"] if f not in item]
            if missing:
                return f"❌ {entity} requires {missing}"
            err = _validate_enums(item)
            if err:
                return err
            items.append(item)
            _enforce_exclusive(item, item)
            save_json(f"{section}.json", blob)
            return f"✅ Added {entity}: {value}"

        elif action == "update":
            idx, item = find_in_array(items, value or "", ident)
            if idx == -1:
                return f"❌ {entity} '{value}' not found"
            changes = {}
            for f in fields:
                v = get_field(data, f)
                if v is not None:
                    changes[f] = v
            err = _validate_enums(changes)
            if err:
                return err
            item.update(changes)
            _enforce_exclusive(changes, item)
            new_ident = get_field(data, f"new_{ident}")
            if new_ident:
                item[ident] = new_ident
            save_json(f"{section}.json", blob)
            return f"✅ Updated {entity}: {item[ident]}"

        elif action == "remove":
            idx, _ = find_in_array(items, value or "", ident)
            if idx == -1:
                return f"❌ {entity} '{value}' not found"
            items.pop(idx)
            save_json(f"{section}.json", blob)
            return f"✅ Removed {entity}: {value}"

    return f"❌ Unknown entity type: {entity}"


# =============================================================================
# ENTITY SCHEMA - For LLM discovery
# =============================================================================

# Each entity carries an `identifier`: the field in `data` used to match an
# existing item on update/remove. Nested entities also carry a `parent`: the
# parent item's identifier field, which must be present in `data` too.
# Both are verified against execute_modify's actual matching logic.
# Per-entity write schema, owned by the section pack manifests
# (backend/section_packs/<key>/manifest.json). Shape is unchanged:
# {section_key: {entity_name: {actions, required, optional, valid_values?,
# identifier, parent?, description?}}}.
import pack_loader as _pack_loader

ENTITY_SCHEMA = _pack_loader.build_entity_schema(_pack_loader.manifests())

GOAL_TYPES = set(ENTITY_SCHEMA["goals"]["goal"]["valid_values"]["type"])
GOAL_STATUSES = set(ENTITY_SCHEMA["goals"]["goal"]["valid_values"]["status"])


def _section_for_entity(entity: str):
    """The registry section (file_type) an entity writes to, or None if unknown."""
    entity = entity.lower()
    for file_name, entities in ENTITY_SCHEMA.items():
        if entity in entities:
            return file_name
    return None


# Usage instructions embedded in every get_schema digest so the LLM sees them up front.
_SCHEMA_USAGE = {
    "choosing_a_write_tool": (
        "Which write tool is correct depends on whether the user asked. For a "
        "change they explicitly asked for, persona_modify / persona_batch "
        "write it immediately. For anything you inferred from the "
        "conversation, propose_update(proposals, client) puts it in their "
        "review queue instead. Same entity vocabulary either way."
    ),
    "workflow": (
        "Use persona_modify(action, entity, data) for one change the user "
        "asked for, persona_batch([...]) for many, and propose_update("
        "proposals, client) for anything you inferred rather than were asked "
        "-- see choosing_a_write_tool. Call get_schema(entity='<name>') for "
        "one entity's full fields, enum values, and copy-paste examples."
    ),
    "identifying": (
        "For update/remove, include the entity's `identifier` field (shown per "
        "entity) matching an existing item."
    ),
    "ids_automatic": (
        "Never send an `id` field — stable ids are assigned automatically on save. "
        "Reference entities by their identifier (name/topic/title/etc.)."
    ),
    "nested": (
        "Entities with a `parent` also need the parent's identifier in `data`, "
        "e.g. project_highlight needs {project_name, highlight}."
    ),
    "linking": (
        "Connect any two existing entries with persona_modify(action=\"link\", "
        "entity=\"link\", data={entity_id: <source id>, related: [<target id>, ...]}) "
        "-- `entity` is ignored for link/unlink (entity=\"link\" is just the "
        "convention). action=\"unlink\" removes ids the same way. Links are "
        "one-directional (stored on the source only) and capped at 10 per entry. "
        "get_entity's `similar` list suggests candidate ids to link."
    ),
}


def _digest_entry(entity: str, spec: dict) -> dict:
    """Lean per-entity digest line: identifier, required, actions (+ parent/purpose)."""
    line = {"entity": entity, "identifier": spec.get("identifier")}
    if spec.get("parent"):
        line["parent"] = spec["parent"]
    line["required"] = spec.get("required", [])
    line["actions"] = spec.get("actions", [])
    if spec.get("description"):
        line["purpose"] = spec["description"]
    return line


def _digest(files: list[str]) -> dict:
    """Build the lean digest for the given file names."""
    return {
        # copy so a caller mutating the result can't corrupt the module constant
        "usage": dict(_SCHEMA_USAGE),
        "files": {
            f: [_digest_entry(name, spec) for name, spec in ENTITY_SCHEMA[f].items()]
            for f in files
        },
    }


def _sample_value(field: str, valid_values: dict) -> str:
    """A minimal but valid sample value for an example field."""
    if field in valid_values:
        return valid_values[field][0]
    return f"<{field}>"


def _add_sample_optional(data: dict, spec: dict) -> None:
    """Add one sample optional field (preferring one with enum values) to `data`."""
    valid_values = spec.get("valid_values", {})
    optional = spec.get("optional", [])
    chosen = next((o for o in optional if o in valid_values), None)
    if chosen is None and optional:
        chosen = optional[0]
    if chosen and chosen not in data:
        data[chosen] = _sample_value(chosen, valid_values)


def _example_data(spec: dict, mode: str) -> dict:
    """Build a data payload for an example.

    add    -> all required fields + one sample optional (a complete, valid payload).
    update -> parent + identifier (to locate) + one sample optional (to change).
    remove -> parent + identifier only (all that matching needs).
    """
    valid_values = spec.get("valid_values", {})
    data = {}
    if mode == "add":
        for field in spec.get("required", []):
            data[field] = _sample_value(field, valid_values)
        _add_sample_optional(data, spec)
        return data
    # update / remove: locate by parent + identifier
    if spec.get("parent"):
        data[spec["parent"]] = _sample_value(spec["parent"], valid_values)
    identifier = spec.get("identifier")
    if identifier:
        data[identifier] = _sample_value(identifier, valid_values)
    if mode == "update":
        _add_sample_optional(data, spec)
    return data


def _build_examples(entity: str, spec: dict) -> dict:
    """Copy-paste persona_modify examples, one per supported action."""
    actions = spec.get("actions", [])
    examples = {}
    for action in ("add", "update", "remove"):
        if action not in actions:
            continue
        data = _example_data(spec, action)
        if not data:
            # Never emit a malformed empty-data example. Fall back to the first
            # required field (not reachable today, but guards future entities).
            required = spec.get("required", [])
            if required:
                data = {required[0]: _sample_value(required[0], spec.get("valid_values", {}))}
            else:
                continue
        examples[action] = {"action": action, "entity": entity, "data": data}
    return examples


def get_entity_schema(entity: str = None, file: str = None) -> dict:
    """Get schema for entity types.

    - entity="X": full detail for one entity, with identifier and worked examples.
    - file="X": lean digest scoped to one file (usage block + its entities).
    - no args: lean digest of all files (usage block + per-file entity lines).
    """
    enabled = settings_store.enabled_sections()

    if entity:
        entity_lower = entity.lower()
        for file_name, entities in ENTITY_SCHEMA.items():
            if entity_lower in entities:
                if file_name not in enabled:
                    return {"error": f"Section '{file_name}' is disabled; enable it in settings."}
                spec = entities[entity_lower]
                detail = {"entity": entity_lower, "file": file_name,
                          "identifier": spec.get("identifier")}
                if spec.get("parent"):
                    detail["parent"] = spec["parent"]
                detail["actions"] = spec.get("actions", [])
                detail["required"] = spec.get("required", [])
                detail["optional"] = spec.get("optional", [])
                if spec.get("valid_values"):
                    detail["valid_values"] = spec["valid_values"]
                if spec.get("description"):
                    detail["purpose"] = spec["description"]
                detail["examples"] = _build_examples(entity_lower, spec)
                # The examples above are persona_modify-shaped, and this is the
                # call an agent makes immediately before writing -- so it is
                # exactly where the other door has to be pointed out. The
                # digest paths carry the full usage block; a single entity gets
                # the one line that decides which tool is correct.
                detail["writing"] = _SCHEMA_USAGE["choosing_a_write_tool"]
                return detail
        valid = sorted(e for ents in ENTITY_SCHEMA.values() for e in ents)
        return {"error": f"Unknown entity: {entity}. Use get_schema() to see valid entities.",
                "valid_entities": valid}

    if file:
        file_lower = file.lower()
        if file_lower in ENTITY_SCHEMA and file_lower not in enabled:
            return {"error": f"Section '{file_lower}' is disabled."}
        if file_lower in ENTITY_SCHEMA:
            return _digest([file_lower])
        return {"error": f"Unknown file: {file}. Valid files: {', '.join(ENTITY_SCHEMA.keys())}",
                "valid_files": list(ENTITY_SCHEMA.keys())}

    return _digest([f for f in ENTITY_SCHEMA if f in enabled])




# =============================================================================
# FASTMCP SERVER INITIALIZATION
# =============================================================================

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

# The skills the instructions above point at, served at skill://mygist/<name>/
# SKILL.md. Not scope-gated, unlike the tools: a skill file is public
# documentation about how to call an API and holds no persona data. See
# skill_resources.py.
skill_resources.register(mcp)

# Per-client counters: which client asked for what, and how often. The one
# thing this server could not previously answer about its own adoption --
# see migration 0008_mcp_activity. Registered first so it counts everything
# below it.
mcp_activity.register(mcp)

# The actions a user can pick from their client's own menu. These ARE
# scope-gated -- see scopes.PROMPT_SCOPES for why they are hidden rather than
# shown-and-refused, which is the opposite of the choice made for tools.
mcp_prompts.register(mcp)


# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

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
care about. Their persona covers the following -- each key is also a `scope`,
and each line is worded as the user sees it in their own settings, so "you"
there means them:
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
    # Compact serialization: no indent, and no ASCII escaping of characters a
    # persona is full of.
    return json.dumps(result, ensure_ascii=False)


@mcp.tool()
def get_raw(
    file: str = "all"
) -> str:
    """
    Raw dump of persona file(s) — export/debug use. For finding specific
    content, prefer search_context (ranked snippets) + get_entity (full detail).

    WHEN TO USE:
        - Before modifying data (to see current state)
        - When get_context doesn't have enough detail

    FILES:
        - all: Complete persona (all files)
        - profile: name, bio, contact, work_experience[], education[]
        - lifestyle: hobbies[], interests[] (kind-tagged), values[]
        - knowledge: domains[] (skills), mental_tabs[]
        - preferences: code_style, communication, learning_style, likes_dislikes[]
        - projects: projects[], top_of_mind[]
        - circle: connections[]
        - learning_log: entries[]

    ARGS:
        file: File to retrieve

    RETURNS: 
        Raw JSON for the specified file(s)
    """
    enabled = settings_store.enabled_sections()
    if file == "all":
        data = get_all_persona_data()
        return json.dumps({k: v for k, v in data.items() if k in enabled}, indent=2)
    elif file in FILE_MAP and file in enabled:
        return json.dumps(load_json(FILE_MAP[file]), indent=2)
    elif file in FILE_MAP:  # exists but disabled
        return f"❌ Section '{file}' is disabled. Enable it in settings."
    else:
        return f"❌ Unknown file: {file}. Valid: all, {', '.join(persona_store.VALID_FILES)}"


@mcp.tool()
def search_context(query: str, sections: Union[str, List[str], None] = None,
                    limit: int = 10, days: Optional[int] = None) -> str:
    """Search the persona for relevant entries by meaning and keywords.

    CALL THIS when they refer to something they told you before, or ask what
    they decided, tried, read, used, chose, or are working on. Those verbs mean
    a stored entry probably exists, and this is far cheaper than widening a
    get_context scope to go looking for it.

    Returns small ranked snippets rather than whole sections. Follow up with
    get_entity(entity_id) for full detail on a hit. Modes: "hybrid" (FTS +
    embeddings) or "fts" (no embedding provider configured).

    PASS `days` WHENEVER THE QUESTION IS ABOUT NOW: "lately", "recently",
    "currently", "these days", "at the moment", "still", "what am I working on".
    Ranking is relevance-only -- it has no idea what "lately" means, and will
    happily put an eighteen-month-old entry above last week's because the older
    one happens to word things more like the query. `days=30` (or 90) is the only
    thing that makes a recency question return recent entries.

    Every hit carries `updated_at`. Read it before you describe anything as
    current: a result set mixes ages freely, and a stale entry reported as
    today's news is the failure this field exists to prevent. If the dates come
    back older than the question implies, say so rather than answering as though
    they were fresh.

    `days` filters per-entity: each indexed entry is included or excluded by
    its own last-change time, never by excluding a whole section, and it
    only sees data that's in the search index (non-entity fields aren't
    indexed). Note a full backfill with `--recreate` resets every entry's
    last-change time, so `days` will look empty right after one.

    Args:
        query: What to look for (natural language or keywords).
        sections: Optional section name or list to restrict the search
            (e.g. "projects" or ["knowledge", "learning_log"]).
        limit: Max results, 1-25 (default 10).
        days: Optional recency filter — only entries changed in the last
            N days (positive integer). Omit for no filter.
    """
    if not query or not query.strip():
        return "Error: query must be a non-empty string"
    if isinstance(sections, str):
        sections = [sections]
    valid = set(SECTION_REGISTRY)
    if sections:
        unknown = [s for s in sections if s not in valid]
        if unknown:
            return (f"Unknown section(s): {', '.join(unknown)}. "
                    f"Valid: {', '.join(sorted(valid))}")
    disabled = settings_store.get_disabled_sections()
    if sections and all(s in disabled for s in sections):
        # Every requested section is disabled -- an explicit error (same
        # wording as get_entity), not a silently-empty result set.
        if len(sections) == 1:
            return f"❌ Section '{sections[0]}' is disabled. Enable it in settings."
        return (f"❌ Sections {', '.join(repr(s) for s in sections)} are "
                "disabled. Enable them in settings.")
    if days is not None and days <= 0:
        return "Error: days must be a positive integer"
    limit = max(1, min(int(limit), 25))
    user_id = db.current_user_id.get()
    out = search_index.search(user_id, query.strip(), sections, limit,
                               exclude_sections=list(disabled), days=days)
    out["query"] = query.strip()
    # Read tools only. persona_modify and propose_update already return
    # receipts, and a nudge on a write is a nudge to write more.
    out["note"] = ("get_entity(id) for full detail on a hit. Heard something "
                   "durable? propose_update. Do not narrate either.")
    return json.dumps(out, indent=2)


def _resolve_entity(entity_id: str) -> str:
    """Resolve a single entity id to its JSON success string, or a plain
    (non-JSON) error string. Extracted from get_entity's original body so
    both the single-id and batch paths share identical resolution logic."""
    loc = search_index.entity_location(entity_id)
    if loc is None:
        prefixes = sorted({p for p, _ in search_index._PREFIXES})
        return ("Unknown entity id prefix. Valid prefixes: "
                + ", ".join(prefixes))
    file_type, list_key = loc
    disabled = settings_store.get_disabled_sections()
    if file_type in disabled:
        return f"❌ Section '{file_type}' is disabled. Enable it in settings."
    data = load_json(file_type)
    for entity in data.get(list_key) or []:
        if isinstance(entity, dict) and entity.get("id") == entity_id:
            payload = {"section": file_type, "entity_id": entity_id, "entity": entity}
            times = search_index.entity_update_times(db.current_user_id.get(), [entity_id])
            if entity_id in times:
                payload["updated_at"] = times[entity_id]
            _mark_stale({file_type: data})
            # A deliberate fetch of one entry, which is the only read that says
            # anything about whether that entry earns its place. Scope reads pull
            # whole sections and are counted nowhere.
            search_index.bump_read_count(db.current_user_id.get(), [entity_id])
            return json.dumps(payload, indent=2)
    return f"❌ Entity {entity_id} not found in {file_type}.{list_key}"


def _attach_relations(parsed_payloads: list, include_related: bool) -> None:
    """Mutate each resolved get_entity payload in `parsed_payloads` (dicts
    carrying an "entity" key, as produced by _resolve_entity) in place:

    - Stored `related` links are ALWAYS resolved to `{"id", "title",
      "section"}` stubs when present (regardless of `include_related`) --
      an id that no longer resolves (since-deleted entry) still surfaces as
      `{"id", "title": None, "section": None}` rather than being hidden.
      Entities with no `related` field get no "related" key at all.
    - When `include_related` is truthy, also attach derived "similar"
      neighbors (`[]` if none / the entry isn't indexed).

    One `resolve_titles` call covers every payload's related ids combined
    (no N+1 across a batch); neighbors are still looked up per entity via
    semantic_neighbors, bounded by get_entity's 25-id batch cap.
    """
    if not parsed_payloads:
        return
    user_id = db.current_user_id.get()

    all_related_ids = set()
    for payload in parsed_payloads:
        rel = payload["entity"].get("related")
        if isinstance(rel, list) and rel:
            all_related_ids.update(rel)
    titles_map = (search_index.resolve_titles(user_id, list(all_related_ids))
                  if all_related_ids else {})

    enabled_sections = None
    if include_related:
        enabled_sections = settings_store.enabled_sections()
        excluded_sections = list(set(sections.SECTION_REGISTRY) - enabled_sections)
    else:
        enabled_sections = settings_store.enabled_sections()

    for payload in parsed_payloads:
        rel = payload["entity"].get("related")
        if isinstance(rel, list) and rel:
            payload["related"] = [
                {"id": rid, "title": titles_map[rid]["title"], "section": titles_map[rid]["file_type"]}
                if rid in titles_map and titles_map[rid]["file_type"] in enabled_sections
                else {"id": rid, "title": None, "section": None}
                for rid in rel
            ]
        if include_related:
            neighbors = search_index.semantic_neighbors(
                user_id, payload["entity_id"], exclude_sections=excluded_sections)
            payload["similar"] = [
                {"id": n["entity_id"], "title": n["title"], "section": n["file_type"]}
                for n in neighbors
            ]


@mcp.tool()
def get_entity(entity_id: Union[str, List[str]], include_related: bool = False) -> str:
    """Fetch one or more persona entities in full by id (as returned by
    search_context results or embedded in get_context output).

    Args:
        entity_id: Either a single prefixed id, e.g. "project_ab12cd34",
            "learn_20260721_x1y2z3" — returns that entity's JSON directly
            (or a plain error string if unresolvable) — or a list of up to
            25 such ids, which returns `{"entities": [...]}` with one
            element per id, in order: a successful lookup's parsed JSON, or
            `{"entity_id": <id>, "error": <message>}` for any id that
            failed to resolve.
        include_related: When True, also attach derived `"similar"`
            neighbors (cross-section, semantically close entries) to every
            resolved entity. Stored `"related"` links (explicit, via
            action="link") are always resolved and included when present,
            independent of this flag; an id whose target has since been
            deleted still appears, as `{"id", "title": None, "section":
            None}`, rather than being silently dropped.

    An entity carrying `"stale": true` has not changed in longer than its
    section allows for. It is a prompt to check, not a verdict: if the user
    mentions it, confirm it still holds and propose_update if it does not.
    """
    if isinstance(entity_id, str):
        result = _resolve_entity(entity_id)
        try:
            parsed = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            parsed = None
        if isinstance(parsed, dict) and "entity" in parsed:
            _attach_relations([parsed], include_related)
            return json.dumps(parsed, indent=2)
        return result

    if not entity_id:
        return "Error: entity_id list must not be empty."
    if len(entity_id) > 25:
        return "Error: at most 25 ids per call — split into multiple calls"

    entities = []
    resolved_payloads = []
    for eid in entity_id:
        result = _resolve_entity(eid)
        try:
            parsed = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            parsed = None
        # A successful resolution is always a JSON object carrying an
        # "entity" key (see _resolve_entity above) -- any other shape,
        # even if it happens to be valid JSON (e.g. a bare string), is
        # treated as an error so it can never be silently spliced into
        # `entities` as something that looks like a resolved entity.
        if isinstance(parsed, dict) and "entity" in parsed:
            entities.append(parsed)
            resolved_payloads.append(parsed)
        else:
            entities.append({"entity_id": eid, "error": result})
    _attach_relations(resolved_payloads, include_related)
    return json.dumps({"entities": entities}, indent=2)


@mcp.tool()
def get_schema(
    file: Optional[str] = None,
    entity: Optional[str] = None
) -> str:
    """
    Discover valid entity types for persona_modify. Digest first, then drill down.

    BEHAVIOR:
        - No args → lean DIGEST: a `usage` block (workflow + how to identify items
          + ids are automatic + nested rules) plus `files`, each listing its
          entities with their `identifier`, `required` fields and `actions`.
        - entity="X" → FULL detail for one entity: identifier, parent (if nested),
          actions, required, optional, valid_values, plus copy-paste `examples`
          (add / update / remove as supported).
        - file="X" → the same lean digest scoped to that one file.

    The `identifier` is the field in `data` that matches an existing item on
    update/remove. Nested entities also expose a `parent` field that must be in
    `data`. Never send an `id` — ids are assigned automatically.

    ARGS:
        file: Scope digest to one file (profile, lifestyle, knowledge, etc.)
        entity: Full detail + examples for one entity (e.g., 'hobby', 'project')

    RETURNS:
        {usage, files} digest, or {entity, file, identifier, ..., examples} detail
    """
    result = get_entity_schema(entity=entity, file=file)
    return json.dumps(result, indent=2)


# =============================================================================
# ADVISORY DUPLICATE DETECTION — best-effort "resembles existing" nudge on adds
# =============================================================================

# Cosine distance cutoff for the vector leg of the duplicate-advisory search.
# Deliberately tighter than TOPIC_VECTOR_DISTANCE_CUTOFF (topic filtering,
# 0.5): that cutoff only needs "related enough to surface"; this one needs
# "close enough to plausibly be the same thing," so a near-identical text
# match is required before the write-time nudge fires.
DUPLICATE_DISTANCE_CUTOFF = 0.4

# How much of a matched entity's stored text the advisory quotes. Enough to tell
# a duplicate from a contradiction; an agent that needs the whole thing has
# get_entity.
MATCH_TEXT_CHARS = 300

# Bounds on the "what did this replace" note. An update touching many entities is
# a batch or a migration, and pasting all of it back would bury the receipt.
OVERWRITE_NOTE_ENTITIES = 3
OVERWRITE_NOTE_FIELDS = 4
OVERWRITE_NOTE_CHARS = 120

# Top-level id-list entities eligible for the advisory duplicate check on
# "add": entity name -> (file_type, list_key). Built by cross-referencing
# ENTITY_SCHEMA's add-capable entities against each execute_modify branch and
# sections.SECTION_REGISTRY's id_lists -- only lists whose items get a stable
# `id` (via persona_store._assign_ids) qualify, since the advisory result
# must resolve to a real entity_id. Sub-entities that write into plain
# nested lists with no id (email, link, work_highlight, *_reference,
# coursework, coursework_topic, education_highlight, hobby_reference,
# hobby_specific, project_tag, project_reference, project_highlight,
# mental_tab_reference, domain_reference) are excluded, as are
# non-id-list top-level entities: personality_trait/value/energy_peak/
# stress_trigger/preference (plain-value lists, no id_lists entry), the update-only
# singletons basic_info/communication_default/sleep, and `knowledge` (writes
# into a caller-chosen category via `data["category"]`, not one fixed
# list_key -- `domain` already covers the one fixed id-list, `domains`).
# `career_aspiration`/`passion`/`curiosity`/`current_learning` are not listed
# separately: they are back-compat aliases that forward straight into
# `goal`/`interest`, so writes via an alias get no duplicate advisory (only
# direct goal/interest writes do). `like`/`dislike` are added by hand below
# (not by the generic-augmentation block) because they share one bespoke
# execute_modify branch rather than being handled by the generic write path.
ADVISORY_ENTITIES: dict[str, tuple[str, str]] = {
    "work_experience": ("profile", "work_experience"),
    "education": ("profile", "education"),
    "language": ("profile", "languages_spoken"),
    "goal": ("goals", "goals"),
    "domain": ("knowledge", "domains"),
    "mental_tab": ("knowledge", "mental_tabs"),
    "project": ("projects", "projects"),
    "top_of_mind": ("projects", "top_of_mind"),
    "hobby": ("lifestyle", "hobbies"),
    "connection": ("circle", "connections"),
    "learning_entry": ("learning_log", "entries"),
    # Bespoke shared branch (stance-flip logic), not the generic write path.
    "like": ("preferences", "likes_dislikes"),
    "dislike": ("preferences", "likes_dislikes"),
}

# Generic pack entities (manifest-only packs) qualify automatically: any
# top-level id-list entity the generic write branch handles gets the same
# duplicate-advisory coverage as the hand-listed entities above. `interest`
# qualifies this way (explicit `list` field in its manifest entity).
ADVISORY_ENTITIES.update({
    entity: (spec[0], spec[1])
    for section_entities in ENTITY_SCHEMA.values()
    for entity in section_entities
    if entity not in ADVISORY_ENTITIES
    and (spec := _generic_entity_spec(entity)) is not None
})


def _find_strong_match(file_type: str, entity_data: dict,
                        same_section: bool = True) -> Optional[dict]:
    """Advisory-only: does `entity_data` resemble an existing entity closely
    enough to warn about? Returns {"entity_id", "title", "distance",
    "file_type"} for the top qualifying hit, else None. Never raises -- this
    runs before/around the real write and must not block it.

    `same_section` controls search scope, not the strength criteria (those
    apply identically either way):
      - True (default; the same-section duplicate-advisory use): search is
        confined to `file_type` itself via `section_filter=[file_type]`.
      - False (the cross-section relation-nudge use): `file_type` itself is
        excluded instead, and the search spans every OTHER enabled section
        (disabled sections are excluded too -- an advisory pointing at a
        section the user can't currently see would be actionable-looking
        but dead).

    Criteria (checked per hit, so one pass covers both search modes):
      - hybrid (embeddings configured): hit distance is not None and
        <= DUPLICATE_DISTANCE_CUTOFF.
      - FTS-only (no embeddings, hit distance is None): exact
        case-insensitive title match against the flattened title (FTS
        relevance/snippet overlap alone is too noisy to imply "duplicate").
    """
    try:
        flattened_title, flattened_text = search_index.flatten_entity(entity_data)
        if not flattened_text:
            return None
        user_id = db.current_user_id.get()
        # `flattened_text` folds title + every text/nested field into one blob
        # (fine for the vector leg -- length doesn't matter there), but
        # websearch_to_tsquery ANDs all of its words together, so a hit whose
        # title matches exactly but whose other fields don't share a single
        # word would never satisfy the FTS leg's `tsv @@ q` on flattened_text
        # alone. OR-ing the title in front keeps that door open (title alone
        # can satisfy the FTS predicate) without weakening the vector leg,
        # which reads the whole query string regardless of the "OR" token.
        # Crucially, this ANDs the bare words of `flattened_text` together
        # (websearch_to_tsquery's default for adjacent bare words) rather
        # than OR-ing them -- unlike semantic_neighbors' FTS fallback, a
        # single shared word (e.g. "Factory") can never satisfy this query
        # on its own; either the full phrase matches or every word does.
        if flattened_title:
            # Phrase-quote the title so websearch_to_tsquery treats it as a
            # literal adjacency requirement rather than parsing any OR/AND/
            # NOT-like tokens embedded in the title itself as operators.
            # Embedded double quotes are stripped first -- an unescaped quote
            # inside the title would otherwise pair up with a later quote in
            # `flattened_text` (which repeats the title verbatim as its first
            # line) and silently swallow everything in between into one
            # bogus phrase, breaking the match on the entity's own text.
            safe_title = flattened_title.replace('"', "")
            query = f'"{safe_title}" OR {flattened_text}'
        else:
            query = flattened_text
        if same_section:
            section_filter, exclude_sections = [file_type], None
        else:
            section_filter = None
            exclude_sections = list(
                (set(sections.SECTION_REGISTRY) - settings_store.enabled_sections())
                | {file_type})
        hits = search_index.search(user_id, query, section_filter, limit=3,
                                   exclude_sections=exclude_sections)

        def _match(hit):
            # The stored text, not just the title. Without it the caller knows
            # only that something similar exists and has to spend a get_entity
            # round trip to find out whether it actually disagrees -- which is
            # the decision the advisory exists to prompt.
            #
            # flatten_entity writes the title as the first line of the indexed
            # text, so the leading copy is dropped: quoting a title back beside
            # itself is noise, and for a title-only entity (top_of_mind) it
            # leaves nothing, which is the correct answer there.
            text = search_index.entity_text(user_id, hit["entity_id"])
            if hit["title"] and text.startswith(hit["title"]):
                text = text[len(hit["title"]):]
            return {"entity_id": hit["entity_id"], "title": hit["title"],
                    "distance": hit["distance"], "file_type": hit["section"],
                    "text": " ".join(text.split())[:MATCH_TEXT_CHARS]}

        for hit in hits["results"]:
            if hit["distance"] is not None and hit["distance"] <= DUPLICATE_DISTANCE_CUTOFF:
                return _match(hit)
            if flattened_title and hit["title"].lower() == flattened_title.lower():
                return _match(hit)
        return None
    except Exception:
        logger.warning("duplicate-advisory check failed for file_type=%s",
                       file_type, exc_info=True)
        return None


def _advisory_note(match: dict, supports_update: bool) -> str:
    """The advisory line appended to a successful add's message (leading
    space to separate it from the success message). `supports_update` tells
    the caller whether this entity's ENTITY_SCHEMA actions include "update"
    -- if not (e.g. top_of_mind, which is add/remove-only), suggesting
    action="update" would be actionable advice for a dead end, so the
    closing clause degrades to a plain duplicate flag instead (same prefix,
    spec wording preserved verbatim for the update-capable case).

    Carries the matched entity's stored text where there is any, so the caller
    can tell a duplicate from a contradiction without a second lookup."""
    prefix = (f' Note: resembles existing {match["entity_id"]} '
              f'"{match["title"]}" ')
    if match.get("text"):
        prefix += f'(on file: {match["text"]}) '
    if supports_update:
        return prefix + '— if this is the same item, use action="update" instead.'
    return prefix + '— it may be a duplicate.'


def _overwrite_note() -> str:
    """What the update just displaced, read from db.last_write.

    Answers the question the add-side advisory cannot: not "what does this
    resemble" -- an update names its target, so it always resembles itself --
    but "what did this replace". Computed generically in persona_store.save()
    from the two section blobs, so every entity in every section is covered
    without thirty per-branch edits.
    """
    changed = (db.last_write.get() or {}).get("changed") or {}
    if not changed:
        return ""
    parts = []
    for entity_id, was in list(changed.items())[:OVERWRITE_NOTE_ENTITIES]:
        fields = ", ".join(
            f"{field}={_as_text(old)[:OVERWRITE_NOTE_CHARS]!r}"
            for field, old in list(was.items())[:OVERWRITE_NOTE_FIELDS])
        parts.append(f"{entity_id} was {fields}")
    return " Replaced: " + "; ".join(parts) + "."


def _cross_section_nudge(file_type: str, entity_data: dict):
    """Best-effort: does the item just added (`entity_data`, in `file_type`)
    have a STRONG match in some OTHER enabled section worth nudging the
    caller to link? Routed entirely through `_find_strong_match(...,
    same_section=False)` -- the same tight vector cutoff and FTS strength
    rules (exact-title match, AND-joined bare words) the same-section
    duplicate advisory already applies, just pointed at every other enabled
    section instead of `file_type` itself. This intentionally replaces an
    earlier design that probed search_index.semantic_neighbors on the
    just-written row: that helper's FTS fallback OR-joins each word of the
    title (appropriate for "similar" surfacing, wrong for a write-time
    advisory), so a single shared word like "Factory" was enough to fire a
    nudge between two otherwise-unrelated entries -- a false positive fixed
    by using `_find_strong_match`'s stricter query construction instead.

    The query is built fresh from `entity_data` (not re-read from the index
    row), so the vector leg embeds the query text synchronously right here
    -- no need to wait on the async embedding-fill job the write kicked off.

    Never raises -- advisory-only, must never affect the write outcome.
    """
    try:
        match = _find_strong_match(file_type, entity_data, same_section=False)
        if match:
            return (f' Possibly related to {match["entity_id"]} "{match["title"]}" '
                    f'({match["file_type"]}) — link them with action="link"')
        return None
    except Exception:
        logger.warning("cross-section nudge probe failed for file_type=%s",
                       file_type, exc_info=True)
        return None


def _augment_add_result(action: str, entity_lower: str, data: dict,
                         match: Optional[dict], supports_update: bool,
                         result: str) -> str:
    """Append at most one advisory to a modify result: the pre-write
    same-section duplicate note (`match`, computed before execute_modify ran
    so it can't match the entity against itself) if one fired, else -- only
    for a genuinely successful add of an ADVISORY_ENTITIES entity, and only
    when no duplicate note fired -- a best-effort cross-section relation
    nudge probed via `_find_strong_match(..., same_section=False)` against
    the same normalized `data` the write itself used (no dependence on the
    write's assigned id or the index row it produced). The duplicate note
    always wins: at most one advisory per response.
    """
    # A stance flip already tells the caller what changed; piling an
    # advisory on top of it is redundant noise, not new information.
    dup_fired = (bool(match) and not result.startswith("❌")
                 and not result.startswith("✅ Updated stance:"))
    if dup_fired:
        # No conflict proposal filed here, deliberately. At this moment the
        # advisory has not been read yet, so an agent that resolves it on the
        # next line would have a row in the inbox describing a problem it just
        # fixed. The sweep's near-duplicate check finds the same condition and
        # confirms both entries still exist first -- later, but never wrong.
        return result + _advisory_note(match, supports_update)
    if action == "update" and result.startswith("✅"):
        return result + _overwrite_note()
    if action == "add" and entity_lower in ADVISORY_ENTITIES and result.startswith("✅") and not result.startswith("✅ Updated stance:"):
        file_type, _list_key = ADVISORY_ENTITIES[entity_lower]
        try:
            nudge = _cross_section_nudge(file_type, normalize_data(data, entity_lower))
            if nudge:
                result += nudge
        except Exception:
            logger.warning("cross-section nudge lookup failed for entity=%s",
                           entity_lower, exc_info=True)
    return result


@mcp.tool()
def persona_modify(
    action: Literal["add", "update", "remove", "link", "unlink"],
    entity: str,
    data: dict
) -> str:
    """Add, update, or remove a single item from persona data. Also links/
    unlinks any two existing entries.
    If unsure, use get_schema to discover valid entity types, required fields, and enum values.

    WRITES IMMEDIATELY. Use this only when the user has explicitly asked for
    something to be recorded -- "add Datadog to my skills", "mark that project
    finished". If you INFERRED it from what they said rather than being asked,
    call propose_update instead: it puts the change in their review queue
    where they decide, and writing behind their back is what that queue exists
    to prevent.

    Args:
        action: "add" | "update" | "remove" | "link" | "unlink"
        entity: Entity type (use get_schema to discover valid types). Ignored
            for "link"/"unlink" -- pass entity="link" by convention.
        data: Object with identifier + fields. Always include: name, title, topic, or address.
            For "link"/"unlink": {entity_id, related: [ids]} instead --
            entity_id is the source entry, related is the target id(s) to
            connect/disconnect (a single id string is also accepted).

    DATA REQUIREMENTS:
        - Always include identifier: name, title, topic, or address (depends on entity)
        - For update/remove: identifier matches existing item
        - For add: identifier + any optional fields
        - For link/unlink: {entity_id, related: [ids]} (entity is ignored)

    EXAMPLES:
        - ADD hobby: {action: "add", entity: "hobby", data: {name: "Photography", skill_level: "beginner"}}
        - UPDATE project: {action: "update", entity: "project", data: {name: "MyApp", status: "completed"}}
        - REMOVE domain: {action: "remove", entity: "domain", data: {name: "PHP"}}
        - ADD learning_entry: {action: "add", entity: "learning_entry", data: {topic: "React Hooks", details: "...", source: "Claude"}}
        - LINK entries: {action: "link", entity: "link", data: {entity_id: "goal_abc123", related: ["project_def456"]}}
        - UNLINK entries: {action: "unlink", entity: "link", data: {entity_id: "goal_abc123", related: ["project_def456"]}}

    NESTED ITEMS (include parent identifier):
        - work_highlight: {company: "Acme", highlight: "Led migration"}
        - project_reference: {project_name: "MyApp", ref_name: "Docs", url: "https://..."}

    RETURN:
        Success/error message
    """
    match = None
    supports_update = False
    if action == "add" and entity.lower() in ADVISORY_ENTITIES:
        file_type, _list_key = ADVISORY_ENTITIES[entity.lower()]
        match = _find_strong_match(file_type, normalize_data(data, entity.lower()))
        supports_update = "update" in ENTITY_SCHEMA.get(file_type, {}).get(
            entity.lower(), {}).get("actions", [])
    result = execute_modify(action, entity, data)
    return _augment_add_result(action, entity.lower(), data, match, supports_update, result)


@mcp.tool()
def persona_batch(operations: list) -> str:
    """Perform multiple persona modifications in one call.
    If unsure, use get_schema to discover valid entity types and fields.

    WRITES IMMEDIATELY, same as persona_modify -- only for changes the user
    explicitly asked for. For anything you inferred, use propose_update.

    WHEN TO USE:
        - Adding multiple items at once (e.g., several highlights)
        - Updating related items together

    ARGS:
        operations (required): Array of {action, entity, data} objects

    EXAMPLES:
        {operations: [
            {action: "add", entity: "work_highlight", data: {company: "Acme", highlight: "Led API"}},
            {action: "update", entity: "project", data: {name: "MyApp", status: "completed"}}
        ]}

        - Multiple highlights:
        {operations: [
            {action: "add", entity: "work_highlight", data: {company: "Acme", highlight: "Led API"}},
            {action: "add", entity: "work_highlight", data: {company: "Acme", highlight: "Built dashboard"}}
        ]}
        - Mixed operations:
        {operations: [
            {action: "update", entity: "project", data: {name: "MyApp", status: "completed"}},
            {action: "add", entity: "project_highlight", data: {project_name: "MyApp", highlight: "Launched v1"}}
        ]}

    RETURN:
        Numbered list of results for each operation
    """
    if not operations:
        return "❌ No operations provided"
    
    results = []
    for i, op in enumerate(operations):
        action = op.get("action", "")
        entity = op.get("entity", "")
        data = op.get("data", {})
        match = None
        supports_update = False
        if action == "add" and entity.lower() in ADVISORY_ENTITIES:
            file_type, _list_key = ADVISORY_ENTITIES[entity.lower()]
            match = _find_strong_match(file_type, normalize_data(data, entity.lower()))
            supports_update = "update" in ENTITY_SCHEMA.get(file_type, {}).get(
                entity.lower(), {}).get("actions", [])
        result = execute_modify(action, entity, data)
        result = _augment_add_result(action, entity.lower(), data, match, supports_update, result)
        results.append(f"{i+1}. {result}")

    return "\n".join(results)


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

    spec = ENTITY_SCHEMA[section][entity]
    identifier_field = spec.get("identifier")
    supplied = p.get("data") or {}
    normalised = normalize_data(supplied, entity)

    # A proposal with no identifier cannot be reviewed OR executed: the card has
    # nothing to title itself with, and execute_modify has nothing to match on.
    # It is the one incompleteness a human reviewer cannot repair, so it is
    # refused here, where the agent can still retry.
    #
    # Deliberately ONLY the identifier. The other declared-required fields are
    # left alone: an agent that hears "I'm now a Senior Engineer at Acme" knows
    # the company and the role but not `period` or `type`, and demanding them
    # would force it to invent them or say nothing. execute_modify enforces the
    # full set at approval time, in front of the person who can actually supply
    # the missing pieces -- which is what the review queue is for.
    #
    # Satisfied by ANY alias, because alias resolution happens inside
    # execute_modify rather than in normalize_data: `top_of_mind` declares
    # `item`, stores under `idea`, and executes perfectly from a bare `name`.
    # Checking the declared spelling alone would reject a payload that
    # demonstrably works.
    if identifier_field and not str(normalised.get(identifier_field) or "").strip():
        if not (_identifier_aliases(entity) & {
            k for k, v in supplied.items() if str(v or "").strip()
        }):
            return None, {
                "result": "invalid",
                "reason": (
                    f"'{entity}' needs {identifier_field} — a proposal with no "
                    f"identifier cannot be reviewed or executed"
                ),
                "accepted_as": sorted(_identifier_aliases(entity)) or [identifier_field],
            }

    # Drop what normalize_data ADDED, not what the caller sent. It derives a
    # canonical `name` from an alias without removing the alias, and keeping
    # both would show the review card one value twice under two names, on the
    # one surface whose whole job is being read by a person.
    #
    # Filtering on "is it declared" instead -- as this did until it dropped a
    # goal's description on the floor -- is a different and worse rule: the
    # executor accepts far more spellings than the schema publishes
    # (`proficiency`, `state`, `is_active`), so undeclared cannot mean unwanted,
    # and a field the agent deliberately wrote vanished with nothing said.
    data = {k: v for k, v in normalised.items() if k in supplied}
    return dict(
        common, action=p["action"], entity=entity, data=data,
        identifier=str(data.get(identifier_field, "")),
    ), None


@mcp.tool()
def propose_update(proposals: list, client: str) -> str:
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
            reads it while deciding, next to a dozen others, so it has to be
            the reason -- not a restatement of the change, and not a summary of
            the conversation.
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
                    # The comment above promises they should not have to go and
                    # look up what it currently says. A title does not say it.
                    "text": match.get("text") or None,
                }
        results.append(entry)

    return json.dumps({"results": results}, ensure_ascii=False)


# # =============================================================================
# # HEALTH CHECK ENDPOINTS & APP SETUP
# # =============================================================================

# async def health_check(request):
#     """Health check endpoint for container orchestration."""
#     return JSONResponse({
#         "status": "ok",
#         "service": "mygist",
#         "data_dir": str(DATA_DIR),
#         "data_dir_exists": DATA_DIR.exists()
#     })

# async def root_handler(request):
#     """Root endpoint with service info."""
#     return JSONResponse({
#         "service": "MyGist MCP Server",
#         "version": "2.0.0",
#         "description": "Your portable personal context for AI",
#         "transport": "FastMCP with SSE/Streamable HTTP",
#         "endpoints": {
#             "health": "/health",
#             "mcp": "/mcp"
#         }
#     })


# async def export_data(request):
#     """Export all MyGist data as a downloadable zip file."""
#     if not DATA_DIR.exists():
#         return JSONResponse({"error": "Data directory not found"}, status_code=404)
    
#     # Create zip in memory
#     zip_buffer = io.BytesIO()
    
#     with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
#         # Add all JSON files from DATA_DIR
#         for json_file in DATA_DIR.glob("*.json"):
#             zf.write(json_file, json_file.name)
        
#         # Add metadata
#         metadata = {
#             "exported_at": datetime.now().isoformat(),
#             "version": "2.0.0",
#             "files": [f.name for f in DATA_DIR.glob("*.json")]
#         }
#         zf.writestr("_metadata.json", json.dumps(metadata, indent=2))
    
#     zip_buffer.seek(0)
#     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
#     filename = f"mygist_backup_{timestamp}.zip"
    
#     return Response(
#         content=zip_buffer.getvalue(),
#         media_type="application/zip",
#         headers={"Content-Disposition": f"attachment; filename={filename}"}
#     )


# async def import_data(request):
#     """Import MyGist data from an uploaded zip file."""
#     content_type = request.headers.get("content-type", "")
    
#     if "multipart/form-data" in content_type:
#         # Handle form upload
#         form = await request.form()
#         upload = form.get("file")
#         if not upload:
#             return JSONResponse({"error": "No file uploaded"}, status_code=400)
#         zip_data = await upload.read()
#     else:
#         # Handle raw body upload
#         zip_data = await request.body()
    
#     if not zip_data:
#         return JSONResponse({"error": "No data received"}, status_code=400)
    
#     # Validate it's a zip file
#     try:
#         zip_buffer = io.BytesIO(zip_data)
#         with zipfile.ZipFile(zip_buffer, 'r') as zf:
#             # Security check: only allow .json files
#             for name in zf.namelist():
#                 if not name.endswith('.json'):
#                     continue
#                 # Prevent path traversal
#                 if '..' in name or name.startswith('/'):
#                     return JSONResponse({"error": f"Invalid filename: {name}"}, status_code=400)
            
#             # Create backup of current data
#             backup_dir = DATA_DIR.parent / f"mygist_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
#             if DATA_DIR.exists():
#                 shutil.copytree(DATA_DIR, backup_dir)
#                 logger.info(f"Created backup at: {backup_dir}")
            
#             # Ensure data dir exists
#             DATA_DIR.mkdir(parents=True, exist_ok=True)
            
#             # Extract only JSON files
#             imported_files = []
#             for name in zf.namelist():
#                 if name.endswith('.json') and not name.startswith('_'):
#                     zf.extract(name, DATA_DIR)
#                     imported_files.append(name)
#                     logger.info(f"Imported: {name}")
            
#             return JSONResponse({
#                 "status": "success",
#                 "imported_files": imported_files,
#                 "backup_created": str(backup_dir) if backup_dir.exists() else None
#             })
            
#     except zipfile.BadZipFile:
#         return JSONResponse({"error": "Invalid zip file"}, status_code=400)
#     except Exception as e:
#         logger.error(f"Import failed: {e}")
#         return JSONResponse({"error": f"Import failed: {str(e)}"}, status_code=500)


# def create_app():
#     """Create the production app with auth middleware."""
#     # Get the underlying Starlette app from FastMCP
#     starlette_app = mcp.http_app()
    
#     # Add custom routes for health checks and data management
#     starlette_app.routes.insert(0, Route("/", endpoint=root_handler, methods=["GET"]))
#     starlette_app.routes.insert(1, Route("/health", endpoint=health_check, methods=["GET"]))
#     starlette_app.routes.insert(2, Route("/healthz", endpoint=health_check, methods=["GET"]))
#     starlette_app.routes.insert(3, Route("/export", endpoint=export_data, methods=["GET"]))
#     starlette_app.routes.insert(4, Route("/import", endpoint=import_data, methods=["POST"]))
    
#     # Add Bearer auth middleware
#     api_token = os.getenv("MYGIST_API_TOKEN")
#     starlette_app.add_middleware(BearerAuthMiddleware, token=api_token)
    
#     logger.info(f"MyGist MCP Server initialized")
#     logger.info(f"Data directory: {DATA_DIR}")
#     logger.info(f"Auth enabled: {bool(api_token)}")
    
#     return starlette_app


# # Create app for uvicorn
# app = create_app()


# =============================================================================
# MAIN ENTRY POINTS
# =============================================================================

if __name__ == "__main__":
    import sys
    
    # # Check if running in HTTP mode
    # if "--http" in sys.argv or os.getenv("MCP_TRANSPORT") == "http":
    #     import uvicorn
    #     port = int(os.getenv("PORT", "1120"))
    #     host = os.getenv("HOST", "0.0.0.0")
    #     uvicorn.run(app, host=host, port=port)
    # else:
    #     # Default: stdio transport for local MCP clients
    mcp.run()
