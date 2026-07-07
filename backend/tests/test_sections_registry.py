import persona_store as store
import server
from sections import SECTION_REGISTRY, SCOPES, SectionSpec


def test_registry_keys_match_valid_files():
    assert set(SECTION_REGISTRY) == set(store.VALID_FILES)


def test_every_entry_is_a_sectionspec_keyed_by_its_own_key():
    for key, spec in SECTION_REGISTRY.items():
        assert isinstance(spec, SectionSpec)
        assert spec.key == key


def test_defaults_match_persona_store():
    assert {k: s.default for k, s in SECTION_REGISTRY.items()} == store.DEFAULTS


def test_id_lists_match_persona_store():
    # Registry stores tuples; persona_store stores lists of tuples. Compare as
    # {file: [(list_key, prefix), ...]} with list() coercion.
    registry_id_lists = {
        k: [tuple(pair) for pair in s.id_lists]
        for k, s in SECTION_REGISTRY.items()
        if s.id_lists
    }
    expected = {k: [tuple(p) for p in v] for k, v in store.ID_LISTS.items()}
    assert registry_id_lists == expected


def test_scope_descriptions_match_context_scopes():
    assert SCOPES == {k: v["description"] for k, v in server.CONTEXT_SCOPES.items()}


def test_context_fields_reconstruct_context_scopes():
    # For each non-"full" scope, rebuilding {file: fields} from the registry's
    # per-section context_fields must equal the old CONTEXT_SCOPES fields dict.
    for scope, cfg in server.CONTEXT_SCOPES.items():
        if cfg["fields"] == "all":
            continue
        rebuilt = {
            spec.key: spec.context_fields[scope]
            for spec in SECTION_REGISTRY.values()
            if scope in spec.context_fields
        }
        assert rebuilt == cfg["fields"], f"scope {scope} mismatch"


def test_full_scope_is_metadata_only():
    # "full" is a scope name with a description but no per-section field lists.
    assert "full" in SCOPES
    assert all("full" not in s.context_fields for s in SECTION_REGISTRY.values())
