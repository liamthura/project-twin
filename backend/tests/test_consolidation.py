"""Phase 5 consolidation: interests, likes_dislikes, current_learning alias."""
import db
import persona_store
import server
from scripts.migrate_consolidation import migrate_user, run_all


def test_interest_write_and_kinds(clean_database, as_user):
    assert server.execute_modify("add", "interest", {"name": "Photography", "kind": "passion"}).startswith("✅")
    assert server.execute_modify("add", "interest", {"name": "Quantum computing", "kind": "curiosity"}).startswith("✅")
    items = server.load_json("lifestyle.json")["interests"]
    assert {(i["name"], i.get("kind")) for i in items} == {("Photography", "passion"), ("Quantum computing", "curiosity")}


def test_passion_curiosity_aliases(clean_database, as_user):
    msg = server.execute_modify("add", "passion", {"name": "Street food"})
    assert msg.startswith("✅") and "interest" in msg
    msg = server.execute_modify("add", "curiosity", {"topic": "Type design"})
    assert msg.startswith("✅")
    kinds = {i["name"]: i.get("kind") for i in server.load_json("lifestyle.json")["interests"]}
    assert kinds == {"Street food": "passion", "Type design": "curiosity"}


def test_like_dislike_shared_list_and_stance_flip(clean_database, as_user):
    assert server.execute_modify("add", "dislike", {"item": "Meetings before 10am"}).startswith("✅")
    assert server.execute_modify("add", "like", {"item": "Dark mode"}).startswith("✅")
    items = server.load_json("preferences.json")["likes_dislikes"]
    assert {(i["item"], i["stance"]) for i in items} == {("Meetings before 10am", "dislike"), ("Dark mode", "like")}
    # adding the same item under the other entity flips stance instead of duplicating
    msg = server.execute_modify("add", "like", {"item": "Meetings before 10am"})
    assert "now a like" in msg
    assert len(server.load_json("preferences.json")["likes_dislikes"]) == 2


def test_always_on_bundle_carries_likes_dislikes(clean_database, as_user):
    server.execute_modify("add", "like", {"item": "Dark mode"})
    ctx = server.get_scoped_context("minimal")["context"]
    assert any(i["item"] == "Dark mode" for i in ctx["preferences"]["likes_dislikes"])
    assert "dislikes" not in ctx["preferences"]


def test_current_learning_alias_creates_learning_goal(clean_database, as_user):
    msg = server.execute_modify("add", "current_learning", {"topic": "SQL", "context": "consulting prep"})
    assert msg.startswith("✅") and "goal" in msg
    [g] = server.load_json("goals.json")["goals"]
    assert g["title"] == "SQL" and g["type"] == "learning" and g["why"] == "consulting prep"


def test_schema_reflects_consolidation(clean_database):
    assert "interest" in server.ENTITY_SCHEMA["lifestyle"]
    assert "passion" not in server.ENTITY_SCHEMA["lifestyle"]
    assert "like" in server.ENTITY_SCHEMA["preferences"]
    assert "likes_dislikes" not in server.ENTITY_SCHEMA["preferences"]  # list, not entity
    assert "current_learning" not in server.ENTITY_SCHEMA["projects"]


# === migrate_consolidation ===
# Seeding mirrors migrate_goals' test pattern: persona_store.save() does not
# call _normalize (only load() does), so writing legacy keys via
# load-mutate-save persists them raw on the row — exactly what the raw-read
# migration helper needs to see.

def _seed_legacy_lifestyle():
    lifestyle = persona_store.load("lifestyle")
    lifestyle["passions"] = ["Photography", {"name": "Baking"}]
    lifestyle["curiosities"] = ["Quantum computing", {"topic": "Type design"}]
    lifestyle["references"] = ["some-orphan-ref"]
    persona_store.save("lifestyle", lifestyle)


def _seed_legacy_preferences():
    preferences = persona_store.load("preferences")
    preferences["dislikes"] = ["Meetings before 10am", "Cold coffee"]
    persona_store.save("preferences", preferences)


def _seed_legacy_projects():
    projects = persona_store.load("projects")
    projects["current_learning"] = [
        {"topic": "SQL", "context": "consulting prep", "priority": "high"},
        "Rust",
    ]
    persona_store.save("projects", projects)


def _seed_legacy_knowledge():
    knowledge = persona_store.load("knowledge")
    knowledge["proficiency_levels"] = {"python": "expert"}
    persona_store.save("knowledge", knowledge)


def _seed_all_legacy():
    _seed_legacy_lifestyle()
    _seed_legacy_preferences()
    _seed_legacy_projects()
    _seed_legacy_knowledge()


def test_migrate_moves_interests_with_kinds(clean_database, as_user):
    _seed_legacy_lifestyle()
    stats = migrate_user(db.current_user_id.get())
    assert stats["interests_moved"] == 4
    interests = persona_store.load("lifestyle")["interests"]
    assert {(i["name"], i["kind"]) for i in interests} == {
        ("Photography", "passion"),
        ("Baking", "passion"),
        ("Quantum computing", "curiosity"),
        ("Type design", "curiosity"),
    }
    assert all("id" in i for i in interests)  # ids assigned on save


