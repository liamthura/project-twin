"""Lean context reads: the size cap, titles by default, the learning-log window,
structured results, errors as isError, and the persona resources.

See docs/superpowers/specs/2026-10-02-lean-context-reads-design.md.
"""
import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import jsonschema
import pytest
from fastmcp import Client

import db
import embeddings
import persona_store
import scopes
import search_index
import server
import settings_store
from sections import SECTION_REGISTRY


@pytest.fixture
def indexed(monkeypatch, as_user):
    """FTS only, and index writes that land before the next line runs."""
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    monkeypatch.setattr(search_index._EXECUTOR, "submit",
                        lambda fn, *a, **kw: fn(*a, **kw))


def _session(fn, grant=(scopes.READ,), user=None):
    """One in-memory client session with `grant` (and `user`, if given) bound,
    as the HTTP layer would.

    Bound inside the coroutine so nothing leaks past this call, and before the
    session opens, because the in-memory server runs in the context it was
    started in. Importing main attaches ScopeMiddleware, which is under test.
    """
    import main  # noqa: F401

    async def run():
        scopes.current_scopes.set(scopes.expand(grant))
        if user:
            db.current_user_id.set(user)
        async with Client(server.mcp) as client:
            return await fn(client)

    return asyncio.run(run())


def _projects(*projects, top=("ship it",)):
    persona_store.save("projects", {
        **SECTION_REGISTRY["projects"].default,
        "projects": list(projects),
        "top_of_mind": [{"idea": t} for t in top],
    })
    return persona_store.load("projects")["projects"]


def _tools():
    tools = asyncio.run(server.mcp.get_tools())
    return list(tools.values()) if isinstance(tools, dict) else tools


# --- 1. read path ------------------------------------------------------------

def test_bare_minimal_is_full_and_everything_else_is_an_index(indexed):
    _projects({"name": "Ledger", "description": "A dashboard", "status": "active"})
    get_context = server.get_context.fn

    top = get_context(scope="minimal")["context"]["projects"]["top_of_mind"][0]
    assert top["idea"] == "ship it"  # full: the stored field, not a title

    [project] = get_context(scope="projects")["context"]["projects"]["projects"]
    assert set(project) == {"id", "title", "status", "updated_at"}
    assert project["status"] == "active"

    listed = get_context(scope=["minimal"])["context"]["projects"]["top_of_mind"][0]
    assert "title" in listed and "idea" not in listed

    [full] = get_context(scope="projects", detail="full")["context"]["projects"]["projects"]
    assert full["description"] == "A dashboard" and "updated_at" in full


def test_full_detail_over_the_cap_falls_back_to_titles(indexed):
    _projects(*({"name": f"Project {i}", "description": "x" * 1500} for i in range(40)))

    out = server.get_context.fn(scope="projects", detail="full")

    assert len(server._compact(out)) <= server.RESULT_BUDGET_CHARS
    record = out["trimmed"]["projects.projects"]
    assert record["detail"] == "titles"
    assert record["total"] == record["shown"] == 40
    assert "search_context" in record["more"]
    assert all("description" not in p for p in out["context"]["projects"]["projects"])
    assert "trimmed" in out["note"]


def test_the_budget_keeps_the_newest_then_only_the_count(monkeypatch):
    monkeypatch.setattr(server, "_FOOTER_RESERVE", 0)
    monkeypatch.setattr(server, "RESULT_BUDGET_CHARS", 2_000)
    stubs = [{"id": f"project_{i:08x}", "title": "t" * 60, "updated_at": f"2026-01-{i + 1:02d}"}
             for i in range(28)]
    result = {"projects": {"projects": list(stubs)}}

    trimmed = server._fit_budget(result, {"context": result}, "titles")

    kept = [e["updated_at"] for e in result["projects"]["projects"]]
    assert kept == [f"2026-01-{d:02d}" for d in range(28, 23, -1)]
    assert trimmed["projects.projects"]["shown"] == server.TRIM_KEEP
    assert trimmed["projects.projects"]["total"] == 28
    assert "detail" not in trimmed["projects.projects"]  # already titles

    monkeypatch.setattr(server, "RESULT_BUDGET_CHARS", 50)
    result = {"projects": {"projects": list(stubs)}}
    trimmed = server._fit_budget(result, {"context": result}, "titles")
    assert result["projects"]["projects"] == []
    assert trimmed["projects.projects"]["shown"] == 0


