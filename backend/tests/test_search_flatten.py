import search_index


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
