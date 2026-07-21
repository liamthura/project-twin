import asyncio
import json

import embeddings
import persona_store
import pytest


@pytest.fixture
def seeded(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("projects", {
        "projects": [{"name": "Ledger", "description": "JavaScript dashboard"}],
        "current_learning": [], "top_of_mind": [],
    })
    return as_user


def test_search_context_via_dispatch(seeded):
    # Real FastMCP dispatch path (established precedent: tests/test_multi_scope.py
    # ::test_real_dispatch_path_accepts_section_and_list_scopes) — `.fn` bypasses
    # schema validation, but this catches Literal/signature mismatches a live
    # client would actually hit.
    import server

    async def _run():
        tool = await server.mcp.get_tool("search_context")
        return await tool.run({"query": "dashboard", "limit": 5})

    result = asyncio.run(_run())
    payload = json.loads(result.content[0].text)
    assert payload["mode"] == "fts"
    assert payload["results"][0]["title"] == "Ledger"
    assert set(payload["results"][0]) == {"entity_id", "section", "title",
                                          "snippet", "score", "fts_hit",
                                          "distance"}


def test_search_context_bad_section_errors(seeded):
    import server

    async def _run():
        tool = await server.mcp.get_tool("search_context")
        return await tool.run({"query": "x", "sections": "not_a_section"})

    result = asyncio.run(_run())
    assert "Unknown section" in result.content[0].text


def test_get_entity_via_dispatch(seeded):
    import server
    pid = persona_store.load("projects")["projects"][0]["id"]

    async def _run():
        tool = await server.mcp.get_tool("get_entity")
        return await tool.run({"entity_id": pid})

    result = asyncio.run(_run())
    assert json.loads(result.content[0].text)["entity"]["name"] == "Ledger"
