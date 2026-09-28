"""persona_provenance: who added and changed each entry, and staleness with Keep."""
from fastapi.testclient import TestClient

import db
import main
import persona_store
import proposals_store as ps
import server


def _project_id(name):
    return next(p["id"] for p in persona_store.load("projects")["projects"] if p["name"] == name)


def _age(entity_id, days):
    """Backdate an entry's last content change, as time passing would."""
    with db.get_pool().connection() as conn:
        conn.execute(
            "update persona_search set updated_at = now() - make_interval(days => %s)"
            " where user_id = %s and entity_id = %s",
            (days, db.current_user_id.get(), entity_id),
        )


def test_each_write_path_records_who_did_it(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    token = db.current_client.set("Claude Desktop 0.9.2")
    try:
        server.execute_modify("update", "project", {"name": "Ledger", "description": "Rewritten"})
    finally:
        db.current_client.reset(token)

    entry = persona_store.provenance("projects")["entries"][_project_id("Ledger")]
    assert entry["added"]["via"] == "editor" and entry["added"]["by"] == ""
    # The version is dropped: it would make one app look like several.
    assert entry["changed"] == {"by": "Claude Desktop", "via": "assistant", "at": entry["changed"]["at"]}


def test_a_restored_entry_keeps_its_origin(clean_database, as_user):
    token = db.current_client.set("Cursor 1.0")
    try:
        server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    finally:
        db.current_client.reset(token)
    ledger = _project_id("Ledger")
    server.execute_modify("remove", "project", {"name": "Ledger"})
    persona_store.revert("projects", persona_store.history("projects")[0]["id"])

    entry = persona_store.provenance("projects")["entries"][ledger]
    assert entry["added"]["by"] == "Cursor"
    assert entry["changed"]["via"] == "editor"


def test_stale_until_kept_for_the_editor_and_the_assistants(clean_database, as_user):
    server.execute_modify("add", "project", {"name": "Ledger", "description": "A dashboard"})
    ledger = _project_id("Ledger")
    _age(ledger, 200)  # projects go stale after 120

    assert persona_store.provenance("projects")["entries"][ledger]["stale"] is True
    assert [e["id"] for e in persona_store.stale_entries()] == [ledger]
    assert server._mark_stale({"projects": persona_store.load("projects")})["projects"]["projects"][0].get("stale")

    assert persona_store.keep(ledger) is True
    assert persona_store.provenance("projects")["entries"][ledger]["stale"] is False
    assert persona_store.stale_entries() == []
    assert not server._mark_stale({"projects": persona_store.load("projects")})["projects"]["projects"][0].get("stale")


def test_keep_refuses_an_entry_you_do_not_have(clean_database, as_user):
    assert persona_store.keep("project_nope") is False


def test_an_approved_suggestion_is_recorded_as_reviews(clean_database):
    client = TestClient(main.app)
    auth = {"Authorization": f"Bearer {client.post('/api/auth/register', json={'username': 'prov'}).json()['token']}"}
    db.current_user_id.set(client.get("/api/auth/whoami", headers=auth).json()["user_id"])
    pid = ps.create(
        "entity", client="Cursor", rationale="r", evidence="e",
        action="add", entity="domain", identifier="Datadog",
        data={"name": "Datadog", "level": "advanced"},
    )["id"]
    assert client.post(f"/api/proposals/{pid}/approve", headers=auth).status_code == 200

    entries = client.get("/api/provenance/knowledge", headers=auth).json()["entries"]
    (entry,) = entries.values()
    assert entry["added"] == {"by": "Cursor", "via": "review", "at": entry["added"]["at"], "proposal_id": pid}
    assert client.post("/api/provenance/domain_nope/keep", headers=auth).status_code == 404
    assert client.post(f"/api/provenance/{entry['id']}/keep", headers=auth).status_code == 200
