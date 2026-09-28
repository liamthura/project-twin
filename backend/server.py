#!/usr/bin/env python3
"""
MyGist MCP Server - FastMCP Edition

Your portable personal context for AI. Defines the tools; main.py mounts them
at /mcp behind its own auth middleware, which is what serves them in
production. `python server.py` runs the same tools over stdio for local
debugging.

Persona data lives in Postgres, scoped to the current request's user by
persona_store -- there is no data directory and no server-owned token. The
credential is the one main.py's middleware already resolved.
"""

import json
import os
import sys
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Literal, Union, List
import uuid

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_request
from dotenv import load_dotenv

import db
import persona_store
import proposals_store
import search_index
import mcp_activity
import mcp_prompts
import mcp_scopes
import scopes
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
        # Stripped as well as lowered: persona_store trims a row's name on the
        # way in, but a row stored before that did is still out there, and a
        # client is free to send a name with a space on either end. Matching is
        # the half that has to tolerate it -- an unaddressable row cannot even
        # be renamed.
        return value.strip().lower() if isinstance(value, str) else None

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
    # ALIAS and nothing else. (mental_tab_reference's fourth spelling is
    # "reference", not "title" -- transcribed from its old branch, not assumed
    # symmetric.)
    #
    # These four were INERT until the write path was made declarative, and the
    # reason they were is the bug that fixing them fixed: `normalize_data`
    # routed each reference entity to its PARENT's alias list, so a reference
    # sent as {"domain_name": "Rust", "title": "The Book"} was stored with the
    # name "Rust". `_name_aliases_for` reads these entries now, minus whichever
    # spelling selects the parent.
    #
    # They also exist so that tests/test_section_bindings.py's alias guard --
    # inert for any entity this table does not name -- can see them. Without
    # them a `ui` child node binding `ref_name` fails NOTHING on the backend:
    # `ref_name` sits in each entity's `required`, so the spelling check waves
    # it through too.
    "hobby_reference": ["ref_name", "name", "reference_name", "title"],
    "project_reference": ["ref_name", "name", "reference_name", "title"],
    "domain_reference": ["ref_name", "name", "reference_name", "title"],
    "mental_tab_reference": ["ref_name", "name", "reference_name", "reference"],
}


