"""The one branch the inventory pack could not be declarative about.

`_generic_entity_spec` (server.py:996) returns None for any entity carrying a
`parent`, so every nested entity needs a hand-written branch and this is
inventory's. tests/test_stored_key_audit.py already drives `add` and `update`
against it generically; `remove`, the duplicate guard and the not-found paths
are only covered here.
"""
import server
import persona_store as store
import settings_store

modify = server.execute_modify


def _specs():
    # `.get`: an item only grows a `specs` key when a spec is actually
    # written, so a refused write leaves it absent rather than empty.
    return store.load("inventory")["items"][0].get("specs", [])


def _seed_item():
    """Inventory ships default-off, so nothing writes to it until it is on."""
    settings_store.set_enabled_optins(["inventory"])
    assert "✅" in modify("add", "inventory_item", {"name": "thuradev-main"})


def test_spec_round_trip(as_user):
    _seed_item()
    assert "✅" in modify("add", "inventory_spec", {
        "inventory_item_name": "thuradev-main", "name": "provider", "value": "Hetzner"})
    assert _specs() == [{"name": "provider", "value": "Hetzner"}]

    assert "✅" in modify("update", "inventory_spec", {
        "inventory_item_name": "thuradev-main", "name": "provider", "value": "Coolify"})
    assert _specs() == [{"name": "provider", "value": "Coolify"}]

    assert "✅" in modify("remove", "inventory_spec", {
        "inventory_item_name": "thuradev-main", "name": "provider"})
    assert _specs() == []


def test_a_second_spec_of_the_same_name_is_refused(as_user):
    _seed_item()
    payload = {"inventory_item_name": "thuradev-main", "name": "ram", "value": "8GB"}
    assert "✅" in modify("add", "inventory_spec", payload)
    assert "ℹ️" in modify("add", "inventory_spec", {**payload, "value": "16GB"})
    # The refusal must not have overwritten the first one, which is the whole
    # reason `add` checks rather than appending.
    assert _specs() == [{"name": "ram", "value": "8GB"}]


def test_an_unknown_parent_is_an_error_not_a_write(as_user):
    _seed_item()
    out = modify("add", "inventory_spec", {
        "inventory_item_name": "no-such-box", "name": "provider", "value": "Hetzner"})
    assert "❌" in out and "no-such-box" in out
    assert _specs() == []


def test_a_spec_needs_both_halves(as_user):
    _seed_item()
    base = {"inventory_item_name": "thuradev-main"}
    assert "❌" in modify("add", "inventory_spec", {**base, "value": "Hetzner"})
    assert "❌" in modify("add", "inventory_spec", {**base, "name": "provider"})
    assert _specs() == []


def test_update_renames_through_new_name(as_user):
    _seed_item()
    modify("add", "inventory_spec", {
        "inventory_item_name": "thuradev-main", "name": "ram", "value": "8GB"})
    assert "✅" in modify("update", "inventory_spec", {
        "inventory_item_name": "thuradev-main", "name": "ram", "new_name": "memory"})
    assert _specs() == [{"name": "memory", "value": "8GB"}]
