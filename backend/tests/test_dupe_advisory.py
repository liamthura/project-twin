import json

import db
import embeddings
import persona_store
import search_index
import server
from tests.test_search_query import VocabProvider


def _seed_project(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [{"name": "Ledger", "description": "A JavaScript dashboard"}],
        "current_learning": [], "top_of_mind": [],
    })
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "projects", persona_store.load("projects"),
                            embed_sync=True)


def test_add_near_dupe_gets_advisory_but_still_writes(as_user, monkeypatch):
    _seed_project(monkeypatch, VocabProvider())
    out = server.persona_modify.fn(
        "add", "project",
        {"name": "Ledger 2", "description": "javascript dashboard app"})
    assert "resembles existing" in out and "project_" in out
    assert len(persona_store.load("projects")["projects"]) == 2  # write happened


def test_add_unrelated_no_advisory(as_user, monkeypatch):
    _seed_project(monkeypatch, VocabProvider())
    out = server.persona_modify.fn(
        "add", "project", {"name": "GardenBot", "description": "watering robot"})
    assert "resembles existing" not in out


def test_fts_only_exact_title_advisory(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = server.persona_modify.fn(
        "add", "project", {"name": "Ledger", "description": "different words"})
    assert "resembles existing" in out


def test_fts_only_overlap_but_different_title_no_advisory(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = server.persona_modify.fn(
        "add", "project", {"name": "Dashboard Two", "description": "A JavaScript dashboard"})
    assert "resembles existing" not in out


def test_advisory_failure_never_breaks_write(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    monkeypatch.setattr(search_index, "search",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    out = server.persona_modify.fn(
        "add", "project", {"name": "Solo", "description": "standalone thing"})
    assert "resembles existing" not in out
    assert any(p["name"] == "Solo" for p in persona_store.load("projects")["projects"])


def test_update_and_remove_never_checked(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    calls = []
    real = search_index.search
    monkeypatch.setattr(search_index, "search",
                        lambda *a, **k: calls.append(1) or real(*a, **k))
    server.persona_modify.fn("update", "project",
                             {"name": "Ledger", "status": "paused"})
    assert calls == []


def test_batch_per_op_advisories(as_user, monkeypatch):
    _seed_project(monkeypatch, None)
    out = server.persona_batch.fn([
        {"action": "add", "entity": "project",
         "data": {"name": "Ledger", "description": "different words"}},
        {"action": "add", "entity": "project",
         "data": {"name": "Fresh", "description": "something brand new"}},
    ])
    # advisory attached to op 1's result line only
    assert out.count("resembles existing") == 1
