import json

import embeddings
import persona_store
import server
from tests.test_dupe_advisory import _seed_project  # reuse fixture helper


def _fixed_analysis(suggestions):
    """Fixed analyze_message_for_capture stand-in: the heuristics never emit
    a `project`-entity add-suggestion (only domain/learning_entry/dislike/
    personality_trait/career_aspiration/passion/curiosity are wired up in
    analyze_message_for_capture), so no phrasing can be found that reliably
    exercises the dedupe-rewrite path through the real analyzer. These tests
    are about suggest_persona_update's dedupe grounding, not the capture
    heuristics -- pin the analyzer's output directly."""
    def fake(message, context=""):
        return {
            "should_capture": True,
            "confidence": 0.8,
            "suggestions": [dict(s) for s in suggestions],
            "detected_triggers": [],
            "detected_entities": [],
            "statement_signals": {},
            "state_changes": [],
            "ignore_reason": None,
        }
    return fake


def test_suggestion_for_existing_rewritten_to_update(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    monkeypatch.setattr(server, "analyze_message_for_capture", _fixed_analysis([
        {"action": "add", "entity": "project",
         "data": {"name": "Ledger", "description": "A JavaScript dashboard"},
         "reason": "test", "confidence": 0.8},
    ]))
    out = json.loads(server.suggest_persona_update.fn(
        "I finished building Ledger, my JavaScript dashboard"))
    assert out["dedupe_checked"] is True
    rewritten = [s for s in out["suggestions"] if s.get("existing_entity")]
    assert rewritten  # sanity: dedupe actually fired
    for s in rewritten:
        assert s["action"] == "update"
        assert s["existing_entity"]["entity_id"].startswith("project_")
        assert s["data"]["name"] == "Ledger"


def test_novel_suggestion_stays_add(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    monkeypatch.setattr(server, "analyze_message_for_capture", _fixed_analysis([
        {"action": "add", "entity": "hobby",
         "data": {"name": "Woodworking"},
         "reason": "test", "confidence": 0.8},
    ]))
    out = json.loads(server.suggest_persona_update.fn(
        "I started a brand new hobby: woodworking"))
    assert out["dedupe_checked"] is True
    assert all(not s.get("existing_entity") for s in out["suggestions"])
    assert all(s["action"] == "add" for s in out["suggestions"])


def test_dedupe_failure_falls_back_cleanly(as_user, monkeypatch):
    import search_index
    _seed_project(monkeypatch, None)
    monkeypatch.setattr(server, "analyze_message_for_capture", _fixed_analysis([
        {"action": "add", "entity": "project",
         "data": {"name": "Ledger", "description": "A JavaScript dashboard"},
         "reason": "test", "confidence": 0.8},
    ]))
    monkeypatch.setattr(search_index, "search",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    out = json.loads(server.suggest_persona_update.fn("I built Ledger today"))
    assert "suggestions" in out  # tool still works, suggestions unmodified
    assert out["dedupe_checked"] is True
    assert out["suggestions"][0]["action"] == "add"
    assert "existing_entity" not in out["suggestions"][0]
