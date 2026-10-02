"""Feedback from the island: what is kept, what is refused, who it is from."""
import base64

import pytest
from fastapi.testclient import TestClient

import db
import feedback_store as fb
import mailer
import main

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 32
WEBP = b"RIFF\x24\0\0\0WEBPVP8 " + b"\0" * 32


def b64(data):
    return base64.b64encode(data).decode()


def account(username, email=None):
    user_id, token = db.create_user(username, "correcthorse1")
    if email:
        with db.get_pool().connection() as conn:
            conn.execute(
                """
                insert into better_auth."user"
                    ("id", "name", "email", "emailVerified", "username", "displayUsername")
                values (%s, %s, %s, false, %s, %s)
                """,
                (user_id, username, email, username, username),
            )
    return user_id, {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "kind, message, shot, error",
    [
        ("praise", "hi", None, "kind"),
        ("problem", "   ", None, "message"),
        ("problem", "x" * 5001, None, "5,000"),
        ("problem", "hi", "not base64!", "could not be read"),
        ("problem", "hi", b64(PNG + b"\0" * (2 * 1024 * 1024)), "2 MB"),
        ("problem", "hi", b64(b"just some text, named .png"), "PNG, JPEG or WebP"),
    ],
)
def test_bad_reports_are_refused(kind, message, shot, error):
    with pytest.raises(fb.InvalidFeedbackError, match=error):
        fb.validate(kind, message, {}, shot)


@pytest.mark.parametrize("data, kind", [(PNG, "png"), (JPEG, "jpeg"), (WEBP, "webp")])
def test_the_image_type_is_read_from_the_bytes(data, kind):
    assert fb.validate("idea", "hi", {}, b64(data))[3:] == (data, kind)


def test_context_keeps_known_keys_cut_to_500():
    _, message, context, _, _ = fb.validate(
        "other", "  hello  ", {"page": "#/review", "browser": "x" * 900, "persona": "secret"}, None
    )
    assert message == "hello"
    assert context == {"page": "#/review", "browser": "x" * 500}


def test_saved_reports_count_towards_the_hour():
    user_id, _ = account("fb-count")
    other, _ = account("fb-other")
    report_id = fb.save(user_id, "problem", "hi", {"page": "#/"}, PNG, "png")
    report = fb.get_report(report_id)
    assert str(report["user_id"]) == str(user_id)
    assert bytes(report["screenshot"]) == PNG
    assert fb.recent_count(user_id) == 1
    assert fb.recent_count(other) == 0


def test_sender_has_a_real_email_and_never_a_placeholder():
    real, _ = account("fb-real", "sam@example.com")
    fake, _ = account("fb-fake", "fb-fake@mygist.invalid")
    bare, _ = account("fb-bare")
    assert fb.sender(real) == {"username": "fb-real", "email": "sam@example.com"}
    assert fb.sender(fake) == {"username": "fb-fake", "email": None}
    assert fb.sender(bare) == {"username": "fb-bare", "email": None}


@pytest.fixture
def outbox(monkeypatch):
    """What notify would send, without Resend."""
    sent = []
    monkeypatch.setenv("FEEDBACK_TO", "owner@example.com")
    monkeypatch.setattr(mailer, "send_email", lambda *a, **k: sent.append((a, k)) or True)
    return sent


def post(auth, **body):
    return TestClient(main.app).post(
        "/api/feedback", headers=auth, json={"kind": "problem", "message": "It broke", **body}
    )


def test_a_report_is_saved_and_emailed(outbox):
    user_id, auth = account("fb-api", "sam@example.com")
    r = post(
        auth,
        message="Save failed\non Profile",
        context={"page": "#/profile", "version": "0.4.0", "commit": "abc1234"},
        screenshot=b64(JPEG),
    )
    assert r.status_code == 200, r.text
    report = fb.get_report(r.json()["id"])
    assert str(report["user_id"]) == str(user_id) and report["kind"] == "problem"
    (to, subject, text), extra = outbox[0]
    assert to == "owner@example.com"
    assert subject == "[MyGist] Problem: Save failed"
    assert "From: fb-api (sam@example.com)" in text
    assert "Version: 0.4.0 (abc1234)" in text
    assert f"python scripts/feedback.py done {report['id']}" in text
    assert extra["reply_to"] == "sam@example.com"
    assert extra["attachments"][0]["filename"] == f"feedback-{report['id']}.jpg"
    assert base64.b64decode(extra["attachments"][0]["content"]) == JPEG


def test_subject_is_one_line_and_cut_to_60(outbox):
    _, auth = account("fb-subject")
    post(auth, kind="idea", message=("y" * 80) + "\nsecond line")
    (_, subject, _), extra = outbox[0]
    assert subject == "[MyGist] Idea: " + "y" * 60
    assert "\n" not in subject
    assert extra["reply_to"] is None and extra["attachments"] is None


def test_bad_input_is_400_and_saves_nothing(outbox):
    user_id, auth = account("fb-bad")
    r = post(auth, kind="praise")
    assert r.status_code == 400 and "kind" in r.json()["detail"]
    assert fb.recent_count(user_id) == 0 and outbox == []


def test_the_eleventh_in_an_hour_is_429_and_only_for_that_account(outbox):
    _, auth = account("fb-busy")
    _, other = account("fb-calm")
    for _ in range(fb.HOURLY_LIMIT):
        assert post(auth).status_code == 200
    r = post(auth)
    assert r.status_code == 429 and "10 reports" in r.json()["detail"]
    assert post(other).status_code == 200


def test_a_failed_email_still_answers_200_and_keeps_the_report(monkeypatch):
    monkeypatch.setenv("FEEDBACK_TO", "owner@example.com")

    def refuse(*a, **k):
        raise mailer.MailError("Resend responded 500")

    monkeypatch.setattr(mailer, "send_email", refuse)
    user_id, auth = account("fb-down")
    assert post(auth).status_code == 200
    assert fb.recent_count(user_id) == 1


def test_without_feedback_to_nothing_is_sent(monkeypatch):
    monkeypatch.delenv("FEEDBACK_TO", raising=False)
    calls = []
    monkeypatch.setattr(mailer, "send_email", lambda *a, **k: calls.append(a))
    _, auth = account("fb-quiet")
    assert post(auth).status_code == 200
    assert calls == []


def test_signed_out_is_refused():
    r = TestClient(main.app).post("/api/feedback", json={"kind": "idea", "message": "x"})
    assert r.status_code == 401
