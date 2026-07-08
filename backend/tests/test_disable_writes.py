import server
import settings_store as ss
import persona_store as store

modify = server.persona_modify.fn


def test_write_to_disabled_section_rejected(as_user):
    ss.set_disabled_sections(["circle"])
    out = modify(action="add", entity="connection", data={"name": "Sam"})
    assert "❌" in out and "disabled" in out.lower()
    # and nothing was written
    assert store.load("circle").get("connections", []) == []


def test_write_to_enabled_section_still_works(as_user):
    ss.set_disabled_sections(["circle"])  # circle off, knowledge on
    out = modify(action="add", entity="domain", data={"name": "Rust"})
    assert "❌" not in out
    assert any(d["name"] == "Rust" for d in store.load("knowledge")["domains"])


def test_write_to_always_on_section_never_blocked(as_user):
    ss.set_disabled_sections(["preferences"])  # bypasses validation on purpose
    out = modify(action="add", entity="dislike", data={"dislike": "spam"})
    assert "❌" not in out


def test_batch_rejects_op_in_disabled_section_but_allows_others(as_user):
    ss.set_disabled_sections(["circle"])  # circle off, knowledge on
    out = server.persona_batch.fn(operations=[
        {"action": "add", "entity": "domain", "data": {"name": "Rust"}},
        {"action": "add", "entity": "connection", "data": {"name": "Sam"}},
    ])
    assert "❌" in out and "disabled" in out.lower()
    assert any(d["name"] == "Rust" for d in store.load("knowledge")["domains"])
    assert store.load("circle").get("connections", []) == []
