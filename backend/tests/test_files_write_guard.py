from fastapi.testclient import TestClient

import main


def _client_and_auth():
    client = TestClient(main.app)
    r = client.post("/api/auth/register", json={"username": "files-write-guard-user"})
    token = r.json()["token"]
    return client, {"Authorization": f"Bearer {token}"}


def test_put_files_rejects_reserved_settings_key(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/files/_settings",
        json={"data": {"disabled_sections": ["profile"]}},
        headers=auth,
    )
    assert r.status_code == 400


def test_put_files_rejects_unknown_file_type(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/files/bogus", json={"data": {}}, headers=auth)
    assert r.status_code == 400


def test_put_files_allows_valid_section(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/files/knowledge",
        json={"data": {"domains": [], "mental_tabs": []}},
        headers=auth,
    )
    assert r.status_code == 200


def test_rejected_settings_write_does_not_clobber_real_settings(clean_database):
    client, auth = _client_and_auth()
    client.put(
        "/api/files/_settings",
        json={"data": {"disabled_sections": ["profile"]}},
        headers=auth,
    )
    body = client.get("/api/settings", headers=auth).json()
    assert body["disabled_sections"] == []
