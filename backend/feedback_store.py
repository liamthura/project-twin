"""Feedback: what people send from the island, kept for the owner to read.

The account id is all a row keeps about the person (migration 0012). Who sent
a report is read from the account when it is emailed or listed.
"""
import base64
import binascii

from psycopg.types.json import Jsonb

import db

KINDS = ("problem", "idea", "other")
KIND_LABELS = {"problem": "Problem", "idea": "Idea", "other": "Something else"}
# What the island says it sends (FeedbackIsland's "Sent with this report").
CONTEXT_KEYS = ("page", "version", "commit", "browser", "screen")
MAX_MESSAGE = 5000
MAX_CONTEXT_VALUE = 500
MAX_SCREENSHOT = 2 * 1024 * 1024
HOURLY_LIMIT = 10
# frontend/src/lib/session.js PLACEHOLDER_DOMAIN: an account with no real address.
PLACEHOLDER_DOMAIN = "mygist.invalid"


class InvalidFeedbackError(ValueError):
    pass


def image_type(data: bytes):
    """What the bytes say they are. Never what the client says."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def validate(kind, message, context, screenshot):
    """The report as it will be stored: (kind, message, context, image, image_type)."""
    if kind not in KINDS:
        raise InvalidFeedbackError("kind must be problem, idea or other.")
    message = (message or "").strip()
    if not message:
        raise InvalidFeedbackError("Write a message first.")
    if len(message) > MAX_MESSAGE:
        raise InvalidFeedbackError(f"A message can be at most {MAX_MESSAGE:,} characters.")
    kept = {
        key: str(value)[:MAX_CONTEXT_VALUE]
        for key, value in (context or {}).items()
        if key in CONTEXT_KEYS and value is not None
    }
    if not screenshot:
        return kind, message, kept, None, None
    # Checked before decoding, so an enormous string is refused unread.
    if len(screenshot) > MAX_SCREENSHOT * 4 // 3 + 4:
        raise InvalidFeedbackError("The screenshot is over 2 MB.")
    try:
        image = base64.b64decode(screenshot, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidFeedbackError("The screenshot could not be read.")
    if len(image) > MAX_SCREENSHOT:
        raise InvalidFeedbackError("The screenshot is over 2 MB.")
    found = image_type(image)
    if not found:
        raise InvalidFeedbackError("The screenshot must be a PNG, JPEG or WebP image.")
    return kind, message, kept, image, found


def save(user_id, kind, message, context, image, found) -> int:
    with db.get_pool().connection() as conn:
        row = conn.execute(
            """
            insert into feedback (user_id, kind, message, context, screenshot, screenshot_type)
            values (%s, %s, %s, %s, %s, %s)
            returning id
            """,
            (user_id, kind, message, Jsonb(context), image, found),
        ).fetchone()
    return row["id"]


def recent_count(user_id) -> int:
    with db.get_pool().connection() as conn:
        return conn.execute(
            """
            select count(*) as n from feedback
             where user_id = %s and created_at > now() - interval '1 hour'
            """,
            (user_id,),
        ).fetchone()["n"]


def sender(user_id) -> dict:
    """{"username", "email"}. email is None for a placeholder or no address."""
    with db.get_pool().connection() as conn:
        row = conn.execute(
            """
            select u.username, a."email" as email
              from users u
              left join better_auth."user" a on a."id" = u.id::text
             where u.id = %s
            """,
            (user_id,),
        ).fetchone()
    if row is None:
        return {"username": None, "email": None}
    email = row["email"]
    if email and email.lower().endswith(f"@{PLACEHOLDER_DOMAIN}"):
        email = None
    return {"username": row["username"], "email": email}


def get_report(report_id):
    with db.get_pool().connection() as conn:
        return conn.execute("select * from feedback where id = %s", (report_id,)).fetchone()


def list_reports(include_handled=False) -> list:
    where = "" if include_handled else "where f.handled_at is null"
    with db.get_pool().connection() as conn:
        return conn.execute(
            f"""
            select f.id, f.kind, f.message, f.created_at, f.handled_at, u.username,
                   f.screenshot is not null as has_screenshot
              from feedback f join users u on u.id = f.user_id
              {where}
             order by f.created_at desc, f.id desc
            """
        ).fetchall()


def mark_handled(report_id) -> bool:
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "update feedback set handled_at = now() where id = %s and handled_at is null returning id",
            (report_id,),
        ).fetchone()
    return row is not None


def screenshot_name(report) -> str:
    ext = {"jpeg": "jpg"}.get(report["screenshot_type"], report["screenshot_type"])
    return f"feedback-{report['id']}.{ext}"
