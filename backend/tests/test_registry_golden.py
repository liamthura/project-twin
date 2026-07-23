"""Golden snapshot guard for the pack-loader refactor (Phase 1).

Pins the exact section registry and entity schema as they were BEFORE the
refactor. Every refactor task must keep this green. If this test fails, the
refactor changed behavior — fix the refactor, never the fixture.
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
    golden = json.loads(FIXTURE.read_text())
    assert server.ENTITY_SCHEMA == golden["entity_schema"]
