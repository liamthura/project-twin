import server
import persona_store as store

# `as_user` fixture is provided by tests/conftest.py.
# persona_modify is registered as a FastMCP FunctionTool; `.fn` is the raw callable.
persona_modify = server.persona_modify.fn


def test_new_domain_gets_an_id(as_user):
    persona_modify(action="add", entity="domain", data={"name": "Rust", "level": "learning"})
    domains = server.load_json("knowledge.json")["domains"]
    assert domains[-1]["id"].startswith("domain_")


def test_new_hobby_gets_an_id(as_user):
    persona_modify(action="add", entity="hobby", data={"name": "Chess"})
    hobbies = server.load_json("lifestyle.json")["hobbies"]
    assert hobbies[-1]["id"].startswith("hobby_")


def test_new_project_gets_an_id(as_user):
    persona_modify(action="add", entity="project", data={"name": "Blog", "description": "A blog"})
    projects = server.load_json("projects.json")["projects"]
    assert projects[-1]["id"].startswith("project_")


def test_new_connection_gets_an_id(as_user):
    persona_modify(action="add", entity="connection", data={"name": "Sam"})
    connections = server.load_json("circle.json")["connections"]
    assert connections[-1]["id"].startswith("connection_")


# --- IDs are assigned on save(), so the frontend's direct PUT path gets them
# too, and the "gray area" object-lists are covered. ---


def test_save_assigns_ids_to_gray_area_profile_lists(as_user):
    store.save("profile", {
        "work_experience": [{"company": "Acme"}],
        "education": [{"institution": "Uni"}],
        "languages_spoken": [{"name": "English"}],
        "goals_and_careers": [{"goal": "Ship it"}],
    })
    p = store.load("profile")
    assert p["work_experience"][0]["id"].startswith("work_")
    assert p["education"][0]["id"].startswith("education_")
    assert p["languages_spoken"][0]["id"].startswith("language_")
    assert p["goals_and_careers"][0]["id"].startswith("goal_")


def test_save_assigns_ids_to_gray_area_project_and_knowledge_lists(as_user):
    store.save("projects", {"current_learning": [{"topic": "Rust"}], "top_of_mind": [{"topic": "Launch"}]})
    store.save("knowledge", {"mental_tabs": [{"name": "Read paper"}]})
    proj = store.load("projects")
    assert proj["current_learning"][0]["id"].startswith("learning_")
    assert proj["top_of_mind"][0]["id"].startswith("top_")
    assert store.load("knowledge")["mental_tabs"][0]["id"].startswith("tab_")


def test_save_assigns_ids_via_direct_frontend_path(as_user):
    # Mirrors PUT /api/files/lifestyle -> persona_store.save (no MCP add branch).
    store.save("lifestyle", {"hobbies": [{"name": "Chess"}]})
    assert store.load("lifestyle")["hobbies"][0]["id"].startswith("hobby_")


def test_ids_are_stable_across_resaves(as_user):
    store.save("projects", {"projects": [{"name": "Blog"}]})
    first = store.load("projects")["projects"][0]["id"]
    store.save("projects", store.load("projects"))  # round-trip
    assert store.load("projects")["projects"][0]["id"] == first
