import pytest
from fastmcp.exceptions import ToolError

import embeddings
import persona_store
import server


def _get_entity(entity_id):
    return server.get_entity.fn(entity_id)


def test_get_entity_roundtrip(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("lifestyle", {"hobbies": [{"name": "Climbing",
                                                  "level": "casual"}],
                                     "passions": [], "curiosities": [],
                                     "personality_traits": [], "values": [],
                                     "wellness": {}})
    hobby_id = persona_store.load("lifestyle")["hobbies"][0]["id"]
    out = _get_entity(hobby_id)
    assert out["section"] == "lifestyle"
    assert out["entity"]["name"] == "Climbing"


def test_get_entity_unknown_prefix_lists_valid(as_user):
    with pytest.raises(ToolError) as caught:
        server.get_entity.fn("bogus_12345678")
    assert "Unknown entity id prefix" in str(caught.value)
    assert "project_" in str(caught.value) and "learn_" in str(caught.value)


def test_get_entity_not_found(as_user):
    with pytest.raises(ToolError) as caught:
        server.get_entity.fn("project_deadbeef")
    assert "not found" in str(caught.value).lower()


def test_get_entity_disabled_section_blocked(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    import settings_store
    persona_store.save("circle", {"connections": [{"name": "Ada"}]})
    cid = persona_store.load("circle")["connections"][0]["id"]
    settings_store.set_disabled_sections(["circle"])
    with pytest.raises(ToolError) as caught:
        server.get_entity.fn(cid)
    assert "disabled" in str(caught.value).lower()
