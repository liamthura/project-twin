import json

import pytest

import server
import persona_store as store
import settings_store

# get_raw is a FastMCP FunctionTool; `.fn` is the raw callable.
get_raw = server.get_raw.fn


@pytest.mark.parametrize("file", store.VALID_FILES)
def test_get_raw_handles_every_registry_file(as_user, file):
    # Every file in the registry-derived VALID_FILES must resolve to real JSON,
    # not the unknown-file error — proving the accepted set follows the
    # registry. media/aesthetics/inventory are default-off, so opt in first;
    # that's a settings concern, not something this accepted-set check should
    # trip on.
    settings_store.set_enabled_optins(["media", "aesthetics", "inventory"])
    out = get_raw(file=file)
    data = json.loads(out)
    assert isinstance(data, dict)


def test_get_raw_all_returns_every_registry_file(as_user):
    settings_store.set_enabled_optins(["media", "aesthetics", "inventory"])
    data = json.loads(get_raw(file="all"))
    assert set(data.keys()) == set(store.VALID_FILES)


def test_get_raw_default_is_all(as_user):
    assert json.loads(get_raw()) == json.loads(get_raw(file="all"))


def test_get_raw_unknown_file_lists_valid_files(as_user):
    out = get_raw(file="bogus")
    assert out.startswith("❌")
    assert "bogus" in out
    for ft in store.VALID_FILES:
        assert ft in out


def test_get_raw_file_param_is_not_a_hardcoded_enum():
    # The drift fix: `file` must be a plain str validated internally against the
    # registry, not a hardcoded Literal enum that can silently diverge from it.
    assert server.get_raw.fn.__annotations__["file"] is str
