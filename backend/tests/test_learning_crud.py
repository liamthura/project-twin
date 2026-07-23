"""Tests for learning_entry full CRUD: update by topic/id, rename, related_entries."""
import server
import persona_store as store

# `as_user` fixture is provided by tests/conftest.py.
persona_modify = server.persona_modify.fn


def _add(topic, **fields):
    return persona_modify(action="add", entity="learning_entry",
                          data={"topic": topic, "details": "d", **fields})


def _entries():
    return server.load_json("learning_log.json")["entries"]


# --- update: locate semantics -------------------------------------------------

def test_update_by_topic_case_insensitive(as_user):
    _add("React Hooks")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "react hooks", "details": "new details"})
    assert result.startswith("✅")
    assert _entries()[-1]["details"] == "new details"


def test_update_by_topic_picks_most_recent_duplicate(as_user):
    _add("Docker")
    _add("Docker")
    persona_modify(action="update", entity="learning_entry",
                   data={"topic": "Docker", "details": "updated"})
    entries = _entries()
    assert entries[0]["details"] == "d"        # older duplicate untouched
    assert entries[1]["details"] == "updated"  # most recent updated


def test_update_by_id_wins_over_topic(as_user):
    _add("A")
    _add("B")
    a_id = _entries()[0]["id"]
    result = persona_modify(action="update", entity="learning_entry",
                            data={"id": a_id, "topic": "B", "details": "via id"})
    assert result.startswith("✅")
    assert _entries()[0]["details"] == "via id"
    assert _entries()[1]["details"] == "d"


def test_update_not_found(as_user):
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "nope", "details": "x"})
    assert result.startswith("❌")


# --- update: field semantics --------------------------------------------------

def test_partial_update_leaves_other_fields(as_user):
    _add("Kafka", tags=["queue"], key_decisions=["use it"])
    persona_modify(action="update", entity="learning_entry",
                   data={"topic": "Kafka", "followup_items": ["read docs"]})
    e = _entries()[-1]
    assert e["followup_items"] == ["read docs"]
    assert e["tags"] == ["queue"]
    assert e["key_decisions"] == ["use it"]


def test_rename_via_new_topic(as_user):
    _add("Typos")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Typos", "new_topic": "Typography"})
    assert result.startswith("✅")
    assert _entries()[-1]["topic"] == "Typography"


def test_id_and_timestamp_immutable(as_user):
    _add("Immutable")
    before = dict(_entries()[-1])
    persona_modify(action="update", entity="learning_entry",
                   data={"topic": "Immutable", "details": "changed"})
    after = _entries()[-1]
    assert after["id"] == before["id"]
    assert after["timestamp"] == before["timestamp"]


def test_identifier_only_update_errors(as_user):
    _add("Bare")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Bare"})
    assert result.startswith("❌")


# --- related_entries validation -----------------------------------------------

def _make_domain():
    persona_modify(action="add", entity="domain", data={"name": "Rust"})
    return server.load_json("knowledge.json")["domains"][-1]["id"]


def test_valid_related_entry_accepted_on_add(as_user):
    domain_id = _make_domain()
    result = _add("Ownership", related_entries=[{"type": "domain", "id": domain_id}])
    assert result.startswith("✅")
    assert _entries()[-1]["related_entries"] == [{"type": "domain", "id": domain_id}]


def test_valid_related_entry_accepted_on_update(as_user):
    domain_id = _make_domain()
    _add("Borrowing")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Borrowing",
                                  "related_entries": [{"type": "domain", "id": domain_id}]})
    assert result.startswith("✅")
    assert _entries()[-1]["related_entries"][0]["id"] == domain_id


def test_unknown_type_rejected(as_user):
    result = _add("Bad", related_entries=[{"type": "planet", "id": "x"}])
    assert result.startswith("❌") and "planet" in result
    assert _entries() == []  # nothing written


def test_nonexistent_id_rejected(as_user):
    result = _add("Bad", related_entries=[{"type": "domain", "id": "domain_missing"}])
    assert result.startswith("❌") and "domain_missing" in result
    assert _entries() == []


def test_malformed_link_rejected(as_user):
    result = _add("Bad", related_entries=["not-a-dict"])
    assert result.startswith("❌")
    assert _entries() == []


def test_rejected_update_writes_nothing(as_user):
    _add("Safe")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Safe", "details": "should not land",
                                  "related_entries": [{"type": "domain", "id": "domain_missing"}]})
    assert result.startswith("❌")
    assert _entries()[-1]["details"] == "d"


# --- registry id assignment ---------------------------------------------------

def test_save_assigns_ids_to_learning_entries(as_user):
    store.save("learning_log", {"entries": [
        {"topic": "no id yet", "timestamp": "2026-07-11T00:00:00"},
        {"id": "learn_keepme", "topic": "has id"},
    ]})
    entries = server.load_json("learning_log.json")["entries"]
    assert entries[0]["id"].startswith("learn_")
    assert entries[1]["id"] == "learn_keepme"  # setdefault: existing id untouched

    first = server.load_json("learning_log.json")["entries"][0]["id"]
    second = server.load_json("learning_log.json")["entries"][0]["id"]
    assert first == second  # persisted by save(), not regenerated per load
