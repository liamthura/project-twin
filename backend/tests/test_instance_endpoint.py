"""/api/instance answers "what is this instance" without a credential.

`commit` is here because the first hour of the tool-triggering investigation
went on a question -- is production even running this code? -- that should have
cost one unauthenticated GET and instead needed a bearer token and a JSON-RPC
handshake. The next investigation gets the cheap version.
"""
import main


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
