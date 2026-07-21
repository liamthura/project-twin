import embeddings
import persona_store
import server
from tests.test_search_query import VocabProvider  # reuse the synonym fake


def _seed(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [
            {"name": "Ledger", "description": "A JavaScript dashboard"},
            {"name": "Ferris", "description": "Rust CLI tool"},
        ],
        "current_learning": [], "top_of_mind": [{"idea": "ship it"}],
    })


def test_topic_filters_id_lists_keeps_other_fields(as_user, monkeypatch):
    _seed(monkeypatch, None)
    # get_scoped_context returns the full payload wrapper (scope,
    # scope_description, topic_filter, token_estimate, context) as
    # characterized by test_context_efficiency.test_scopes_return_stable_shape;
    # the brief's shorthand `out["projects"]` is adapted to `out["context"]["projects"]`.
    out = server.get_scoped_context("professional", topic="rust")
    projects = out["context"]["projects"]["projects"]
    assert [p["name"] for p in projects] == ["Ferris"]
    # non-matching id-list content is filtered; a section with no id_lists at
    # all (preferences: id_lists=()) is untouched by the topic filter and
    # still comes through via the always-on bundle.
    assert "preferences" in out["context"]


def test_topic_semantic_match_in_hybrid_mode(as_user, monkeypatch):
    _seed(monkeypatch, VocabProvider())
    import db, search_index
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "projects", persona_store.load("projects"),
                            embed_sync=True)
    out = server.get_scoped_context("professional", topic="js")
    names = [p["name"] for p in out["context"]["projects"]["projects"]]
    # FTS alone can't match "js" to "JavaScript" (no stemming relationship);
    # hybrid mode's embedding half recovers it. pgvector KNN has no similarity
    # cutoff -- test_search_query.test_hybrid_finds_semantic_match asserts
    # only top-rank, not exclusivity, for the same reason -- so with this
    # 2-item fixture Ferris may also come back as a nearest neighbour. We
    # assert presence of the semantic match, not absence of the other item.
    assert "Ledger" in names


def test_alias_dict_is_gone():
    assert not hasattr(server, "KEYWORD_ALIASES")
    assert not hasattr(server, "_extract_keywords")
    assert not hasattr(server, "_item_matches_topic")
