import embeddings
import persona_store
import search_index
import server
from tests.test_search_query import VocabProvider  # reuse the synonym fake


def _seed(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    # persona_store.save() fires the embed job on search_index's shared,
    # single-worker background executor. Running it inline (instead of
    # asserting immediately after save() and hoping the background thread
    # already finished) makes embedding deterministic for these tests without
    # racing or fighting that thread over the persona_search rows.
    monkeypatch.setattr(search_index._EXECUTOR, "submit",
                         lambda fn, *a, **kw: fn(*a, **kw))
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
    out = server.get_scoped_context("professional", topic="js")
    names = [p["name"] for p in out["context"]["projects"]["projects"]]
    # FTS alone can't match "js" to "JavaScript" (no stemming relationship);
    # hybrid mode's embedding half recovers it. The TOPIC_VECTOR_DISTANCE_CUTOFF
    # in server._filter_by_topic excludes Ferris (orthogonal fake embedding,
    # cosine distance 1.0 from the query), so this is now exact.
    assert names == ["Ledger"]


def _seed_many(monkeypatch, provider):
    """8-entity fixture: only Ledger genuinely relates to the "js" topic;
    Ferris relates to "rust"; the rest are topically unrelated to both and
    embed to VocabProvider's orthogonal fallback vector. Large enough to
    exceed a toy 2-item corpus and prove the vector cutoff actually excludes
    unrelated entities rather than everything happening to be "close enough"
    by virtue of there being nothing else in the index."""
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    monkeypatch.setattr(search_index._EXECUTOR, "submit",
                         lambda fn, *a, **kw: fn(*a, **kw))
    persona_store.save("projects", {
        "projects": [
            {"name": "Ledger", "description": "A JavaScript dashboard"},
            {"name": "Ferris", "description": "Rust CLI tool"},
            {"name": "Cook", "description": "Cooking recipes collection"},
            {"name": "Garden", "description": "Gardening tips and tricks"},
            {"name": "Photo", "description": "Photography guide for beginners"},
            {"name": "Paint", "description": "Painting studio notes"},
            {"name": "Chess", "description": "Chess strategy exercises"},
            {"name": "Yoga", "description": "Yoga practice routine"},
        ],
        "current_learning": [], "top_of_mind": [],
    })


def test_hybrid_mode_hard_cutoff_excludes_unrelated_entities(as_user, monkeypatch):
    # Regression for the reviewer-found gap: pgvector KNN has no similarity
    # threshold, so it always returns its nearest CANDIDATES(40) rows
    # regardless of distance. With a corpus smaller than CANDIDATES, every
    # entity used to land in the matched set and topic filtering did nothing.
    # 8 entities here (< 40); only Ledger should survive topic="js" in hybrid
    # mode once TOPIC_VECTOR_DISTANCE_CUTOFF is enforced.
    _seed_many(monkeypatch, VocabProvider())
    out = server.get_scoped_context("professional", topic="js")
    names = [p["name"] for p in out["context"]["projects"]["projects"]]
    assert names == ["Ledger"]


def test_fts_only_mode_exact_with_many_entities(as_user, monkeypatch):
    # Control: FTS-only mode was never affected by the vector-cutoff gap --
    # websearch_to_tsquery has no false-positive problem here -- included to
    # show the contrast the reviewer used to confirm the bug (FTS-only
    # correctly kept just Ferris for topic="rust").
    _seed_many(monkeypatch, None)
    out = server.get_scoped_context("professional", topic="rust")
    names = [p["name"] for p in out["context"]["projects"]["projects"]]
    assert names == ["Ferris"]


def test_alias_dict_is_gone():
    assert not hasattr(server, "KEYWORD_ALIASES")
    assert not hasattr(server, "_extract_keywords")
    assert not hasattr(server, "_item_matches_topic")
