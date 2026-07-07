import json
import server
from sections import SECTION_REGISTRY, ALWAYS_ON


def _pref_fields():
    return set(ALWAYS_ON["preferences"])


def test_section_scope_returns_its_whole_section(as_user):
    fields = server._resolve_scope_fields("lifestyle")
    assert set(fields["lifestyle"]) == set(SECTION_REGISTRY["lifestyle"].default.keys())


def test_section_scope_includes_always_on_preferences(as_user):
    fields = server._resolve_scope_fields("circle")
    assert set(fields["preferences"]) == _pref_fields()
    assert set(fields["circle"]) == {"connections"}


def test_section_scope_has_no_other_sections(as_user):
    fields = server._resolve_scope_fields("circle")
    assert set(fields.keys()) == {"circle", "preferences"}


def test_global_scope_output_unchanged_after_always_on(as_user):
    # professional still yields the same preferences fields via ALWAYS_ON.
    fields = server._resolve_scope_fields("professional")
    assert set(fields["preferences"]) == _pref_fields()


def test_preferences_section_scope_uses_canonical_always_on_order(as_user):
    prefs = server._resolve_scope_fields("preferences")["preferences"]
    assert list(prefs) == ["code_style", "learning_style", "communication", "dislikes"]
    assert len(prefs) == len(set(prefs))  # no duplicate fields


def test_get_context_accepts_a_section_scope(as_user):
    import persona_store as store
    p = store.load("circle")
    p["connections"] = [{"name": "Sam"}]
    store.save("circle", p)
    ctx = json.loads(server.get_context.fn(scope="circle"))["context"]
    assert "circle" in ctx and "preferences" in ctx


def test_unknown_scope_lists_valid_names(as_user):
    out = json.loads(server.get_context.fn(scope="nope"))
    assert "error" in out
    assert "lifestyle" in out["error"]  # section names are advertised too
