import json
import pytest
import server
import persona_store as store
from sections import SECTION_REGISTRY

get_context = server.get_context.fn

ALL_SCOPES = ("minimal", "professional", "personal", "learning", "full")


def _seed():
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "A", "preferred_name": "B"})
    store.save("projects", {**SECTION_REGISTRY["projects"].default, "top_of_mind": [{"topic": "x"}]})


_EXPECTED_FILES_BY_SCOPE = {
    "minimal": {"preferences", "profile", "projects", "goals"},
    "professional": {"preferences", "profile", "knowledge", "projects", "goals"},
    "personal": {"preferences", "profile", "lifestyle", "knowledge", "circle", "goals"},
    "learning": {"preferences", "profile", "knowledge", "projects", "learning_log", "goals"},
}


def _expected_filetypes(scope: str) -> set[str]:
    """Bare file-type names a scope should load. Hardcoded (NOT derived from the
    code under test) so this characterization test can catch scope->file drift."""
    if scope == "full":
        return set(store.VALID_FILES)
    return _EXPECTED_FILES_BY_SCOPE[scope]


def test_scopes_return_stable_shape(as_user):
    _seed()
    for scope in ALL_SCOPES:
        out = json.loads(get_context(scope=scope))
        assert set(out.keys()) == {"scope", "scope_description", "topic_filter", "token_estimate", "context"}
        assert out["scope"] == scope


@pytest.mark.parametrize("scope", ALL_SCOPES)
def test_scope_touches_exactly_its_files(as_user, monkeypatch, scope):
    loaded = []
    orig = server.load_json
    monkeypatch.setattr(server, "load_json", lambda fn: loaded.append(fn) or orig(fn))
    get_context(scope=scope)
    loaded_filetypes = {fn[:-5] if fn.endswith(".json") else fn for fn in loaded}
    assert loaded_filetypes == _expected_filetypes(scope)


def test_resolve_scope_fields_matches_legacy_scopes():
    # _resolve_scope_fields must reproduce each global scope's {file: fields}
    # by merging the registry's per-section context_fields for that scope
    # with the ALWAYS_ON bundle (the preferences fields present on every
    # scope), in the same canonical order the registry defines.
    from sections import ALWAYS_ON
    for scope in ["minimal", "professional", "personal", "learning"]:
        legacy = {
            spec.key: list(spec.context_fields[scope])
            for spec in SECTION_REGISTRY.values()
            if scope in spec.context_fields
        }
        for fk, fl in ALWAYS_ON.items():
            legacy.setdefault(fk, [])
            legacy[fk] = legacy[fk] + [f for f in fl if f not in legacy[fk]]
        assert server._resolve_scope_fields(scope) == legacy


def test_resolve_scope_fields_full_is_all():
    assert server._resolve_scope_fields("full") == "all"


def test_resolve_scope_fields_preserves_legacy_key_order():
    expected = {
        "minimal": ["preferences", "profile", "goals", "projects"],
        "professional": ["preferences", "profile", "goals", "knowledge", "projects"],
        "personal": ["preferences", "profile", "goals", "lifestyle", "knowledge", "circle"],
        "learning": ["preferences", "profile", "goals", "knowledge", "projects", "learning_log"],
    }
    for scope, keys in expected.items():
        assert list(server._resolve_scope_fields(scope).keys()) == keys


def test_token_estimate_reflects_returned_payload(as_user):
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "A", "bio": "x"*400})
    raw = server.get_context.fn(scope="full")          # exact string the caller receives
    est = json.loads(raw)["token_estimate"]
    actual = len(raw) // 4
    assert abs(est - actual) <= max(10, int(actual * 0.10)), (est, actual)
