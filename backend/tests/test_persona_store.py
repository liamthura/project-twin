import copy

import db
import persona_store as store
from sections import SECTION_REGISTRY

# `as_user` fixture is provided by tests/conftest.py


def test_load_unknown_file_returns_default(as_user):
    data = store.load("profile")
    assert data == SECTION_REGISTRY["profile"].default


def test_save_then_load_round_trips(as_user):
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "Alice"})
    assert store.load("profile")["name"] == "Alice"


def test_data_is_isolated_per_user():
    with db.get_pool().connection() as conn:
        row_a = conn.execute(
            "insert into users (username, token_hash) values ('a', 'ta') returning id"
        ).fetchone()
        row_b = conn.execute(
            "insert into users (username, token_hash) values ('b', 'tb') returning id"
        ).fetchone()

    token_a = db.current_user_id.set(str(row_a["id"]))
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "Alice"})
    db.current_user_id.reset(token_a)

    token_b = db.current_user_id.set(str(row_b["id"]))
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "Bob"})
    assert store.load("profile")["name"] == "Bob"
    db.current_user_id.reset(token_b)

    token_a2 = db.current_user_id.set(str(row_a["id"]))
    assert store.load("profile")["name"] == "Alice"
    db.current_user_id.reset(token_a2)


def test_get_all_returns_every_file_type(as_user):
    all_data = store.get_all()
    assert set(all_data.keys()) == set(store.VALID_FILES)


def test_load_strips_dead_goals_keys_from_old_profile_blobs(as_user):
    """Phase 2 (goals pack): career_aspirations/goals_and_careers moved to the
    goals section. _normalize is the safety net that keeps old backups/imports
    from resurrecting these now-invisible orphan keys on load."""
    profile = {
        **SECTION_REGISTRY["profile"].default,
        "career_aspirations": ["Become a consultant"],
        "goals_and_careers": [{"goal": "Run a marathon", "target": "May 2027"}],
    }
    store.save("profile", profile)
    loaded = store.load("profile")
    assert "career_aspirations" not in loaded
    assert "goals_and_careers" not in loaded


def test_load_coerces_legacy_bare_string_top_of_mind_entries_to_idea_objects(as_user):
    """Legacy top_of_mind entries were bare strings. server.py's get_idea_text
    and the bespoke editor both coerce on read, which hid the problem from the
    only two consumers that did -- everything else (id assignment, the search
    index, a generic list renderer) sees a string with no `idea` and no `id`.

    The string must survive as `idea`; a value that vanished into an
    "Untitled entry" row would be unreadable and uneditable in the UI."""
    store.save("projects", {
        "projects": [],
        "top_of_mind": [
            "Ship the CLI",
            {"idea": "Already an object", "note": "untouched"},
        ],
    })
    loaded = store.load("projects")

    assert loaded["top_of_mind"][0] == {"idea": "Ship the CLI"}
    # An already-normalised neighbour is returned verbatim -- `note` and any
    # other key survive, and no `note: ""` is invented for the coerced one.
    assert loaded["top_of_mind"][1]["idea"] == "Already an object"
    assert loaded["top_of_mind"][1]["note"] == "untouched"
    assert "note" not in loaded["top_of_mind"][0]


def test_top_of_mind_coercion_is_idempotent(as_user):
    """Every other case in _normalize can run twice without changing the blob;
    this one must too, since load() runs on every read."""
    store.save("projects", {"projects": [], "top_of_mind": ["Ship the CLI"]})
    once = store.load("projects")
    twice = store._normalize("projects", copy.deepcopy(once))
    assert twice == once


def test_coerced_top_of_mind_entries_become_id_addressable(as_user):
    """The point of coercing on load rather than in the renderer: _assign_ids
    skips non-dicts (persona_store.py), so a bare string could never get an
    `id` -- which is what search_index keys on and what `related` links point
    at. After a load/save cycle the entry is a first-class one."""
    store.save("projects", {"projects": [], "top_of_mind": ["Ship the CLI"]})
    store.save("projects", store.load("projects"))
    entry = store.load("projects")["top_of_mind"][0]
    assert entry["idea"] == "Ship the CLI"
    assert entry["id"].startswith("top_")


