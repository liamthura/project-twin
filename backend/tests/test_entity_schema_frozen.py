"""The contract MCP clients see, frozen before the format changed under it.

`build_entity_schema` copies today and computes after the v2 migration. This is
the reference for that change: `required` and `optional` compare as SETS (the
shipped packs already disagree with themselves on order -- communication_default
lists tone/locale/detail_level in the ui block and tone/detail_level/locale in
the entity -- so no order is authoritative), everything else compares exactly.

The frozen file holds 42 entities across 10 packs, which is every pack
`load_packs` ships. `_template` is not among them: it declares one entity
(`example_item`), but pack_loader.py:93 skips any directory whose name starts
with `_`, so it never reaches a client. Counting the directory listing gives 43
across 11 -- that number describes the filesystem, not the contract.

Weakening this test is never the right fix. It is the whole safety argument for
deriving a schema that used to be copied.
"""
import json
from pathlib import Path

import pack_loader

FROZEN = json.loads((Path(__file__).parent / "fixtures" / "entity_schema_v1.json").read_text())
ORDERLESS = ("required", "optional")


def test_every_pack_and_entity_still_present():
    derived = pack_loader.build_entity_schema(pack_loader.manifests())
    assert set(derived) == set(FROZEN)
    for pack in FROZEN:
        assert set(derived[pack]) == set(FROZEN[pack]), pack


def test_every_entity_matches_field_for_field():
    derived = pack_loader.build_entity_schema(pack_loader.manifests())
    for pack, entities in FROZEN.items():
        for name, expected in entities.items():
            actual = derived[pack][name]
            assert set(actual) == set(expected), f"{pack}.{name}: key set changed"
            for key, value in expected.items():
                if key in ORDERLESS:
                    assert set(actual[key]) == set(value), f"{pack}.{name}.{key}"
                else:
                    assert actual[key] == value, f"{pack}.{name}.{key}"
