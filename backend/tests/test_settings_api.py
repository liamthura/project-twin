from fastapi.testclient import TestClient

import main


def _client_and_auth():
    client = TestClient(main.app)
    r = client.post("/api/auth/register", json={"username": "settings-test-user"})
    token = r.json()["token"]
    return client, {"Authorization": f"Bearer {token}"}


def test_get_settings_defaults(clean_database):
    client, auth = _client_and_auth()
    body = client.get("/api/settings", headers=auth).json()
    assert body["disabled_sections"] == []
    assert set(body["toggleable"]) == {"knowledge", "projects", "lifestyle", "circle"}
    assert set(body["always_on"]) == {"profile", "preferences", "learning_log"}


def test_put_settings_persists(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings", json={"disabled_sections": ["circle", "knowledge"]}, headers=auth)
    assert r.status_code == 200
    body = client.get("/api/settings", headers=auth).json()
    assert set(body["disabled_sections"]) == {"circle", "knowledge"}


def test_put_rejects_always_on_section(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings", json={"disabled_sections": ["profile"]}, headers=auth)
    assert r.status_code == 400


def test_put_rejects_unknown_section(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings", json={"disabled_sections": ["bogus"]}, headers=auth)
    assert r.status_code == 400


def test_get_settings_includes_pack_metadata(clean_database):
    client, auth = _client_and_auth()
    body = client.get("/api/settings", headers=auth).json()
    packs = body["packs"]
    assert [p["key"] for p in packs] == [
        "profile", "knowledge", "preferences", "projects",
        "lifestyle", "circle", "learning_log",
    ]
    profile = packs[0]
    assert profile == {
        "key": "profile",
        "title": "Profile",
        "description": "Identity, work, education, contact",
        "core": True,
        "enabled": True,
    }
    # disabling a toggleable pack is reflected in `enabled`
    client.put("/api/settings", json={"disabled_sections": ["circle"]}, headers=auth)
    body = client.get("/api/settings", headers=auth).json()
    circle = next(p for p in body["packs"] if p["key"] == "circle")
    assert circle["enabled"] is False and circle["core"] is False
