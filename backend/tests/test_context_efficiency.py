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
        # media/aesthetics are default-off (opt-in); a fresh as_user has no
        # opt-ins, so "full" excludes them same as any other disabled pack.
        return set(store.VALID_FILES) - {"media", "aesthetics"}
    return _EXPECTED_FILES_BY_SCOPE[scope]


def test_scopes_return_stable_shape(as_user):
    _seed()
    for scope in ALL_SCOPES:
        out = json.loads(get_context(scope=scope))
        # `not_in_this_scope` and `advisories` depend on what is seeded and
        # indexed, so the shape is required-plus-optional rather than exact.
        required = {"scope", "scope_description", "topic_filter", "context", "note"}
        optional = {"not_in_this_scope", "advisories"}
        assert required <= set(out.keys()) <= required | optional
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
        # `aesthetics` joined minimal in wave 6 and, like media/aesthetics on
        # "personal" below, lands after the legacy tuple. It contributes only
        # the ONE entry marked `primary` -- see the aesthetics hook in
        # get_scoped_context -- so minimal stays small.
        "minimal": ["preferences", "profile", "goals", "projects", "aesthetics"],
        "professional": ["preferences", "profile", "goals", "knowledge", "projects"],
        # media/aesthetics contribute to "personal" too but post-date the
        # legacy _CONTEXT_FILE_ORDER tuple, so they land after it (in
        # registry position order) rather than interleaved with it.
        "personal": ["preferences", "profile", "goals", "lifestyle", "knowledge", "circle",
                     "media", "aesthetics"],
        "learning": ["preferences", "profile", "goals", "knowledge", "projects", "learning_log"],
    }
    for scope, keys in expected.items():
        assert list(server._resolve_scope_fields(scope).keys()) == keys


# `test_token_estimate_reflects_returned_payload` lived here. The field it
# asserted about is gone -- see tests/test_context_footer.py for what replaced
# it, and the design spec's section 4 for why.


# ---------------------------------------------------------------------------
# The aesthetics hook: a user's design language reaches an AI client at
# conversation start, without the whole styles list riding along.
# ---------------------------------------------------------------------------


def _styles(*entries):
    import settings_store
    settings_store.set_enabled_optins(["aesthetics"])
    from persona_store import save
    save("aesthetics", {"styles": list(entries)})


def test_minimal_carries_only_the_primary_style(as_user):
    _styles(
        {"name": "Playful Editorial", "notes": "the governing one", "primary": True},
        {"name": "Brutalist", "notes": "just liked"},
    )
    styles = server.get_scoped_context("minimal")["context"]["aesthetics"]["styles"]
    assert [s["name"] for s in styles] == ["Playful Editorial"]
    assert styles[0]["notes"] == "the governing one"


def test_minimal_omits_aesthetics_entirely_when_nothing_is_primary(as_user):
    """Absent is a truthful answer to "what is your design language". Picking
    an arbitrary first entry would be a guess."""
    _styles({"name": "Brutalist", "notes": "just liked"})
    assert "aesthetics" not in server.get_scoped_context("minimal")["context"]


def test_a_full_aesthetics_scope_still_returns_every_style(as_user):
    _styles(
        {"name": "Playful Editorial", "primary": True},
        {"name": "Brutalist"},
    )
    for scope in ("aesthetics", "personal", "full"):
        styles = server.get_scoped_context(scope)["context"]["aesthetics"]["styles"]
        assert len(styles) == 2, f"{scope} should not be reduced"


def test_a_disabled_aesthetics_section_contributes_nothing_to_minimal(as_user):
    import settings_store
    settings_store.set_enabled_optins([])
    assert "aesthetics" not in server.get_scoped_context("minimal")["context"]
