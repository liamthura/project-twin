import pytest
from fastapi.testclient import TestClient

import main
import sections
import settings_store


def _client_and_auth():
    client = TestClient(main.app)
    r = client.post("/api/auth/register", json={"username": "settings-test-user"})
    token = r.json()["token"]
    return client, {"Authorization": f"Bearer {token}"}


def test_get_settings_defaults(clean_database):
    client, auth = _client_and_auth()
    body = client.get("/api/settings", headers=auth).json()
    assert body["disabled_sections"] == []
    assert set(body["toggleable"]) == {
        "knowledge", "projects", "lifestyle", "media", "aesthetics", "inventory",
        "circle", "goals",
    }
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
        "profile", "goals", "knowledge", "preferences", "projects",
        "lifestyle", "media", "aesthetics", "inventory", "circle", "learning_log",
    ]
    profile = packs[0]
    assert profile == {
        "key": "profile",
        "title": "Profile",
        "description": "Identity, work, education, contact",
        "core": True,
        "default_enabled": True,
        "sections": sections.PACK_META["profile"]["sections"],
        "entities": sections.PACK_META["profile"]["entities"],
        "promotable": sections.PACK_META["profile"]["promotable"],
        "defaults": sections.PACK_META["profile"]["defaults"],
        "enabled": True,
    }
    # disabling a toggleable pack is reflected in `enabled`
    client.put("/api/settings", json={"disabled_sections": ["circle"]}, headers=auth)
    body = client.get("/api/settings", headers=auth).json()
    circle = next(p for p in body["packs"] if p["key"] == "circle")
    assert circle["enabled"] is False and circle["core"] is False


def test_get_settings_reports_onboarding_defaults(clean_database):
    client, auth = _client_and_auth()
    body = client.get("/api/settings", headers=auth).json()
    assert body["onboarding"] == {"dismissed": False, "steps": {}, "seen": []}


def test_put_settings_persists_onboarding(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/settings",
        json={
            "disabled_sections": [],
            "onboarding": {"dismissed": False, "steps": {"about-you": "done"}},
        },
        headers=auth,
    )
    assert r.status_code == 200
    body = client.get("/api/settings", headers=auth).json()
    assert body["onboarding"] == {"dismissed": False, "steps": {"about-you": "done"}, "seen": []}


def test_put_settings_leaves_onboarding_alone_when_omitted(clean_database):
    # Every existing caller sends only disabled_sections -- App.jsx's togglePack
    # is one -- and none of them may quietly clear progress.
    client, auth = _client_and_auth()
    client.put(
        "/api/settings",
        json={"disabled_sections": [], "onboarding": {"dismissed": True, "steps": {}}},
        headers=auth,
    )
    client.put("/api/settings", json={"disabled_sections": ["circle"]}, headers=auth)
    body = client.get("/api/settings", headers=auth).json()
    assert body["onboarding"]["dismissed"] is True


def test_put_rejects_an_unknown_onboarding_step(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/settings",
        json={"disabled_sections": [], "onboarding": {"steps": {"welcome": "done"}}},
        headers=auth,
    )
    assert r.status_code == 400
    assert "welcome" in r.json()["detail"]


def test_put_rejects_an_unknown_onboarding_status(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/settings",
        json={"disabled_sections": [], "onboarding": {"steps": {"about-you": "later"}}},
        headers=auth,
    )
    assert r.status_code == 400
    assert "later" in r.json()["detail"]


def test_seen_is_remembered_once_and_survives_other_writes(clean_database):
    client, auth = _client_and_auth()
    assert client.get("/api/settings", headers=auth).json()["onboarding"]["seen"] == []
    for key in ("guide:editor", "guide:editor", "hint:promote"):
        assert client.post("/api/onboarding/seen", headers=auth, json={"key": key}).status_code == 200
    assert client.post("/api/onboarding/seen", headers=auth, json={"key": "Bad Key!"}).status_code == 400
    # The card's dismiss sends dismissed and steps; it must not wipe seen.
    client.put("/api/settings", headers=auth,
               json={"disabled_sections": [], "onboarding": {"dismissed": True, "steps": {}}})
    onboarding = client.get("/api/settings", headers=auth).json()["onboarding"]
    assert onboarding["seen"] == ["guide:editor", "hint:promote"]
    assert onboarding["dismissed"] is True


@pytest.mark.nodb
def test_seen_is_repaired_on_read():
    assert settings_store._seen(None) == []
    assert settings_store._seen(["a", "a", 5, "NO", "b:c"]) == ["a", "b:c"]
    assert len(settings_store._seen([f"k{i}" for i in range(40)])) == settings_store.MAX_SEEN


def test_settings_packs_carry_their_defaults(clean_database):
    client, auth = _client_and_auth()
    packs = client.get("/api/settings", headers=auth).json()["packs"]
    prefs = next(p for p in packs if p["key"] == "preferences")
    assert prefs["defaults"]["communication"]["default"]["locale"] == "British English"
