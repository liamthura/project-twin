"""Suggesting where an observation belongs: what is sent, what comes back,
and that nothing breaks or leaves the server without the key."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import db
import main
import proposals_store as ps
import routing
import sections

PACKS = [
    {"key": "lifestyle", "title": "Lifestyle", "promotable": [
        {"entity": "hobby", "title": "Hobbies & activities",
         "about": {"what": "Something you do outside work", "not_for": "subjects you only follow", "examples": ["Bouldering"]}},
        {"entity": "value", "title": "Values", "about": None},
    ]},
]
OBSERVATION = {"note": "Cooks to decompress.", "rationale": "Said so twice.", "evidence": "I stress-cook", "section_hint": "lifestyle"}


def _client(answer=None, status=200, seen=None):
    def handler(request):
        if seen is not None:
            seen.append({"url": str(request.url), "auth": request.headers.get("authorization"),
                         "body": json.loads(request.content)})
        return httpx.Response(status, json={"model": "jev-1.13.0", "answers": {"destination": answer}})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _run(coro):
    return asyncio.run(coro)


@pytest.mark.nodb
def test_each_type_is_described_by_its_manifest_about(monkeypatch):
    c = routing.criteria(PACKS)
    assert c["lifestyle.hobby"] == {
        "what": "Lifestyle › Hobbies & activities: Something you do outside work",
        "not_for": "subjects you only follow",
        "examples": ["Bouldering"],
    }
    # No `about`: still offered, on its titles.
    assert c["lifestyle.value"] == {"what": "Lifestyle › Values"}
    assert "none" in c


@pytest.mark.nodb
def test_the_shipped_packs_route_on_the_same_words_the_dialog_shows():
    packs = [{"key": k, "title": m["title"], "promotable": m["promotable"]} for k, m in sections.PACK_META.items()]
    c = routing.criteria(packs)
    assert c["preferences.mood_override"]["what"].endswith(
        sections.PACK_META["preferences"]["promotable"][0]["about"]["what"])
    assert len(c) == 25  # 24 types and none


@pytest.mark.nodb
def test_without_the_key_nothing_is_sent(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    seen = []
    result = _run(routing.suggest(OBSERVATION, PACKS, client=_client(seen=seen)))
    assert result == {"enabled": False, "suggestions": [], "confident": False}
    assert seen == []


@pytest.mark.nodb
def test_it_sends_the_observation_and_the_types_and_ranks_the_answer(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    seen = []
    answer = {"type": "choice", "choice": "lifestyle.hobby", "confidence": 0.95,
              "probabilities": {"lifestyle.hobby": 0.95, "none": 0.03, "lifestyle.value": 0.02}}
    result = _run(routing.suggest(OBSERVATION, PACKS, client=_client(answer, seen=seen)))

    # value, at 0.02, is under the floor: a sure answer is offered alone.
    assert result == {"enabled": True, "confident": True, "suggestions": [
        {"section": "lifestyle", "entity": "hobby", "probability": 0.95},
    ]}
    [call] = seen
    assert call["url"] == routing.URL and call["auth"] == "Bearer test-key"
    assert call["body"]["model"] == routing.MODEL
    # The note, its reason and its quote; nothing else of the proposal.
    assert call["body"]["state"] == {"note": "Cooks to decompress.", "rationale": "Said so twice.", "evidence": "I stress-cook"}
    assert call["body"]["questions"]["destination"]["criteria"] == routing.criteria(PACKS)


@pytest.mark.nodb
def test_it_is_not_confident_below_the_line_or_when_none_leads(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    unsure = {"choice": "lifestyle.hobby", "confidence": 0.78,
              "probabilities": {"lifestyle.hobby": 0.78, "lifestyle.value": 0.2, "none": 0.02}}
    assert _run(routing.suggest(OBSERVATION, PACKS, client=_client(unsure)))["confident"] is False

    nowhere = {"choice": "none", "confidence": 0.97,
               "probabilities": {"none": 0.97, "lifestyle.value": 0.02, "lifestyle.hobby": 0.01}}
    result = _run(routing.suggest(OBSERVATION, PACKS, client=_client(nowhere)))
    assert result["confident"] is False
    # The first real type is kept whatever its probability; the rest are not.
    assert [s["entity"] for s in result["suggestions"]] == ["value"]

    split = {"choice": "lifestyle.hobby", "confidence": 0.5,
             "probabilities": {"lifestyle.hobby": 0.55, "lifestyle.value": 0.4, "none": 0.05}}
    assert [s["entity"] for s in _run(routing.suggest(OBSERVATION, PACKS, client=_client(split)))["suggestions"]] == ["hobby", "value"]


@pytest.mark.nodb
@pytest.mark.parametrize("status,answer", [(401, None), (529, None), (200, "not a dict"), (200, {"choice": "x"})])
def test_a_failure_is_no_suggestions_not_an_error(monkeypatch, status, answer):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    result = _run(routing.suggest(OBSERVATION, PACKS, client=_client(answer, status=status)))
    assert result == {"enabled": True, "suggestions": [], "confident": False}


def _as_user(client):
    r = client.post("/api/auth/register", json={"username": "routing-test-user"})
    auth = {"Authorization": f"Bearer {r.json()['token']}"}
    db.current_user_id.set(client.get("/api/auth/whoami", headers=auth).json()["user_id"])
    return auth


def test_the_endpoint_suggests_for_a_pending_observation(clean_database, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    client = TestClient(main.app)
    auth = _as_user(client)
    note = ps.create("note", client="Cursor", rationale="r", evidence="e", note="Walks before work")["id"]
    entity = ps.create("entity", client="Cursor", rationale="r", evidence="e", action="add",
                       entity="domain", identifier="Datadog", data={"name": "Datadog"})["id"]

    assert client.post(f"/api/proposals/{note}/suggest", headers=auth).json() == {
        "enabled": False, "suggestions": [], "confident": False}
    assert client.post(f"/api/proposals/{entity}/suggest", headers=auth).status_code == 400
    assert client.post("/api/proposals/not-a-uuid/suggest", headers=auth).status_code == 404


def test_the_endpoint_offers_only_the_readers_enabled_sections(clean_database, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    offered = {}

    async def fake(observation, packs, client=None):
        offered["keys"] = [p["key"] for p in packs]
        return {"enabled": True, "suggestions": [], "confident": False}

    monkeypatch.setattr(routing, "suggest", fake)
    client = TestClient(main.app)
    auth = _as_user(client)
    note = ps.create("note", client="Cursor", rationale="r", evidence="e", note="Walks before work")["id"]
    client.post(f"/api/proposals/{note}/suggest", headers=auth)
    # Media, aesthetics and inventory are opt-in and off by default.
    assert "lifestyle" in offered["keys"]
    assert "inventory" not in offered["keys"]
