"""The unattended sweep: what it finds, and the one thing it must never do."""
from datetime import date, timedelta

import db
import persona_store
import proposals_store
import server
import settings_store
from scripts import sweep as sweep_mod


def _notes():
    return [p["note"] for p in proposals_store.list_pending("note", mark_seen=False)]


def _passed_goal(days_ago=30, status="active"):
    server.execute_modify("add", "goal", {
        "title": "Ship the sweep",
        "status": status,
        "target_date": (date.today() - timedelta(days=days_ago)).isoformat(),
    })


def test_passed_target_date_is_proposed(clean_database, as_user):
    _passed_goal(days_ago=30)
    result = sweep_mod.sweep_user(db.current_user_id.get())
    assert result["filed"] == 1
    (note,) = _notes()
    assert "Ship the sweep" in note and "30 days ago" in note


def test_a_goal_that_is_not_active_is_left_alone(clean_database, as_user):
    # An achieved goal with a past target date is not an inconsistency, it is a
    # finished goal. Proposing on it would be exactly the noise that gets an
    # inbox abandoned.
    _passed_goal(days_ago=30, status="achieved")
    assert sweep_mod.sweep_user(db.current_user_id.get())["found"] == 0


def test_a_future_target_date_is_left_alone(clean_database, as_user):
    _passed_goal(days_ago=-30)
    assert sweep_mod.sweep_user(db.current_user_id.get())["found"] == 0


def test_a_clean_persona_files_nothing(clean_database, as_user):
    server.execute_modify("add", "project",
                          {"name": "Ledger", "description": "A dashboard"})
    result = sweep_mod.sweep_user(db.current_user_id.get())
    assert result == {"user_id": db.current_user_id.get(), "found": 0,
                      "filed": 0, "suppressed": 0, "over_cap": 0}
    assert _notes() == []


def test_dangling_related_link_is_proposed(clean_database, as_user):
    server.execute_modify("add", "project",
                          {"name": "Ledger", "description": "A dashboard"})
    projects = persona_store.load("projects")
    projects["projects"][0]["related"] = [{"id": "domain_deadbeef"}]
    persona_store.save("projects", projects)

    result = sweep_mod.sweep_user(db.current_user_id.get())
    assert result["filed"] == 1
    assert "domain_deadbeef" in _notes()[0]


def test_second_run_does_not_file_the_same_thing_twice(clean_database, as_user):
    _passed_goal()
    first = sweep_mod.sweep_user(db.current_user_id.get())
    second = sweep_mod.sweep_user(db.current_user_id.get())
    assert first["filed"] == 1
    # Still found -- the inconsistency has not gone away -- but the existing
    # pending row absorbs it instead of a duplicate appearing.
    assert (second["found"], second["filed"], second["suppressed"]) == (1, 0, 1)
    assert len(_notes()) == 1


def test_a_rejected_finding_is_never_raised_again(clean_database, as_user):
    _passed_goal()
    sweep_mod.sweep_user(db.current_user_id.get())
    pending = proposals_store.list_pending("note", mark_seen=False)
    proposals_store.resolve(pending[0]["id"], "rejected")

    again = sweep_mod.sweep_user(db.current_user_id.get())
    assert (again["filed"], again["suppressed"]) == (0, 1)
    assert _notes() == []


def test_per_run_cap_holds_and_reports_the_overflow(clean_database, as_user):
    for i in range(5):
        server.execute_modify("add", "goal", {
            "title": f"Goal {i}", "status": "active",
            "target_date": (date.today() - timedelta(days=10 + i)).isoformat(),
        })
    result = sweep_mod.sweep_user(db.current_user_id.get(), cap=2)
    assert (result["found"], result["filed"], result["over_cap"]) == (5, 2, 3)
    assert len(_notes()) == 2


def test_dry_run_files_nothing_and_records_nothing(clean_database, as_user):
    _passed_goal()
    result = sweep_mod.sweep_user(db.current_user_id.get(), dry_run=True)
    assert (result["found"], result["filed"]) == (1, 0)
    assert _notes() == []
    assert settings_store.get_settings().get("last_sweep") is None


def test_it_records_when_it_last_ran(clean_database, as_user):
    _passed_goal()
    sweep_mod.sweep_user(db.current_user_id.get())
    assert settings_store.get_settings()["last_sweep"] == {
        "at": date.today().isoformat(), "examined": 1, "filed": 1}


def test_the_sweep_cannot_write_to_the_persona(clean_database, as_user, monkeypatch):
    """The property the entire design rests on.

    An unattended process is only acceptable here because its sole output is
    rows in the review queue. If it can ever reach persona_store.save it can
    change the persona behind the user's back, and every promise MyGist makes
    about that stops being true. Asserted rather than reasoned about, because
    this is the kind of thing a well-meaning later edit breaks silently.
    """
    _passed_goal()
    server.execute_modify("add", "project",
                          {"name": "Ledger", "description": "A dashboard"})
    projects = persona_store.load("projects")
    projects["projects"][0]["related"] = [{"id": "domain_deadbeef"}]
    persona_store.save("projects", projects)
    before = {ft: persona_store.load(ft) for ft in persona_store.VALID_FILES}

    def _explode(*a, **k):
        raise AssertionError("the sweep must never write to the persona")

    monkeypatch.setattr(persona_store, "save", _explode)
    result = sweep_mod.sweep_user(db.current_user_id.get())

    assert result["filed"] == 2  # it did its job without writing
    assert {ft: persona_store.load(ft) for ft in persona_store.VALID_FILES} == before


def _age_the_index(days):
    with db.get_pool().connection() as conn:
        conn.execute(
            "update persona_search set updated_at = now() - make_interval(days => %s)"
            " where user_id = %s",
            (days, db.current_user_id.get()),
        )


def test_gone_quiet_needs_age_and_never_having_been_read(clean_database, as_user):
    """The two-signal rule, which is the whole reason read_count exists.

    Age alone is a weak reason to suggest dropping something: a preference set
    two years ago and read every week is settled, not stale.
    """
    server.execute_modify("add", "project",
                          {"name": "Ledger", "description": "A dashboard"})
    _age_the_index(200)  # projects declares stale_after_days: 120

    assert sweep_mod.sweep_user(db.current_user_id.get())["filed"] == 1
    assert "never been read back" in _notes()[0]


def test_an_old_but_frequently_read_entry_is_left_alone(clean_database, as_user):
    server.execute_modify("add", "project",
                          {"name": "Ledger", "description": "A dashboard"})
    _age_the_index(200)
    entity_id = persona_store.load("projects")["projects"][0]["id"]
    server.get_entity.fn(entity_id)  # the second signal: somebody reads it

    assert sweep_mod.sweep_user(db.current_user_id.get())["found"] == 0


def test_a_section_without_a_window_never_goes_quiet(clean_database, as_user):
    # `circle` declares no stale_after_days: a person you have not mentioned in
    # a year has not expired.
    server.execute_modify("add", "connection",
                          {"name": "Sam", "relationship": "friend"})
    _age_the_index(3000)
    assert sweep_mod.sweep_user(db.current_user_id.get())["found"] == 0