def test_load_backfills_a_legacy_mental_tab_title_from_topic(as_user):
    """`mental_tabs[].topic` is the pre-rename name key: read by four
    fallbacks in server.py, written by nothing since. Those fallbacks hid it
    from the two consumers that have none -- get_context's title and a generic
    list renderer keyed on `title`, both of which see a nameless tab.

    Backfilling is additive: `topic` stays (it is still a live MCP address for
    the entry) and an existing `title` is never overwritten."""
    store.save("knowledge", {
        "domains": [],
        "mental_tabs": [
            {"topic": "Old bookmarks", "notes": "kept"},
            {"title": "Current", "topic": "Superseded", "notes": "both keys"},
            {"title": "", "topic": "Blank title counts as nameless"},
        ],
    })
    loaded = store.load("knowledge")["mental_tabs"]

    assert loaded[0]["title"] == "Old bookmarks"
    assert loaded[0]["topic"] == "Old bookmarks"  # not popped
    assert loaded[0]["notes"] == "kept"
    # An existing title wins; the divergent legacy key is left exactly as is.
    assert loaded[1]["title"] == "Current"
    assert loaded[1]["topic"] == "Superseded"
    # "" is as nameless as absent -- setdefault would have left this one blank.
    assert loaded[2]["title"] == "Blank title counts as nameless"


def test_mental_tab_title_backfill_is_idempotent(as_user):
    """load() runs on every read, so a second pass must be a no-op."""
    store.save("knowledge", {
        "domains": [],
        "mental_tabs": [{"topic": "Old bookmarks"}],
    })
    once = store.load("knowledge")
    twice = store._normalize("knowledge", copy.deepcopy(once))
    assert twice == once


def test_backfilled_mental_tab_is_found_by_the_title_lookup(as_user):
    """The read-neutrality claim, executably: every server.py site that reads
    `topic` does so as `title or topic`, so after the backfill it resolves the
    same entry from the first branch. find_in_array on "title" is the lookup
    those sites use and the one that missed a topic-only tab before."""
    from server import find_in_array

    store.save("knowledge", {
        "domains": [],
        "mental_tabs": [{"topic": "Old bookmarks"}],
    })
    tabs = store.load("knowledge")["mental_tabs"]
    idx, tab = find_in_array(tabs, "Old bookmarks", "title")
    assert idx == 0
    assert tab["topic"] == "Old bookmarks"


def test_backfill_skips_a_topic_that_collides_with_another_tabs_title(as_user):
    """A tab stored as {topic: "X"} earlier in the list than a tab already
    holding {title: "X"} used to be read-neutral: find_in_array(tabs, "X",
    "title") resolved only the second tab, since the first had no `title` at
    all. Backfilling the first tab's title from its topic would make it match
    too, and -- being earlier in the list -- it would now win that lookup,
    silently taking over the second tab's identity. A remove-by-title MCP
    call would then delete the wrong tab.

    The guard: skip the backfill when the candidate title would collide
    (case-insensitively, matching find_in_array's own comparison) with
    another tab's current title. The colliding tab keeps rendering blank --
    reachable only via `topic` -- rather than hijacking another entry's name."""
    from server import find_in_array

    store.save("knowledge", {
        "domains": [],
        "mental_tabs": [
            {"topic": "X", "notes": "legacy, collides"},
            {"title": "X", "notes": "the real owner of this name"},
        ],
    })
    tabs = store.load("knowledge")["mental_tabs"]

    # The colliding tab is left exactly as it was: no title backfilled.
    assert "title" not in tabs[0]
    assert tabs[0]["topic"] == "X"

    # The lookup a remove/update action would actually run still resolves
    # the real owner, exactly as it did before the backfill existed.
    idx, tab = find_in_array(tabs, "X", "title")
    assert idx == 1
    assert tab["notes"] == "the real owner of this name"


def test_backfill_collision_check_is_case_insensitive_like_find_in_array(as_user):
    """find_in_array compares with .lower(), so a topic that collides only
    by case ("x" vs "X") must be treated as a collision too -- otherwise the
    guard and the lookup it protects would disagree about what counts as a
    match."""
    store.save("knowledge", {
        "domains": [],
        "mental_tabs": [
            {"topic": "x"},
            {"title": "X"},
        ],
    })
    tabs = store.load("knowledge")["mental_tabs"]
    assert "title" not in tabs[0]
    assert tabs[0]["topic"] == "x"


