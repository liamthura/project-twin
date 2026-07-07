import persona_store as store
import server
from sections import SECTION_REGISTRY, SCOPES, SectionSpec


def test_every_entry_is_a_sectionspec_keyed_by_its_own_key():
    for key, spec in SECTION_REGISTRY.items():
        assert isinstance(spec, SectionSpec)
        assert spec.key == key


def test_full_scope_is_metadata_only():
    # "full" is a scope name with a description but no per-section field lists.
    assert "full" in SCOPES
    assert all("full" not in s.context_fields for s in SECTION_REGISTRY.values())
