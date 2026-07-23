import db
import embeddings
import persona_store
import search_index


class VocabProvider:
    """Deterministic fake with a tiny synonym vocabulary: 'js' and
    'javascript' embed to the same vector so hybrid search can rank a
    semantic match FTS misses (parity with the deleted alias dict)."""

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


def _seed(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [
            {"name": "Ledger", "description": "A JavaScript dashboard", "tags": []},
            {"name": "Ferris", "description": "Rust CLI tool", "tags": []},
        ],
        "current_learning": [], "top_of_mind": [],
    })
    persona_store.save("knowledge", {
        "domains": [{"name": "Databases", "notes": "postgres tuning"}],
        "mental_tabs": [],
    })
    # embed synchronously for determinism
    uid = db.current_user_id.get()
    for ft in ("projects", "knowledge"):
        data = persona_store.load(ft)
        search_index.sync_index(uid, ft, data, embed_sync=True)


def test_fts_only_search(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    _seed(monkeypatch, None)
    uid = db.current_user_id.get()
    out = search_index.search(uid, "rust cli", None, 10)
    assert out["mode"] == "fts"
    assert out["results"][0]["title"] == "Ferris"
    assert "snippet" in out["results"][0] and out["results"][0]["section"] == "projects"


def test_hybrid_finds_semantic_match(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())
    uid = db.current_user_id.get()
    out = search_index.search(uid, "js", None, 10)  # FTS alone can't match 'JavaScript'
    assert out["mode"] == "hybrid"
    assert out["results"][0]["title"] == "Ledger"


def test_section_filter_and_exclusion(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())
    uid = db.current_user_id.get()
    only_knowledge = search_index.search(uid, "postgres", ["knowledge"], 10)
    assert {r["section"] for r in only_knowledge["results"]} == {"knowledge"}
    excluded = search_index.search(uid, "postgres", None, 10,
                                   exclude_sections=["knowledge"])
    assert all(r["section"] != "knowledge" for r in excluded["results"])


def test_query_embed_failure_degrades_to_fts(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())

    class Boom:
        def embed(self, texts, input_type="document"):
            raise embeddings.EmbeddingError("down")

    monkeypatch.setattr(embeddings, "get_provider", lambda: Boom())
    uid = db.current_user_id.get()
    out = search_index.search(uid, "rust", None, 10)
    assert out["mode"] == "fts"
    assert out["results"][0]["title"] == "Ferris"


def test_lazy_heal_builds_missing_index(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("circle", {"connections": [{"name": "Ada",
                                                   "relationship": "mentor"}]})
    uid = db.current_user_id.get()
    with db.get_pool().connection() as conn:  # simulate pre-feature user
        conn.execute("delete from persona_search where user_id = %s", (uid,))
    out = search_index.search(uid, "mentor", None, 10)
    assert out["results"] and out["results"][0]["title"] == "Ada"
