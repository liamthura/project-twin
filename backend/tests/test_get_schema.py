"""Tests for the smarter get_schema MCP tool: lean digest + drill-down."""
import json

import pytest

import server

get_schema = server.get_schema.fn


@pytest.fixture(autouse=True)
def _bind_user(as_user):
    # get_schema now consults settings_store.enabled_sections(), which needs
    # a per-request user; bind one for every test in this file.
    pass


def _call(**kwargs):
    return json.loads(get_schema(**kwargs))


# --- No-arg digest -----------------------------------------------------------

def test_no_arg_returns_usage_and_files():
    result = _call()
    assert "usage" in result
    assert "files" in result
    # files maps file -> list of entity digest lines
    assert isinstance(result["files"], dict)
    assert "lifestyle" in result["files"]


def test_usage_block_has_guidance():
    usage = _call()["usage"]
    assert "ids_automatic" in usage
    assert "id" in usage["ids_automatic"].lower()
    assert "identifying" in usage
    assert "identifier" in usage["identifying"].lower()
    assert "workflow" in usage
    assert "nested" in usage


def test_digest_entry_is_lean():
    files = _call()["files"]
    hobby = next(e for e in files["lifestyle"] if e["entity"] == "hobby")
    assert hobby["identifier"] == "name"
    assert "required" in hobby
    assert "actions" in hobby
    # lean: no optional / valid_values in the digest line
    assert "optional" not in hobby
    assert "valid_values" not in hobby


# --- Entity drill-down -------------------------------------------------------

def test_entity_detail_includes_examples_and_optional():
    result = _call(entity="hobby")
    assert result["entity"] == "hobby"
    assert result["file"] == "lifestyle"
    assert result["identifier"] == "name"
    assert "optional" in result
    assert "examples" in result
    add = result["examples"]["add"]
    assert add["action"] == "add"
    assert add["entity"] == "hobby"
    # add example's data carries the identifier
    assert "name" in add["data"]
    # hobby supports remove
    assert "remove" in result["examples"]
    assert "name" in result["examples"]["remove"]["data"]


def test_identifier_correctness_spread():
    assert _call(entity="hobby")["identifier"] == "name"
    assert _call(entity="curiosity")["identifier"] == "topic"
    assert _call(entity="mental_tab")["identifier"] == "title"
    assert _call(entity="learning_entry")["identifier"] == "topic"
    assert _call(entity="goal")["identifier"] == "title"
    assert _call(entity="connection")["identifier"] == "name"


def test_learning_entry_advertises_full_crud():
    result = _call(entity="learning_entry")
    assert result["actions"] == ["add", "update", "remove"]
    assert result["identifier"] == "topic"
    assert {"new_topic", "related_entries"} <= set(result["optional"])
    assert set(result["examples"].keys()) == {"add", "update", "remove"}
    # update example identifies by topic, not id
    assert "topic" in result["examples"]["update"]["data"]
    assert "id" not in result["examples"]["update"]["data"]


def test_null_identifier_update_only_entity():
    # communication_default is an update-only singleton with no identifier.
    result = _call(entity="communication_default")
    assert result["identifier"] is None
    assert set(result["examples"].keys()) == {"update"}
    update_data = result["examples"]["update"]["data"]
    assert update_data  # must not be an empty {} example
    assert isinstance(update_data, dict)


def test_sleep_update_only_with_required_key():
    # sleep is update-only, keyed by day_type.
    result = _call(entity="sleep")
    assert set(result["examples"].keys()) == {"update"}
    assert "day_type" in result["examples"]["update"]["data"]


def test_nested_entity_has_parent():
    ph = _call(entity="project_highlight")
    assert ph["identifier"] == "highlight"
    assert ph["parent"] == "project_name"
    # add example includes both parent and identifier
    add_data = ph["examples"]["add"]["data"]
    assert "project_name" in add_data
    assert "highlight" in add_data


def test_nested_entity_shown_in_digest_with_parent():
    files = _call()["files"]
    ph = next(e for e in files["projects"] if e["entity"] == "project_highlight")
    assert ph["parent"] == "project_name"
    assert ph["identifier"] == "highlight"


# --- File scoping ------------------------------------------------------------

def test_file_scope_lists_only_that_file():
    result = _call(file="lifestyle")
    assert "usage" in result
    assert "files" in result
    assert set(result["files"].keys()) == {"lifestyle"}
    entities = {e["entity"] for e in result["files"]["lifestyle"]}
    assert "hobby" in entities
    # an entity from another file should not appear
    assert "project" not in entities


# --- Error handling ----------------------------------------------------------

def test_unknown_entity_returns_error():
    result = _call(entity="does_not_exist")
    assert "error" in result


def test_unknown_file_returns_error():
    result = _call(file="does_not_exist")
    assert "error" in result


def test_basic_info_is_update_only_singleton():
    # basic_info mirrors communication_default: update-only, no identifier.
    result = _call(entity="basic_info")
    assert result["file"] == "profile"
    assert result["actions"] == ["update"]
    assert result["identifier"] is None
    assert set(result["optional"]) == {
        "name", "preferred_name", "current_role", "organisation",
        "location", "nationality", "bio",
    }
    assert set(result["examples"].keys()) == {"update"}
    assert result["examples"]["update"]["data"]  # non-empty example data
