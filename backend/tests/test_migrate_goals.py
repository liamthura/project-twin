"""migrate_goals: legacy profile lists -> goals section, idempotent."""
import db
import persona_store
from scripts.migrate_goals import migrate_user


def _seed_legacy_profile():
    profile = persona_store.load("profile")
    profile["career_aspirations"] = ["Become a consultant", "Lead a team"]
    profile["goals_and_careers"] = [
        {"goal": "Run a marathon", "target": "May 2027"},
        "Learn Mandarin",
    ]
    persona_store.save("profile", profile)


def test_migrate_moves_both_lists(as_user):
    _seed_legacy_profile()
    stats = migrate_user(db.current_user_id.get())
    assert stats["moved"] == 4
    goals = persona_store.load("goals")["goals"]
    titles = {g["title"] for g in goals}
    assert titles == {"Become a consultant", "Lead a team", "Run a marathon", "Learn Mandarin"}
    assert all(g["type"] == "career" and g["status"] == "active" for g in goals)
    assert all("id" in g for g in goals)  # ids assigned on save
    marathon = next(g for g in goals if g["title"] == "Run a marathon")
    assert marathon["notes"] == "target: May 2027"
    profile = persona_store.load("profile")
    assert "career_aspirations" not in profile
    assert "goals_and_careers" not in profile


def test_migrate_is_idempotent(as_user):
    _seed_legacy_profile()
    migrate_user(db.current_user_id.get())
    stats2 = migrate_user(db.current_user_id.get())
    assert stats2["moved"] == 0
    assert len(persona_store.load("goals")["goals"]) == 4


def test_migrate_skips_titles_already_present(as_user):
    import server
    server.execute_modify("add", "goal", {"title": "Become a consultant"})
    _seed_legacy_profile()
    stats = migrate_user(db.current_user_id.get())
    assert stats["moved"] == 3  # duplicate title skipped


def test_run_all_isolates_per_user_failures(monkeypatch):
    from scripts import migrate_goals

    calls = []

    def fake_migrate(user_id):
        calls.append(user_id)
        if user_id == "bad":
            raise RuntimeError("corrupt blob")
        return {"moved": 2}

    monkeypatch.setattr(migrate_goals, "migrate_user", fake_migrate)
    users = [{"id": "bad", "username": "u1"}, {"id": "ok", "username": "u2"}]
    summary = migrate_goals.run_all(users)
    assert calls == ["bad", "ok"]          # second user still processed
    assert summary["total"] == 2
    assert len(summary["failures"]) == 1 and summary["failures"][0][0] == "u1"
