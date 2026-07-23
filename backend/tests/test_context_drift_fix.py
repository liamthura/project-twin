import json
import server


def test_professional_scope_includes_previously_dropped_fields(as_user):
    # Seed the drifted fields directly through the store (this also creates the row):
    import persona_store as store
    p = store.load("profile")
    p["organisation"] = "Acme"
    p["nationality"] = "British"
    p["languages_spoken"] = [{"name": "English"}]
    store.save("profile", p)

    ctx = json.loads(server.get_context.fn(scope="professional"))["context"]["profile"]
    assert ctx.get("organisation") == "Acme"
    assert ctx.get("nationality") == "British"
    assert "languages_spoken" in ctx


def test_personal_scope_includes_goals_and_languages(as_user):
    import persona_store as store
    g = store.load("goals")
    g["goals"] = [{"title": "Ship it"}]
    store.save("goals", g)
    p = store.load("profile")
    p["languages_spoken"] = [{"name": "English"}]
    p["nationality"] = "British"
    store.save("profile", p)

    full_ctx = json.loads(server.get_context.fn(scope="personal"))["context"]
    ctx = full_ctx["profile"]
    assert "goals" in full_ctx["goals"]
    assert "languages_spoken" in ctx
    assert ctx.get("nationality") == "British"
