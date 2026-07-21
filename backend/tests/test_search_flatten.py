import pytest

import search_index


# Representative shapes for every id-list entity server.py's persona_modify
# (execute_modify) can store, taken from the actual dicts each branch builds
# (see server.py: work_experience ~L1186, education ~L1290, language ~L1160,
# domain ~L1462, mental_tab ~L1498, project ~L1543, current_learning ~L1581,
# top_of_mind ~L1617, hobby ~L1339, connection ~L1665, learning_entry ~L1710).
# `goal` (profile.goals_and_careers, {"goal": ...}) has no persona_modify
# entity -- it's only reachable via the direct frontend PUT path -- and is
# included to document that it stays untitled/untexted (out of scope here).
FLATTEN_ENTITY_CASES = [
    ("work_experience",
     {"role": "Engineer", "company": "Acme Corp", "type": "Full-time",
      "period": "2020-2022", "highlights": ["Shipped X"]},
     True, ["Engineer", "Acme Corp", "Shipped X"]),
    ("education",
     {"institution": "Northumbria University", "degree_level": "BSc",
      "field_of_study": "Computer Science", "start_year": "2020",
      "end_year": "2023", "status": "current", "coursework": [], "clubs": [],
      "highlights": []},
     True, ["Northumbria University", "Computer Science"]),
    ("language", {"name": "Spanish", "fluency": "fluent"}, True, ["Spanish"]),
    ("goal", {"goal": "Ship it"}, False, []),
    ("domain", {"name": "Rust", "level": "learning",
                "notes": "Systems programming study"},
     True, ["Rust", "learning", "Systems programming study"]),
    ("mental_tab",
     {"title": "Read paper", "notes": "context on X", "tags": ["research"],
      "status": "open", "references": []},
     True, ["Read paper", "context on X", "research"]),
    ("project",
     {"name": "Blog", "description": "A blog", "status": "active",
      "tags": ["writing"], "references": [], "highlights": ["Launched v1"],
      "notes": "side project"},
     True, ["Blog", "A blog", "active", "writing", "Launched v1", "side project"]),
    ("current_learning",
     {"topic": "Rust", "context": "needed for new job", "priority": "high"},
     True, ["Rust", "needed for new job"]),
    ("top_of_mind", {"idea": "Ship v2", "note": "before Friday"},
     True, ["Ship v2", "before Friday"]),
    ("hobby",
     {"name": "Chess", "skill_level": "learning", "status": "active",
      "notes": "casual player", "specifics": [], "references": []},
     True, ["Chess", "active", "casual player"]),
    ("connection",
     {"name": "Sam", "relationship": "friend", "traits": ["funny", "kind"],
      "notes": "met at work"},
     True, ["Sam", "friend", "met at work", "funny", "kind"]),
    ("learning_entry",
     {"topic": "FastAPI", "details": "Learned dependency injection",
      "source": "conversation", "tags": ["python"]},
     True, ["FastAPI", "Learned dependency injection"]),
]


@pytest.mark.parametrize("label, entity, expect_title, must_contain",
                         FLATTEN_ENTITY_CASES,
                         ids=[c[0] for c in FLATTEN_ENTITY_CASES])
def test_flatten_entity_covers_every_persona_modify_shape(
    label, entity, expect_title, must_contain
):
    title, text = search_index.flatten_entity(entity)
    if expect_title:
        assert title, f"{label}: expected a non-empty title for {entity!r}"
        assert text, f"{label}: expected non-empty text for {entity!r}"
    for marker in must_contain:
        assert marker in text, f"{label}: {marker!r} missing from text {text!r}"


def test_flatten_entity_title_priority_and_fields():
    title, text = search_index.flatten_entity({
        "id": "project_ab12cd34",
        "name": "MyGist",
        "description": "Personal context for AI",
        "status": "active",
        "tags": ["mcp", "postgres"],
        "references": [{"name": "Neon docs", "url": "https://neon.com"}],
        "highlights": ["Shipped auth"],
        "count": 7,          # non-str scalar: skipped
        "nested": {"x": 1},  # unknown dict: skipped
    })
    assert title == "MyGist"
    assert text.splitlines()[0] == "MyGist"
    for expected in ("Personal context for AI", "active", "mcp", "postgres",
                     "Neon docs", "https://neon.com", "Shipped auth"):
        assert expected in text


def test_flatten_entity_title_fallbacks():
    assert search_index.flatten_entity({"topic": "FastAPI DI"})[0] == "FastAPI DI"
    assert search_index.flatten_entity({"title": "T"})[0] == "T"
    assert search_index.flatten_entity({"institution": "Northumbria"})[0] == "Northumbria"
    assert search_index.flatten_entity({"details": "only details"})[0] == ""


def test_flatten_section_skips_entities_without_id():
    rows = search_index.flatten_section("projects", {
        "projects": [{"id": "project_a1b2c3d4", "name": "P1"}, {"name": "no id yet"}],
        "current_learning": [{"id": "learning_a1b2c3d4", "topic": "Rust"}],
        "top_of_mind": [],
    })
    ids = [r[0] for r in rows]
    assert ids == ["project_a1b2c3d4", "learning_a1b2c3d4"]


def test_flatten_section_no_id_lists_is_empty():
    assert search_index.flatten_section("preferences", {"dislikes": ["x"]}) == []


def test_entity_location_longest_prefix_wins():
    assert search_index.entity_location("learn_20260721_ab12cd") == ("learning_log", "entries")
    assert search_index.entity_location("learning_ab12cd34") == ("projects", "current_learning")
    assert search_index.entity_location("hobby_ab12cd34") == ("lifestyle", "hobbies")
    assert search_index.entity_location("nope_123") is None
