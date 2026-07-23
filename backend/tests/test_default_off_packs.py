"""Default-off pack model: opt-in via settings.enabled_sections."""
from fastapi.testclient import TestClient

import main
import sections
import settings_store


def _client_and_auth():
    client = TestClient(main.app)
    r = client.post("/api/auth/register", json={"username": "defoff-test-user"})
    return client, {"Authorization": f"Bearer {r.json()['token']}"}


def test_default_enabled_map_covers_all_packs(clean_database):
    assert set(sections.DEFAULT_ENABLED) == set(sections.SECTION_REGISTRY)
    # media and aesthetics (Task 2, manifest-only packs) are the first
    # default-off packs; everything else still defaults on.
    assert sections.DEFAULT_ENABLED["media"] is False
    assert sections.DEFAULT_ENABLED["aesthetics"] is False
    assert all(v for k, v in sections.DEFAULT_ENABLED.items()
               if k not in ("media", "aesthetics"))


def test_pack_meta_carries_ui_and_entities(clean_database):
    meta = sections.PACK_META["goals"]
    assert meta["default_enabled"] is True
    assert meta["ui"]["goals"]["title_field"] == "title"
    assert "goal" in meta["entities"]


def test_put_settings_accepts_enabled_sections(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings",
                   json={"disabled_sections": [], "enabled_sections": []},
                   headers=auth)
    assert r.status_code == 200
    body = client.get("/api/settings", headers=auth).json()
    assert body["enabled_sections"] == []


def test_put_rejects_unknown_enabled_section(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings",
                   json={"disabled_sections": [], "enabled_sections": ["bogus"]},
                   headers=auth)
    assert r.status_code == 400


def test_default_off_pack_requires_opt_in(clean_database, as_user, monkeypatch):
    # Simulate a default-off pack without needing a real one yet (Task 2 adds them).
    monkeypatch.setitem(sections.DEFAULT_ENABLED, "circle", False)
    assert "circle" not in settings_store.enabled_sections()
    settings_store.set_enabled_optins(["circle"])
    assert "circle" in settings_store.enabled_sections()


def test_put_without_enabled_sections_preserves_optins(clean_database, monkeypatch):
    monkeypatch.setitem(sections.DEFAULT_ENABLED, "circle", False)
    client, auth = _client_and_auth()
    client.put("/api/settings", json={"disabled_sections": [], "enabled_sections": ["circle"]}, headers=auth)
    r = client.put("/api/settings", json={"disabled_sections": []}, headers=auth)
    assert r.status_code == 200
    body = client.get("/api/settings", headers=auth).json()
    assert body["enabled_sections"] == ["circle"]
