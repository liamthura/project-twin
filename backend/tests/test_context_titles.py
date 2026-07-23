import asyncio
import json

import embeddings
import persona_store
import search_index
import server


def _seed(monkeypatch=None, provider=None):
    if monkeypatch is not None:
        monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
        monkeypatch.setattr(search_index._EXECUTOR, "submit",
                             lambda fn, *a, **kw: fn(*a, **kw))
    persona_store.save("profile", {
        "name": "Ada Lovelace",
        "bio": "Mathematician and writer, first programmer.",
    })
    persona_store.save("projects", {
        "projects": [
            {"name": "Ledger", "description": "A JavaScript dashboard"},
            {"name": "Ferris", "description": "Rust CLI tool"},
        ],
        "current_learning": [], "top_of_mind": [{"idea": "ship it"}],
    })


def test_titles_mode_reduces_id_list_entities_to_id_and_title(as_user):
    _seed()
    out = server.get_scoped_context("professional", detail="titles")
    projects = out["context"]["projects"]["projects"]
    assert len(projects) == 2
    for p in projects:
        assert set(p.keys()) == {"id", "title"}
        assert p["title"] in ("Ledger", "Ferris")
        assert p["id"]


def test_titles_mode_leaves_non_entity_scalars_untouched(as_user):
    _seed()
    out = server.get_scoped_context("professional", detail="titles")
    profile = out["context"]["profile"]
    assert profile["name"] == "Ada Lovelace"
    assert profile["bio"] == "Mathematician and writer, first programmer."


def test_titles_token_estimate_smaller_than_full(as_user):
    _seed()
    full = server.get_scoped_context("professional", detail="full")
    titles = server.get_scoped_context("professional", detail="titles")
    assert titles["token_estimate"] < full["token_estimate"]


def test_detail_bogus_errors(as_user):
    out = server.get_scoped_context("professional", detail="bogus")
    assert "error" in out
    assert "full" in out["error"]
    assert "titles" in out["error"]


def test_titles_composes_with_topic_filters_then_stubs(as_user, monkeypatch):
    _seed(monkeypatch, None)
    out = server.get_scoped_context("professional", topic="rust", detail="titles")
    projects = out["context"]["projects"]["projects"]
    assert len(projects) == 1
    assert projects[0] == {"id": projects[0]["id"], "title": "Ferris"}
    assert set(projects[0].keys()) == {"id", "title"}


def test_get_context_detail_via_dispatch(as_user, monkeypatch):
    _seed(monkeypatch, None)

    async def _run():
        tool = await server.mcp.get_tool("get_context")
        return await tool.run({"scope": "professional", "detail": "titles"})

    result = asyncio.run(_run())
    payload = json.loads(result.content[0].text)
    projects = payload["context"]["projects"]["projects"]
    for p in projects:
        assert set(p.keys()) == {"id", "title"}
