"""Editing email copy without a deploy: scripts/emails.py."""
import pytest

import mailer
from emails import render as emails
from scripts import emails as cli


def test_set_saves_an_edit_that_the_next_email_uses(capsys):
    cli.main(["set", "reset", "heading", "Pick a new password"])
    assert emails.overrides("reset") == {"heading": "Pick a new password"}
    cli.main([])
    assert "reset" in capsys.readouterr().out
    cli.main(["show", "reset"])
    out = capsys.readouterr().out
    assert "Pick a new password" in out and "Reset your password" in out and "{username}" in out


def test_unset_goes_back_to_the_default():
    cli.main(["set", "reset", "heading", "Pick a new password"])
    cli.main(["unset", "reset", "heading"])
    assert emails.overrides("reset") == {}


@pytest.mark.parametrize(
    "args, error",
    [
        (["set", "digest", "heading", "x"], "No email digest"),
        (["set", "reset", "footer", "x"], "reset has no slot footer"),
        (["set", "reset", "intro", "Hi {newEmail}"], "{newEmail}"),
        (["set", "reset", "intro", "   "], "empty"),
        (["set", "reset", "intro", "x" * 1001], "1,000"),
    ],
)
def test_set_refuses_what_would_break_an_email(args, error):
    with pytest.raises(SystemExit, match=error):
        cli.main(args)
    assert emails.overrides("reset") == {}


def test_an_em_dash_is_a_warning_not_a_refusal(capsys):
    cli.main(["set", "reset", "note", "Ignore it — nothing changed."])
    assert "em dash" in capsys.readouterr().out
    assert emails.overrides("reset")["note"] == "Ignore it — nothing changed."


def test_preview_writes_html_and_text(tmp_path):
    cli.main(["set", "invite", "heading", "Come in"])
    cli.main(["preview", "invite", "--out", str(tmp_path)])
    assert "Come in" in (tmp_path / "invite.html").read_text()
    assert (tmp_path / "invite.txt").read_text().startswith("Come in\n")


def test_send_test_sends_a_marked_copy(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send_email", lambda *a, **k: sent.append((a, k)) or True)
    cli.main(["send-test", "reset", "me@example.com"])
    (to, subject, text), extra = sent[0]
    assert to == "me@example.com" and subject == "[Test] Reset your MyGist password"
    assert "Choose a new password" in extra["html"] and "sam" in text


def test_unset_checks_the_slot_and_says_when_there_was_no_edit(capsys):
    with pytest.raises(SystemExit, match="reset has no slot intor"):
        cli.main(["unset", "reset", "intor"])
    cli.main(["unset", "reset", "intro"])
    assert "had no edit" in capsys.readouterr().out
