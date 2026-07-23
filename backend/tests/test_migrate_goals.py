"""migrate_goals: legacy profile lists -> goals section, idempotent."""
import db
import persona_store
from scripts.migrate_goals import migrate_user


def _seed_legacy_profile():
    profile = persona_store.load("profile")
    profile["career_aspirations"] = ["Become a consultant", "Lead a team"]
    profile["goals_and_careers"] = [{"title": "Run a marathon"}, "Learn Mandarin"]
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
