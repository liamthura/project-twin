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


import json as _json


def _write_pack(root, key, mutate=None, dirname=None):
    m = copy.deepcopy(MINIMAL)
    m["key"] = key
    m["entities"] = {
        f"{key}_item": {
            "actions": ["add", "remove"],
            "required": ["name"],
            "optional": [],
            "identifier": "name",
        }
    }
    m["id_lists"] = [["items", key]]
    if mutate:
        mutate(m)
    d = root / (dirname or key)
    d.mkdir()
    (d / "manifest.json").write_text(_json.dumps(m))
    return m


def test_load_packs_loads_and_orders(tmp_path):
    _write_pack(tmp_path, "bbb", mutate=lambda m: m.update(position=20))
    _write_pack(tmp_path, "aaa", mutate=lambda m: m.update(position=10))
    packs = pack_loader.load_packs(tmp_path)
    assert list(packs) == ["aaa", "bbb"]


def test_load_packs_skips_invalid_manifest_with_warning(tmp_path, caplog):
    _write_pack(tmp_path, "good")
    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    (bad_dir / "manifest.json").write_text("{not json")
    with caplog.at_level("WARNING"):
        packs = pack_loader.load_packs(tmp_path)
    assert list(packs) == ["good"]
    assert any("bad" in r.message for r in caplog.records)


def test_load_packs_skips_underscore_dirs(tmp_path):
    _write_pack(tmp_path, "real")
    _write_pack(tmp_path, "template", dirname="_template")
    assert list(pack_loader.load_packs(tmp_path)) == ["real"]


def test_load_packs_skips_key_dir_mismatch(tmp_path, caplog):
    _write_pack(tmp_path, "sneaky", dirname="honest")
    with caplog.at_level("WARNING"):
        packs = pack_loader.load_packs(tmp_path)
    assert packs == {}


def test_load_packs_raises_on_entity_collision(tmp_path):
    _write_pack(tmp_path, "one")
    _write_pack(tmp_path, "two",
                mutate=lambda m: m["entities"].update({"one_item": m["entities"]["two_item"]}))
    with pytest.raises(pack_loader.PackError, match="one_item"):
        pack_loader.load_packs(tmp_path)


def test_load_packs_raises_on_prefix_collision(tmp_path):
    _write_pack(tmp_path, "one")
    _write_pack(tmp_path, "two", mutate=lambda m: m.update(id_lists=[["items", "one"]]))
    with pytest.raises(pack_loader.PackError, match="prefix"):
        pack_loader.load_packs(tmp_path)


def test_manifests_is_cached(tmp_path, monkeypatch):
    calls = []
    real = pack_loader.load_packs

    def counting(packs_dir=pack_loader.PACKS_DIR):
        calls.append(1)
        return real(packs_dir)

    monkeypatch.setattr(pack_loader, "load_packs", counting)
    pack_loader._reset_cache()
    pack_loader.manifests()
    pack_loader.manifests()
    assert len(calls) == 1
    pack_loader._reset_cache()


def test_core_manifests_reproduce_legacy_registry():
    """While sections.py/server.py are still hardcoded, the generated
    manifests must reproduce them exactly. After Tasks 5-6 flip those
    modules onto the loader, this becomes a tautology and the golden
    test carries the guarantee instead."""
    import sections
    import server

    packs = pack_loader.load_packs()
    assert list(packs) == list(sections.SECTION_REGISTRY)
    for key, spec in sections.SECTION_REGISTRY.items():
        m = packs[key]
        assert m["defaults"] == spec.default, key
        assert [tuple(t) for t in m["id_lists"]] == list(spec.id_lists), key
        assert m.get("scope_contributions", {}) == spec.context_fields, key
    assert pack_loader.build_entity_schema(packs) == server.ENTITY_SCHEMA
    core = {k for k, m in packs.items() if m["core"]}
    assert core == set(sections.ALWAYS_ON_SECTIONS)
