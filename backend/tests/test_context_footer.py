"""get_context's footer: what the scope did NOT return, and what to do about it.

A token estimate used to sit in this slot. It measured the payload the model was
already holding -- a receipt for a purchase that cannot be returned. These counts
point the other way, at what has not been paid for yet, with an action attached.
"""
import server
from sections import SECTION_REGISTRY
import persona_store as store


def _seed():
    store.save("projects", {
        **SECTION_REGISTRY["projects"].default,
        "projects": [
            {"id": "proj_a", "name": "Ledger", "description": "Double-entry books"},
            {"id": "proj_b", "name": "Ferris", "description": "Rust CLI tool"},
        ],
    })
    store.save("circle", {
        **SECTION_REGISTRY["circle"].default,
        "connections": [
            {"id": "conn_a", "name": "Ada", "relationship": "colleague"},
        ],
    })


def test_token_estimate_is_gone(as_user):
    _seed()
    out = server.get_scoped_context("professional")
    assert "token_estimate" not in out


def test_the_note_is_always_there_and_names_both_follow_ups(as_user):
    _seed()
    out = server.get_scoped_context("minimal")
    assert "search_context" in out["note"]
    assert "propose_update" in out["note"]
    assert "not narrate" in out["note"]


def test_a_narrow_scope_reports_what_it_left_behind(as_user):
    _seed()
    out = server.get_scoped_context("professional")
    # `circle` is not in the professional scope, and one connection is indexed.
    assert out["not_in_this_scope"]["circle"] == 1
    # `projects` came back in full, so it is not reported as left behind.
    assert "projects" not in out["not_in_this_scope"]


def test_full_scope_leaves_nothing_behind(as_user):
    _seed()
    out = server.get_scoped_context("full")
    assert out.get("not_in_this_scope", {}) == {}