def test_collision_guarded_backfill_is_idempotent(as_user):
    """Running _normalize twice on a blob that already hit the collision
    guard must not change it further -- the skipped tab stays skipped."""
    store.save("knowledge", {
        "domains": [],
        "mental_tabs": [
            {"topic": "X"},
            {"title": "X"},
        ],
    })
    once = store.load("knowledge")
    twice = store._normalize("knowledge", copy.deepcopy(once))
    assert twice == once
    assert "title" not in once["mental_tabs"][0]


def test_same_pass_backfill_counts_as_collision_for_a_later_entry(as_user):
    """Decision: a title backfilled earlier in the *same* normalisation pass
    counts as a collision for a later entry with the same legacy topic. Two
    tabs that only ever carried {topic: "X"} (neither had a real title
    before) are processed in list order; the earlier one claims the title,
    and the later one is treated exactly like colliding with a pre-existing
    title -- it is left unbackfilled rather than both ending up with the
    identical title "X", which would just recreate the same ambiguous-lookup
    hazard the guard exists to prevent.

    This also keeps the outcome stable under repeated normalisation: once
    the earlier tab holds a real title, the later one collides with it on
    every subsequent pass the same way it did on the first."""
    store.save("knowledge", {
        "domains": [],
        "mental_tabs": [
            {"topic": "X", "notes": "first, claims the name"},
            {"topic": "X", "notes": "second, loses the race"},
        ],
    })
    tabs = store.load("knowledge")["mental_tabs"]

    assert tabs[0]["title"] == "X"
    assert "title" not in tabs[1]
    assert tabs[1]["topic"] == "X"

    # Idempotent: a second pass makes no further change.
    twice = store._normalize("knowledge", copy.deepcopy({"domains": [], "mental_tabs": tabs}))
    assert twice["mental_tabs"] == tabs


# ---------------------------------------------------------------------------
# preferences: mood override `when_feeling` -> `mood` (wave 5)
#
# The retired PreferencesEditor wrote a mood override's name under
# `when_feeling`; execute_modify has always written `mood` (server.py:2247).
# Same shape as the mental_tab topic -> title backfill above, and it carries
# the same two rules: never pop the legacy key, and skip on collision.
# ---------------------------------------------------------------------------


def _overrides(data):
    return store.load("preferences")["communication"]["mood_overrides"]


def test_when_feeling_is_backfilled_to_mood(as_user):
    """Until this backfill, a UI-written override was invisible to every MCP
    lookup: they all resolve on `o.get("mood", "").lower()`, so update and
    remove could never find it and a second add for the same mood silently
    duplicated it."""
    store.save("preferences", {
        "communication": {
            "default": {"tone": "", "detail_level": "", "locale": "British English"},
            "mood_overrides": [{"when_feeling": "stressed", "tone": "brief"}],
        }
    })
    [override] = _overrides(store.load("preferences"))
    assert override["mood"] == "stressed"
    assert override["tone"] == "brief"


def test_when_feeling_is_not_popped(as_user):
    """Where both keys exist the entry is addressable by either name today;
    dropping one would remove an address rather than add one."""
    store.save("preferences", {
        "communication": {
            "default": {"tone": "", "detail_level": "", "locale": "British English"},
            "mood_overrides": [{"when_feeling": "tired"}],
        }
    })
    [override] = _overrides(store.load("preferences"))
    assert override["when_feeling"] == "tired"
    assert override["mood"] == "tired"


def test_an_override_that_already_has_mood_is_left_alone(as_user):
    store.save("preferences", {
        "communication": {
            "default": {"tone": "", "detail_level": "", "locale": "British English"},
            "mood_overrides": [{"mood": "excited", "when_feeling": "something else"}],
        }
    })
    [override] = _overrides(store.load("preferences"))
    assert override["mood"] == "excited"


def test_mood_backfill_skips_a_collision_case_insensitively(as_user):
    """execute_modify matches with .lower(), so a name colliding only by case
    is still a collision -- otherwise the guard and the lookup it protects
    would disagree about what counts as a match."""
    store.save("preferences", {
        "communication": {
            "default": {"tone": "", "detail_level": "", "locale": "British English"},
            "mood_overrides": [{"when_feeling": "stressed"}, {"mood": "STRESSED"}],
        }
    })
    overrides = _overrides(store.load("preferences"))
    assert "mood" not in overrides[0]
    assert overrides[0]["when_feeling"] == "stressed"


