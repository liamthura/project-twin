import copy
import persona_store as store
from sections import SECTION_REGISTRY


def test_load_returns_default_when_empty_and_does_not_mutate_registry(as_user):
    # Loading a never-saved file returns its default...
    loaded = store.load("circle")
    assert loaded == SECTION_REGISTRY["circle"].default
    # ...and mutating the returned object must NOT corrupt the registry default.
    loaded["connections"].append({"name": "Mutant"})
    assert SECTION_REGISTRY["circle"].default["connections"] == []


def test_reset_does_not_inject_ids_into_registry_default(as_user):
    # reset() saves the default, which runs _assign_ids. That must not add ids
    # to the shared registry default (the pre-fix bug: reset() mutated DEFAULTS).
    store.reset("lifestyle")
    assert all("id" not in h for h in SECTION_REGISTRY["lifestyle"].default["hobbies"])
    # Baseline default has no hobbies, so this also asserts it stayed empty:
    assert SECTION_REGISTRY["lifestyle"].default["hobbies"] == []
