"""Goals scope hook: active-only in globals, ≤5 stubs in minimal, all in goals scope."""
import server


def _seed(n_active=6, achieved=True):
    for i in range(n_active):
        server.execute_modify("add", "goal", {"title": f"Active goal {i}", "type": "learning"})
    if achieved:
        server.execute_modify("add", "goal", {"title": "Done goal", "status": "achieved"})
        server.execute_modify("add", "goal", {"title": "Dropped goal", "status": "dropped"})


def test_minimal_scope_stubs_active_goals_max5(as_user):
    _seed()
    ctx = server.get_scoped_context("minimal")["context"]
    goals = ctx["goals"]["goals"]
    assert len(goals) == 5
    assert all(set(g) == {"id", "title"} for g in goals)
    assert all("Done goal" != g["title"] and "Dropped goal" != g["title"] for g in goals)


def test_professional_scope_full_active_goals_only(as_user):
    _seed(n_active=2)
    ctx = server.get_scoped_context("professional")["context"]
    goals = ctx["goals"]["goals"]
    assert len(goals) == 2
    assert all(g["status"] == "active" for g in goals)
    assert any("type" in g for g in goals)  # full entries, not stubs


def test_goals_section_scope_includes_non_active(as_user):
    _seed(n_active=1)
    ctx = server.get_scoped_context("goals")["context"]
    titles = {g["title"] for g in ctx["goals"]["goals"]}
    assert {"Active goal 0", "Done goal", "Dropped goal"} <= titles


def test_mixed_scope_with_goal_bearing_token_keeps_full(as_user):
    _seed(n_active=2)
    ctx = server.get_scoped_context(["minimal", "professional"])["context"]
    goals = ctx["goals"]["goals"]
    assert all("status" in g for g in goals)  # professional wins: full entries


def test_full_scope_active_only(as_user):
    _seed(n_active=1)
    ctx = server.get_scoped_context("full")["context"]
    titles = {g["title"] for g in ctx["goals"]["goals"]}
    assert "Done goal" not in titles