def test_migrate_moves_dislikes_with_stance(clean_database, as_user):
    _seed_legacy_preferences()
    stats = migrate_user(db.current_user_id.get())
    assert stats["likes_dislikes_moved"] == 2
    likes_dislikes = persona_store.load("preferences")["likes_dislikes"]
    assert {(ld["item"], ld["stance"]) for ld in likes_dislikes} == {
        ("Meetings before 10am", "dislike"),
        ("Cold coffee", "dislike"),
    }
    assert all("id" in ld for ld in likes_dislikes)  # ids assigned on save


def test_migrate_moves_current_learning_to_learning_goals(clean_database, as_user):
    _seed_legacy_projects()
    stats = migrate_user(db.current_user_id.get())
    assert stats["goals_moved"] == 2
    goals = persona_store.load("goals")["goals"]
    titles = {g["title"] for g in goals}
    assert titles == {"SQL", "Rust"}
    assert all(g["type"] == "learning" and g["status"] == "active" for g in goals)
    sql = next(g for g in goals if g["title"] == "SQL")
    assert sql["why"] == "consulting prep"
    assert "priority" not in sql
    assert all("id" in g for g in goals)  # ids assigned on save


def test_migrate_pops_all_legacy_keys(clean_database, as_user):
    _seed_all_legacy()
    stats = migrate_user(db.current_user_id.get())
    assert stats["lifestyle_keys_popped"] is True
    assert stats["preferences_keys_popped"] is True
    assert stats["projects_keys_popped"] is True
    assert stats["knowledge_keys_popped"] is True

    lifestyle = persona_store.load("lifestyle")
    assert "passions" not in lifestyle and "curiosities" not in lifestyle and "references" not in lifestyle
    preferences = persona_store.load("preferences")
    assert "dislikes" not in preferences
    projects = persona_store.load("projects")
    assert "current_learning" not in projects
    knowledge = persona_store.load("knowledge")
    assert "proficiency_levels" not in knowledge


def test_migrate_is_idempotent(clean_database, as_user):
    _seed_all_legacy()
    migrate_user(db.current_user_id.get())
    stats2 = migrate_user(db.current_user_id.get())
    assert stats2 == {
        "interests_moved": 0,
        "lifestyle_keys_popped": False,
        "likes_dislikes_moved": 0,
        "preferences_keys_popped": False,
        "goals_moved": 0,
        "projects_keys_popped": False,
        "knowledge_keys_popped": False,
        "moved": 0,
    }
    assert len(persona_store.load("lifestyle")["interests"]) == 4
    assert len(persona_store.load("preferences")["likes_dislikes"]) == 2
    assert len(persona_store.load("goals")["goals"]) == 2


def test_migrate_skips_same_name_pre_existing_entries(clean_database, as_user):
    server.execute_modify("add", "interest", {"name": "Photography", "kind": "curiosity"})
    server.execute_modify("add", "dislike", {"item": "Cold coffee"})
    server.execute_modify("add", "goal", {"title": "SQL", "type": "learning"})
    _seed_all_legacy()

    stats = migrate_user(db.current_user_id.get())
    assert stats["interests_moved"] == 3  # Photography skipped (already present)
    assert stats["likes_dislikes_moved"] == 1  # Cold coffee skipped
    assert stats["goals_moved"] == 1  # SQL skipped

    interests = persona_store.load("lifestyle")["interests"]
    photography = [i for i in interests if i["name"] == "Photography"]
    assert len(photography) == 1 and photography[0]["kind"] == "curiosity"  # untouched, not duplicated

    goals = persona_store.load("goals")["goals"]
    sql_goals = [g for g in goals if g["title"] == "SQL"]
    assert len(sql_goals) == 1 and "why" not in sql_goals[0]  # pre-existing entry wins, not overwritten


def test_run_all_isolates_per_user_failures(monkeypatch):
    import scripts.migrate_consolidation as migrate_consolidation

    calls = []

    def fake_migrate(user_id):
        calls.append(user_id)
        if user_id == "bad":
            raise RuntimeError("corrupt blob")
        return {"moved": 2}

    monkeypatch.setattr(migrate_consolidation, "migrate_user", fake_migrate)
    users = [{"id": "bad", "username": "u1"}, {"id": "ok", "username": "u2"}]
    summary = run_all(users)
    assert calls == ["bad", "ok"]          # second user still processed
    assert summary["total"] == 2
    assert len(summary["failures"]) == 1 and summary["failures"][0][0] == "u1"


def test_titles_mode_keeps_stance_on_always_on_likes_dislikes(clean_database, as_user):
    server.execute_modify("add", "dislike", {"item": "Morning meetings"})
    ctx = server.get_scoped_context("minimal", detail="titles")["context"]
    [stub] = ctx["preferences"]["likes_dislikes"]
    assert stub["stance"] == "dislike"
    assert stub["title"] == "Morning meetings"


def test_titles_mode_keeps_stance_on_aesthetics(clean_database, as_user):
    import settings_store
    settings_store.set_enabled_optins(["aesthetics"])
    server.execute_modify("add", "aesthetic", {"name": "Corporate memphis", "stance": "avoid"})
    ctx = server.get_scoped_context("aesthetics", detail="titles")["context"]
    [stub] = ctx["aesthetics"]["styles"]
    assert stub["stance"] == "avoid"
