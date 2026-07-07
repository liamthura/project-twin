import server

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
