"""The one Resend sender: invites (scripts/access.py) and feedback both use it."""
import io
import json
import urllib.error
import urllib.request

import pytest

import mailer

pytestmark = pytest.mark.nodb


class _Accepted:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def sent(monkeypatch):
    box = {}

    def urlopen(request, timeout=None):
        box["request"] = request
        box["body"] = json.loads(request.data)
        return _Accepted()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    monkeypatch.setenv("RESEND_API_KEY", "re_not_a_real_key")
    monkeypatch.setenv("EMAIL_FROM", "mygist@example.com")
    return box


def test_reply_to_and_attachments_go_in_resends_shape(sent):
    attachment = {"filename": "feedback-1.jpg", "content": "AAAA"}
    assert mailer.send_email(
        "owner@example.com", "Hi", "body", reply_to="sam@example.com", attachments=[attachment]
    )
    assert sent["body"]["reply_to"] == "sam@example.com"
    assert sent["body"]["attachments"] == [attachment]
    assert "Python-urllib" not in sent["request"].get_header("User-agent")


def test_without_them_the_payload_is_what_it_was(sent):
    mailer.send_email("a@example.com", "S", "T")
    assert set(sent["body"]) == {"from", "to", "subject", "text"}


def test_unset_prints_and_returns_false(monkeypatch, capsys):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert mailer.send_email("a@example.com", "S", "T") is False
    assert "Not sent" in capsys.readouterr().out


def test_a_refusal_is_a_mail_error(sent, monkeypatch):
    def refuse(request, timeout=None):
        raise urllib.error.HTTPError(mailer.RESEND_ENDPOINT, 422, "bad", {}, io.BytesIO(b"nope"))

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    with pytest.raises(mailer.MailError, match="422"):
        mailer.send_email("a@example.com", "S", "T")
