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


# ---------------------------------------------------------------------------
# Task 2: action="link"/"unlink" -- entity-agnostic explicit relation writes
# ---------------------------------------------------------------------------

def test_link_happy_path_names_titles(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": [pid]})

    assert out.startswith("✅")
    assert pid in out and "Ledger" in out
    stored = persona_store.load("goals")["goals"][0]
    assert stored["related"] == [pid]


def test_link_entity_arg_is_ignored(as_user):
    # The `entity` argument passed to persona_modify/execute_modify is
    # completely ignored for link/unlink -- dispatch is on `action` alone.
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "anything_goes_here",
                                {"entity_id": gid, "related": [pid]})

    assert out.startswith("✅")
    assert persona_store.load("goals")["goals"][0]["related"] == [pid]


def test_link_single_target_string_accepted(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": pid})

    assert out.startswith("✅")
    assert persona_store.load("goals")["goals"][0]["related"] == [pid]


def test_link_unknown_source_prefix(as_user):
    out = server.execute_modify("link", "link", {"entity_id": "bogus_1234", "related": ["x"]})
    assert out.startswith("❌")
    assert "prefix" in out.lower()


def test_link_source_not_found(as_user):
    out = server.execute_modify("link", "link",
                                {"entity_id": "goal_deadbeef", "related": ["x"]})
    assert out.startswith("❌")
    assert "not found" in out.lower()


def test_link_source_in_disabled_section(as_user):
    import settings_store
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]
    settings_store.set_disabled_sections(["goals"])

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": ["project_x"]})

    assert out.startswith("❌")
    assert "disabled" in out.lower()


def test_link_unknown_target_prefix(as_user):
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": ["bogus_1234"]})

    assert out.startswith("❌")
    assert "bogus_1234" in out


def test_link_target_not_found(as_user):
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": ["project_deadbeef"]})

    assert out.startswith("❌")
    assert "project_deadbeef" in out
    assert persona_store.load("goals")["goals"][0].get("related") in (None, [])


def test_link_target_in_disabled_section(as_user):
    import settings_store
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]
    settings_store.set_disabled_sections(["projects"])

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": [pid]})

    assert out.startswith("❌")
    assert "disabled" in out.lower()
    assert persona_store.load("goals")["goals"][0].get("related") in (None, [])


def test_link_self_rejected(as_user):
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": [gid]})

    assert out.startswith("❌")
    assert gid in out
    assert persona_store.load("goals")["goals"][0].get("related") in (None, [])


def test_link_first_offender_named_and_nothing_partially_linked(as_user):
    # Second target is bad -- validation must fail before either target is
    # written (all-or-nothing), naming the offending target.
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "link",
                                {"entity_id": gid, "related": [pid, "project_deadbeef"]})

    assert out.startswith("❌")
    assert "project_deadbeef" in out
    assert persona_store.load("goals")["goals"][0].get("related") in (None, [])


