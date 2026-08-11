"""The converter is only correct if the schema derived from its output equals the
schema authored today. That is the entire safety argument, so it is asserted per
pack, before a single manifest is committed in the new shape.

`_template` is excluded from the contract gate: its `key` is `example`, and
`load_packs` skips any directory starting with `_`, so it has no frozen entry and
ships no entity to anyone. It is still required to convert, validate and be
idempotent -- Task 11 rewrites it by hand afterwards.
"""
import json
from pathlib import Path

import pack_loader
from tools.manifest_v1_to_v2 import convert

PACKS = Path(pack_loader.PACKS_DIR)
FROZEN = json.loads((Path(__file__).parent / "fixtures" / "entity_schema_v1.json").read_text())
ORDERLESS = ("required", "optional")


def _v1_manifests():
    for d in sorted(p for p in PACKS.iterdir() if p.is_dir()):
        yield json.loads((d / "manifest.json").read_text())


def _derive(v2, key):
    # `derive_entities`, not `build_entity_schema`: the latter still reads the
    # authored `entities` block and is not swapped over until Task 6. The gate
    # cannot wait for that -- it is what proves the swap safe -- so Task 4 owns
    # both halves of the claim, the converter and the derivation.
    return pack_loader.derive_entities(v2)


def _walk_fields(v2):
    """Yield (node_label, field) for every field descriptor anywhere in the tree."""

    def element_fields(item, label):
        for field in item.get("fields", []):
            yield label, field
            if "element" in field:
                yield from element_fields(field["element"], f"{label} > {field['name']}")

    def visit(nodes, trail):
        for node in nodes:
            label = f"{trail}{node.get('title') or '.'.join(node.get('path') or [])}"
            if node["kind"] == "group":
                yield from visit(node["sections"], f"{label} > ")
            elif node["kind"] == "fields":
                yield from element_fields(node, label)
            elif node["kind"] == "list":
                yield from element_fields(node["element"], label)

    yield from visit(v2["sections"], "")


def test_every_pack_converts_to_the_same_contract():
    for v1 in _v1_manifests():
        key = v1["key"]
        if key not in FROZEN:  # _template
            continue
        derived = _derive(convert(v1), key)
        expected = FROZEN[key]
        assert set(derived) == set(expected), (
            f"{key}: entity set changed -- missing {sorted(set(expected) - set(derived))}, "
            f"extra {sorted(set(derived) - set(expected))}"
        )
        for name, want in expected.items():
            got = derived[name]
            assert set(got) == set(want), (
                f"{key}.{name}: key set changed -- missing "
                f"{sorted(set(want) - set(got))}, extra {sorted(set(got) - set(want))}"
            )
            for k, v in want.items():
                if k in ORDERLESS:
                    assert set(got[k]) == set(v), f"{key}.{name}.{k}: {got[k]} != {v}"
                else:
                    assert got[k] == v, f"{key}.{name}.{k}: {got[k]!r} != {v!r}"


def test_conversion_is_idempotent_and_deterministic():
    # Re-running the converter in CI must not produce a diff, or "generated
    # output" stops being a reviewable claim.
    for v1 in _v1_manifests():
        assert convert(v1) == convert(v1)


def test_output_validates_against_the_v2_schema():
    for v1 in _v1_manifests():
        pack_loader.validate_manifest_v2(convert(v1))  # raises on failure


def test_no_field_is_invented_from_the_entity_vocabulary_alone():
    """The declared-but-unrendered names must not become visible fields."""
    MCP_ONLY = {
        "conversation_metadata",
        "related_entries",
        "day_type",
        "new_topic",
        "new_label",
        "ref_name",
        "course",
        "custom_type",
    }
    for v1 in _v1_manifests():
        v2 = convert(v1)
        for node, field in _walk_fields(v2):
            if field["name"] in MCP_ONLY:
                assert field.get("write_only") or field.get("alias"), (
                    f"{v2['key']}/{node}: {field['name']} would render"
                )


def test_the_rendered_field_census_is_unchanged():
    """The other half of Task 1's freeze: the same field names, in the same nodes.

    The contract gate above compares what MCP sees. This compares what the app
    draws -- and it is the one that would catch a converter that satisfied the
    contract by putting a control on screen for an MCP-only name.
    """
    frozen = json.loads(
        (Path(__file__).parent.parent.parent / "frontend/src/__fixtures__/field-census-v1.json")
        .read_text()
    )
    for v1 in _v1_manifests():
        key = v1["key"]
        if key not in frozen:  # _template
            continue
        v2 = convert(v1)
        names = [n for names in frozen[key].values() for n in names]
        for node, field in _walk_fields(v2):
            if _census_cannot_see(field):
                continue
            assert field["name"] in names or field.get("alias"), (
                f"{key}/{node}: '{field['name']}' renders but was in no node before"
            )


def _census_cannot_see(field):
    """Three kinds of field the frozen census could not have recorded, by
    construction -- so their absence from it proves nothing.

    1. `write_only`: never rendered, so never in a census of rendered fields.
    2. `pin`: `fieldCensus.fieldsOf` reads the seven display arrays and v1 kept a
       pinned field out of every one of them -- the star that claims the slot was
       drawn by the renderer from `pinned.field`, which the census never looks at.
    3. An array that was a v1 CHILD NODE. The census recorded those as their own
       entries keyed by title (`entries > Key Decisions`) with an empty field list,
       because a `strings` node has no field descriptors. As a v2 field the same
       array is named by its stored key, which appears nowhere in the census.

    The frontend covers what is left of case 3: Phase A regenerates packs.json from
    the converted manifests and 810 tests render the real shapes unchanged.
    """
    return (
        field.get("write_only")
        or "pin" in field
        or field.get("type") in ("strings", "list")
    )