def test_the_learning_log_is_windowed_in_every_scope(indexed):
    now = datetime.now(timezone.utc).isoformat()
    persona_store.save("learning_log", {"entries": [
        {"topic": f"Lesson {i}", "details": "d", "timestamp": now} for i in range(15)
    ]})
    get_context = server.get_context.fn

    def entries(**kw):
        return get_context(**kw)["context"]["learning_log"]["entries"]

    assert len(entries(scope="learning_log")) == server.LEARNING_LOG_DEFAULT_LIMIT
    assert len(entries(scope="full")) == server.LEARNING_LOG_DEFAULT_LIMIT
    assert len(entries(scope="learning_log", limit=12)) == 12
    assert len(entries(scope="learning")) == 15  # its own 60-day window, unchanged


def test_get_entity_defers_what_does_not_fit(indexed, monkeypatch):
    persona_store.save("lifestyle", {"hobbies": [
        {"name": f"Hobby {i}", "notes": "n" * 1500} for i in range(3)
    ]})
    ids = [h["id"] for h in persona_store.load("lifestyle")["hobbies"]]
    monkeypatch.setattr(server, "_FOOTER_RESERVE", 0)
    monkeypatch.setattr(server, "RESULT_BUDGET_CHARS", 2_500)

    out = server.get_entity.fn(ids)

    assert out["entities"][0]["entity"]["name"] == "Hobby 0"
    assert out["entities"][1:] == [{"entity_id": i, "deferred": True} for i in ids[1:]]
    assert "another call" in out["note"]

    # One entry is always delivered whole, even past the cap.
    monkeypatch.setattr(server, "RESULT_BUDGET_CHARS", 100)
    assert "entity" in server.get_entity.fn([ids[0]])["entities"][0]


# --- 2. tool surface -----------------------------------------------------------

def test_every_description_survives_claude_codes_cut():
    # Claude Code truncates a tool description at 2,048 characters.
    for tool in _tools():
        assert len(tool.description or "") <= 2048, tool.name


ANNOTATIONS = {
    # name: (readOnlyHint, destructiveHint)
    "get_context": (True, None), "search_context": (True, None),
    "get_entity": (True, None), "get_raw": (True, None),
    "get_schema": (True, None), "whoami": (True, None),
    "persona_modify": (False, True), "persona_batch": (False, True),
    "propose_update": (False, False),
}


def test_every_tool_is_annotated_and_titled():
    tools = {t.name: t for t in _tools()}
    assert set(tools) == set(ANNOTATIONS)
    for name, (read_only, destructive) in ANNOTATIONS.items():
        hints = tools[name].annotations
        assert tools[name].title, name
        assert hints.readOnlyHint is read_only, name
        assert hints.destructiveHint is destructive, name
        assert hints.openWorldHint is False, name


# --- 3. structured results -----------------------------------------------------

def test_read_tools_return_one_encoding_of_their_payload(indexed):
    [project] = _projects({"name": "Café Ledger", "description": "naïve"})
    calls = {
        "get_context": {"scope": "projects", "detail": "full"},
        "search_context": {"query": "ledger"},
        "get_entity": {"entity_id": project["id"]},
        "get_raw": {"file": "projects"},
        "get_schema": {},
        "whoami": {},
    }
    tools = {t.name: t for t in _tools()}
    for name, args in calls.items():
        result = asyncio.run(tools[name].run(args))
        payload = result.structured_content
        jsonschema.validate(payload, tools[name].output_schema)
        text = result.content[0].text
        assert json.loads(text) == payload, name
        assert "\n" not in text and "\\u" not in text, name  # compact, unescaped
        assert "result" not in payload or name == "get_schema", name  # no wrapper


def test_write_tools_answer_in_plain_text(as_user):
    tools = {t.name: t for t in _tools()}
    for name in ("persona_modify", "persona_batch", "propose_update"):
        assert tools[name].output_schema is None, name
    result = asyncio.run(tools["persona_modify"].run(
        {"action": "add", "entity": "hobby", "data": {"name": "Climbing"}}))
    assert result.structured_content is None
    assert result.content[0].text.startswith("✅")


def test_failures_come_back_flagged_and_partial_results_do_not(indexed):
    [project] = _projects({"name": "Ledger"})

    async def calls(client):
        bad_scope = await client.call_tool("get_context", {"scope": "nope"},
                                           raise_on_error=False)
        bad_write = await client.call_tool(
            "persona_modify", {"action": "remove", "entity": "hobby",
                               "data": {"name": "Never added"}}, raise_on_error=False)
        mixed = await client.call_tool(
            "get_entity", {"entity_id": [project["id"], "project_deadbeef"]},
            raise_on_error=False)
        return bad_scope, bad_write, mixed

    bad_scope, bad_write, mixed = _session(calls, grant=(scopes.WRITE,))
    assert bad_scope.is_error and "Unknown scope" in bad_scope.content[0].text
    assert bad_write.is_error and "not found" in bad_write.content[0].text
    assert not mixed.is_error
    assert "error" in mixed.structured_content["entities"][1]