def test_same_pass_mood_backfill_counts_as_a_collision_for_a_later_entry(as_user):
    """Two overrides carrying only {when_feeling: "X"} are processed in list
    order: the earlier claims the name, the later is left unbackfilled rather
    than both ending up identical -- which would recreate the ambiguous-lookup
    hazard the guard exists to prevent."""
    store.save("preferences", {
        "communication": {
            "default": {"tone": "", "detail_level": "", "locale": "British English"},
            "mood_overrides": [
                {"when_feeling": "stressed", "tone": "first, claims the name"},
                {"when_feeling": "stressed", "tone": "second, loses the race"},
            ],
        }
    })
    overrides = _overrides(store.load("preferences"))

    assert overrides[0]["mood"] == "stressed"
    assert "mood" not in overrides[1]

    # Idempotent: a second pass makes no further change.
    twice = store._normalize("preferences", copy.deepcopy({
        "communication": {"default": {}, "mood_overrides": overrides}
    }))
    assert twice["communication"]["mood_overrides"] == overrides


def test_mood_backfill_survives_a_malformed_override(as_user):
    """An MCP client can leave any shape behind; a bare string in the list
    must not crash the read path for the whole section."""
    store.save("preferences", {
        "communication": {
            "default": {"tone": "", "detail_level": "", "locale": "British English"},
            "mood_overrides": ["oops", {"when_feeling": "tired"}],
        }
    })
    overrides = _overrides(store.load("preferences"))
    assert overrides[0] == "oops"
    assert overrides[1]["mood"] == "tired"


def test_flat_communication_migrates_to_the_nested_shape(as_user):
    """This migration already existed (persona_store.py) but was never tested
    against an old-shape record. Wave 5 adds the test, not the code."""
    store.save("preferences", {
        "communication": {
            "tone": "warm",
            "detail_level": "thorough",
            "locale": "British English",
        }
    })
    comm = store.load("preferences")["communication"]
    assert comm["default"] == {
        "tone": "warm",
        "detail_level": "thorough",
        "locale": "British English",
    }
    assert comm["mood_overrides"] == []


# ---------------------------------------------------------------------------
# Wave 6 duplicate cleanup.
#
# `contact.github`/`contact.linkedin` and `preferences.coding` held values that
# already existed in `contact.links` and `code_style.tools`. Each is FOLDED into
# its canonical home before being dropped, so a record where the duplicate is
# NOT actually duplicated keeps its value.
# ---------------------------------------------------------------------------


def test_github_handle_is_dropped_when_the_link_already_exists(as_user):
    store.save("profile", {"contact": {
        "links": [{"url": "https://github.com/someone", "label": "Github"}],
        "github": "someone",
    }})
    contact = store.load("profile")["contact"]
    assert "github" not in contact
    assert [l["url"] for l in contact["links"]] == ["https://github.com/someone"]


def test_github_handle_becomes_a_link_when_none_exists(as_user):
    """The reason this is a fold and not a pop: on a record with no matching
    link, a bare pop would silently delete the only copy."""
    store.save("profile", {"contact": {"links": [], "github": "someone"}})
    contact = store.load("profile")["contact"]
    assert "github" not in contact
    assert contact["links"] == [{"url": "https://github.com/someone", "label": "Github"}]


def test_linkedin_handle_folds_the_same_way(as_user):
    store.save("profile", {"contact": {"links": [], "linkedin": "someone"}})
    [link] = store.load("profile")["contact"]["links"]
    assert link == {"url": "https://linkedin.com/in/someone", "label": "LinkedIn"}


def test_a_handle_matches_a_link_stored_in_another_form(as_user):
    """A link saved without the scheme, or with a trailing slash, is still the
    same profile -- matching on the handle rather than the exact url stops a
    near-duplicate being appended."""
    store.save("profile", {"contact": {
        "links": [{"url": "github.com/someone/", "label": "My code"}],
        "github": "someone",
    }})
    links = store.load("profile")["contact"]["links"]
    assert len(links) == 1
    assert links[0]["label"] == "My code"


def test_an_empty_handle_is_dropped_without_adding_a_link(as_user):
    store.save("profile", {"contact": {"links": [], "github": "   "}})
    contact = store.load("profile")["contact"]
    assert "github" not in contact
    assert contact["links"] == []


