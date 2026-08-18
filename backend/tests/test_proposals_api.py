"""The four review endpoints."""
from fastapi.testclient import TestClient

import db
import main
import proposals_store as ps
import server


def _client_and_auth():
    client = TestClient(main.app)
    r = client.post("/api/auth/register", json={"username": "proposals-test-user"})
    return client, {"Authorization": f"Bearer {r.json()['token']}"}


def _as_that_user(client, auth):
    """Bind current_user_id so the seed helpers write as the API's user."""
    user_id = client.get("/api/auth/whoami", headers=auth).json()["user_id"]
    db.current_user_id.set(user_id)


def _seed_entity():
    return ps.create(
        "entity", client="Cursor", rationale="r", evidence="e",
        action="add", entity="domain", identifier="Datadog",
        data={"name": "Datadog", "level": "advanced"},
    )["id"]


def _seed_note():
    return ps.create(
        "note", client="Cursor", rationale="r", evidence="e",
        note="Wants recommendations first", section_hint="knowledge",
    )["id"]


def test_listing_returns_only_the_requested_kind(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    _seed_entity()
    _seed_note()
    entities = client.get("/api/proposals?kind=entity", headers=auth).json()["proposals"]
    assert len(entities) == 1
    assert entities[0]["kind"] == "entity"


def test_listing_exposes_the_proposing_client(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    _seed_entity()
    rows = client.get("/api/proposals?kind=entity", headers=auth).json()["proposals"]
    assert rows[0]["proposed_by"] == "Cursor"


def test_listing_rejects_an_unknown_kind(clean_database):
    client, auth = _client_and_auth()
    assert client.get("/api/proposals?kind=bogus", headers=auth).status_code == 400


def test_approving_writes_the_entity(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_entity()
    assert client.post(f"/api/proposals/{pid}/approve", headers=auth).status_code == 200
    assert [d["name"] for d in server.load_json("knowledge.json")["domains"]] == ["Datadog"]


def test_approving_with_edits_writes_the_edited_data(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_entity()
    client.post(f"/api/proposals/{pid}/approve", headers=auth,
                json={"data": {"name": "Datadog", "level": "intermediate"}})
    [domain] = server.load_json("knowledge.json")["domains"]
    assert domain["level"] == "intermediate"


def test_the_count_endpoint_reports_both_queues(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    _seed_entity()
    _seed_note()
    body = client.get("/api/proposals/count", headers=auth).json()
    assert body == {"entity": 1, "note": 1, "total": 2}


def test_counting_does_not_mark_rows_as_seen(clean_database):
    """The sidebar dot polls this from every tab. If counting marked rows
    seen, sitting on Profile would quietly strip the eviction protection off
    observations the user has never once looked at."""
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    _seed_note()
    client.get("/api/proposals/count", headers=auth)
    assert ps.list_pending("note", mark_seen=False)[0]["seen_at"] is None


def test_the_count_is_zero_when_the_queue_is_empty(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    assert client.get("/api/proposals/count", headers=auth).json()["total"] == 0


def test_the_count_is_scoped_to_the_user(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    _seed_entity()
    other = TestClient(main.app)
    r = other.post("/api/auth/register", json={"username": "someone-else"})
    other_auth = {"Authorization": f"Bearer {r.json()['token']}"}
    assert other.get("/api/proposals/count", headers=other_auth).json()["total"] == 0


def test_approving_reports_which_section_changed(clean_database):
    # The UI links the user straight to what moved. Deriving the section
    # frontend-side would mean a second copy of the entity->section map.
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_entity()
    assert client.post(f"/api/proposals/{pid}/approve", headers=auth).json()["section"] == "knowledge"


def test_promoting_reports_which_section_changed(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_note()
    r = client.post(f"/api/proposals/{pid}/promote", headers=auth, json={
        "entity": "hobby", "data": {"name": "Bouldering"}})
    assert r.json()["section"] == "lifestyle"


def test_rejecting_reports_no_section(clean_database):
    # Nothing changed, so there is nothing to link to.
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_entity()
    assert client.post(f"/api/proposals/{pid}/reject", headers=auth).json()["section"] is None


def test_approving_removes_it_from_the_queue(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_entity()
    client.post(f"/api/proposals/{pid}/approve", headers=auth)
    assert client.get("/api/proposals?kind=entity", headers=auth).json()["proposals"] == []


def test_rejecting_leaves_the_persona_alone(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_entity()
    client.post(f"/api/proposals/{pid}/reject", headers=auth)
    assert server.load_json("knowledge.json").get("domains", []) == []


def test_promoting_a_note_creates_the_entity_and_tags_it(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_note()
    r = client.post(f"/api/proposals/{pid}/promote", headers=auth, json={
        "entity": "mental_tab",
        "data": {"title": "Wants recommendations first"},
    })
    assert r.status_code == 200
    [tab] = server.load_json("knowledge.json")["mental_tabs"]
    assert "agent-observation" in tab.get("tags", [])


def test_promotion_records_provenance_even_without_a_tags_field(clean_database):
    # Only four entities declare `tags`. Provenance must not depend on that:
    # the ledger row is what survives, and it points at what the note became.
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_note()
    r = client.post(f"/api/proposals/{pid}/promote", headers=auth, json={
        "entity": "domain", "data": {"name": "Recommendation-first", "level": "advanced"},
    })
    assert r.status_code == 200
    # The entity ID, not the entity type. `domain` would only say what kind of
    # thing the note became; the id is what makes the ledger reversible, so
    # "why is this in my persona" has an answer for this specific entry.
    promoted_to = ps.get(pid)["promoted_to"]
    assert promoted_to.startswith("domain_"), promoted_to
    assert ps.get(pid)["status"] == "promoted"

    # ...and that link resolves back the other way.
    found = ps.for_entity(promoted_to)
    assert [p["id"] for p in found] == [pid]


def test_promoting_clears_it_from_the_queue(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_note()
    client.post(f"/api/proposals/{pid}/promote", headers=auth, json={
        "entity": "mental_tab", "data": {"title": "X"}})
    assert client.get("/api/proposals?kind=note", headers=auth).json()["proposals"] == []


def test_approving_an_unknown_id_is_404(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    r = client.post("/api/proposals/00000000-0000-0000-0000-000000000000/approve",
                    headers=auth)
    assert r.status_code == 404


def test_promoting_an_entity_proposal_is_rejected(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_entity()
    r = client.post(f"/api/proposals/{pid}/promote", headers=auth, json={
        "entity": "mental_tab", "data": {"title": "X"}})
    assert r.status_code == 400


def test_approving_a_note_is_rejected(clean_database):
    client, auth = _client_and_auth()
    _as_that_user(client, auth)
    pid = _seed_note()
    assert client.post(f"/api/proposals/{pid}/approve", headers=auth).status_code == 400
