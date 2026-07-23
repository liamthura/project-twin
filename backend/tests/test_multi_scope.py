import asyncio
import json

import server


def _seed(as_user):
    import persona_store as store
    c = store.load("circle"); c["connections"] = [{"name": "Sam"}]; store.save("circle", c)
    l = store.load("lifestyle"); l["hobbies"] = [{"name": "Chess"}]; store.save("lifestyle", l)


def test_single_string_scope_still_works(as_user):
    out = json.loads(server.get_context.fn(scope="minimal"))
    assert out["scope"] == "minimal"
    assert "context" in out


def test_two_section_scopes_union(as_user):
    _seed(as_user)
    out = json.loads(server.get_context.fn(scope=["lifestyle", "circle"]))
    ctx = out["context"]
    assert "lifestyle" in ctx and "circle" in ctx
    assert "preferences" in ctx  # always-on


def test_global_and_section_mix(as_user):
    _seed(as_user)
    ctx = json.loads(server.get_context.fn(scope=["professional", "circle"]))["context"]
    assert "circle" in ctx           # from the section scope
    assert "projects" in ctx or "profile" in ctx  # from professional


def test_overlapping_scopes_dedup_fields(as_user):
    # personal already includes lifestyle; unioning with the lifestyle section
    # scope must not duplicate fields.
    fields = server._resolve_scope_fields_multi(["personal", "lifestyle"])
    assert len(fields["lifestyle"]) == len(set(fields["lifestyle"]))


def test_unknown_token_in_list_errors(as_user):
    out = json.loads(server.get_context.fn(scope=["minimal", "bogus"]))
    assert "error" in out


def test_list_with_full_returns_everything(as_user):
    # Seed circle/lifestyle so their (list-valued) sections aren't stripped by
    # the inactive-filtering pass, which drops sections with no active items.
    _seed(as_user)
    out = json.loads(server.get_context.fn(scope=["minimal", "full"]))
    # full wins → all files present
    assert set(out["context"].keys()) >= {"profile", "lifestyle", "circle", "preferences"}


def test_real_dispatch_path_accepts_section_and_list_scopes(as_user):
    """Drive get_context through the real FastMCP tool-dispatch path (the
    validated path a live client uses), not the raw `.fn`. This is the only
    way to catch a schema that still rejects section scopes / lists with a
    pydantic ValidationError before get_scoped_context ever runs."""
    _seed(as_user)

    async def _run():
        tool = await server.mcp.get_tool("get_context")
        section_result = await tool.run({"scope": "circle"})
        list_result = await tool.run({"scope": ["lifestyle", "circle"]})
        return section_result, list_result

    section_result, list_result = asyncio.run(_run())

    section_payload = json.loads(section_result.content[0].text)
    assert "error" not in section_payload
    assert "circle" in section_payload["context"]

    list_payload = json.loads(list_result.content[0].text)
    assert "error" not in list_payload
    assert "lifestyle" in list_payload["context"] and "circle" in list_payload["context"]
