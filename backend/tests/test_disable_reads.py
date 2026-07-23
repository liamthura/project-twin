import json

import server
import settings_store as ss


def test_get_raw_disabled_file_errors(as_user):
    ss.set_disabled_sections(["circle"])
    out = server.get_raw.fn(file="circle")
    assert out.startswith("❌")
    assert "disabled" in out.lower()


def test_get_raw_all_excludes_disabled(as_user):
    ss.set_disabled_sections(["circle"])
    data = json.loads(server.get_raw.fn(file="all"))
    assert "circle" not in data
    assert "knowledge" in data


def test_get_raw_always_on_still_readable(as_user):
    ss.set_disabled_sections(["profile"])  # bypasses validation on purpose
    data = json.loads(server.get_raw.fn(file="profile"))
    assert isinstance(data, dict)  # not an error string


def test_get_schema_omits_disabled_section_entities(as_user):
    ss.set_disabled_sections(["circle"])
    digest = json.loads(server.get_schema.fn())
    assert "circle" not in digest["files"]
    assert "knowledge" in digest["files"]


def test_get_schema_entity_lookup_of_disabled_section_errors(as_user):
    ss.set_disabled_sections(["circle"])
    out = json.loads(server.get_schema.fn(entity="connection"))  # connection lives in circle
    assert "error" in out
