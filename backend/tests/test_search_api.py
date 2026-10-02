"""GET /api/search: what the app's search dialog cannot find itself.

The dialog searches the sections it has loaded; this covers the rest, by
keyword always and by meaning where embeddings are configured.
"""
from fastapi.testclient import TestClient

import main
import search_index
import settings_store


def _client():
    client = TestClient(main.app)
    token = client.post("/api/auth/register", json={"username": "search-api"}).json()["token"]
    return client, {"Authorization": f"Bearer {token}"}


def test_keyword_hits_come_back_as_word_matches(clean_database, monkeypatch):
    # Sections the page has not loaded can only be word-searched here.
    monkeypatch.setattr(search_index, "search", lambda *a, **k: {
        "mode": "fts", "results": [{"entity_id": "x", "section": "goals", "title": "Climb",
                                    "snippet": "<b>Climb</b>\nLead climb outdoors", "fts_hit": True}]})
    client, auth = _client()
    assert client.get("/api/search?q=climb", headers=auth).json() == {"results": [
        {"entity_id": "x", "section": "goals", "title": "Climb",
         "snippet": "Lead climb outdoors", "match": "words"}]}


def test_meaning_results_skip_turned_off_sections(clean_database, monkeypatch):
    seen = {}

    def fake(user_id, query, sections, limit, exclude_sections=None, days=None):
        seen.update(query=query, exclude=exclude_sections, limit=limit)
        return {"mode": "hybrid", "results": [{"entity_id": "goal_1", "section": "goals",
                                               "title": "Lead climb outdoors", "snippet": "…",
                                               "score": 0.5, "updated_at": "2026-01-01",
                                               "fts_hit": False}]}

    monkeypatch.setattr(search_index, "search", fake)
    monkeypatch.setattr(settings_store, "get_disabled_sections", lambda: {"media"})
    client, auth = _client()
    body = client.get("/api/search?q=%20climbing%20", headers=auth).json()
    assert body == {"results": [{"entity_id": "goal_1", "section": "goals",
                                 "title": "Lead climb outdoors", "snippet": "…",
                                 "match": "meaning"}]}
    assert seen == {"query": "climbing", "exclude": ["media"], "limit": 5}
    assert client.get("/api/search?q=c", headers=auth).json() == {"results": []}
