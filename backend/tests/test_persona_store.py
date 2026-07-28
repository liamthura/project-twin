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