def test_search_snippets_drop_highlight_tags_and_the_repeated_title():
    clean = server._clean_snippet
    assert clean("<b>Proxmox</b> <b>setup</b>\nBuilt the box", "Proxmox setup") == "Built the box"
    assert clean("Something <b>else</b>", "Proxmox setup") == "Something else"
    assert clean(None, "x") is None


# --- 4. resources, links, skills -------------------------------------------------

PERSONA_TEMPLATES = {"mygist://entity/{entity_id}", "mygist://section/{key}"}


def _template_uris(grant):
    async def listing(client):
        return {t.uriTemplate for t in await client.list_resource_templates()}
    return _session(listing, grant=grant)


def test_persona_templates_are_listed_only_with_persona_read(as_user):
    assert PERSONA_TEMPLATES <= _template_uris((scopes.READ,))
    assert not (PERSONA_TEMPLATES & _template_uris(()))


def test_persona_uris_are_refused_without_persona_read_but_skills_are_not(as_user):
    with pytest.raises(Exception, match="persona:read"):
        _session(lambda c: c.read_resource("mygist://section/projects"), grant=())
    assert _session(lambda c: c.read_resource("skill://index.json"), grant=())


def test_the_entity_and_section_resources_match_the_tools(indexed):
    [project] = _projects({"name": "Ledger", "description": "A dashboard"})

    async def both(client):
        entity = await client.read_resource(f"mygist://entity/{project['id']}")
        section = await client.read_resource("mygist://section/projects")
        return json.loads(entity[0].text), json.loads(section[0].text)

    entity, section = _session(both)
    assert entity["entity"]["description"] == "A dashboard"
    [stub] = section["context"]["projects"]["projects"]
    assert set(stub) <= {"id", "title", "status", "updated_at"}


def test_a_disabled_section_resource_is_refused(as_user):
    settings_store.set_disabled_sections(["projects"])
    with pytest.raises(Exception, match="disabled"):
        _session(lambda c: c.read_resource("mygist://section/projects"))


def test_one_user_cannot_read_anothers_entry_by_uri(indexed):
    [project] = _projects({"name": "Alice's ledger"})
    bob, _ = db.create_user("lean-reads-bob", password="correct horse battery")

    with pytest.raises(Exception, match="not found"):
        _session(lambda c: c.read_resource(f"mygist://entity/{project['id']}"), user=bob)
    # And the same read as Alice works, so the refusal is about the user.
    assert _session(lambda c: c.read_resource(f"mygist://entity/{project['id']}"))


def test_get_context_links_the_sections_it_left_out(indexed):
    _projects({"name": "Ledger"})
    persona_store.save("circle", {"connections": [{"name": "Ann"}]})

    result = _session(lambda c: c.call_tool("get_context", {"scope": "projects"}))

    links = {str(b.uri) for b in result.content if b.type == "resource_link"}
    assert "mygist://section/circle" in links
    assert "mygist://section/projects" not in links  # nothing of it left out


def test_deferred_ids_come_back_as_links(indexed, monkeypatch):
    persona_store.save("lifestyle", {"hobbies": [
        {"name": f"Hobby {i}", "notes": "n" * 1500} for i in range(2)
    ]})
    ids = [h["id"] for h in persona_store.load("lifestyle")["hobbies"]]
    monkeypatch.setattr(server, "_FOOTER_RESERVE", 0)
    monkeypatch.setattr(server, "RESULT_BUDGET_CHARS", 2_000)

    result = _session(lambda c: c.call_tool("get_entity", {"entity_id": ids}))

    links = [str(b.uri) for b in result.content if b.type == "resource_link"]
    assert links == [f"mygist://entity/{ids[1]}"]


def test_every_persona_uri_a_skill_mentions_is_served():
    skills = Path(server.__file__).parent / "skills"
    for path in skills.rglob("*.md"):
        for uri in re.findall(r"mygist://[\w/{}]+", path.read_text()):
            assert re.sub(r"/[^/]+$", "/", uri) in {"mygist://entity/", "mygist://section/"}, (path, uri)
