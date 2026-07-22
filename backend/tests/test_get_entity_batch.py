import asyncio
import json

import embeddings
import persona_store

import server


def _get_entity(entity_id):
    return server.get_entity.fn(entity_id)


def test_get_entity_batch_list_happy_path(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("lifestyle", {"hobbies": [
        {"name": "Climbing", "level": "casual"},
        {"name": "Chess", "level": "hobbyist"},
    ], "passions": [], "curiosities": [], "personality_traits": [],
        "values": [], "wellness": {}})
    hobbies = persona_store.load("lifestyle")["hobbies"]
    ids = [hobbies[0]["id"], hobbies[1]["id"]]

    out = json.loads(_get_entity(ids))

    assert "entities" in out
    assert len(out["entities"]) == 2
    names = {e["entity"]["name"] for e in out["entities"]}
    assert names == {"Climbing", "Chess"}
    for e in out["entities"]:
        assert e["section"] == "lifestyle"


def test_get_entity_batch_mixed_valid_and_errors(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("lifestyle", {"hobbies": [
        {"name": "Climbing", "level": "casual"},
    ], "passions": [], "curiosities": [], "personality_traits": [],
        "values": [], "wellness": {}})
    hobby_id = persona_store.load("lifestyle")["hobbies"][0]["id"]

    ids = [hobby_id, "bogus_12345678", "project_deadbeef"]
    out = json.loads(_get_entity(ids))

    assert "entities" in out
    assert len(out["entities"]) == 3

    valid_entry = out["entities"][0]
    assert valid_entry["entity"]["name"] == "Climbing"

    unknown_prefix_entry = out["entities"][1]
    assert unknown_prefix_entry["entity_id"] == "bogus_12345678"
    assert "Unknown entity id prefix" in unknown_prefix_entry["error"]

    not_found_entry = out["entities"][2]
    assert not_found_entry["entity_id"] == "project_deadbeef"
    assert "not found" in not_found_entry["error"].lower()


def test_get_entity_batch_over_cap_errors(as_user):
    ids = [f"project_{i:08x}" for i in range(26)]
    out = _get_entity(ids)

    assert "25" in out
    assert "split" in out


def test_get_entity_batch_empty_list_errors(as_user):
    out = _get_entity([])
    assert "error" in out.lower()


def test_get_entity_single_string_no_entities_key(as_user):
    out = _get_entity("bogus_12345678")
    assert "Unknown entity id prefix" in out
    # Byte-compatible with the original shape: no JSON wrapping at all,
    # so "entities" cannot appear as a key.
    assert "entities" not in out


def test_get_entity_batch_via_dispatch(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("lifestyle", {"hobbies": [
        {"name": "Climbing", "level": "casual"},
        {"name": "Chess", "level": "hobbyist"},
    ], "passions": [], "curiosities": [], "personality_traits": [],
        "values": [], "wellness": {}})
    hobbies = persona_store.load("lifestyle")["hobbies"]
    ids = [hobbies[0]["id"], hobbies[1]["id"]]

    async def _run():
        tool = await server.mcp.get_tool("get_entity")
        return await tool.run({"entity_id": ids})

    result = asyncio.run(_run())
    payload = json.loads(result.content[0].text)
    assert "entities" in payload
    names = {e["entity"]["name"] for e in payload["entities"]}
    assert names == {"Climbing", "Chess"}