def test_the_handle_fold_is_idempotent(as_user):
    store.save("profile", {"contact": {"links": [], "github": "someone"}})
    once = store.load("profile")
    twice = store._normalize("profile", copy.deepcopy(once))
    assert twice["contact"]["links"] == once["contact"]["links"]


def test_coding_editor_is_dropped_when_tools_already_lists_it(as_user):
    """Compared without spaces or case, so "VSCode" recognises "VS Code"."""
    store.save("preferences", {"coding": {"editor": "VSCode"},
                               "code_style": {"tools": ["VS Code", "Docker"]}})
    prefs = store.load("preferences")
    assert "coding" not in prefs
    assert prefs["code_style"]["tools"] == ["VS Code", "Docker"]


def test_coding_editor_joins_tools_when_absent(as_user):
    store.save("preferences", {"coding": {"editor": "Zed"},
                               "code_style": {"tools": ["Docker"]}})
    prefs = store.load("preferences")
    assert "coding" not in prefs
    assert prefs["code_style"]["tools"] == ["Docker", "Zed"]


def test_coding_editor_folds_when_there_is_no_tools_list_at_all(as_user):
    store.save("preferences", {"coding": {"editor": "Zed"}})
    prefs = store.load("preferences")
    assert "coding" not in prefs
    assert prefs["code_style"]["tools"] == ["Zed"]


def test_the_editor_fold_is_idempotent(as_user):
    store.save("preferences", {"coding": {"editor": "Zed"}, "code_style": {"tools": []}})
    once = store.load("preferences")
    twice = store._normalize("preferences", copy.deepcopy(once))
    assert twice["code_style"]["tools"] == once["code_style"]["tools"]


def test_lifestyle_media_is_left_alone(as_user):
    """Deliberately NOT removed. It looks like a duplicate of the `media`
    section pack, but that pack stores items[] of {title, kind, status} -- there
    is nowhere for `favourite_genres` or a bare game title to go, so dropping it
    would destroy data rather than de-duplicate it."""
    store.save("lifestyle", {"media": {"games": ["Minecraft"],
                                       "favourite_genres": ["sci-fi"]}})
    assert store.load("lifestyle")["media"] == {"games": ["Minecraft"],
                                                "favourite_genres": ["sci-fi"]}


# ---------------------------------------------------------------------------
# Wave 6: `work_preferences` dissolves into homes that already existed.
# ---------------------------------------------------------------------------


def test_project_approach_folds_into_learning_style(as_user):
    """Same class of statement as the entries already there -- "learning by
    building", "incremental complexity"."""
    store.save("preferences", {
        "work_preferences": {"project_approach": "iterative, MVP first"},
        "learning_style": {"preferred": ["hands-on examples"]},
    })
    prefs = store.load("preferences")
    assert prefs["learning_style"]["preferred"] == ["hands-on examples", "iterative, MVP first"]
    assert "project_approach" not in prefs.get("work_preferences", {})


def test_project_approach_is_not_duplicated_on_a_second_pass(as_user):
    store.save("preferences", {"work_preferences": {"project_approach": "iterative"}})
    once = store.load("preferences")
    twice = store._normalize("preferences", copy.deepcopy(once))
    assert twice["learning_style"]["preferred"] == ["iterative"]


def test_timezone_is_left_alone(as_user):
    """profile.location already implies it, so it earns no control -- but it is
    not popped either: a record whose location is vague or absent would lose
    the only explicit copy, and _normalize cannot read another section to
    check."""
    store.save("preferences", {"work_preferences": {"timezone": "GMT/BST (UK)"}})
    assert store.load("preferences")["work_preferences"] == {"timezone": "GMT/BST (UK)"}
    assert "timezone" not in store.load("preferences").get("communication", {}).get("default", {})


def test_work_preferences_disappears_once_empty(as_user):
    store.save("preferences", {"work_preferences": {"project_approach": "x"}})
    assert "work_preferences" not in store.load("preferences")


# ---------------------------------------------------------------------------
# response_format: five fixed booleans -> a free-text list
# ---------------------------------------------------------------------------


def test_response_format_booleans_become_text(as_user):
    store.save("preferences", {"response_format": {
        "prefer_code_blocks": True,
        "provide_next_steps": True,
    }})
    assert store.load("preferences")["response_format"] == [
        "prefer code blocks", "provide next steps",
    ]


