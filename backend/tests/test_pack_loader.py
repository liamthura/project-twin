import copy

import pytest

import pack_loader

MINIMAL = {
    "key": "demo",
    "title": "Demo",
    "description": "A demo pack",
    "core": False,
    "position": 99,
    "defaults": {"items": []},
    "id_lists": [["items", "demo"]],
    "entities": {
        "demo_item": {
            "actions": ["add", "remove"],
            "required": ["name"],
            "optional": ["notes"],
            "identifier": "name",
        }
    },
}


def test_validate_accepts_minimal_manifest():
    pack_loader.validate_manifest(copy.deepcopy(MINIMAL))  # must not raise


def test_validate_rejects_missing_required_field():
    bad = copy.deepcopy(MINIMAL)
    del bad["defaults"]
    with pytest.raises(pack_loader.PackError, match="defaults"):
        pack_loader.validate_manifest(bad)


def test_validate_rejects_unknown_action():
    bad = copy.deepcopy(MINIMAL)
    bad["entities"]["demo_item"]["actions"] = ["add", "obliterate"]
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(bad)


def test_validate_rejects_extra_top_level_key():
    bad = copy.deepcopy(MINIMAL)
    bad["surprise"] = True
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(bad)
