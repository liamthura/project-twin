"""Schema coverage for the `ui` block: meta_schema.json must give it teeth
(reject unknown kinds, reject unknown keys on a section node) while still
accepting the legacy flat map third-party packs use, and every in-repo
manifest must actually validate.

Also enforces a narrow completeness check, scoped to the generic packs only
(goals, media, aesthetics): every field a pack's `ui` node names
(`title_field`, `badges`, `detail_fields`, `array_fields`) must appear in
that entity's `required + optional`. This runs ui -> entity only. It is
deliberately NOT reversed: `goals` declares `custom_type` in `optional`
with no `ui` reference -- that's the documented `custom_*` overflow
mechanism, not an omission, and a reverse check would fail on it today for
a legitimate reason.

The reject/accept tests below build their own manifests (based on the
`goals` shape) rather than depending on what's currently on disk, so they
exercise the schema regardless of whether the real manifests have been
migrated to the explicit `ui.sections` form yet.
"""
import copy
import json

import pytest

import pack_loader

# Packs whose manifest `ui` field names happen to equal their storage keys --
# the constraint this check actually verifies (ui fields subset of
# entity.required + entity.optional) only holds for those. Later waves
# migrate sections where a node's fields deliberately diverge from the
# entity vocabulary (e.g. `projects`, `knowledge`, `profile`), and this test
# will need reworking to account for that divergence rather than those packs
# simply being left out of this list to keep it green.
GENERIC_PACKS = ["goals", "media", "aesthetics", "learning_log", "circle"]

BASE_GOALS_MANIFEST = {
    "key": "goals",
    "title": "Goals",
    "description": "What you're working toward",
    "core": False,
    "position": 15,
    "defaults": {"goals": []},
    "id_lists": [["goals", "goal"]],
    "entities": {
        "goal": {
            "actions": ["add", "update", "remove"],
            "required": ["title"],
            "optional": ["type", "custom_type", "status", "target_date", "why", "notes"],
            "identifier": "title",
        }
    },
}


def _manifest_with_ui(ui):
    m = copy.deepcopy(BASE_GOALS_MANIFEST)
    m["ui"] = ui
    return m


def _load(key):
    path = pack_loader.PACKS_DIR / key / "manifest.json"
    return json.loads(path.read_text())


def test_every_in_repo_manifest_validates():
    packs = pack_loader.load_packs()
    # load_packs() swallows invalid manifests as warnings, so assert the
    # full on-disk set was actually loaded -- a schema regression that
    # rejects a manifest would otherwise silently shrink this set.
    on_disk = [
        p.name
        for p in pack_loader.PACKS_DIR.iterdir()
        if p.is_dir() and not p.name.startswith("_") and (p / "manifest.json").exists()
    ]
    assert set(packs) == set(on_disk)
    for key, manifest in packs.items():
        pack_loader.validate_manifest(copy.deepcopy(manifest))  # must not raise


def test_unknown_kind_is_rejected():
    manifest = _manifest_with_ui(
        {"sections": [{"kind": "grid", "path": ["goals"], "entity": "goal"}]}
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_list_node_missing_path_is_rejected():
    manifest = _manifest_with_ui({"sections": [{"kind": "list", "entity": "goal"}]})
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_unknown_key_on_section_node_is_rejected():
    manifest = _manifest_with_ui(
        {
            "sections": [
                {"kind": "list", "path": ["goals"], "entity": "goal", "surprise": True}
            ]
        }
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_fields_node_with_empty_path_is_accepted():
    """The spec's mechanism for a section's top-level scalars (profile's
    name/bio/location): `kind: "fields"` with `path: []` and a `fields` list.
    Before this fix, `fields` had no schema property (rejected as an unknown
    key) and `path`'s `minItems: 1` rejected the empty path outright."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "fields",
                    "path": [],
                    "fields": ["name", "preferred_name"],
                    "long_text": ["bio"],
                }
            ]
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_fields_node_with_nonempty_path_is_accepted():
    manifest = _manifest_with_ui(
        {"sections": [{"kind": "fields", "path": ["contact"], "fields": ["email"]}]}
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_malformed_enum_is_rejected():
    """node.enum must have the same shape as entity.valid_values
    (`{field: [string, ...]}`), not bare `{"type": "object"}` -- a scalar
    value there validates and crashes EnumControl's `options.map` at
    runtime."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "entity": "goal",
                    "enum": {"stance": "love"},
                }
            ]
        }
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_well_formed_enum_is_accepted():
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "entity": "goal",
                    "enum": {"stance": ["love", "like", "avoid"]},
                }
            ]
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_legacy_flat_ui_map_is_still_accepted():
    manifest = _manifest_with_ui(
        {
            "goals": {
                "title_field": "title",
                "badges": ["type", "status"],
                "detail_fields": ["target_date", "why", "notes"],
            }
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


@pytest.mark.parametrize("key", GENERIC_PACKS)
def test_ui_fields_are_covered_by_the_entity(key):
    """ui -> entity only: every field a ui node names must exist on the
    entity it binds to. Not reversed -- see module docstring."""
    manifest = _load(key)
    entities = manifest["entities"]
    sections = manifest["ui"]["sections"]
    assert sections, f"{key}: ui.sections is empty -- nothing to check"
    for section in sections:
        entity = entities[section["entity"]]
        known = set(entity["required"]) | set(entity["optional"])
        named = set(section.get("badges", []))
        named |= set(section.get("detail_fields", []))
        named |= set(section.get("array_fields", []))
        if section.get("title_field"):
            named.add(section["title_field"])
        missing = named - known
        assert not missing, f"{key}: ui names field(s) {missing} not on entity {section['entity']}"
