"""
Postgres-backed persona data store, scoped to the current request's user via
db.current_user_id. Replaces the old per-file-on-disk storage in main.py and
server.py; keeps the same "load whole blob / save whole blob" shape those
callers already expect.
"""

import copy
import json
import logging
import uuid

import db
import sections

VALID_FILES = list(sections.SECTION_REGISTRY)

FILE_MAP = {name: f"{name}.json" for name in VALID_FILES}


def generate_entity_id(prefix: str) -> str:
    """Stable, machine-readable ID for a persona entity, e.g. 'hobby_3f9a21c4'."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _assign_ids(file_type: str, data: dict) -> dict:
    """Give every object in a designated list a stable `id` if it lacks one.
    Uses setdefault, so existing IDs are never rewritten. The id-carrying lists
    come from the section registry."""
    if not isinstance(data, dict):
        return data
    spec = sections.SECTION_REGISTRY.get(file_type)
    if spec is None:
        return data
    for list_key, prefix in spec.id_lists:
        items = data.get(list_key)
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    item.setdefault("id", generate_entity_id(prefix))
    return data


def _name_keys() -> frozenset:
    """Stored keys that NAME a row, collected from every shipped manifest.

    Derived rather than listed: `role: "title"` is already the manifest's answer
    to "which field names this row", and a hardcoded set would go stale the next
    time a pack lands. Not taken from the derived contract's `identifier`, which
    reports an input spelling where a field has one -- `domain_reference`
    identifies as `ref_name` and stores `name`.
    """
    keys = set()

    def walk(nodes):
        for node in nodes:
            for f in (node.get("element") or {}).get("fields") or []:
                if f.get("role") == "title":
                    keys.add(f["name"])
                # A `list`/`strings` FIELD carries an `element` of the same
                # shape as a node's, so a nested row's title comes out of the
                # same branch rather than a second one.
                if f.get("element"):
                    walk([f])
            walk(node.get("sections") or [])

    for meta in sections.PACK_META.values():
        walk(meta["sections"])
    return frozenset(keys)


NAME_KEYS = _name_keys()


def _trim_names(value) -> None:
    """Strip whitespace around every row name in the blob, in place, at any depth.

    A name is an identifier: server.find_in_array matches on it, so a stored
    "iPhone " is a row no client can address by the name its user sees. Done
    here because save() is the only write both the editor and the MCP branches
    reach -- trimming in either one alone would leave the other able to store an
    unaddressable row.

    Only names. Whitespace inside a notes field can be deliberate, and nothing
    looks a row up by its notes.
    """
    if isinstance(value, dict):
        for key, inner in value.items():
            if key in NAME_KEYS and isinstance(inner, str):
                value[key] = inner.strip()
            else:
                _trim_names(inner)
    elif isinstance(value, list):
        for inner in value:
            _trim_names(inner)


def _normalize(file_type: str, data: dict) -> dict:
    """Legacy-format migration, ported verbatim from main.py's read_json_file.

    Operates on `data` (a blob already loaded from Postgres) instead of a
    locally-scoped dict read from disk. Current data is already migrated, but
    this stays a safety net for older backups/imports.
    """
    # Normalize legacy profile language entries (strings -> objects with fluency)
    if file_type == "profile":
        # Phase 6 (consolidation): `contact.github` and `contact.linkedin` are
        # bare handles from an older shape, duplicating entries that now live in
        # `contact.links` as {label, url}. Nothing has rendered them since the
        # links list arrived, and no ui node binds them.
        #
        # Folded rather than popped outright: a record whose handle has NO
        # matching link would otherwise lose it silently. The link is added only
        # when no existing entry already points at that profile -- compared on
        # the handle appearing in the url, so a link stored with or without
        # https:// or a trailing slash still counts as present.
        contact = data.get("contact")
        if isinstance(contact, dict):
            links = contact.setdefault("links", [])
            if isinstance(links, list):
                for key, label, base in (("github", "Github", "https://github.com/"),
                                         ("linkedin", "LinkedIn", "https://linkedin.com/in/")):
                    handle = contact.get(key)
                    if not isinstance(handle, str) or not handle.strip():
                        contact.pop(key, None)
                        continue
                    handle = handle.strip()
                    already = any(
                        isinstance(l, dict) and handle.lower() in (l.get("url") or "").lower()
                        for l in links
                    )
                    if not already:
                        links.append({"url": f"{base}{handle}", "label": label})
                    contact.pop(key, None)

        languages = data.get("languages_spoken", [])
        if languages and isinstance(languages[0], str):
            data["languages_spoken"] = [
                {"name": lang, "fluency": "conversational"}
                for lang in languages
            ]

        # Migrate education from object to array if needed
        education = data.get("education", {})
        if isinstance(education, dict) and education:
            # Old format was a single education object
            data["education"] = [{
                "institution": education.get("university", ""),
                "degree_level": education.get("degree_level", ""),
                "field_of_study": education.get("major", ""),
                "start_year": "",
                "end_year": education.get("graduation_year", ""),
                "status": "completed",
                "coursework": education.get("coursework", []),
                "clubs": education.get("clubs", []),
                "highlights": [],
            }]
        elif isinstance(education, list):
            # Ensure all education entries have highlights field
            for edu in education:
                if isinstance(edu, dict):
                    edu.setdefault("highlights", [])
                    # Phase 6 (consolidation): `coursework` and `clubs` are
                    # lists of OBJECTS -- {"name", "topics"} and {"name",
                    # "activities_involved"} -- which is what the editor has
                    # always written and read. Until wave 6 `execute_modify`
                    # appended a bare STRING into the same lists, so a record
                    # touched by an AI client holds a mix of both shapes. The
                    # renderer maps over these and reads `.name`, so a stray
                    # string renders as a blank row -- and the pre-wave-6
                    # chip control threw outright on an object.
                    #
                    # Coerced on read rather than migrated in place: this only
                    # ever widens a string into the object that already
                    # represents it, so it is lossless and idempotent. The
                    # string becomes the name; its nested list starts empty,
                    # which is exactly what the string carried.
                    for key, nested in (("coursework", "topics"),
                                        ("clubs", "activities_involved")):
                        entries = edu.get(key)
                        if not isinstance(entries, list):
                            continue
                        edu[key] = [
                            {"name": e, nested: []} if isinstance(e, str)
                            else e
                            for e in entries
                        ]
        else:
            data["education"] = []

        contact = data.get("contact", {})
        # Convert single email string -> emails array
        if isinstance(contact, dict):
            email_value = contact.get("email")
            if email_value and not contact.get("emails"):
                contact["emails"] = [{
                    "address": email_value,
                    "purpose": "primary"
                }]
                contact.pop("email", None)

            # Ensure emails list exists
            contact.setdefault("emails", [])

            # Normalize links if stored as list of strings
            links = contact.get("links", [])
            if links and isinstance(links, list) and links and isinstance(links[0], str):
                contact["links"] = [
                    {"label": f"Link {i+1}", "url": url}
                    for i, url in enumerate(links)
                ]

            contact.setdefault("links", [])
            data["contact"] = contact

        # Phase 2 (goals pack): these lists moved to the goals section; strip
        # them so old backups/imports can't resurrect invisible orphan keys.
        data.pop("career_aspirations", None)
        data.pop("goals_and_careers", None)
    if file_type == "projects":
        projects = data.get("projects", [])
        if isinstance(projects, list):
            for project in projects:
                if isinstance(project, dict):
                    # migrate legacy tech_stack -> tags
                    if "tags" not in project and "tech_stack" in project:
                        project["tags"] = project.get("tech_stack", [])
                        project.pop("tech_stack", None)
                    project.setdefault("tags", [])
                    project.setdefault("references", [])
                    project.setdefault("notes", "")
                    project.setdefault("highlights", [])
        # Legacy top_of_mind entries were bare strings. Two consumers coerce
        # them on read and therefore hid the problem -- execute_modify
        # (server.py's get_idea_text) and ProjectsEditor.jsx -- but nothing
        # else does: _assign_ids below skips non-dicts so a string entry never
        # gets an `id`, search_index skips id-less entries so it is
        # unsearchable, the staleness advisory (server.py) skips it, and a
        # generic list renderer keyed on `idea` shows a row with no reachable
        # content. Coercing here, on load, repairs every consumer at once
        # rather than the one that happens to render.
        #
        # Idempotent, like every other case in this function: a dict entry is
        # returned untouched, so re-normalising an already-normalised blob is
        # a no-op. Only `idea` is written -- `note` is genuinely absent on a
        # legacy entry, and inventing `note: ""` would be a value the user
        # never entered (and one ListRenderer.updateItem deletes on the first
        # edit anyway, producing a spurious diff).
        top_of_mind = data.get("top_of_mind")
        if isinstance(top_of_mind, list):
            data["top_of_mind"] = [
                {"idea": entry} if isinstance(entry, str) else entry
                for entry in top_of_mind
            ]
        # Phase 5 (consolidation): current_learning folds into goals (type=learning);
        # strip it so old backups/imports can't resurrect an invisible orphan key.
        data.pop("current_learning", None)
    if file_type == "knowledge":
        domains = data.get("domains", [])
        if isinstance(domains, list):
            for domain in domains:
                if isinstance(domain, dict):
                    domain.setdefault("references", [])
        mental_tabs = data.get("mental_tabs", [])
        if isinstance(mental_tabs, list):
            for tab in mental_tabs:
                if isinstance(tab, dict):
                    tab.setdefault("references", [])
                    # Legacy mental tabs stored their name under `topic`.
                    # Nothing has written that key since the rename to
                    # `title`, but four places in server.py still READ it as a
                    # fallback -- the add-time dedupe, the update lookup, the
                    # remove lookup, and mental_tab_reference's parent lookup
                    # -- and those fallbacks are what hid the problem, exactly
                    # as get_idea_text hid the bare-string top_of_mind entries
                    # above. Everything that does NOT fall back sees a tab
                    # with no name at all: get_context's title, and a generic
                    # list renderer keyed on `title`, which shows a blank row
                    # and then -- on the first edit -- writes a `title`
                    # alongside the orphaned `topic`, leaving one entry with
                    # two names and no rule about which wins.
                    #
                    # Backfilling here repairs every consumer at once, and is
                    # read-neutral by construction: each of those four sites
                    # already computes `title or topic`, so after the backfill
                    # they compute the same value from the first branch.
                    #
                    # `topic` is deliberately NOT popped. Where the two keys
                    # differ (title present, topic present) the entry is
                    # addressable over MCP by either name today, and dropping
                    # one would remove an address rather than add one -- so
                    # this only ever ADDS a key, never removes or overwrites.
                    # setdefault is not enough: a tab carrying `title: ""` is
                    # just as nameless as one carrying no title at all.
                    #
                    # Read-neutral does NOT mean collision-neutral. All four
                    # fallback sites resolve by `title` first via
                    # find_in_array, which compares case-insensitively
                    # (item.get(id_field, "").lower() == identifier.lower())
                    # and returns the FIRST match. If some other tab already
                    # has that same title, backfilling this one would give
                    # two tabs an identical title, and being earlier or later
                    # in the list would silently decide which one every
                    # title-keyed lookup (including a remove) resolves to --
                    # exactly the divergence from yesterday's behaviour this
                    # normalisation must not introduce. So: skip the backfill
                    # when the candidate title collides, case-insensitively,
                    # with another tab's title as it currently stands. The
                    # tab keeps rendering blank -- reachable only via `topic`
                    # -- rather than taking over another entry's identity.
                    #
                    # "As it stands" deliberately includes a title backfilled
                    # earlier in this same pass, not just titles that existed
                    # before _normalize ran: since the list is scanned and
                    # mutated in order, two tabs that both carry only
                    # {topic: "X"} would otherwise both backfill to the same
                    # title in one pass, recreating the identical hazard this
                    # guard exists to prevent. Instead the earlier tab claims
                    # the title and the later one collides with it, exactly
                    # as it would against a pre-existing title -- and stays
                    # collided on every later pass, since the earlier tab's
                    # title is no longer a backfill candidate itself.
                    if not tab.get("title") and tab.get("topic"):
                        candidate = tab["topic"]
                        collides = any(
                            other is not tab
                            and isinstance(other, dict)
                            and (other.get("title") or "").lower() == candidate.lower()
                            for other in mental_tabs
                        )
                        if not collides:
                            tab["title"] = candidate
        # Phase 5 (consolidation): proficiency_levels retired; strip it so old
        # backups/imports can't resurrect an invisible orphan key.
        data.pop("proficiency_levels", None)
    if file_type == "preferences":
        if isinstance(data, dict):
            # Phase 5 (consolidation): dislikes moved into likes_dislikes
            # (stance-tagged); strip it so old backups/imports can't
            # resurrect an invisible orphan key.
            data.pop("dislikes", None)
            # Phase 6 (consolidation): `coding` held a single `editor` key that
            # duplicates an entry in `code_style.tools`. Folded into that list
            # when absent, so a record whose editor is not already listed keeps
            # it, then dropped.
            coding = data.get("coding")
            if isinstance(coding, dict):
                editor = coding.get("editor")
                if isinstance(editor, str) and editor.strip():
                    tools = data.setdefault("code_style", {}).setdefault("tools", [])
                    if isinstance(tools, list):
                        # Compared without spaces or case so "VSCode" recognises
                        # an existing "VS Code" rather than adding a near-twin.
                        squashed = {t.replace(" ", "").lower() for t in tools if isinstance(t, str)}
                        if editor.replace(" ", "").lower() not in squashed:
                            tools.append(editor.strip())
                data.pop("coding", None)

            # Phase 6 (consolidation): `work_preferences` held three keys that
            # each belong somewhere that already existed.
            wp = data.get("work_preferences")
            if isinstance(wp, dict):
                # `project_approach` ("iterative, MVP first then enhance") is
                # the same class of statement as learning_style.preferred,
                # which already carries "learning by building" and
                # "incremental complexity".
                approach = wp.get("project_approach")
                if isinstance(approach, str) and approach.strip():
                    pref = data.setdefault("learning_style", {}).setdefault("preferred", [])
                    if isinstance(pref, list) and approach.strip() not in pref:
                        pref.append(approach.strip())
                    wp.pop("project_approach", None)
                # `timezone` is left alone: profile.location already implies
                # it, so it earns no control of its own. Not popped either --
                # a record whose location is vague or absent would lose the
                # only explicit copy, and an unbound key costs a line of JSON.
                #
                # `best_productivity_time` duplicates lifestyle.wellness.
                # energy_peaks, which is a RICHER list in a DIFFERENT section --
                # and _normalize only ever sees one section's blob, so it
                # cannot be folded here. Left in place rather than dropped:
                # deleting it without a home is data loss, and an unbound key
                # costs nothing but a line of JSON.
                if not wp:
                    data.pop("work_preferences", None)

            # Phase 6 (consolidation): `response_format` was five booleans,
            # which can only say yes or no to five fixed ideas. Real preferences
            # are more specific than that ("code blocks for anything over three
            # lines"), so it becomes a free-text list like work highlights.
            #
            # Only the TRUE keys carry over: a list of wants has no way to
            # express "explicitly off", and a false boolean was already the
            # same as absent for every reader of this key.
            rf = data.get("response_format")
            if isinstance(rf, dict):
                data["response_format"] = [
                    key.replace("_", " ")
                    for key, on in rf.items()
                    if on is True
                ]

            # `design` is deliberately NOT dropped here. It duplicates the
            # aesthetics pack, which holds the same material split by domain,
            # stance-tagged, and able to express the "avoid" list `design` had
            # no room for -- so it should end up there. But _normalize only
            # ever sees ONE section's blob, and cannot check whether that pack
            # is in use, let alone move prose into it. Popping blind would
            # destroy the only copy for anyone who never adopted aesthetics.
            #
            # So it is unbound from the preferences UI (wave 6) and left in
            # storage, and moving it is a one-off migration rather than a
            # read-time normalisation.
            # Migrate old flat communication structure to new nested structure
            if "communication" in data:
                comm = data["communication"]
                # Check if it's the old flat format (has "tone" at top level but no "default")
                if isinstance(comm, dict) and "tone" in comm and "default" not in comm:
                    # Migrate to new nested format
                    data["communication"] = {
                        "default": {
                            "tone": comm.get("tone", ""),
                            "detail_level": comm.get("detail_level", ""),
                            "locale": comm.get("locale", "British English")
                        },
                        "mood_overrides": []
                    }
            else:
                data["communication"] = copy.deepcopy(
                    sections.SECTION_REGISTRY["preferences"].default["communication"]
                )
            # Phase 5 (consolidation): the retired PreferencesEditor wrote a
            # mood override's name under `when_feeling`; execute_modify has
            # always written `mood` (server.py:2247). The two never met, so a
            # UI-written override was invisible to every MCP lookup -- all of
            # which resolve on `o.get("mood", "").lower()`, meaning update and
            # remove could never find it and a second `add` for the same mood
            # silently duplicated it. In the other direction an AI-written
            # override had no `when_feeling` and the editor rendered it as
            # "Untitled mood".
            #
            # Backfilled here rather than fixed only forward, so overrides
            # already in a record become reachable. Exactly the shape of the
            # `mental_tab` topic -> title backfill above, and it carries the
            # same two rules for the same reasons:
            #
            #   - `when_feeling` is NOT popped. Where both keys exist the entry
            #     is addressable by either name today, and dropping one would
            #     remove an address rather than add one. This only ever ADDS.
            #   - Read-neutral is not collision-neutral. Every MCP site
            #     resolves by `mood` case-insensitively and takes the FIRST
            #     match, so backfilling a name another override already holds
            #     would let list position silently decide which entry a remove
            #     resolves to. So: skip when the candidate collides with
            #     another override's `mood` AS IT CURRENTLY STANDS -- which
            #     includes one backfilled earlier in this same pass, since the
            #     list is scanned and mutated in order and two overrides both
            #     carrying only {when_feeling: "X"} would otherwise both claim
            #     it. The earlier one claims it; the later stays collided on
            #     every later pass, reachable only via `when_feeling`.
            comm = data.get("communication")
            if isinstance(comm, dict):
                overrides = comm.get("mood_overrides")
                if isinstance(overrides, list):
                    for override in overrides:
                        if not isinstance(override, dict):
                            continue
                        if override.get("mood") or not override.get("when_feeling"):
                            continue
                        candidate = override["when_feeling"]
                        collides = any(
                            other is not override
                            and isinstance(other, dict)
                            and (other.get("mood") or "").lower() == candidate.lower()
                            for other in overrides
                        )
                        if not collides:
                            override["mood"] = candidate
    if file_type == "lifestyle":
        if isinstance(data, dict):
            # Phase 5 (consolidation): passions/curiosities folded into the
            # kind-tagged interests list; references was dormant/unused.
            # Strip them so old backups/imports can't resurrect invisible
            # orphan keys.
            data.pop("passions", None)
            data.pop("curiosities", None)
            data.pop("references", None)
            data.setdefault("wellness", {
                "sleep": {
                    "weekday": {"bedtime": "", "wakeup": ""},
                    "weekend": {"bedtime": "", "wakeup": ""}
                },
                "energy_peaks": [],
                "stress_triggers": []
            })
    if file_type == "learning_log":
        # Migrate existing entries to enhanced schema with IDs
        entries = data.get("entries", [])
        if isinstance(entries, list):
            import uuid
            from datetime import datetime as dt
            for entry in entries:
                if isinstance(entry, dict):
                    # Add ID if missing (for cross-referencing)
                    if "id" not in entry:
                        # Generate ID from timestamp or index
                        ts = entry.get("timestamp", "")
                        if ts:
                            try:
                                date_part = ts[:10].replace("-", "")
                            except:
                                date_part = dt.now().strftime("%Y%m%d")
                        else:
                            date_part = dt.now().strftime("%Y%m%d")
                        entry["id"] = f"learn_{date_part}_{uuid.uuid4().hex[:6]}"
                    # Ensure optional fields have proper defaults when accessed
                    # (don't add empty fields to keep data clean)
    return data


def load(file_type: str) -> dict:
    """Load one persona file for the current user, or its default."""
    if file_type not in VALID_FILES:
        return {"error": f"{file_type} not found"}
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from persona_data where user_id = %s and file_type = %s",
            (user_id, file_type),
        ).fetchone()
    if row is None:
        spec = sections.SECTION_REGISTRY.get(file_type)
        return copy.deepcopy(spec.default) if spec else {}
    return _normalize(file_type, row["data"])


# How many previous versions of each section to keep. Whole-section snapshots,
# so this is 20 copies of a section's JSON per section per user.
# ponytail: whole-section snapshots, move to jsonb diffs only if a section's
# blob ever gets big enough to notice.
HISTORY_KEEP = 20

# Fields the write path stamps itself, so a change to them says nothing about
# what the caller actually did. Reporting "last_updated changed" on every single
# update would bury the one field that matters.
_BOOKKEEPING = frozenset({"last_updated", "added_date", "updated_at"})


def _entities(file_type: str, data: dict) -> dict:
    """{entity_id: entity} for every id-bearing entity in a section blob.

    Driven off `spec.id_lists`, the same declaration search_index.flatten_section
    walks, so a new section pack is covered without touching this.
    """
    spec = sections.SECTION_REGISTRY.get(file_type)
    if spec is None:
        return {}
    found = {}
    for list_key, _prefix in spec.id_lists:
        for entity in data.get(list_key) or []:
            if isinstance(entity, dict) and entity.get("id"):
                found[entity["id"]] = entity
    return found


def _diff(file_type: str, before: dict, after: dict) -> dict:
    """What changed between two versions of one section.

    `changed` maps an entity id to the PREVIOUS value of each field that moved,
    which is what an update advisory needs: not what it is now (the caller just
    supplied that) but what it displaced. A field cleared entirely counts, since
    that is the most destructive shape an overwrite takes.
    """
    old, new = _entities(file_type, before), _entities(file_type, after)
    changed = {}
    for entity_id, entity in new.items():
        previous = old.get(entity_id)
        if previous is None:
            continue
        was = {k: v for k, v in previous.items()
               if k not in _BOOKKEEPING and v != entity.get(k)}
        if was:
            changed[entity_id] = was
    return {"added": [i for i in new if i not in old], "changed": changed}


def save(file_type: str, data: dict) -> bool:
    """Save (upsert) one persona file for the current user.

    Also snapshots the version being displaced into persona_history and records
    what changed in db.last_write. Both come off the same read of the previous
    row: this is the only point in the system holding what the persona said and
    what it is about to say at the same time.
    """
    _trim_names(data)
    _assign_ids(file_type, data)
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        previous = conn.execute(
            "select data from persona_data where user_id = %s and file_type = %s",
            (user_id, file_type),
        ).fetchone()
        if previous is not None:
            # Same transaction as the upsert below, so a section is never
            # overwritten without its predecessor being kept.
            conn.execute(
                "insert into persona_history (user_id, file_type, data, written_by)"
                " values (%s, %s, %s, %s)",
                (user_id, file_type, json.dumps(previous["data"]),
                 db.current_client.get()),
            )
            conn.execute(
                "delete from persona_history where user_id = %s and file_type = %s"
                " and id not in (select id from persona_history"
                " where user_id = %s and file_type = %s"
                " order by replaced_at desc, id desc limit %s)",
                (user_id, file_type, user_id, file_type, HISTORY_KEEP),
            )
        conn.execute(
            """
            insert into persona_data (user_id, file_type, data, updated_at)
            values (%s, %s, %s, now())
            on conflict (user_id, file_type)
            do update set data = excluded.data, updated_at = now()
            """,
            (user_id, file_type, json.dumps(data)),
        )
    db.last_write.set(
        _diff(file_type, previous["data"] if previous else {}, data))
    try:
        import search_index
        search_index.sync_index(user_id, file_type, data)
    except Exception:
        logging.getLogger(__name__).exception(
            "search index sync failed for %s (persona write succeeded)", file_type
        )
    return True


def history(file_type: str) -> list[dict]:
    """Previous versions of one section, newest first."""
    if file_type not in VALID_FILES:
        return []
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select id, written_by, replaced_at, data from persona_history"
            " where user_id = %s and file_type = %s"
            " order by replaced_at desc, id desc",
            (db.current_user_id.get(), file_type),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "written_by": r["written_by"] or None,
            "replaced_at": r["replaced_at"].isoformat(),
            "entity_count": len(_entities(file_type, r["data"])),
        }
        for r in rows
    ]


def revert(file_type: str, history_id: int) -> bool:
    """Restore one section to a previous version. False if there is no such row.

    Routed through save() rather than writing persona_data directly, so the
    version being replaced is itself snapshotted and the search index re-syncs by
    the existing path. A revert is therefore reversible, and there is no second
    write path to keep correct.
    """
    if file_type not in VALID_FILES:
        return False
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from persona_history"
            " where id = %s and user_id = %s and file_type = %s",
            (history_id, db.current_user_id.get(), file_type),
        ).fetchone()
    if row is None:
        return False
    return save(file_type, copy.deepcopy(row["data"]))


def get_all() -> dict:
    """Load every persona file for the current user."""
    return {file_type: load(file_type) for file_type in VALID_FILES}


def reset(file_type: str) -> bool:
    """Reset one file to its default."""
    return save(file_type, copy.deepcopy(sections.SECTION_REGISTRY[file_type].default))
