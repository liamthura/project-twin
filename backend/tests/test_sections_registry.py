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


from sections import ALWAYS_ON_SECTIONS, toggleable_sections, SECTION_REGISTRY


def test_always_on_sections_are_the_core_three():
    assert ALWAYS_ON_SECTIONS == frozenset({"profile", "preferences", "learning_log"})


def test_always_on_are_real_registry_sections():
    assert ALWAYS_ON_SECTIONS <= set(SECTION_REGISTRY)


def test_toggleable_is_registry_minus_always_on():
    assert toggleable_sections() == set(SECTION_REGISTRY) - ALWAYS_ON_SECTIONS
    assert toggleable_sections() == {"knowledge", "projects", "lifestyle", "circle", "goals"}
