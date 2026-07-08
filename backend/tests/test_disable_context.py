import json

import server
import settings_store as ss
import persona_store as store


def _seed(as_user):
    c = store.load("circle"); c["connections"] = [{"name": "Sam"}]; store.save("circle", c)
    k = store.load("knowledge"); k["domains"] = [{"name": "Rust"}]; store.save("knowledge", k)


def test_disabled_section_omitted_from_full_context(as_user):
    _seed(as_user)
    ss.set_disabled_sections(["circle"])
    ctx = json.loads(server.get_context.fn(scope="full"))["context"]
    assert "circle" not in ctx
    assert "knowledge" in ctx  # not disabled


def test_disabled_section_omitted_from_personal_scope(as_user):
    _seed(as_user)
    ss.set_disabled_sections(["circle"])
    ctx = json.loads(server.get_context.fn(scope="personal"))["context"]
    assert "circle" not in ctx


def test_section_scope_of_disabled_section_errors(as_user):
    ss.set_disabled_sections(["circle"])
    out = json.loads(server.get_context.fn(scope="circle"))
    assert "error" in out
    assert "circle" in out["error"]


def test_always_on_section_never_omitted_even_if_in_disabled_blob(as_user):
    ss.set_disabled_sections(["profile"])  # bypasses API validation on purpose
    ctx = json.loads(server.get_context.fn(scope="full"))["context"]
    assert "profile" in ctx
