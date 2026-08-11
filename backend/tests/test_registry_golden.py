"""Golden snapshot guard for the pack-loader refactor (Phase 1).

Pins the exact section registry and entity schema as they were BEFORE the
refactor. Every refactor task must keep this green. If this test fails, the
refactor changed behavior — fix the refactor, never the fixture.

The one thing that legitimately moves this fixture is a DELIBERATE change to
the tool contract, which is not a refactor and must be argued for on its own.
That has happened twice.

Wave 6 corrected `profile`'s vocabulary, which declared seven field names
nothing stored (`language.proficiency`, `email.label`,
`education.degree`/`field`/`period`) and omitted seven that were stored. Values
sent under the phantoms were discarded on arrival, and `email.add` demanded a
`purpose` the contract never mentioned, so no MCP client could add an email.
See docs/superpowers/plans/2026-07-29-wave-6-storage-keys-reference.md.

Wave 8 moved four more, all found by the stored-key audit
(tests/test_stored_key_audit.py). Three had a `required` that did not match what
their branch demands -- `profile.language` (name AND fluency),
`profile.work_experience` (role/company/type/period), `projects.project` (name
AND description) -- so a client following `get_schema` got a rejection it could
not predict. The fourth, `circle.connection`, listed `contact` in `optional` as
though it were storable; it is an input spelling for `name`.

Wave 7 moved four entities, each closing a recorded follow-up: `profile.link`
gained `update` (and `new_label`, since `label` identifies the row);
`preferences.like`/`dislike` gained `stance`, the key that decides which entity
a row IS and which was in neither entity's `required` nor `optional`; and
`lifestyle.stress_trigger` is new, for a stored key that had a UI node but no
MCP write path at all. Nothing else in the schema moved -- the diff was checked
entity by entity before this fixture was regenerated.

Before editing this fixture, diff `server.ENTITY_SCHEMA` against it and confirm
every changed entity is one you meant to change. A refactor that quietly widens
the diff is exactly what this file exists to catch.
"""
import json
from pathlib import Path

import sections
import server

FIXTURE = Path(__file__).parent / "fixtures" / "registry_golden.json"


def _norm_spec(spec):
    return {
        "key": spec.key,
        "default": spec.default,
        "id_lists": [list(t) for t in spec.id_lists],
        "context_fields": spec.context_fields,
    }


def test_section_registry_matches_golden():
    golden = json.loads(FIXTURE.read_text())
    assert list(sections.SECTION_REGISTRY) == golden["section_order"]
    assert sorted(sections.ALWAYS_ON_SECTIONS) == golden["always_on_sections"]
    current = {k: _norm_spec(v) for k, v in sections.SECTION_REGISTRY.items()}
    assert current == golden["section_registry"]


def test_entity_schema_matches_golden():
    """Every entity, key for key, against the snapshot taken before Phase 1.

    `required` and `optional` compare as SETS. Format v2 derives them from the
    field list rather than carrying them as authored arrays, and the field list
    is ordered for the screen -- form controls first, then the row's chips -- so
    the arrays come out in a different order for ten entities. Both are unordered
    to every reader: `server.py` membership-tests them, and `get_schema` hands
    them to a client as "these are the names". The spec records this as the one
    accepted difference of the migration, and `test_entity_schema_frozen.py`
    compares them the same way for the same reason. Everything else is exact.
    """
    golden = json.loads(FIXTURE.read_text())["entity_schema"]
    live = server.ENTITY_SCHEMA
    assert set(live) == set(golden)
    for pack, entities in golden.items():
        assert set(live[pack]) == set(entities), f"{pack}: entity set changed"
        for name, spec in entities.items():
            got = live[pack][name]
            assert set(got) == set(spec), f"{pack}.{name}: key set changed"
            for key, value in spec.items():
                if key in ("required", "optional"):
                    assert set(got[key]) == set(value), f"{pack}.{name}.{key}"
                else:
                    assert got[key] == value, f"{pack}.{name}.{key}"
