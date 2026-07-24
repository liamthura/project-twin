"""Phase 6 Task 1: semantic_neighbors()/resolve_titles() in search_index,
and get_entity's `related` (stored links, always resolved) / `similar`
(derived neighbors, on request) surfaces. Links themselves (action="link")
are Task 2 -- here `related` is seeded directly via persona_store.save."""
import json

import db
import embeddings
import persona_store
import search_index
import server
from tests.test_search_query import VocabProvider


def _get_entity(entity_id, **kwargs):
    return json.loads(server.get_entity.fn(entity_id, **kwargs))


# ---------------------------------------------------------------------------
# search_index.semantic_neighbors()
# ---------------------------------------------------------------------------

def test_neighbors_cross_section_fts_only(as_user):
    # FTS-only mode: no embedding provider configured (conftest strips the
    # relevant env vars, so embeddings.get_provider() is already None here).
    server.execute_modify("add", "project", {"name": "MyGist MCP server",
                                              "description": "persona context server"})
    server.execute_modify("add", "goal", {"title": "Ship MyGist relations", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    neighbors = search_index.semantic_neighbors(db.current_user_id.get(), gid)

    assert any(n["file_type"] == "projects" for n in neighbors)
    assert all(n["entity_id"] != gid for n in neighbors)
    assert all(n["file_type"] != "goals" for n in neighbors)  # cross-section only


def test_neighbors_hybrid_vector_path(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: VocabProvider())
    persona_store.save("projects", {
        "projects": [{"name": "Ledger", "description": "A JavaScript dashboard"}],
        "current_learning": [], "top_of_mind": [],
    })
    persona_store.save("goals", {"goals": [{"title": "Learn javascript deeply",
                                             "type": "learning"}]})
    uid = db.current_user_id.get()
    for ft in ("projects", "goals"):
        search_index.sync_index(uid, ft, persona_store.load(ft), embed_sync=True)
    gid = persona_store.load("goals")["goals"][0]["id"]
    pid = persona_store.load("projects")["projects"][0]["id"]

    neighbors = search_index.semantic_neighbors(uid, gid)

    assert neighbors
    assert neighbors[0]["entity_id"] == pid
    assert neighbors[0]["file_type"] == "projects"
    assert neighbors[0]["distance"] is not None


def test_neighbors_respects_exclude_sections(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ledger", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    neighbors = search_index.semantic_neighbors(db.current_user_id.get(), gid,
                                                  exclude_sections=["projects"])

    assert neighbors == []


def test_neighbors_unindexed_entity_returns_empty(as_user):
    neighbors = search_index.semantic_neighbors(db.current_user_id.get(), "goal_deadbeef")
    assert neighbors == []


def test_neighbors_null_source_embedding_falls_back_to_fts(as_user, monkeypatch):
    # Hybrid mode is configured (provider present, pgvector available) but the
    # source row itself hasn't been embedded yet -- must degrade to the FTS
    # fallback seeded with the source row's title, not crash / return [].
    monkeypatch.setattr(embeddings, "get_provider", lambda: VocabProvider())
    uid = db.current_user_id.get()
    doc_vec = str(VocabProvider().embed(["dummy"])[0])
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into persona_search (user_id, file_type, entity_id, title, text,"
            " content_hash, embedding, updated_at)"
            " values (%s, 'goals', 'goal_aaaaaaaa', 'Ledger', 'Ledger javascript project',"
            " 'h1', null, now())",
            (uid,),
        )
        conn.execute(
            "insert into persona_search (user_id, file_type, entity_id, title, text,"
            " content_hash, embedding, updated_at)"
            " values (%s, 'projects', 'project_bbbbbbbb', 'Ledger', 'Ledger javascript"
            " project', 'h2', %s, now())",
            (uid, doc_vec),
        )

    neighbors = search_index.semantic_neighbors(uid, "goal_aaaaaaaa")

    assert any(n["entity_id"] == "project_bbbbbbbb" for n in neighbors)


# ---------------------------------------------------------------------------
# search_index.resolve_titles()
# ---------------------------------------------------------------------------

def test_resolve_titles_batches_and_skips_missing(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    pid = server.load_json("projects.json")["projects"][0]["id"]

    titles = search_index.resolve_titles(db.current_user_id.get(), [pid, "project_deadbeef"])

    assert titles[pid] == {"title": "Ledger", "file_type": "projects"}
    assert "project_deadbeef" not in titles


def test_resolve_titles_empty_input(as_user):
    assert search_index.resolve_titles(db.current_user_id.get(), []) == {}


# ---------------------------------------------------------------------------
# get_entity: related (stored links, always resolved) + similar (derived)
# ---------------------------------------------------------------------------

def test_related_resolution_and_dangling(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    # Task 1 precedes link (Task 2): seed `related` directly through
    # persona_store.save, as the plan's TDD sketch prescribes.
    persona_store.save("goals", {"goals": [
        {"title": "Ship it", "type": "learning", "related": [pid, "goal_deadbeef"]},
    ]})
    gid = persona_store.load("goals")["goals"][0]["id"]

    result = _get_entity(gid)

    assert {"id": pid, "title": "Ledger", "section": "projects"} in result["related"]
    # a link to a since-deleted/never-existed entry stays visible, not hidden
    assert {"id": "goal_deadbeef", "title": None, "section": None} in result["related"]
    assert "similar" not in result  # include_related defaults to False


def test_no_related_field_omits_related_key(as_user):
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    result = _get_entity(gid)

    assert "related" not in result


def test_include_related_adds_similar_neighbors(as_user):
    server.execute_modify("add", "project", {"name": "MyGist MCP server",
                                              "description": "persona context server"})
    server.execute_modify("add", "goal", {"title": "Ship MyGist relations", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    result = _get_entity(gid, include_related=True)

    assert any(s["section"] == "projects" for s in result["similar"])
    assert all(s["id"] != gid for s in result["similar"])


def test_include_related_similar_empty_when_no_neighbors(as_user):
    server.execute_modify("add", "goal", {"title": "Solo goal", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    result = _get_entity(gid, include_related=True)

    assert result["similar"] == []


def test_similar_excludes_disabled_sections(as_user):
    import settings_store
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ledger", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]
    settings_store.set_disabled_sections(["projects"])

    result = _get_entity(gid, include_related=True)

    assert all(s["section"] != "projects" for s in result["similar"])


def test_batch_get_entity_resolves_related_once(as_user, monkeypatch):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    persona_store.save("goals", {"goals": [
        {"title": "Ship it", "type": "learning", "related": [pid]},
        {"title": "Learn Rust", "type": "learning", "related": [pid]},
    ]})
    g1, g2 = persona_store.load("goals")["goals"]

    calls = []
    real_resolve_titles = search_index.resolve_titles

    def counting_resolve_titles(user_id, ids):
        calls.append(list(ids))
        return real_resolve_titles(user_id, ids)

    monkeypatch.setattr(search_index, "resolve_titles", counting_resolve_titles)

    out = json.loads(server.get_entity.fn([g1["id"], g2["id"]]))

    assert len(calls) == 1  # no N+1 -- one resolve_titles call for the whole batch
    assert set(calls[0]) == {pid}
    for e in out["entities"]:
        assert e["related"] == [{"id": pid, "title": "Ledger", "section": "projects"}]


def test_batch_get_entity_include_related_similar_per_entity(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ledger goal", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = json.loads(server.get_entity.fn([pid, gid], include_related=True))

    for e in out["entities"]:
        assert "similar" in e


# ---------------------------------------------------------------------------
# get_scoped_context: `related` stripped from every id-list entry
# ---------------------------------------------------------------------------

def test_scope_reads_strip_related(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    persona_store.save("goals", {"goals": [
        {"title": "Ship it", "type": "learning", "related": [pid]},
    ]})

    ctx = server.get_scoped_context("professional")["context"]

    [goal] = ctx["goals"]["goals"]
    assert "related" not in goal

    # The strip must not mutate the underlying stored blob.
    stored = persona_store.load("goals")["goals"][0]
    assert stored["related"] == [pid]


def test_scope_reads_strip_related_titles_detail(as_user):
    persona_store.save("goals", {"goals": [
        {"title": "Ship it", "type": "learning", "related": ["goal_deadbeef"]},
    ]})

    ctx = server.get_scoped_context("professional", detail="titles")["context"]

    [goal] = ctx["goals"]["goals"]
    assert "related" not in goal


def test_get_raw_keeps_related(as_user):
    persona_store.save("goals", {"goals": [
        {"title": "Ship it", "type": "learning", "related": ["goal_deadbeef"]},
    ]})

    raw = json.loads(server.get_raw.fn("goals"))

    assert raw["goals"][0]["related"] == ["goal_deadbeef"]
