"""`hobby.status` stores every value the manifest declares.

`lifestyle/manifest.json` declares `valid_values.status = ["active",
"inactive", "paused"]` and the editor offers all three, but `execute_modify`
used to fold "paused" into "inactive" on write. The frontend PUTs section JSON
directly, so a user's "paused" persisted -- until the next AI edit to that
hobby silently rewrote it.

The read path never agreed with that collapse: "paused" is a member of
`INACTIVE_STATUSES` (server.py:1074, annotated "goals, lifestyle.hobby,
projects"), so `_filter_inactive` has always treated a paused hobby as a
distinct status the write path refused to store.

See docs/superpowers/plans/2026-07-29-wave-5-storage-keys-reference.md §1.1.1.
"""
import server


def _hobbies():
    return server.load_json("lifestyle.json")["hobbies"]


def test_add_stores_paused(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Bouldering", "status": "paused"})
    assert _hobbies()[0]["status"] == "paused"


def test_update_stores_paused(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Bouldering"})
    server.execute_modify("update", "hobby", {"name": "Bouldering", "status": "paused"})
    assert _hobbies()[0]["status"] == "paused"


def test_paused_hobby_survives_an_unrelated_update(clean_database, as_user):
    """The update branch recomputes `status` from `data` unconditionally but
    only writes it back when a status alias is actually present
    (server.py:1735). So an update touching only `notes` must leave a paused
    hobby paused -- pinning that gate, which is what stops the collapse from
    reappearing on every unrelated edit."""
    server.execute_modify("add", "hobby", {"name": "Bouldering", "status": "paused"})
    server.execute_modify("update", "hobby", {"name": "Bouldering", "notes": "twice a week"})
    hobby = _hobbies()[0]
    assert hobby["notes"] == "twice a week"
    assert hobby["status"] == "paused"


def test_on_hold_normalises_to_paused(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Pottery", "status": "on_hold"})
    assert _hobbies()[0]["status"] == "paused"


def test_the_other_inactive_spellings_still_collapse(clean_database, as_user):
    """This fix narrows the collapse list; it does not remove it. Every
    spelling that meant "inactive" before must still mean it."""
    for spelling in ["inactive", "stopped", "not_active", "false"]:
        server.execute_modify("add", "hobby", {"name": f"H-{spelling}", "status": spelling})
    assert {h["status"] for h in _hobbies()} == {"inactive"}


def test_unknown_status_still_falls_back_to_active(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Chess", "status": "banana"})
    assert _hobbies()[0]["status"] == "active"


def test_default_status_is_still_active(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Chess"})
    assert _hobbies()[0]["status"] == "active"


def test_paused_hobby_is_still_filtered_from_context(clean_database, as_user):
    """Making "paused" storable must not make paused hobbies suddenly visible
    to AI clients. `_filter_inactive` already knew the value; it just never
    saw one until now."""
    server.execute_modify("add", "hobby", {"name": "Bouldering", "status": "paused"})
    server.execute_modify("add", "hobby", {"name": "Chess", "status": "active"})
    filtered = server._filter_inactive({"lifestyle": {"hobbies": _hobbies()}})
    names = [h["name"] for h in filtered["lifestyle"]["hobbies"]]
    assert names == ["Chess"]