def test_a_false_boolean_is_dropped_rather_than_negated(as_user):
    """A list of wants has no way to say "explicitly off", and a false boolean
    already read the same as absent for every reader of this key."""
    store.save("preferences", {"response_format": {
        "prefer_code_blocks": True,
        "include_explanations": False,
    }})
    assert store.load("preferences")["response_format"] == ["prefer code blocks"]


def test_an_already_converted_list_is_untouched(as_user):
    store.save("preferences", {"response_format": ["code blocks over three lines"]})
    assert store.load("preferences")["response_format"] == ["code blocks over three lines"]


def test_the_response_format_conversion_is_idempotent(as_user):
    store.save("preferences", {"response_format": {"prefer_code_blocks": True}})
    once = store.load("preferences")
    twice = store._normalize("preferences", copy.deepcopy(once))
    assert twice["response_format"] == once["response_format"]


def test_best_productivity_time_is_kept_rather_than_dropped(as_user):
    """It duplicates lifestyle.wellness.energy_peaks -- a RICHER list in a
    DIFFERENT section. _normalize only sees one section's blob, so it cannot be
    folded here, and dropping it without a home would be data loss. Left in
    place until a cross-section migration moves it."""
    store.save("preferences", {"work_preferences": {"best_productivity_time": "evening"}})
    assert store.load("preferences")["work_preferences"] == {"best_productivity_time": "evening"}


def test_design_is_left_in_storage(as_user):
    """It belongs in the aesthetics pack, but _normalize cannot reach another
    section to move it, and cannot tell whether that pack is even in use.
    Unbound from the UI; never dropped blind."""
    store.save("preferences", {"design": {"frontend_aesthetic": "Playful Editorial"}})
    assert store.load("preferences")["design"] == {"frontend_aesthetic": "Playful Editorial"}


def test_response_format_entity_adds_and_removes(as_user):
    """Bare strings need their own branch -- the generic `preference` router
    writes scalars into a category dict and cannot append to a list."""
    import server
    store.save("preferences", {"response_format": []})
    server.execute_modify("add", "response_format", {"item": "code blocks over three lines"})
    server.execute_modify("add", "response_format", {"item": "code blocks over three lines"})
    assert store.load("preferences")["response_format"] == ["code blocks over three lines"]

    assert server.execute_modify(
        "remove", "response_format", {"item": "CODE BLOCKS OVER THREE LINES"}
    ).startswith("✅")
    assert store.load("preferences")["response_format"] == []


def test_a_row_name_is_trimmed_on_the_way_in(as_user):
    """A name is an identifier -- server.find_in_array matches on it -- so a
    stored "iPhone " is a row nothing can address by the name its user sees."""
    store.save("inventory", {"items": [{"name": "  iPhone  ", "category": "phone"}]})
    assert store.load("inventory")["items"][0]["name"] == "iPhone"


def test_trimming_reaches_a_nested_row(as_user):
    """The walk is depth-first over the whole blob rather than over id_lists,
    which are top-level only. A spec is addressed by name like any other row."""
    store.save("inventory", {"items": [
        {"name": "VPS", "specs": [{"name": " provider ", "value": " Hetzner "}]}]})
    spec = store.load("inventory")["items"][0]["specs"][0]
    assert spec["name"] == "provider"
    # Only names. A value is not looked up by, and its whitespace is the
    # user's business.
    assert spec["value"] == " Hetzner "


def test_notes_keep_their_whitespace(as_user):
    """The narrow rule stated as a test: trimming every string would quietly
    rewrite prose, and nothing finds a row by its notes."""
    store.save("inventory", {"items": [{"name": "VPS", "notes": "  runs Coolify\n"}]})
    assert store.load("inventory")["items"][0]["notes"] == "  runs Coolify\n"


def test_an_untrimmed_row_can_still_be_addressed(as_user):
    """Rows written before the trim existed. Matching strips both sides, so the
    row is reachable -- and the write that reaches it trims it for good."""
    import server
    import settings_store
    settings_store.set_enabled_optins(["inventory"])   # ships default-off
    store.save("inventory", {"items": [{"name": "iPhone ", "category": "phone"}]})
    assert server.execute_modify(
        "update", "inventory_item", {"name": "iPhone", "status": "spare"}
    ).startswith("✅")
    item = store.load("inventory")["items"][0]
    assert item["name"] == "iPhone" and item["status"] == "spare"
