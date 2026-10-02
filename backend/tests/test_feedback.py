"""Feedback from the island: what is kept, what is refused, who it is from."""
import base64

import pytest

import db
import feedback_store as fb

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
