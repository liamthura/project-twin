import math
import re

import pytest

import db
import embeddings
import persona_store
import search_index
import server
from tests.test_search_query import VocabProvider


@pytest.fixture(autouse=True)
def _drain_embed_executor_after(monkeypatch):
    """search_index's background embed executor has one worker and lives for
    the whole test session (module-level singleton), not per test. A real
    "add" under a mocked provider schedules an async embed job there
    (embed_sync=False is persona_store.save's default); if that job hasn't
    run by the time this test's monkeypatch/db pool are torn down, it can
    fire later under a *different* test's provider/pool -- order-dependent
    flakiness. Depending on `monkeypatch` here forces this fixture's
    teardown (LIFO) to run before monkeypatch's own, so draining (waiting
    for anything already queued to finish) always happens while this test's
    state is still live.
    """
    yield
    search_index._EXECUTOR.submit(lambda: None).result(timeout=5)


class AngleProvider:
    """Fixed-angle fake: every document embeds to the same unit vector; the
    query embeds to a unit vector at a chosen cosine similarity to it, so the
    resulting cosine distance between any new entity and the seeded one is
    exact and independent of text content -- lets boundary tests around
    DUPLICATE_DISTANCE_CUTOFF (0.4) hit a precise, reproducible distance
    (distance = 1 - cosine_similarity for unit vectors)."""

    def __init__(self, cos_sim):
        dim = db.EMBEDDING_DIM
        self.doc_vec = [1.0, 0.0] + [0.0] * (dim - 2)
        other = math.sqrt(max(0.0, 1.0 - cos_sim ** 2))
        self.query_vec = [cos_sim, other] + [0.0] * (dim - 2)

    def embed(self, texts, input_type="document"):
        vec = self.query_vec if input_type == "query" else self.doc_vec
        return [vec for _ in texts]


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
    # Locks the verbatim spec wording (entity_id/title interpolated, no
    # emoji, no distance field, plain double-quoted title) so drift in the
    # message format is caught here rather than by a loose substring check.
    assert re.search(
        r' Note: resembles existing project_\w+ "Ledger"'
        r' — if this is the same item, use action="update" instead\.',
        out,
    )
    assert len(persona_store.load("projects")["projects"]) == 2  # write happened


def test_hybrid_distance_just_above_cutoff_no_advisory(as_user, monkeypatch):
    # cos_sim=0.55 -> distance=0.45, just above DUPLICATE_DISTANCE_CUTOFF (0.4)
    _seed_project(monkeypatch, AngleProvider(cos_sim=0.55))
    out = server.persona_modify.fn(
        "add", "project", {"name": "Something Else", "description": "unrelated text"})
    assert "resembles existing" not in out


def test_hybrid_distance_at_cutoff_gets_advisory(as_user, monkeypatch):
    # cos_sim=0.65 -> distance=0.35, comfortably at/under the 0.4 cutoff
    _seed_project(monkeypatch, AngleProvider(cos_sim=0.65))
    out = server.persona_modify.fn(
        "add", "project", {"name": "Something Else 2", "description": "unrelated text"})
    assert "resembles existing" in out


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


def _seed_top_of_mind(monkeypatch, provider, idea="Switch to a monorepo"):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [], "current_learning": [],
        "top_of_mind": [{"idea": idea, "note": ""}],
    })
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "projects", persona_store.load("projects"),
                            embed_sync=True)


def test_top_of_mind_advisory_omits_update_hint(as_user, monkeypatch):
    # top_of_mind's ENTITY_SCHEMA only lists ["add", "remove"] -- no "update"
    # action exists for it, so the advisory must not suggest one (F1).
    _seed_top_of_mind(monkeypatch, None)
    out = server.persona_modify.fn(
        "add", "top_of_mind",
        {"item": "Switch to a monorepo", "note": "different note"})
    assert "resembles existing" in out
    assert 'action="update"' not in out
    assert re.search(
        r' Note: resembles existing top_\w+ "Switch to a monorepo"'
        r' — it may be a duplicate\.',
        out,
    )


def test_project_advisory_still_offers_update_hint(as_user, monkeypatch):
    # Regression guard alongside the top_of_mind case above: an
    # update-capable entity (project) must keep the verbatim update wording.
    _seed_project(monkeypatch, None)
    out = server.persona_modify.fn(
        "add", "project", {"name": "Ledger", "description": "different words"})
    assert 'use action="update" instead.' in out


def test_advisory_survives_title_with_embedded_quote(as_user, monkeypatch):
    # F4: a title containing a literal double-quote/operator-like text used
    # to garble the FTS query (websearch_to_tsquery interpreting the stray
    # quote as a phrase delimiter across "OR" and the rest of the query),
    # causing the entity to fail to match even its own resurfaced text.
    title = 'Ben "Franklin'
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("projects", {
        "projects": [{"name": title,
                      "description": "A history project about a founding father"}],
        "current_learning": [], "top_of_mind": [],
    })
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "projects", persona_store.load("projects"),
                            embed_sync=True)

    out = server.persona_modify.fn(
        "add", "project",
        {"name": title,
         "description": "different words about the same founding father"})
    assert "resembles existing" in out
