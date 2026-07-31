"""propose_update validates, never writes, and always names its client."""
import json

import server


def _call(proposals, client="Claude Desktop"):
    return json.loads(server.propose_update.fn(proposals=proposals, client=client))


def _entity_proposal(**over):
    base = {
        "kind": "entity", "action": "update", "entity": "domain",
        "data": {"name": "Datadog", "level": "advanced"},
        "rationale": "Runs the on-call dashboards unaided now.",
        "evidence": "I rebuilt the whole alerting setup myself",
        "confidence": 0.7,
    }
    base.update(over)
    return base


def _note_proposal(**over):
    base = {
        "kind": "note", "section_hint": "preferences",
        "text": "Wants the recommendation first, then the reasoning.",
        "rationale": "Said so repeatedly across sessions.",
        "evidence": "just tell me which one you'd pick",
    }
    base.update(over)
    return base


def test_a_valid_entity_proposal_is_stored(clean_database, as_user):
    assert _call([_entity_proposal()])["results"][0]["result"] == "stored"


def test_a_valid_note_is_stored(clean_database, as_user):
    assert _call([_note_proposal()])["results"][0]["result"] == "stored"


def test_the_persona_is_not_touched(clean_database, as_user):
    _call([_entity_proposal()])
    assert server.load_json("knowledge.json").get("domains", []) == []


def test_the_client_argument_is_required(clean_database, as_user):
    out = _call([_entity_proposal()], client="  ")
    assert "error" in out
    assert out["results"] == []


def test_missing_rationale_is_invalid(clean_database, as_user):
    p = _entity_proposal()
    del p["rationale"]
    assert _call([p])["results"][0]["result"] == "invalid"


def test_missing_evidence_is_invalid(clean_database, as_user):
    p = _entity_proposal()
    del p["evidence"]
    assert _call([p])["results"][0]["result"] == "invalid"


def test_an_unknown_entity_is_invalid_and_returns_the_schema(clean_database, as_user):
    r = _call([_entity_proposal(entity="vibe")])["results"][0]
    assert r["result"] == "invalid"
    assert "valid_entities" in r


def test_one_invalid_item_does_not_sink_the_batch(clean_database, as_user):
    p = _entity_proposal()
    del p["rationale"]
    results = _call([p, _note_proposal()])["results"]
    assert results[0]["result"] == "invalid"
    assert results[1]["result"] == "stored"


def test_repeat_proposals_report_duplicate(clean_database, as_user):
    _call([_entity_proposal()])
    assert _call([_entity_proposal()])["results"][0]["result"] == "duplicate_pending"


def test_a_conflicting_value_is_stored_with_the_current_one_attached(clean_database, as_user):
    server.execute_modify("add", "domain", {"name": "Datadog", "level": "beginner"})
    r = _call([_entity_proposal()])["results"][0]
    assert r["result"] == "conflicts_with_existing"
    assert r["existing_entity"]["title"] == "Datadog"


def test_the_queue_is_not_readable_over_mcp(clean_database, as_user):
    names = {t.lower() for t in dir(server)}
    for forbidden in ("list_proposals", "get_proposals", "resolve_proposal"):
        assert forbidden not in names
