import pytest

import scopes

# Pure logic -- nothing here reads or writes a persona, so the per-test row
# wipe in conftest is dead weight. The marker only skips cleanup; it can
# never make a test wrong, only slower to forget.
pytestmark = pytest.mark.nodb


def test_write_implies_propose_and_read():
    granted = scopes.expand([scopes.WRITE])
    assert granted == {scopes.WRITE, scopes.PROPOSE, scopes.READ}


def test_propose_implies_read_but_not_write():
    granted = scopes.expand([scopes.PROPOSE])
    assert granted == {scopes.PROPOSE, scopes.READ}
    assert not scopes.has(granted, scopes.WRITE)


def test_read_implies_only_itself():
    assert scopes.expand([scopes.READ]) == {scopes.READ}


def test_unknown_scopes_are_dropped():
    """openid and offline_access are granted by the AS but mean nothing here."""
    assert scopes.expand(["openid", "offline_access", scopes.READ]) == {scopes.READ}


def test_expand_handles_empty():
    assert scopes.expand([]) == frozenset()


def test_method_maps_get_to_read_and_everything_else_to_write():
    assert scopes.scope_for_method("GET") == scopes.READ
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert scopes.scope_for_method(method) == scopes.WRITE


def test_every_mcp_tool_has_a_scope():
    expected = {
        "get_context": scopes.READ,
        "get_raw": scopes.READ,
        "search_context": scopes.READ,
        "get_entity": scopes.READ,
        "get_schema": scopes.READ,
        "whoami": scopes.READ,
        "propose_update": scopes.PROPOSE,
        "persona_modify": scopes.WRITE,
        "persona_batch": scopes.WRITE,
    }
    assert scopes.TOOL_SCOPES == expected


def test_current_scopes_has_no_default():
    """Fail closed: an unauthenticated code path must raise, not pass."""
    with pytest.raises(LookupError):
        scopes.current_scopes.get()
