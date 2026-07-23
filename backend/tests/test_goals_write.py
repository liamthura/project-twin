"""Goals pack write path: add/update/remove, type coercion, alias."""
import server


def test_goals_pack_registered(clean_database):
    import sections
    assert "goals" in sections.SECTION_REGISTRY
    assert list(sections.SECTION_REGISTRY)[:2] == ["profile", "goals"]  # position 15
    assert "goals" not in sections.ALWAYS_ON_SECTIONS
    assert "career_aspirations" not in sections.SECTION_REGISTRY["profile"].default
    assert "goals_and_careers" not in sections.SECTION_REGISTRY["profile"].default


def test_goal_add_and_defaults(as_user):
    msg = server.execute_modify("add", "goal", {"title": "Run a 10K", "type": "health"})
    assert msg.startswith("✅")
    blob = server.load_json("goals.json")
    [g] = blob["goals"]
    assert g["title"] == "Run a 10K"
    assert g["type"] == "health"
    assert g["status"] == "active"  # default


def test_goal_unknown_type_coerces_to_other(as_user):
    msg = server.execute_modify("add", "goal", {"title": "Serve community", "type": "spiritual"})
    assert msg.startswith("✅")
    assert "other" in msg  # coercion noted in the message
    [g] = server.load_json("goals.json")["goals"]
    assert g["type"] == "other"
    assert g["custom_type"] == "spiritual"


def test_goal_unknown_status_errors(as_user):
    msg = server.execute_modify("add", "goal", {"title": "X", "status": "someday"})
    assert msg.startswith("❌")


def test_goal_update_and_remove(as_user):
    server.execute_modify("add", "goal", {"title": "Ship v2", "type": "learning"})
    msg = server.execute_modify("update", "goal", {"title": "Ship v2", "status": "achieved", "why": "portfolio"})
    assert msg.startswith("✅")
    [g] = server.load_json("goals.json")["goals"]
    assert g["status"] == "achieved" and g["why"] == "portfolio"
    msg = server.execute_modify("remove", "goal", {"title": "Ship v2"})
    assert msg.startswith("✅")
    assert server.load_json("goals.json")["goals"] == []


def test_career_aspiration_alias_creates_goal(as_user):
    msg = server.execute_modify("add", "career_aspiration", {"aspiration": "Become a consultant"})
    assert msg.startswith("✅")
    assert "goal" in msg.lower()  # advisory names the new entity
    [g] = server.load_json("goals.json")["goals"]
    assert g["title"] == "Become a consultant"
    assert g["type"] == "career"


def test_goal_update_to_real_type_clears_custom_type(as_user):
    server.execute_modify("add", "goal", {"title": "Serve", "type": "spiritual"})
    msg = server.execute_modify("update", "goal", {"title": "Serve", "type": "career"})
    assert msg.startswith("✅")
    [g] = server.load_json("goals.json")["goals"]
    assert g["type"] == "career"
    assert "custom_type" not in g


def test_career_aspiration_not_in_schema(clean_database):
    assert "career_aspiration" not in server.ENTITY_SCHEMA.get("profile", {})
    assert "goal" in server.ENTITY_SCHEMA["goals"]
