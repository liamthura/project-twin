"""Phase 5 consolidation: interests, likes_dislikes, current_learning alias."""
import server


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
