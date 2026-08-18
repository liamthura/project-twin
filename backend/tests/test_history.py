"""persona_history: every write reversible, and what a write displaced."""
import db
import persona_store
import server


def _projects():
    return persona_store.load("projects")["projects"]


def test_a_first_write_has_no_previous_version(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    # There was nothing to displace, so nothing is kept. A history row here would
    # be a snapshot of the section's empty default, which restores to nothing.
    assert persona_store.history("projects") == []


def test_a_second_write_keeps_what_it_replaced(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    server.execute_modify("add", "project", {"name": "Twine", "description": "A parser"})

    versions = persona_store.history("projects")
    assert len(versions) == 1
    # The PREVIOUS state (one project), not the current one (two).
    assert versions[0]["entity_count"] == 1


def test_revert_restores_and_is_itself_reversible(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    server.execute_modify("add", "project", {"name": "Twine", "description": "A parser"})
    assert len(_projects()) == 2

    version = persona_store.history("projects")[0]
    assert persona_store.revert("projects", version["id"]) is True
    assert [p["name"] for p in _projects()] == ["Ledger"]

    # The revert went through save(), so the two-project state it displaced was
    # itself snapshotted -- undoing an undo needs no special path.
    newest = persona_store.history("projects")[0]
    assert newest["entity_count"] == 2
    assert persona_store.revert("projects", newest["id"]) is True
    assert [p["name"] for p in _projects()] == ["Ledger", "Twine"]


def test_revert_resyncs_the_search_index(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    server.execute_modify("add", "project", {"name": "Twine", "description": "A parser"})
    version = persona_store.history("projects")[0]
    persona_store.revert("projects", version["id"])

    with db.get_pool().connection() as conn:
        titles = {r["title"] for r in conn.execute(
            "select title from persona_search where user_id = %s and file_type = 'projects'",
            (db.current_user_id.get(),)).fetchall()}
    # Twine is gone from the persona, so it must be gone from the index too --
    # otherwise search returns a hit that get_entity cannot resolve.
    assert titles == {"Ledger"}


def test_revert_rejects_an_unknown_version(clean_database, as_user):
    assert persona_store.revert("projects", 999999) is False


def test_retention_prunes_the_oldest(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "P0", "description": "d"})
    for i in range(1, persona_store.HISTORY_KEEP + 3):
        server.execute_modify("add", "project", {"name": f"P{i}", "description": "d"})

    versions = persona_store.history("projects")
    assert len(versions) == persona_store.HISTORY_KEEP
    # Newest first, and the oldest survivor is not the very first version: the
    # earliest snapshots have been dropped.
    assert versions[0]["entity_count"] > versions[-1]["entity_count"]


def test_history_is_per_section(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    server.execute_modify("add", "project", {"name": "Twine", "description": "A parser"})
    assert len(persona_store.history("projects")) == 1
    assert persona_store.history("goals") == []


def test_written_by_records_the_client_when_there_is_one(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    token = db.current_client.set("Claude Code 1.2.3")
    try:
        server.execute_modify("add", "project", {"name": "Twine", "description": "A parser"})
    finally:
        db.current_client.reset(token)

    assert persona_store.history("projects")[0]["written_by"] == "Claude Code 1.2.3"


def test_written_by_is_empty_for_a_web_ui_write(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    server.execute_modify("add", "project", {"name": "Twine", "description": "A parser"})
    # No client bound: honest as None rather than guessed at.
    assert persona_store.history("projects")[0]["written_by"] is None


def test_an_update_reports_what_it_replaced(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    out = server.persona_modify.fn(
        "update", "project", {"name": "Ledger", "description": "A parser"})

    # The question the add-side advisory cannot answer: an update names its
    # target, so "resembles an existing entity" is trivially true of itself.
    assert "Replaced:" in out and "A dashboard" in out


def test_an_update_that_changes_nothing_says_nothing(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    out = server.persona_modify.fn(
        "update", "project", {"name": "Ledger", "description": "A dashboard"})
    assert "Replaced:" not in out


def test_the_overwrite_note_covers_a_section_with_no_bespoke_branch(clean_database, as_user):
    """The diff is computed from the two section blobs in persona_store.save(),
    so it covers every entity in every section -- including generic pack
    entities the write path handles without a hand-written branch."""
    server.execute_modify("add", "connection", {"name": "Sam", "relationship": "friend"})
    out = server.persona_modify.fn(
        "update", "connection", {"name": "Sam", "relationship": "colleague"})
    assert "Replaced:" in out and "friend" in out
