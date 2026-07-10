"""Tests for the basic_info update-only singleton (top-level profile scalars)."""
import server

# `as_user` fixture is provided by tests/conftest.py.
# persona_modify is registered as a FastMCP FunctionTool; `.fn` is the raw callable.
persona_modify = server.persona_modify.fn


def test_update_single_field_leaves_others_untouched(as_user):
    persona_modify(action="update", entity="basic_info",
                   data={"name": "Khant Thura"})
    result = persona_modify(action="update", entity="basic_info",
                            data={"bio": "Final-year IT student."})
    assert result.startswith("✅")
    profile = server.load_json("profile.json")
    assert profile["bio"] == "Final-year IT student."
    assert profile["name"] == "Khant Thura"  # untouched by the second update


def test_update_multiple_fields_at_once(as_user):
    result = persona_modify(action="update", entity="basic_info",
                            data={"location": "Newcastle upon Tyne, UK",
                                  "current_role": "IT Consultant"})
    assert result.startswith("✅")
    assert "location" in result and "current_role" in result
    profile = server.load_json("profile.json")
    assert profile["location"] == "Newcastle upon Tyne, UK"
    assert profile["current_role"] == "IT Consultant"


def test_update_with_no_known_field_errors(as_user):
    result = persona_modify(action="update", entity="basic_info", data={})
    assert result.startswith("❌")
    result = persona_modify(action="update", entity="basic_info",
                            data={"unknown_field": "x"})
    assert result.startswith("❌")


def test_non_update_action_errors(as_user):
    result = persona_modify(action="add", entity="basic_info",
                            data={"name": "X"})
    assert result.startswith("❌")
    result = persona_modify(action="remove", entity="basic_info",
                            data={"name": "X"})
    assert result.startswith("❌")


def test_alias_fields_do_not_leak_into_name(as_user):
    # normalize_data must NOT inject a phantom "name" from generic aliases
    # (title/label/value/item) for basic_info.
    result = persona_modify(action="update", entity="basic_info",
                            data={"title": "should not become name"})
    assert result.startswith("❌")
    profile = server.load_json("profile.json")
    assert profile.get("name", "") == ""