def test_link_dedupes_across_calls(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    server.execute_modify("link", "link", {"entity_id": gid, "related": [pid]})
    out = server.execute_modify("link", "link", {"entity_id": gid, "related": [pid]})

    assert out.startswith("✅")
    assert persona_store.load("goals")["goals"][0]["related"] == [pid]


def test_link_dedupes_within_one_call(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    server.execute_modify("link", "link", {"entity_id": gid, "related": [pid, pid]})

    assert persona_store.load("goals")["goals"][0]["related"] == [pid]


def test_link_cap_at_ten(as_user):
    for i in range(10):
        server.execute_modify("add", "project", {"name": f"Proj{i}", "description": "x"})
    project_ids = [p["id"] for p in server.load_json("projects.json")["projects"]]
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("link", "link", {"entity_id": gid, "related": project_ids})
    assert out.startswith("✅")
    assert len(persona_store.load("goals")["goals"][0]["related"]) == 10

    server.execute_modify("add", "project", {"name": "Eleventh", "description": "x"})
    eleventh = next(p["id"] for p in server.load_json("projects.json")["projects"]
                    if p["name"] == "Eleventh")
    out2 = server.execute_modify("link", "link", {"entity_id": gid, "related": [eleventh]})

    assert out2 == "❌ related is capped at 10 links per entry"
    assert len(persona_store.load("goals")["goals"][0]["related"]) == 10


def test_unlink_removes_and_reports_missing(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]
    server.execute_modify("link", "link", {"entity_id": gid, "related": [pid]})

    out = server.execute_modify("unlink", "link",
                                {"entity_id": gid, "related": [pid, "project_neverlinked"]})

    assert "✅" in out and pid in out
    assert "ℹ️" in out and "project_neverlinked" in out
    assert persona_store.load("goals")["goals"][0].get("related") in (None, [])


def test_unlink_absent_id_only_gives_info_no_write(as_user):
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.execute_modify("unlink", "link",
                                {"entity_id": gid, "related": ["project_neverlinked"]})

    assert out.startswith("ℹ️")
    assert "✅" not in out


def test_unlink_no_targets_error(as_user):
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    gid = server.load_json("goals.json")["goals"][0]["id"]
    out = server.execute_modify("unlink", "link", {"entity_id": gid, "related": []})
    assert out.startswith("❌")


def test_link_one_directional_not_mirrored(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    server.execute_modify("link", "link", {"entity_id": gid, "related": [pid]})

    project = persona_store.load("projects")["projects"][0]
    assert "related" not in project or pid not in (project.get("related") or [])


def test_get_entity_round_trip_after_link(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    server.execute_modify("link", "link", {"entity_id": gid, "related": [pid]})
    out = json.loads(server.get_entity.fn(gid))

    assert {"id": pid, "title": "Ledger", "section": "projects"} in out["related"]


# ---------------------------------------------------------------------------
# persona_batch passthrough for link/unlink ops
# ---------------------------------------------------------------------------

def test_batch_link_unlink_passthrough(as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "dash"})
    server.execute_modify("add", "goal", {"title": "Ship it", "type": "learning"})
    pid = server.load_json("projects.json")["projects"][0]["id"]
    gid = server.load_json("goals.json")["goals"][0]["id"]

    out = server.persona_batch.fn([
        {"action": "link", "entity": "link", "data": {"entity_id": gid, "related": [pid]}},
        {"action": "unlink", "entity": "link", "data": {"entity_id": gid, "related": [pid]}},
    ])

    assert "1. ✅" in out
    assert "2. ✅" in out
    assert persona_store.load("goals")["goals"][0].get("related") in (None, [])


# ---------------------------------------------------------------------------
# Cross-section relation nudge on persona_modify adds
# ---------------------------------------------------------------------------

def _seed_project_for_nudge(monkeypatch, provider):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("projects", {
        "projects": [{"name": "Ledger", "description": "A JavaScript dashboard"}],
        "current_learning": [], "top_of_mind": [],
    })
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "projects", persona_store.load("projects"), embed_sync=True)


def test_nudge_fires_on_cross_section_fts_exact_title_match(as_user, monkeypatch):
    # FTS-only mode (no provider): semantic_neighbors' FTS fallback is seeded
    # with the just-written goal's own title -- an exact cross-section title
    # match ("Ledger") is a null-distance hit, which counts per the
    # fts_hit-truthiness rule.
    _seed_project_for_nudge(monkeypatch, None)

    out = server.persona_modify.fn("add", "goal", {"title": "Ledger", "type": "learning"})

    assert "Possibly related to" in out
    assert "Ledger" in out
    assert "(projects)" in out
    assert 'link them with action="link"' in out


def test_nudge_does_not_fire_when_same_section_duplicate_advisory_fires(as_user, monkeypatch):
    # Same-section dupe advisory wins: a project named "Ledger" resembling
    # the existing "Ledger" project fires the dupe note, not the nudge --
    # even though nothing here is cross-section related at all.
    _seed_project_for_nudge(monkeypatch, None)

    out = server.persona_modify.fn(
        "add", "project", {"name": "Ledger", "description": "different words"})

    assert "resembles existing" in out
    assert "Possibly related to" not in out


def test_nudge_does_not_fire_without_cross_section_match(as_user, monkeypatch):
    _seed_project_for_nudge(monkeypatch, None)

    out = server.persona_modify.fn(
        "add", "goal", {"title": "Totally unrelated", "type": "learning"})

    assert "Possibly related to" not in out


def test_nudge_never_fires_on_update_or_remove(as_user, monkeypatch):
    _seed_project_for_nudge(monkeypatch, None)
    server.persona_modify.fn("add", "goal", {"title": "Ledger", "type": "learning"})

    out = server.persona_modify.fn(
        "update", "goal", {"title": "Ledger", "status": "active"})

    assert "Possibly related to" not in out


def test_nudge_batch_per_op_parity(as_user, monkeypatch):
    _seed_project_for_nudge(monkeypatch, None)

    out = server.persona_batch.fn([
        {"action": "add", "entity": "goal", "data": {"title": "Ledger", "type": "learning"}},
    ])

    assert "Possibly related to" in out


def test_nudge_probe_failure_never_breaks_write(as_user, monkeypatch):
    _seed_project_for_nudge(monkeypatch, None)
    monkeypatch.setattr(search_index, "semantic_neighbors",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))

    out = server.persona_modify.fn("add", "goal", {"title": "Ledger", "type": "learning"})

    assert "Possibly related to" not in out
    assert any(g["title"] == "Ledger" for g in persona_store.load("goals")["goals"])