# Every OTHER field's input spellings, per entity -- FIELD_ALIASES above covers
# identifiers only. Harvested verbatim from the per-entity branches that used
# to hold them as `get_field(data, "trait", "characteristic", ...)` calls, so
# an agent that has been sending `employer` for a work highlight or
# `proficiency` for a domain's level keeps working.
#
# `new_<field>` needs no entry: a rename accepts `new_` in front of the stored
# name, the MCP spelling, or any alias here (see _field_value).
#
# tests/test_field_aliases.py asserts every one of these writes exactly what
# the field's own name writes.
ENTITY_FIELD_ALIASES = {
    "career_aspiration": {"aspiration": ['goal', 'title', 'career_goal', 'objective', 'aim']},
    "club": {"name": ['club', 'society', 'activity']},
    "connection": {"name": ['person', 'contact', 'connection_name']},
    "coursework": {"course": ['coursework', 'class', 'topic', 'subject']},
    "coursework_topic": {"course": ['coursework', 'class', 'topic', 'subject']},
    "curiosity": {"name": ['passion', 'topic', 'curiosity', 'interest']},
    "current_learning": {"context": ['why'], "topic": ['name', 'title']},
    "dislike": {"item": ['name', 'dislike', 'like']},
    "domain": {"level": ['proficiency', 'skill_level'], "name": ['domain', 'domain_name', 'area', 'topic'], "notes": ['description', 'details']},
    "domain_reference": {"domain_name": ['domain', 'for_domain', 'parent'], "notes": ['description'], "ref_name": ['name', 'reference_name', 'title'], "url": ['link', 'href']},
    "email": {"address": ['email', 'email_address'], "purpose": ['type', 'category']},
    "energy_peak": {"peak": ['energy_peak', 'time', 'when', 'name']},
    "goal": {"custom_type": ['type_label'], "title": ['name', 'goal'], "type": ['category']},
    "hobby": {"name": ['hobby', 'hobby_name', 'title', 'activity'], "notes": ['description', 'details'], "skill_level": ['level', 'proficiency'], "status": ['state', 'is_active']},
    "hobby_reference": {"hobby_name": ['hobby', 'parent', 'for_hobby'], "notes": ['description'], "ref_name": ['name', 'reference_name', 'title'], "url": ['link', 'href']},
    "hobby_specific": {"hobby_name": ['hobby', 'parent', 'for_hobby'], "specific": ['value', 'item', 'detail']},
    "inventory_spec": {"inventory_item_name": ['inventory_item', 'item', 'parent'], "name": ['spec_name', 'key', 'field']},
    "knowledge": {"category": ['type'], "level": ['proficiency', 'skill_level'], "name": ['topic', 'domain', 'subject', 'area'], "notes": ['description', 'details']},
    "language": {"fluency": ['level', 'proficiency'], "name": ['language', 'language_name', 'lang']},
    "like": {"item": ['name', 'dislike', 'like']},
    "link": {"label": ['name', 'title', 'platform'], "url": ['link', 'href', 'website']},
    "mental_tab": {"context": ['notes', 'description', 'details'], "status": ['state'], "title": ['topic', 'name', 'mental_tab', 'subject']},
    "mental_tab_reference": {"notes": ['description'], "ref_name": ['name', 'reference_name', 'reference'], "title": ['topic', 'mental_tab', 'for_tab', 'parent'], "url": ['link', 'href']},
    "mood_override": {"mood": ['feeling', 'state', 'when']},
    "passion": {"name": ['passion', 'topic', 'curiosity', 'interest']},
    "personality_trait": {"trait": ['personality_trait', 'characteristic', 'quality', 'name']},
    "preference": {"category": ['type'], "key": ['setting', 'option', 'preference'], "value": ['setting_value']},
    "project": {"description": ['desc', 'summary'], "name": ['project', 'project_name', 'title'], "notes": ['details'], "status": ['state', 'progress']},
    "project_highlight": {"highlight": ['item', 'achievement'], "project_name": ['project', 'for_project', 'parent']},
    "project_reference": {"notes": ['description'], "project_name": ['project', 'for_project'], "ref_name": ['name', 'reference_name', 'title'], "url": ['link', 'href']},
    "project_tag": {"project_name": ['project', 'for_project'], "tag": ['label', 'value']},
    "response_format": {"item": ['format', 'preference', 'value']},
    "sleep": {"bedtime": ['bed_time', 'sleep_time', 'sleep'], "day_type": ['type', 'day', 'when'], "wakeup": ['wake_up', 'wake_time', 'wake', 'rise']},
    "stress_trigger": {"trigger": ['stress_trigger', 'item', 'name']},
    "top_of_mind": {"item": ['topic', 'thought', 'subject', 'name', 'idea']},
    "value": {"value": ['core_value', 'belief', 'principle', 'name']},
    "work_highlight": {"company": ['work', 'employer', 'organization'], "highlight": ['item', 'achievement']},
    "work_skill": {"company": ['work', 'employer', 'organization'], "skill": ['item', 'technology']},
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
    """The alias list normalize_data resolves an entity's identifier from.

    A CHILD is never resolved from its parent's list. It used to be: all four
    `*_reference` entities read their parent's, so `{"domain_name": "Rust",
    "title": "The Book"}` set `name` from `domain_name` and stored a reference
    called "Rust" -- the parent's name, silently, on a spelling the manifest
    advertises. Each of the four has had its own entry in FIELD_ALIASES all
    along; they are what is read now.

    `_without_parent_spellings` then holds the rule generally, for the two
    bare-string children (hobby_specific, project_tag) and for any nested
    element a future pack declares: whatever list an entity resolves its own
    name from, the parameter that selects its parent is not in it.
    """
    if entity == "hobby_reference":
        name_aliases = FIELD_ALIASES["hobby_reference"]
    elif entity == "project_reference":
        name_aliases = FIELD_ALIASES["project_reference"]
    elif entity == "mental_tab_reference":
        name_aliases = FIELD_ALIASES["mental_tab_reference"]
    elif entity == "domain_reference":
        name_aliases = FIELD_ALIASES["domain_reference"]
    elif entity in ["hobby", "hobby_specific"]:
        name_aliases = FIELD_ALIASES.get("hobby", FIELD_ALIASES["name"])
    elif entity in ["project", "project_tag"]:
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
    elif entity == "mental_tab":
        name_aliases = FIELD_ALIASES.get("mental_tab", FIELD_ALIASES["name"])
    elif entity == "domain" or entity == "knowledge":
        name_aliases = FIELD_ALIASES.get("domain", FIELD_ALIASES["name"])
    elif entity == "current_learning":
        name_aliases = FIELD_ALIASES.get("learning_item", ["topic"])
    elif entity == "top_of_mind":
        name_aliases = FIELD_ALIASES.get("top_of_mind", ["topic"])
    elif entity == "connection":
        name_aliases = FIELD_ALIASES.get("connection", FIELD_ALIASES["name"])
    elif entity == "inventory_spec":
        # `value` is a DECLARED field on a spec, not a synonym for its
        # identifier. The FIELD_ALIASES["name"] default lists both "value" and
        # "item", so falling through would copy a spec's value into its name --
        # {"name": "provider", "value": "Hetzner"} sent without a name stored
        # itself as "Hetzner". Not in FIELD_ALIASES: nothing else looks this up,
        # and a key there would pull the entity into test_alias_agreement's
        # CHECKED set, which is about manifest-declared aliases.
        name_aliases = ["name", "spec_name", "key", "field"]
    else:
        name_aliases = FIELD_ALIASES["name"]

    return _without_parent_spellings(entity, name_aliases)


def _without_parent_spellings(entity: str, aliases: list) -> list:
    """`aliases` minus anything that names the row this entity sits under.

    A parent selector locates a row; it is never the child's own name. Reading
    one as a name is not a harmless mix-up -- it stores the parent's name on
    the child, which is a plausible-looking row nobody can tell is wrong.

    Derived from the pack rather than listed here, so a nested element a future
    manifest declares is covered the day it ships.
    """
    resolved = _target_for(entity)
    if resolved is None or not resolved[1]["parent"]:
        return aliases
    parent = resolved[1]["parent"]
    barred = {parent["param"], parent["identifier"]}
    return [a for a in aliases if a not in barred]


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
    if entity == "career_aspiration":
        # Back-compat alias: aspirations are goals now (type=career).
        asp = get_field(data, "aspiration", "goal", "title", "career_goal", "objective", "aim")
        if not asp:
            return "❌ career_aspiration requires 'aspiration'"
        result = execute_modify(action, "goal", {"title": asp, "type": "career"})
        if result.startswith("✅"):
            result += " — career_aspiration is stored as a goal now; use entity 'goal'"
        return result

    elif entity in ("passion", "curiosity"):
        name = get_field(data, "name", "passion", "topic", "curiosity", "interest")
        if not name:
            return f"❌ {entity} requires 'name'"
        result = execute_modify(action, "interest", {"name": name, "kind": entity})
        if result.startswith("✅"):
            result += f" — {entity}s are stored as interests now; use entity 'interest'"
        return result

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

    
    resolved = _target_for(entity)
    if resolved is not None:
        return write_entity(action, entity, *resolved, data)

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


# =============================================================================
# THE DECLARATIVE WRITE PATH
# =============================================================================
# One implementation of add/update/remove, driven by what a pack declares.
# `pack_loader.derive_write_targets` says where an entity's rows live and what
# shape they are; ENTITY_SCHEMA says what a client may send; ENTITY_FIELD_ALIASES
# says what else it may call each field. Nothing below knows the name of a
# single entity.
#
# It replaced forty-odd hand-written branches, whose confirmations were forty-odd
# different sentences ("ℹ️ 'X' already in clubs", "ℹ️ Connection 'X' already
# exists", "❌ Domain requires 'name' or 'domain'"). They are one family now --
# an agent reading a result, or a person reading an error the editor surfaced,
# meets the same phrasing whichever entity they touched.

WRITE_TARGETS = _pack_loader.build_write_targets(_pack_loader.manifests())

# Dates the server writes, never the client. The fields are `ui_only` in the
# manifests -- declared and rendered, settable by nobody -- but the format has
# no way to say WHEN the server sets one, so that half lives here: "add" stamps
# on creation only, "update" stamps on every edit.
_STAMPS = {
    "hobby": {"last_updated": "update"},
    "project": {"added_date": "add", "last_updated": "update"},
}
# Two entries, because two entities were ever stamped: nothing has written a
# date onto a domain, a mental tab, an education or a work experience, and
# adding one here would be a change dressed up as a move. mental_tab's
# `created_at` is not missing from this table -- its pack declares
# `default: "@now"`, which _seed resolves, so the format already says it.
#
# Inventory has no entry because inventory has no date: its manifest says so in
# as many words ("No purchase price, serial, warranty or acquired date -- this
# section is what the user has ... not an asset register"). A stamp here would
# invent a field nothing declares, renders or reads.


def _target_for(entity: str):
    """(section, target) for an entity the packs describe, or None."""
    for section, targets in WRITE_TARGETS.items():
        if entity in targets:
            return section, targets[entity]
    return None


def _noun(entity: str) -> str:
    return entity.replace("_", " ")


def _spellings(entity: str, *names) -> list:
    """Every spelling a field answers to: its own names, then its aliases."""
    aliases = ENTITY_FIELD_ALIASES.get(entity, {})
    out = []
    for name in names:
        if name and name not in out:
            out.append(name)
        for alias in aliases.get(name, ()):
            if alias not in out:
                out.append(alias)
    return out


def _sent(data: dict, entity: str, *names, default=None):
    return get_field(data, *_spellings(entity, *names), default=default)


def _resolve_default(value):
    """`@now` and `@today` are the format's tokens for "whatever time it is"."""
    if value == "@now":
        return datetime.now().isoformat() + "Z"
    if value == "@today":
        return datetime.now().strftime("%Y-%m-%d")
    return value


def _stamp(entity: str, item: dict, when: str) -> None:
    for field, moment in _STAMPS.get(entity, {}).items():
        if moment == when:
            item[field] = datetime.now().strftime("%Y-%m-%d") if field != "created_at" \
                else datetime.now().isoformat() + "Z"


def _at_path(blob: dict, path: list, kind: str):
    """The array (or object) a target's path names, created if absent."""
    node = blob
    for step in path[:-1]:
        node = node.setdefault(step, {})
    if not path:
        return blob
    return node.setdefault(path[-1], {} if kind == "singleton" else [])


def _parent_row(blob: dict, target: dict, entity: str, data: dict):
    """(the row a nested entity hangs under, its name) or (None, error)."""
    parent = target["parent"]
    rows = _at_path(blob, parent["path"], "rows")
    name = _sent(data, entity, parent["param"], parent["identifier"], default="")
    if not name:
        return None, f"❌ {_noun(entity).capitalize()} requires '{parent['param']}'"
    _, row = find_in_array(rows, name, parent["identifier"])
    if row is None:
        return None, f"❌ {parent['identifier'].capitalize()} '{name}' not found"
    return row, name


def _validate(entity: str, target: dict, payload: dict):
    """An enum field holds one of its declared values, or says which."""
    for field in target["fields"]:
        values = field.get("values")
        if not values or field["name"] not in payload:
            continue
        if payload[field["name"]] not in values:
            if field.get("allow_custom"):
                continue
            return (f"❌ Invalid {field['name']} '{payload[field['name']]}'. "
                    f"Valid: {values}")
    return None


def _collect(entity: str, target: dict, data: dict, identifier_value=None) -> dict:
    """Everything a client sent, under the keys the persona stores it as."""
    payload = {}
    for field in target["fields"]:
        if field.get("ui_only") or field["name"].startswith("new_"):
            # A rename parameter, not a field: `new_label` says what to call
            # the row, and storing it would leave the instruction on the row.
            continue
        if field.get("allow_custom"):
            # `custom_<field>` is a declared optional in its own right, so it
            # is storable on its own -- a client may correct the label on a
            # row whose enum already reads "other" without re-sending the enum.
            custom = _sent(data, entity, f"custom_{field['name']}")
            if custom is not None:
                payload[f"custom_{field['name']}"] = custom
        if field["name"] == target["identifier"]:
            continue
        value = _sent(data, entity, field["param"], field["name"])
        if value is not None:
            payload[field["name"]] = value
    if identifier_value is not None and target["identifier"]:
        payload[target["identifier"]] = identifier_value
    return payload


def _custom_values(entity: str, target: dict, payload: dict, data: dict) -> str:
    """An `allow_custom` enum keeps an unrecognised value under custom_<field>.

    Declared by the pack (`allow_custom` on the field), which is what puts
    `custom_<field>` in the entity's optional list in the first place.

    Returns a note for the caller's confirmation when it coerced something:
    a client that sent type="volunteering" should not have to diff the row to
    learn the row now says "other".
    """
    note = ""
    for field in target["fields"]:
        if not field.get("allow_custom") or field["name"] not in payload:
            continue
        name = field["name"]
        sent = _sent(data, entity, f"custom_{name}")
        if payload[name] in field["values"]:
            # Corrected to a real value: the custom label it used to carry is
            # no longer true of the row. None means "remove this key".
            payload[f"custom_{name}"] = sent
            continue
        original = payload[name]
        payload[f"custom_{name}"] = sent if sent is not None else original
        payload[name] = "other" if "other" in field["values"] else field["values"][-1]
        note = f" ({name} '{original}' stored as {payload[name]}/custom_{name})"
    return note


_EMPTY_FOR_TYPE = {"strings": list, "list": list, "bool": bool}


def _seed(target: dict, payload: dict) -> None:
    """A new row carries every field its pack declares.

    Declared defaults first, then the empty value for the type. The editor
    renders all of them either way, and a row that omits `skills` reads as a
    row whose skills are unknown rather than none -- the distinction nothing
    downstream draws. An enum with no default is the exception: there is no
    honest empty for "one of these five", so it stays absent.
    """
    for field in target["fields"]:
        if field["name"].startswith("new_"):
            continue
        if "default" in field:
            payload.setdefault(field["name"], _resolve_default(field["default"]))
        elif field.get("ui_only") or "values" in field:
            # A `ui_only` field with no declared default is the server's to
            # write or leave alone (see _STAMPS), and an enum with no default
            # has no honest empty -- there is no "none of these five".
            continue
        else:
            payload.setdefault(field["name"], _EMPTY_FOR_TYPE.get(field["type"], str)())


def _exclusive(target: dict, rows: list, payload: dict, keep) -> None:
    """A field declared `exclusive` is true on one row at a time."""
    for field in target["fields"]:
        if not field.get("exclusive") or payload.get(field["name"]) is not True:
            continue
        for other in rows:
            if other is not keep and isinstance(other, dict):
                other.pop(field["name"], None)


def _missing(target: dict, payload: dict, identifier_value) -> list:
    missing = [] if identifier_value else [target["param"]]
    for field in target["fields"]:
        if field["required"] and field["name"] != target["identifier"] \
                and not payload.get(field["name"]):
            missing.append(field["param"])
    return missing


def write_entity(action: str, entity: str, section: str, target: dict, data: dict) -> str:
    """add / update / remove for any entity a pack describes."""
    noun = _noun(entity)
    blob = load_json(f"{section}.json")
    parent = target["parent"]

    if parent:
        holder, parent_name = _parent_row(blob, target, entity, data)
        if holder is None:
            return parent_name  # the error _parent_row built
        rows = holder.setdefault(parent["child"], [])
        where = f" to {parent_name}", f" on {parent_name}", f" from {parent_name}"
    else:
        holder = None
        rows = _at_path(blob, target["path"], target["kind"])
        where = "", "", ""

    def save():
        # Editing a child row is an edit to the row it sits under: a hobby
        # whose references changed was touched today, and staleness reads that
        # date. Only the parent's own _STAMPS entry decides whether it shows.
        if holder is not None:
            _stamp(parent["entity"], holder, "update")
        save_json(f"{section}.json", blob)

    if target["kind"] == "singleton":
        return _write_singleton(entity, target, data, rows, noun, save)
    if target["kind"] == "strings":
        return _write_strings(action, entity, target, data, rows, noun, where, save)
    return _write_rows(action, entity, target, data, rows, noun, where, save)


def _added(noun, value, where) -> str:
    return f"✅ Added {noun} '{value}'{where[0]}" if where[0] else f"✅ Added {noun}: {value}"


def _updated(noun, value, where) -> str:
    return f"✅ Updated {noun} '{value}'{where[1]}" if where[1] else f"✅ Updated {noun}: {value}"


def _removed(noun, value, where) -> str:
    return f"✅ Removed {noun} '{value}'{where[2]}" if where[2] else f"✅ Removed {noun}: {value}"


def _write_singleton(entity, target, data, node, noun, save) -> str:
    """One object, updated in place -- no identifier, nothing to add or remove."""
    payload = _collect(entity, target, data)
    error = _validate(entity, target, payload)
    if error:
        return error
    if not payload:
        return f"❌ {noun.capitalize()} update requires at least one field to change"
    node.update(payload)
    save()
    return f"✅ Updated {noun}: {', '.join(sorted(payload))}"


def _write_strings(action, entity, target, data, items, noun, where, save) -> str:
    """An array of bare strings. `bulk` lets a client send several at once."""
    ident = target["identifier"]
    values = []
    if target["bulk"]:
        values = _as_list(_sent(data, entity, target["bulk"], default=[]))
    if not values:
        single = _sent(data, entity, ident, default="")
        values = _as_list(single) if single else []
    values = [_as_text(v).strip() for v in values if _as_text(v).strip()]
    if not values:
        return f"❌ {noun.capitalize()} requires '{ident}'"

    if action == "add":
        # Case-insensitively, and the same way `remove` matches: a list that
        # accepted "Tight deadlines" beside "tight deadlines" could only ever
        # remove one of them.
        held = {_as_text(v).lower() for v in items}
        added = []
        for value in values:
            if value.lower() not in held:
                held.add(value.lower())  # a bulk add may repeat itself too
                added.append(value)
        if not added:
            return f"ℹ️ {noun.capitalize()} '{values[0]}' already exists{where[1]}"
        items.extend(added)
        save()
        if len(added) == 1:
            return _added(noun, added[0], where)
        return f"✅ Added {len(added)} {noun}s{where[0]}"

    if action == "remove":
        value = values[0]
        match = next((v for v in items if _as_text(v).lower() == value.lower()), None)
        if match is None:
            return f"❌ {noun.capitalize()} '{value}' not found{where[1]}"
        items.remove(match)
        save()
        return _removed(noun, value, where)

    return f"❌ {noun.capitalize()} supports add and remove, not {action}"


def _write_rows(action, entity, target, data, rows, noun, where, save) -> str:
    """An array of objects, identified by one field."""
    ident = target["identifier"]
    value = _sent(data, entity, target["param"], ident)
    value = _as_text(value).strip() if value is not None else ""

    if action == "add":
        payload = _collect(entity, target, data, identifier_value=value)
        missing = _missing(target, payload, value)
        if missing:
            return f"❌ {noun.capitalize()} requires {', '.join(repr(m) for m in missing)}"
        note = _custom_values(entity, target, payload, data)
        error = _validate(entity, target, payload)
        if error:
            return error
        _, existing = find_in_array(rows, value, ident)
        if existing is not None:
            return f"ℹ️ {noun.capitalize()} '{value}' already exists{where[1]}"
        _seed(target, payload)
        _stamp(entity, payload, "add")
        # Rebuilt, not appended as-is: None is _custom_values' way of saying
        # "no such key". The row that goes in is the one _exclusive must keep,
        # so it is the object handed to both.
        row = {k: v for k, v in payload.items() if v is not None}
        rows.append(row)
        _exclusive(target, rows, row, row)
        save()
        return _added(noun, value, where) + note

    index, row = find_in_array(rows, value, ident)
    if row is None:
        return f"❌ {noun.capitalize()} '{value}' not found{where[1]}"

    if action == "update":
        changes = _collect(entity, target, data)
        note = _custom_values(entity, target, changes, data)
        error = _validate(entity, target, changes)
        if error:
            return error
        renamed = _sent(data, entity, *[f"new_{s}" for s in
                                        _spellings(entity, target["param"], ident)])
        if not changes and not renamed:
            return f"❌ {noun.capitalize()} update requires at least one field to change"
        row.update(changes)
        for key, value in changes.items():
            if value is None:  # _custom_values' way of saying "drop this key"
                row.pop(key, None)
        _exclusive(target, rows, changes, row)
        if renamed:
            row[ident] = renamed
        _stamp(entity, row, "update")
        save()
        return _updated(noun, row.get(ident, value), where) + note

    if action == "remove":
        rows.pop(index)
        save()
        return _removed(noun, value, where)

    return f"❌ {noun.capitalize()} does not support '{action}'"


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


@mcp.tool()
def whoami() -> str:
    """Which MyGist account this connection is authenticated as, and what it
    may do.

    Call it when the user asks who they are signed in as, when they suspect
    they are connected to the wrong account, or when a tool refused a write --
    the cause is usually a narrower grant rather than a broken connection, and
    `tools` below says which is which.

    RETURNS:
        username    the account this connection reads and writes
        credential  "oauth" (a connected app), "token" (a personal access
                    token), or "unknown" outside HTTP
        scopes      the granted scopes, hierarchy already expanded
        tools       the tools those scopes allow -- anything missing here needs
                    a wider grant, made by reconnecting from MyGist's settings
    """
    user = db.resolve_user_by_id(db.current_user_id.get())
    try:
        granted = scopes.current_scopes.get()
    except LookupError:
        # Same fail-closed answer as mcp_scopes: no grant on the request means
        # nothing is authorised, not that everything is.
        granted = frozenset()
    try:
        credential = get_http_request().state.credential_kind
    except Exception:
        # stdio, or a request that never passed main.py's middleware.
        credential = "unknown"
    return json.dumps({
        "username": user["username"] if user else None,
        "credential": credential,
        "scopes": sorted(granted),
        "tools": sorted(mcp_scopes.tools_for_scopes(granted)),
    }, ensure_ascii=False)


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

# A pack's entities qualify automatically, so a new pack needs no entry above:
# any top-level row entity whose list is one of the section's `id_lists`. The
# id-list condition is the operative one -- an advisory points at an entity_id,
# and only those lists carry one. It is also why `email` does not qualify (its
# rows live at contact.emails, which has no ids) while `interest` does.
ADVISORY_ENTITIES.update({
    entity: (section, target["path"][-1])
    for section, targets in WRITE_TARGETS.items()
    for entity, target in targets.items()
    if entity not in ADVISORY_ENTITIES
    and target["kind"] == "rows" and not target["parent"]
    and any(key == target["path"][-1]
            for key, _ in sections.SECTION_REGISTRY[section].id_lists)
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


# =============================================================================
# MAIN ENTRY POINTS
# =============================================================================

if __name__ == "__main__":
    mcp.run()
