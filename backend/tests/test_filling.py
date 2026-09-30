"""Filling a type's fields from what was said: candidates in code, choices by
Jev, and nothing invented, guessed below its line, or sent without the key."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import db
import filling
import main
import proposals_store as ps
import sections

EDUCATION = next(t for t in sections.PACK_META["profile"]["promotable"] if t["entity"] == "education")
HOBBY = next(t for t in sections.PACK_META["lifestyle"]["promotable"] if t["entity"] == "hobby")
OBSERVATION = {
    "note": "Doing an MA in Digital Media part-time at the University of Leeds.",
    "rationale": "Mentioned twice.",
    "evidence": "I started the MA at Leeds last September",
}


def _client(answers=None, status=200, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(json.loads(request.content))
        return httpx.Response(status, json={"model": "jev-1.13.0", "answers": answers})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _fill(observation, target, **kw):
    return asyncio.run(filling.fill(observation, target, client=_client(**kw)))


@pytest.mark.nodb
def test_candidates_are_phrases_from_what_was_said():
    phrases = filling.candidates({"note": "Curious about urban history, especially Manchester's canals.",
                                  "evidence": "I keep reading about the canals"})
    assert "urban history" in phrases
    assert "Manchester's canals" in phrases
    # Not across a comma, and never starting or ending on a small word.
    assert not any("," in p for p in phrases)
    assert "about urban history" not in phrases and "the canals" not in phrases
    # One spelling of each: "canals" from the note, not again from the quote.
    assert sum(p.lower() == "canals" for p in phrases) == 1


@pytest.mark.nodb
def test_questions_come_from_the_manifest_fields():
    q = filling.questions(EDUCATION, OBSERVATION)
    # Every text, date and fixed-value field is asked about; long text is not.
    assert set(q) == {"institution", "degree_level", "field_of_study", "start_year", "end_year", "status"}
    status = q["status"]["criteria"]
    assert set(status) == {"current", "completed", "incomplete", filling.NOT_STATED}
    institution = q["institution"]["criteria"]
    assert "University of Leeds" in institution and filling.NONE in institution
    # The name may be the whole note, for a title that is a sentence.
    assert "Doing an MA in Digital Media part-time at the University of Leeds" in institution
    assert "Doing an MA in Digital Media part-time at the University of Leeds" not in q["degree_level"]["criteria"]
    # The editor's hint goes with the question.
    assert "for example" in q["institution"]["instructions"]


@pytest.mark.nodb
def test_the_note_goes_to_a_required_long_field_then_notes():
    project = next(t for t in sections.PACK_META["projects"]["promotable"] if t["entity"] == "project")
    goal = next(t for t in sections.PACK_META["goals"]["promotable"] if t["entity"] == "goal")
    assert filling.notes_field(project) == "description"  # required
    assert filling.notes_field(goal) == "notes"  # before `why`
    assert filling.notes_field(EDUCATION) is None


@pytest.mark.nodb
def test_it_fills_what_jev_is_sure_of_and_keeps_the_note(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    seen = []
    answers = {
        "name": {"choice": "bouldering", "confidence": 0.98},
        "skill_level": {"choice": "beginner", "confidence": 1.0},
        "status": {"choice": "active", "confidence": 0.6},  # under 0.7 for a choice
    }
    observation = {"note": "Picked up bouldering again, still a beginner.", "evidence": "back on the wall"}
    result = _fill(observation, HOBBY, answers=answers, seen=seen)
    assert result == {
        "enabled": True,
        "values": {"name": "bouldering", "skill_level": "beginner",
                   "notes": "Picked up bouldering again, still a beginner."},
        "confidence": {"name": 0.98, "skill_level": 1.0},
    }
    [body] = seen
    assert body["state"] == {"note": observation["note"], "evidence": "back on the wall"}
    assert set(body["questions"]) == {"name", "skill_level", "status"}


@pytest.mark.nodb
def test_a_value_it_did_not_offer_or_one_below_its_line_is_not_filled(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    answers = {
        "institution": {"choice": "Oxford", "confidence": 0.99},  # never a candidate
        "field_of_study": {"choice": "Digital Media", "confidence": 0.45},  # text takes 0.5
        "degree_level": {"choice": "none", "confidence": 0.99},
        "status": {"choice": "not_stated", "confidence": 0.99},
    }
    assert _fill(OBSERVATION, EDUCATION, answers=answers)["values"] == {}


@pytest.mark.nodb
@pytest.mark.parametrize("status,answers", [(401, None), (529, None), (200, "nope")])
def test_a_failure_or_no_key_is_no_values(monkeypatch, status, answers):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    assert _fill(OBSERVATION, EDUCATION, status=status, answers=answers)["values"] == {}
    monkeypatch.delenv("TYPESAFE_API_KEY")
    seen = []
    assert _fill(OBSERVATION, EDUCATION, seen=seen) == {"enabled": False, "values": {}, "confidence": {}}
    assert seen == []


def _as_user(client):
    r = client.post("/api/auth/register", json={"username": "filling-test-user"})
    auth = {"Authorization": f"Bearer {r.json()['token']}"}
    db.current_user_id.set(client.get("/api/auth/whoami", headers=auth).json()["user_id"])
    return auth


def test_the_endpoint_fills_an_observation_or_a_new_entry_but_not_an_update(clean_database, monkeypatch):
    calls = []

    async def fake(observation, target, client=None):
        calls.append((observation.get("note"), target["entity"]))
        return {"enabled": True, "values": {}, "confidence": {}}

    monkeypatch.setattr(filling, "fill", fake)
    client = TestClient(main.app)
    auth = _as_user(client)
    note = ps.create("note", client="Cursor", rationale="r", evidence="e", note="Plays five-a-side on Thursdays")["id"]
    added = ps.create("entity", client="Cursor", rationale="r", evidence="e", action="add", entity="hobby",
                      identifier="x", data={"name": "Plays five-a-side football every Thursday with work"})["id"]
    updated = ps.create("entity", client="Cursor", rationale="r", evidence="e", action="update", entity="hobby",
                        identifier="Bouldering", data={"name": "Bouldering", "status": "paused"})["id"]
    fill = lambda pid, **kw: client.post(f"/api/proposals/{pid}/fill", headers=auth,
                                         json={"section": "lifestyle", "entity": "hobby", **kw})

    assert fill(note).status_code == 200
    assert fill(added).status_code == 200
    assert calls == [("Plays five-a-side on Thursdays", "hobby"),
                     ("Plays five-a-side football every Thursday with work", "hobby")]
    assert fill(updated).status_code == 400
    assert fill(note, entity="hobby_specific").status_code == 400  # not a type a sentence can make


def test_a_sure_suggestion_comes_with_its_fields_filled(clean_database, monkeypatch):
    import routing

    async def sure(observation, packs, client=None):
        return {"enabled": True, "confident": True,
                "suggestions": [{"section": "lifestyle", "entity": "hobby", "probability": 0.97}]}

    async def filled(observation, target, client=None):
        return {"enabled": True, "values": {"name": "five-a-side"}, "confidence": {"name": 0.8}}

    monkeypatch.setattr(routing, "suggest", sure)
    monkeypatch.setattr(filling, "fill", filled)
    client = TestClient(main.app)
    auth = _as_user(client)
    note = ps.create("note", client="Cursor", rationale="r", evidence="e", note="Plays five-a-side on Thursdays")["id"]
    body = client.post(f"/api/proposals/{note}/suggest", headers=auth).json()
    assert body["fill"]["values"] == {"name": "five-a-side"}
