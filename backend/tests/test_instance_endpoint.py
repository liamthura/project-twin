"""/api/instance answers "what is this instance" without a credential.

`commit` is here because the first hour of the tool-triggering investigation
went on a question -- is production even running this code? -- that should have
cost one unauthenticated GET and instead needed a bearer token and a JSON-RPC
handshake. The next investigation gets the cheap version.
"""
import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client():
    return TestClient(main.app)


def test_commit_prefers_app_commit(monkeypatch):
    monkeypatch.setenv("APP_COMMIT", "abc1234")
    monkeypatch.setenv("SOURCE_COMMIT", "def5678")
    assert main.build_commit() == "abc1234"


def test_commit_falls_back_to_source_commit(monkeypatch):
    monkeypatch.delenv("APP_COMMIT", raising=False)
    monkeypatch.setenv("SOURCE_COMMIT", "def5678")
    assert main.build_commit() == "def5678"


def test_commit_is_dev_when_unstamped(monkeypatch):
    monkeypatch.delenv("APP_COMMIT", raising=False)
    monkeypatch.delenv("SOURCE_COMMIT", raising=False)
    assert main.build_commit() == "dev"


def test_sso_is_off_unless_a_discovery_url_is_set(monkeypatch):
    monkeypatch.delenv("AUTH_OIDC_DISCOVERY_URL", raising=False)
    assert main.sso_configured() is False


def test_sso_is_on_when_a_discovery_url_is_set(monkeypatch):
    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    assert main.sso_configured() is True


def test_blank_is_not_configured(monkeypatch):
    # A variable declared in compose and left empty is the DEFAULT state, not
    # an opt-in. Reading it as on would show a button on every instance that
    # merely pulled the new compose file.
    monkeypatch.setenv("AUTH_OIDC_DISCOVERY_URL", "   ")
    assert main.sso_configured() is False


def test_the_endpoint_actually_reports_it(client, monkeypatch):
    # The helper being right is not the same as the endpoint being wired to it,
    # and the SPA reads the endpoint. This is the assertion that would catch a
    # field dropped from the dict.
    monkeypatch.delenv("AUTH_OIDC_DISCOVERY_URL", raising=False)
    assert client.get("/api/instance").json()["sso"] is False

    monkeypatch.setenv(
        "AUTH_OIDC_DISCOVERY_URL",
        "https://door.example/application/o/mygist/.well-known/openid-configuration",
    )
    assert client.get("/api/instance").json()["sso"] is True
