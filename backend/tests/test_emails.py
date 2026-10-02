"""The email renderer, held to the auth service's output by shared golden files."""
import json
from pathlib import Path

import pytest

import db
from emails import render as emails

BACKEND = Path(__file__).resolve().parent.parent
HERE = BACKEND / "emails"
AUTH = BACKEND.parent / "auth" / "src" / "emails"
FIXTURES = json.loads((HERE / "golden" / "fixtures.json").read_text())


@pytest.mark.nodb
@pytest.mark.parametrize(
    "rel", ["layout.html", "copy.json", *sorted(p.name for p in (HERE / "golden").iterdir())]
)
def test_the_shared_files_match_the_auth_service(rel):
    path = rel if rel in ("layout.html", "copy.json") else f"golden/{rel}"
    assert (HERE / path).read_bytes() == (AUTH / path).read_bytes(), (
        f"{path} differs between backend/emails and auth/src/emails; copy it across"
    )


@pytest.mark.nodb
@pytest.mark.parametrize("name", sorted(FIXTURES["values"]))
def test_python_renders_what_the_auth_service_renders(name):
    out = emails.render(name, FIXTURES["values"][name], {}, FIXTURES["origin"])
    assert out["html"] == (HERE / "golden" / f"{name}.html").read_text()
    assert out["text"] == (HERE / "golden" / f"{name}.txt").read_text()


@pytest.mark.nodb
def test_values_are_escaped_and_bold_in_html_plain_in_text():
    out = emails.render("reset", {"username": '<b>"sam" & co</b>', "url": "https://x.example/?a=1&b=2"})
    assert "<b>&lt;b&gt;&quot;sam&quot; &amp; co&lt;/b&gt;</b>" in out["html"]
    assert 'href="https://x.example/?a=1&amp;b=2"' in out["html"]
    assert '<b>"sam" & co</b>' in out["text"]


@pytest.mark.nodb
def test_an_edit_replaces_the_default():
    out = emails.render("reset", FIXTURES["values"]["reset"], {"heading": "New <password>"})
    assert "New &lt;password&gt;" in out["html"]
    assert out["text"].startswith("New <password>\n")


def test_overrides_come_from_the_table():
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into email_copy (email, slot, value) values ('reset', 'heading', 'Pick a new one')"
        )
    assert emails.overrides("reset") == {"heading": "Pick a new one"}
    assert emails.compose("reset", FIXTURES["values"]["reset"])["subject"] == "Reset your MyGist password"
    assert "Pick a new one" in emails.compose("reset", FIXTURES["values"]["reset"])["html"]


@pytest.mark.nodb
def test_a_failed_read_means_the_defaults(monkeypatch):
    def down():
        raise RuntimeError("database down")

    monkeypatch.setattr(db, "get_pool", down)
    assert emails.overrides("reset") == {}


@pytest.mark.nodb
def test_the_change_note_points_to_a_reset_that_signs_everyone_out():
    # Settings' Change password keeps every session alive; only a reset
    # (revokeSessionsOnPasswordReset) puts an intruder out.
    note = emails.DECK["change"]["slots"]["note"]
    assert "signs out every device" in note and "Settings" not in note


@pytest.mark.nodb
def test_copy_claims_hold_in_both_versions():
    # A placeholder account's address is set before the link is opened; only
    # confirming it waits. And the text version has no button.
    assert "Nothing is confirmed unless the link is opened." in emails.DECK["verify"]["slots"]["note"]
    assert "button" not in emails.DECK["invite"]["slots"]["detail"].lower()


@pytest.mark.nodb
def test_an_optional_line_without_its_value_is_left_out_even_when_edited():
    values = {k: v for k, v in FIXTURES["values"]["invite"].items() if k not in ("expires", "uses")}
    out = emails.render("invite", values, {"expires": "It expires soon.", "uses": "Share it."})
    assert "expires soon" not in out["text"] and "Share it" not in out["text"]
    assert "expires soon" not in out["html"]
