import json
import pytest
import server
import persona_store as store

get_context = server.get_context.fn

ALL_SCOPES = ("minimal", "professional", "personal", "learning", "full")


def _seed():
    store.save("profile", {**store.DEFAULTS["profile"], "name": "A", "preferred_name": "B"})
    store.save("projects", {**store.DEFAULTS["projects"], "top_of_mind": [{"topic": "x"}]})


def _expected_filetypes(scope: str) -> set[str]:
    """Bare file-type names a scope should load, derived from config."""
    fields = server.CONTEXT_SCOPES[scope]["fields"]
    if fields == "all":
        return set(store.VALID_FILES)
    return set(fields.keys())


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


def test_token_estimate_reflects_returned_payload(as_user):
    store.save("profile", {**store.DEFAULTS["profile"], "name": "A", "bio": "x"*400})
    raw = server.get_context.fn(scope="full")          # exact string the caller receives
    est = json.loads(raw)["token_estimate"]
    actual = len(raw) // 4
    assert abs(est - actual) <= max(10, int(actual * 0.10)), (est, actual)
