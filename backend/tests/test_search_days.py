"""search_index.search(..., days=) recency filter + server.search_context's
`days` param. Covers both FTS-only and hybrid modes, error handling for
non-positive `days`, the real dispatch path, and the docstring's per-entity
semantics note (Task 6)."""

import asyncio
import json

import db
import embeddings
import persona_store
import search_index


class VocabProvider:
    """Deterministic fake embedder (copied from test_search_query.py): 'js'
    and 'javascript' embed to the same vector so hybrid search can rank a
    semantic match FTS misses."""

    GROUPS = {"js": 0, "javascript": 0, "rust": 1, "postgres": 2}

    def embed(self, texts, input_type="document"):
        out = []
        for t in texts:
            v = [0.0] * db.EMBEDDING_DIM
            for word, dim in self.GROUPS.items():
                if word in t.lower():
                    v[dim] = 1.0
            if not any(v):
                v[3] = 1.0
            out.append(v)
        return out


def _seed_two_entities(provider):
    """Two projects; caller backdates one afterward."""
    persona_store.save("projects", {
        "projects": [
            {"name": "Ledger", "description": "A JavaScript dashboard project", "tags": []},
            {"name": "Ferris", "description": "Rust CLI tool project", "tags": []},
        ],
        "current_learning": [], "top_of_mind": [],
    })
    uid = db.current_user_id.get()
    data = persona_store.load("projects")
    search_index.sync_index(uid, "projects", data, embed_sync=True)
    return {e["name"]: e["id"] for e in data["projects"]}


def _backdate(entity_id, days=3):
    with db.get_pool().connection() as conn:
        conn.execute(
            "update persona_search set updated_at = now() - make_interval(days => %s)"
            " where entity_id = %s",
            (days, entity_id),
        )


def test_fts_only_days_excludes_and_includes(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    ids = _seed_two_entities(None)
    _backdate(ids["Ferris"])
    uid = db.current_user_id.get()

    recent_only = search_index.search(uid, "project", None, 10, days=1)
    assert recent_only["mode"] == "fts"
    titles = {r["title"] for r in recent_only["results"]}
    assert "Ferris" not in titles
    assert "Ledger" in titles

    both = search_index.search(uid, "project", None, 10, days=7)
    titles = {r["title"] for r in both["results"]}
    assert titles == {"Ledger", "Ferris"}


def test_hybrid_days_excludes_and_includes(as_user, monkeypatch):
    ids = _seed_two_entities(VocabProvider())
    monkeypatch.setattr(embeddings, "get_provider", lambda: VocabProvider())
    _backdate(ids["Ferris"])
    uid = db.current_user_id.get()

    recent_only = search_index.search(uid, "project", None, 10, days=1)
    assert recent_only["mode"] == "hybrid"
    titles = {r["title"] for r in recent_only["results"]}
    assert "Ferris" not in titles
    assert "Ledger" in titles

    both = search_index.search(uid, "project", None, 10, days=7)
    assert both["mode"] == "hybrid"
    titles = {r["title"] for r in both["results"]}
    assert titles == {"Ledger", "Ferris"}


def test_days_none_is_unfiltered(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    ids = _seed_two_entities(None)
    _backdate(ids["Ferris"], days=365)
    uid = db.current_user_id.get()

    out = search_index.search(uid, "project", None, 10)
    titles = {r["title"] for r in out["results"]}
    assert titles == {"Ledger", "Ferris"}


def test_search_context_rejects_non_positive_days(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    _seed_two_entities(None)
    import server

    zero = server.search_context.fn(query="project", days=0)
    assert "error" in zero.lower()

    negative = server.search_context.fn(query="project", days=-2)
    assert "error" in negative.lower()


def test_search_context_days_dispatch_path(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    ids = _seed_two_entities(None)
    _backdate(ids["Ferris"])
    import server

    async def _run():
        tool = await server.mcp.get_tool("search_context")
        return await tool.run({"query": "project", "days": 1})

    result = asyncio.run(_run())
    payload = json.loads(result.content[0].text)
    titles = {r["title"] for r in payload["results"]}
    assert "Ferris" not in titles
    assert "Ledger" in titles


def test_search_context_docstring_mentions_per_entity():
    import server

    assert "per-entity" in server.search_context.fn.__doc__
