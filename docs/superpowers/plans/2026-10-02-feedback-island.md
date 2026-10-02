# Feedback island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floating Feedback island on every signed-in screen that saves a report (kind, message, optional screenshot) and emails it to the owner, plus a Report action on every error toast.

**Architecture:** `POST /api/feedback` validates and saves to a new `feedback` table (migration 0012), then emails the owner in a background task through a shared `backend/mailer.py` (moved out of `scripts/access.py`). The frontend island is a Radix Popover over a pill; `lib/feedback.js` holds the request, the image shrink and the open event the toast's Report fires. The owner reads reports from the email and `backend/scripts/feedback.py`.

**Tech Stack:** FastAPI, psycopg 3, Alembic (hand-written SQL), React 18, Radix Popover, Tailwind 3, Vitest + Testing Library, Sonner toasts.

**Spec:** `docs/superpowers/specs/2026-10-02-feedback-island-design.md`

## Global Constraints

- Release **0.4.0**: `frontend/package.json` (and lockfile) and `backend/main.py` `FastAPI(version=...)` move together.
- Copy: plain British English, no em dashes, exactly the strings in the spec's section 7 copy table.
- No new dependencies, frontend or backend.
- `kind` is one of `problem`, `idea`, `other`. Message 1 to 5,000 characters after stripping. Context keys `page`, `version`, `commit`, `browser`, `screen`, each cut to 500. Screenshot at most 2 MiB decoded, PNG, JPEG or WebP by its first bytes.
- 10 reports per account per hour; the 11th is a 429.
- The row holds the account id and nothing else about the person; deleting the account deletes its reports (`on delete cascade`).
- Placeholder emails end in `@mygist.invalid` and never get a Reply-To or a "Replies go to" line.
- Island `z-30`; dialogs `z-50`; toasts stay bottom left.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

**Rulings carried in from planning (the spec defers to these):**

- Success is shown inside the panel ("Thanks. Your feedback is in.") rather than as a toast. Onboarding renders no `<Toaster />`, and the island shows there. Cost if wrong: one line moved to a toast.
- With `FEEDBACK_TO` unset, `notify` logs the report's id only, not its text. The text is in the database; logs are not where a report should be read. Cost if wrong: owner reads staging reports with `feedback.py` instead of logs.
- `api()` in `frontend/src/lib/api.js` gains `error.status` on non-OK responses so the island can tell a 429 from anything else. One line in a shared function; nothing else reads it yet.

## Review Focus

1. Two quick presses on Send must make one report, not two. (Task 6, "sends once".)
2. A multi-line message must still make a one-line email subject. (Task 3, "subject is one line".)
3. Report from a toast while a draft is open must keep the draft and add the error to it. (Task 6, "keeps a draft".)
4. A pasted screenshot that arrives only in `clipboardData.items` (how Chrome and Safari paste one) must attach. (Task 6, "paste".)
5. Sending from onboarding, which has no Toaster, must still say it was sent. (Task 6, "sent state".)

---

### Task 1: The shared mailer

**Files:**
- Create: `backend/mailer.py`
- Modify: `backend/scripts/access.py` (remove `RESEND_ENDPOINT`, the urllib imports and `send_email`'s body)
- Modify: `backend/tests/test_access_waitlist.py:248-270` (patch `urllib.request` directly)
- Test: `backend/tests/test_mailer.py`

**Interfaces:**
- Produces: `mailer.send_email(to: str, subject: str, text: str, reply_to: str | None = None, attachments: list[dict] | None = None) -> bool` (True if sent, False if printed); `mailer.MailError(RuntimeError)`; `mailer.RESEND_ENDPOINT`.
- `scripts/access.py` keeps `send_email(to, subject, text) -> bool`, raising `SystemExit` on `MailError`.

- [ ] **Step 1: Write the failing test** `backend/tests/test_mailer.py`

```python
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && venv/bin/pytest tests/test_mailer.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'mailer'`

- [ ] **Step 3: Write `backend/mailer.py`**

```python
"""Email through Resend, or printed when there is no provider.

One sender for the two things that mail: invites (scripts/access.py) and the
owner's copy of each feedback report (feedback_store.notify).

Printing is deliberate rather than a fallback, and it is the same choice
auth/src/email.js makes for password reset: the whole flow can be walked
locally before anyone has a Resend account. A silent no-op would be worse than
either sending or failing, because you would think the mail went.
"""
import json
import os
import urllib.error
import urllib.request

RESEND_ENDPOINT = "https://api.resend.com/emails"


class MailError(RuntimeError):
    """Resend refused the message, or could not be reached."""


def send_email(to, subject, text, reply_to=None, attachments=None) -> bool:
    """Send, or print. True if it actually left the building.

    `attachments` is Resend's shape: [{"filename": ..., "content": <base64>}].
    """
    api_key = os.environ.get("RESEND_API_KEY")
    sender = os.environ.get("EMAIL_FROM")

    if not api_key or not sender:
        print("\n  Not sent: RESEND_API_KEY and EMAIL_FROM are unset here.")
        print(f"  to:      {to}")
        print(f"  subject: {subject}")
        for line in text.split("\n"):
            print(f"  {line}" if line else "")
        return False

    payload = {"from": sender, "to": to, "subject": subject, "text": text}
    if reply_to:
        payload["reply_to"] = reply_to
    if attachments:
        payload["attachments"] = attachments
    request = urllib.request.Request(
        RESEND_ENDPOINT,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Not decoration. Resend sits behind Cloudflare, which bans urllib's
            # default `Python-urllib/3.x` signature outright -- every send came
            # back 403 with a body of `error code: 1010`, refused at the edge
            # before Resend ever saw the key.
            "User-Agent": "mygist/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15):
            pass
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:200]
        raise MailError(f"Resend responded {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise MailError(f"could not reach Resend: {exc.reason}")
    return True
```

In `backend/scripts/access.py`: delete `import json`? No: check it is still used elsewhere in the file first (`grep -n "json\." scripts/access.py`); delete only imports nothing else uses. Delete `RESEND_ENDPOINT` and replace `send_email` with:

```python
import mailer  # noqa: E402   (with the other backend imports)


def send_email(to: str, subject: str, text: str) -> bool:
    """mailer.send_email, failing the command loudly.

    Raised, not swallowed. The code is already minted and the row already
    stamped, so silence here would leave someone marked invited with nothing
    in their inbox and no record of why.
    """
    try:
        return mailer.send_email(to, subject, text)
    except mailer.MailError as exc:
        raise SystemExit(str(exc))
```

Update the module docstring line "Mail goes through Resend, reading ..." to say it goes through `mailer.py`. In `tests/test_access_waitlist.py::test_the_send_request_says_who_it_is`, change `monkeypatch.setattr(access.urllib.request, "urlopen", capture)` to `monkeypatch.setattr(urllib.request, "urlopen", capture)` with `import urllib.request` at the top.

- [ ] **Step 4: Run both**

Run: `cd backend && venv/bin/pytest tests/test_mailer.py tests/test_access_waitlist.py -q`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/mailer.py backend/scripts/access.py backend/tests/test_mailer.py backend/tests/test_access_waitlist.py
git commit -m "refactor: one Resend sender, with reply-to and attachments"
```

---

### Task 2: The feedback table and store

**Files:**
- Create: `backend/migrations/versions/0012_feedback.py`
- Create: `backend/feedback_store.py`
- Modify: `backend/tests/test_account_delete.py` (`USER_TABLES` gains `"feedback": "user_id"`; `_account` inserts a report)
- Test: `backend/tests/test_feedback.py`

**Interfaces:**
- Consumes: `db.get_pool()` (dict rows), `db.create_user(username, password) -> (user_id, token)`.
- Produces: `feedback_store.KINDS`, `KIND_LABELS`, `CONTEXT_KEYS`, `HOURLY_LIMIT = 10`, `MAX_MESSAGE = 5000`, `MAX_SCREENSHOT = 2 * 1024 * 1024`, `PLACEHOLDER_DOMAIN`, `InvalidFeedbackError(ValueError)`, `validate(kind, message, context, screenshot) -> (kind, message, context, image_bytes|None, image_type|None)`, `save(user_id, kind, message, context, image, image_type) -> int`, `recent_count(user_id) -> int`, `sender(user_id) -> {"username", "email"}`, `get_report(id) -> dict|None`, `list_reports(include_handled=False) -> list[dict]`, `mark_handled(id) -> bool`, `screenshot_name(report) -> str`.

- [ ] **Step 1: Write the failing tests** `backend/tests/test_feedback.py`

```python
"""Feedback from the island: what is kept, what is refused, who it is from."""
import base64

import pytest

import db
import feedback_store as fb

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 32
WEBP = b"RIFF\x24\0\0\0WEBPVP8 " + b"\0" * 32
b64 = lambda data: base64.b64encode(data).decode()  # noqa: E731


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
    assert fb.get_report(report_id)["user_id"] == user_id
    assert bytes(fb.get_report(report_id)["screenshot"]) == PNG
    assert fb.recent_count(user_id) == 1
    assert fb.recent_count(other) == 0


def test_sender_has_a_real_email_and_never_a_placeholder():
    real, _ = account("fb-real", "sam@example.com")
    fake, _ = account("fb-fake", "fb-fake@mygist.invalid")
    bare, _ = account("fb-bare")
    assert fb.sender(real) == {"username": "fb-real", "email": "sam@example.com"}
    assert fb.sender(fake) == {"username": "fb-fake", "email": None}
    assert fb.sender(bare) == {"username": "fb-bare", "email": None}
```

In `tests/test_account_delete.py`, add `"feedback": "user_id",` to `USER_TABLES`, and at the end of `_account`'s `with` block:

```python
        conn.execute(
            "insert into feedback (user_id, kind, message) values (%s, 'problem', 'it broke')",
            (user_id,),
        )
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && venv/bin/pytest tests/test_feedback.py tests/test_account_delete.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'feedback_store'`, and `relation "feedback" does not exist` in the delete test.

- [ ] **Step 3: Write the migration** `backend/migrations/versions/0012_feedback.py`

```python
"""feedback: what people send from the feedback island

Revision ID: 0012_feedback
Revises: 0011_persona_provenance
Create Date: 2026-10-02

One row per report. The account id is the only thing about the person kept
here: their username and email are read from the account when the report is
emailed or listed, so a report never holds a second copy of who sent it.

`on delete cascade` is what deletes a person's reports, screenshots included,
with their account. db.delete_account deletes the users row; nothing else has
to know this table exists.

`handled_at` is the owner's "done" (scripts/feedback.py), so the list shows
what is still open.
"""
from alembic import op

revision = "0012_feedback"
down_revision = "0011_persona_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        create table if not exists feedback (
            id               bigserial primary key,
            user_id          uuid not null references users(id) on delete cascade,
            kind             text not null check (kind in ('problem', 'idea', 'other')),
            message          text not null,
            context          jsonb not null default '{}',
            screenshot       bytea,
            screenshot_type  text,
            created_at       timestamptz not null default now(),
            handled_at       timestamptz
        )
    """)
    # The hourly limit counts one account's recent rows.
    op.execute(
        "create index if not exists feedback_user_created on feedback (user_id, created_at desc)"
    )


def downgrade() -> None:
    op.execute("drop table if exists feedback")
```

- [ ] **Step 4: Write `backend/feedback_store.py`**

```python
"""Feedback: what people send from the island, kept for the owner to read.

The account id is all a row keeps about the person (migration 0012). Who sent
a report is read from the account when it is emailed or listed.
"""
import base64
import binascii
import logging
import os

from psycopg.types.json import Jsonb

import db
import mailer

logger = logging.getLogger(__name__)

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
```

(`email_for` and `notify` arrive in Task 3. `mailer`, `os` and `logger` are imported now because Task 3 adds to this file; if a linter objects before then, add them in Task 3 instead.)

- [ ] **Step 5: Run them**

Run: `cd backend && venv/bin/pytest tests/test_feedback.py tests/test_account_delete.py tests/test_migrations.py -q`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/versions/0012_feedback.py backend/feedback_store.py backend/tests/test_feedback.py backend/tests/test_account_delete.py
git commit -m "feat: a feedback table, deleted with the account"
```

---

### Task 3: `POST /api/feedback` and the owner's email

**Files:**
- Modify: `backend/feedback_store.py` (add `email_for`, `notify`)
- Modify: `backend/main.py` (imports, `FeedbackRequest`, the route)
- Test: `backend/tests/test_feedback.py` (API and email tests appended)

**Interfaces:**
- Consumes: everything Task 2 produces; `mailer.send_email`, `mailer.MailError`.
- Produces: `feedback_store.email_for(report: dict, who: dict) -> (subject, text)`, `feedback_store.notify(report_id) -> bool`; `POST /api/feedback` returning `{"id": int}`; 400 with `detail`, 429 with `detail`.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_feedback.py`)

```python
from fastapi.testclient import TestClient

import main
import mailer


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
    r = post(auth, message="Save failed\non Profile", context={"page": "#/profile", "version": "0.4.0", "commit": "abc1234"}, screenshot=b64(JPEG))
    assert r.status_code == 200
    report = fb.get_report(r.json()["id"])
    assert report["user_id"] == user_id and report["kind"] == "problem"
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
    assert TestClient(main.app).post("/api/feedback", json={"kind": "idea", "message": "x"}).status_code == 401
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && venv/bin/pytest tests/test_feedback.py -q`
Expected: the new API tests FAIL with 404 (no route); Task 2's still pass.

- [ ] **Step 3: Add `email_for` and `notify` to `backend/feedback_store.py`**

```python
def email_for(report, who):
    """Subject and plain-text body of the owner's copy. Also what
    scripts/feedback.py prints for `show`."""
    first = report["message"].strip().splitlines()[0].strip()
    subject = f"[MyGist] {KIND_LABELS[report['kind']]}: {first[:60]}"
    ctx = report["context"] or {}
    version = ctx.get("version", "unknown")
    if ctx.get("commit"):
        version += f" ({ctx['commit']})"
    lines = [
        report["message"],
        "",
        f"From: {who['username']} ({who['email'] or 'no recovery email'})",
        f"Page: {ctx.get('page', 'unknown')}",
        f"Version: {version}",
        f"Browser: {ctx.get('browser', 'unknown')}",
        f"Screen: {ctx.get('screen', 'unknown')}",
        "",
        f"Report {report['id']}. Mark it handled with:",
        f"python scripts/feedback.py done {report['id']}",
    ]
    return subject, "\n".join(lines)


def notify(report_id) -> bool:
    """Email the owner a report. Runs after the response, so nobody waits on
    Resend. Anything that goes wrong is logged with the report's id and
    nothing else: the report is saved, and feedback.py lists it."""
    to = os.environ.get("FEEDBACK_TO")
    if not to:
        logger.info("feedback %s saved; FEEDBACK_TO is unset, so it was not emailed", report_id)
        return False
    try:
        report = get_report(report_id)
        who = sender(report["user_id"])
        subject, text = email_for(report, who)
        attachments = None
        if report["screenshot"] is not None:
            attachments = [{
                "filename": screenshot_name(report),
                "content": base64.b64encode(bytes(report["screenshot"])).decode(),
            }]
        return mailer.send_email(to, subject, text, reply_to=who["email"], attachments=attachments)
    except Exception:
        logger.exception("feedback %s saved but not emailed", report_id)
        return False
```

- [ ] **Step 4: Add the route to `backend/main.py`**

Imports: `from fastapi import BackgroundTasks` (add to the existing `from fastapi import ...` line) and `import feedback_store` (alphabetically with the other store imports). Next to `WaitlistRequest`:

```python
class FeedbackRequest(BaseModel):
    kind: str
    message: str
    context: Dict[str, Any] = {}
    screenshot: Optional[str] = None


@app.post("/api/feedback")
async def send_feedback(body: FeedbackRequest, background: BackgroundTasks):
    """A report from the feedback island (components/FeedbackIsland.jsx).

    Saved first, then emailed to the owner after the response
    (feedback_store.notify). Who sent it comes from the session, never from
    the body. Ten an hour per account, counted from the table, so a stuck
    retry cannot fill the owner's inbox.
    """
    user_id = db.current_user_id.get()
    if feedback_store.recent_count(user_id) >= feedback_store.HOURLY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"That's {feedback_store.HOURLY_LIMIT} reports in the last hour. Try again later.",
        )
    try:
        report = feedback_store.validate(body.kind, body.message, body.context, body.screenshot)
    except feedback_store.InvalidFeedbackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    report_id = feedback_store.save(user_id, *report)
    background.add_task(feedback_store.notify, report_id)
    return {"id": report_id}
```

- [ ] **Step 5: Run them**

Run: `cd backend && venv/bin/pytest tests/test_feedback.py tests/test_mailer.py -q`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add backend/feedback_store.py backend/main.py backend/tests/test_feedback.py
git commit -m "feat: POST /api/feedback, saved then emailed to the owner"
```

---

### Task 4: `scripts/feedback.py`

**Files:**
- Create: `backend/scripts/feedback.py`
- Test: `backend/tests/test_feedback_cli.py`

**Interfaces:**
- Consumes: `feedback_store.list_reports`, `get_report`, `sender`, `email_for`, `mark_handled`, `screenshot_name`, `KIND_LABELS`; `scripts.access.table`, `scripts.access.hint`.
- Produces: `main(argv: list[str] | None = None) -> None`.

- [ ] **Step 1: Write the failing test** `backend/tests/test_feedback_cli.py`

```python
"""Reading feedback where the database is: list, show, done."""
import pytest

import feedback_store as fb
from scripts import feedback as cli
from tests.test_feedback import JPEG, account


def test_list_shows_open_reports_and_done_hides_them(capsys):
    user_id, _ = account("cli-sam")
    first = fb.save(user_id, "problem", "Save failed\nmore", {}, None, None)
    fb.save(user_id, "idea", "Dark mode for print", {}, JPEG, "jpeg")

    cli.main([])
    out = capsys.readouterr().out
    assert "Save failed" in out and "more" not in out
    assert "Dark mode for print [image]" in out and "cli-sam" in out

    cli.main(["done", str(first)])
    assert f"Report {first} is handled." in capsys.readouterr().out
    cli.main([])
    assert "Save failed" not in capsys.readouterr().out

    cli.main(["--all"])
    assert "Save failed" in capsys.readouterr().out


def test_show_prints_it_and_writes_the_screenshot(tmp_path, capsys):
    user_id, _ = account("cli-ada", "ada@example.com")
    report_id = fb.save(user_id, "idea", "Dark mode", {"page": "#/profile"}, JPEG, "jpeg")
    cli.main(["show", str(report_id), "--out", str(tmp_path)])
    out = capsys.readouterr().out
    assert "From: cli-ada (ada@example.com)" in out and "Page: #/profile" in out
    assert (tmp_path / f"feedback-{report_id}.jpg").read_bytes() == JPEG


def test_unknown_ids_fail_loudly():
    with pytest.raises(SystemExit, match="No report 999"):
        cli.main(["show", "999"])
    with pytest.raises(SystemExit, match="No open report 999"):
        cli.main(["done", "999"])
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && venv/bin/pytest tests/test_feedback_cli.py -q`
Expected: FAIL, `ImportError: cannot import name 'feedback' from 'scripts'`

- [ ] **Step 3: Write `backend/scripts/feedback.py`**

```python
#!/usr/bin/env python3
"""Reading feedback: what people sent from the island.

Run where the database is reachable -- in the container, where DATABASE_URL
already is. Same gate as access.py, for the same reason: database access is a
stronger lock than any admin screen this project would have to build.

    python scripts/feedback.py              open reports, newest first
    python scripts/feedback.py --all        handled ones too
    python scripts/feedback.py show 42      one in full; writes feedback-42.jpg if it has one
    python scripts/feedback.py done 42      mark it handled

Each report is also emailed to FEEDBACK_TO as it arrives. This is the record
for when a send failed, or the email is long gone.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import feedback_store  # noqa: E402
from scripts.access import hint, table  # noqa: E402


def first_line(message: str, width: int = 50) -> str:
    line = message.strip().splitlines()[0]
    return line if len(line) <= width else line[: width - 1] + "…"


def list_reports(show_all: bool) -> None:
    rows = feedback_store.list_reports(include_handled=show_all)
    if not rows:
        print("\n  No feedback yet." if show_all else "\n  No open feedback.")
        return
    table(
        ["ID", "WHEN", "KIND", "FROM", "MESSAGE"],
        [
            [
                str(r["id"]),
                r["created_at"].strftime("%Y-%m-%d %H:%M"),
                feedback_store.KIND_LABELS[r["kind"]] + (" (handled)" if r["handled_at"] else ""),
                r["username"],
                first_line(r["message"]) + (" [image]" if r["has_screenshot"] else ""),
            ]
            for r in rows
        ],
    )
    hint("Read one: feedback.py show <id>", "Mark it handled: feedback.py done <id>")


def show(report_id: int, out: str) -> None:
    report = feedback_store.get_report(report_id)
    if report is None:
        raise SystemExit(f"No report {report_id}.")
    subject, text = feedback_store.email_for(report, feedback_store.sender(report["user_id"]))
    print(f"\n  {subject}\n")
    for line in text.split("\n"):
        print(f"  {line}" if line else "")
    if report["screenshot"] is not None:
        path = Path(out) / feedback_store.screenshot_name(report)
        path.write_bytes(bytes(report["screenshot"]))
        print(f"\n  Screenshot: {path}")


def done(report_id: int) -> None:
    if not feedback_store.mark_handled(report_id):
        raise SystemExit(f"No open report {report_id}.")
    print(f"\n  Report {report_id} is handled.")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Read the feedback people sent.")
    parser.add_argument("--all", action="store_true", help="include handled reports")
    commands = parser.add_subparsers(dest="command")
    show_cmd = commands.add_parser("show", help="one report in full")
    show_cmd.add_argument("id", type=int)
    show_cmd.add_argument("--out", default=".", help="where to write its screenshot")
    done_cmd = commands.add_parser("done", help="mark a report handled")
    done_cmd.add_argument("id", type=int)
    args = parser.parse_args(argv)

    if args.command == "show":
        show(args.id, args.out)
    elif args.command == "done":
        done(args.id)
    else:
        list_reports(args.all)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run it**

Run: `cd backend && venv/bin/pytest tests/test_feedback_cli.py tests/test_access_waitlist.py -q`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/feedback.py backend/tests/test_feedback_cli.py
git commit -m "feat: scripts/feedback.py lists, shows and closes reports"
```

---

### Task 5: `lib/feedback.js`

**Files:**
- Create: `frontend/src/lib/feedback.js`
- Modify: `frontend/src/lib/api.js:168-171` (non-OK errors carry `status`)
- Test: `frontend/src/lib/feedback.test.js`

**Interfaces:**
- Consumes: `api(endpoint, options)` from `./api.js`.
- Produces: `FEEDBACK_EVENT = "mygist:feedback"`, `MAX_IMAGE`, `openFeedback({ kind, message })`, `reportContext() -> {page, version, commit, browser, screen}`, `sendFeedback({ kind, message, screenshot?: Blob }) -> Promise<{id}>`, `shrinkImage(file: Blob) -> Promise<Blob>` rejecting `Error("unreadable")` or `Error("too-large")`.

- [ ] **Step 1: Write the failing test** `frontend/src/lib/feedback.test.js`

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api.js", () => ({ api: apiMock }));

const { FEEDBACK_EVENT, openFeedback, reportContext, sendFeedback, shrinkImage, MAX_IMAGE } =
  await import("./feedback.js");

let drawn;
let sizes;
beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ id: 7 });
  drawn = null;
  sizes = [];
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }));
  HTMLCanvasElement.prototype.getContext = vi.fn(function () {
    return { fillRect: vi.fn(), drawImage: (_b, _x, _y, w, h) => (drawn = [w, h]) };
  });
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (done, type, quality) {
    sizes.push(quality);
    done(new Blob(["x".repeat(10)], { type }));
  });
});

describe("shrinkImage", () => {
  it("draws the long edge at 2000 px and saves a JPEG", async () => {
    const blob = await shrinkImage(new Blob(["png"]));
    expect(drawn).toEqual([2000, 1500]);
    expect(blob.type).toBe("image/jpeg");
    expect(sizes).toEqual([0.9]);
  });

  it("leaves a small image its size", async () => {
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() }));
    await shrinkImage(new Blob(["png"]));
    expect(drawn).toEqual([800, 600]);
  });

  it("tries a lower quality once, then refuses", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (done, type, quality) {
      sizes.push(quality);
      done({ size: MAX_IMAGE + 1, type });
    });
    await expect(shrinkImage(new Blob(["png"]))).rejects.toThrow("too-large");
    expect(sizes).toEqual([0.9, 0.7]);
  });

  it("says when it cannot read the image", async () => {
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error("decode");
    });
    await expect(shrinkImage(new Blob(["heic"]))).rejects.toThrow("unreadable");
  });
});

describe("sendFeedback", () => {
  it("posts the report, what goes with it, and the screenshot as base64", async () => {
    window.location.hash = "#/review";
    await sendFeedback({ kind: "idea", message: "hi", screenshot: new Blob(["abc"], { type: "image/jpeg" }) });
    const [endpoint, options] = apiMock.mock.calls[0];
    expect(endpoint).toBe("/feedback");
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ kind: "idea", message: "hi", screenshot: btoa("abc") });
    expect(Object.keys(body.context).sort()).toEqual(["browser", "commit", "page", "screen", "version"]);
    expect(body.context.page).toBe("#/review");
  });

  it("sends no screenshot when there is none", async () => {
    await sendFeedback({ kind: "problem", message: "hi" });
    expect(JSON.parse(apiMock.mock.calls[0][1].body).screenshot).toBeNull();
  });
});

describe("openFeedback", () => {
  it("asks the island to open, with what to fill in", () => {
    const heard = vi.fn();
    window.addEventListener(FEEDBACK_EVENT, heard);
    openFeedback({ kind: "problem", message: 'The app said: "Failed to save"' });
    expect(heard.mock.calls[0][0].detail).toEqual({ kind: "problem", message: 'The app said: "Failed to save"' });
    window.removeEventListener(FEEDBACK_EVENT, heard);
  });
});

it("reportContext names the screen size", () => {
  expect(reportContext().screen).toBe(`${window.innerWidth}×${window.innerHeight}`);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd frontend && npx vitest run src/lib/feedback.test.js`
Expected: FAIL, cannot find module `./feedback.js`

- [ ] **Step 3: Write `frontend/src/lib/feedback.js`**

```js
/**
 * Feedback from the island (components/FeedbackIsland.jsx) to POST /api/feedback.
 *
 * reportContext() is the source of the form's "Sent with this report" line:
 * the page, the version and commit, the browser and the screen size. Nothing
 * from the persona. Who sent it the server takes from the session.
 */
import { api } from "./api.js";

/** The island listens for this; an error toast's Report fires it. */
export const FEEDBACK_EVENT = "mygist:feedback";

const LONG_EDGE = 2000;
// backend/feedback_store.py MAX_SCREENSHOT.
export const MAX_IMAGE = 2 * 1024 * 1024;

export function openFeedback(prefill) {
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail: prefill }));
}

export function reportContext() {
  return {
    page: window.location.hash || "#/",
    version: typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__,
    commit: typeof __APP_COMMIT__ === "undefined" ? "dev" : __APP_COMMIT__,
    browser: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight}`,
  };
}

// Bare base64, the shape the endpoint takes.
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function sendFeedback({ kind, message, screenshot = null }) {
  return api("/feedback", {
    method: "POST",
    body: JSON.stringify({
      kind,
      message,
      context: reportContext(),
      screenshot: screenshot ? await toBase64(screenshot) : null,
    }),
  });
}

const toJpeg = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/**
 * An image as a JPEG at most 2000 px on its long edge. Drawing it again on a
 * canvas drops its EXIF, which is where a phone photo keeps its location.
 * Rejects with "unreadable" or "too-large".
 */
export async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("unreadable");
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  // JPEG has no transparency; a transparent PNG would otherwise turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.9, 0.7]) {
    const blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= MAX_IMAGE) return blob;
  }
  throw new Error("too-large");
}
```

In `frontend/src/lib/api.js`, the non-OK branch becomes:

```js
    if (!response.ok) {
      const text = await response.text();
      // The status rides along, as it does for 401 and 403 above, so a caller
      // can tell a 429 from a failure (the feedback island does).
      const error = new Error(`API Error ${response.status}: ${text}`);
      error.status = response.status;
      throw error;
    }
```

- [ ] **Step 4: Run it**

Run: `cd frontend && npx vitest run src/lib/feedback.test.js src/lib/api.test.js`
Expected: all pass (if `api.test.js` does not exist, the first file alone)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/feedback.js frontend/src/lib/feedback.test.js frontend/src/lib/api.js
git commit -m "feat: lib/feedback.js sends a report and shrinks its screenshot"
```

---

### Task 6: The island

**Files:**
- Create: `frontend/src/components/FeedbackIsland.jsx`
- Modify: `frontend/src/globals.css` (position and the selection-bar lift)
- Test: `frontend/src/components/FeedbackIsland.test.jsx`

**Interfaces:**
- Consumes: `FEEDBACK_EVENT`, `sendFeedback`, `shrinkImage` (Task 5); `getSession`, `isPlaceholderEmail` (`@/lib/session.js`); `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverClose`; `segmentClass`; `Textarea`; `Button`.
- Produces: `FeedbackIsland({ onAddEmail })`; the `.feedback-island` class.

- [ ] **Step 1: Write the failing test** `frontend/src/components/FeedbackIsland.test.jsx`

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendMock = vi.hoisted(() => vi.fn());
const shrinkMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendFeedback: sendMock,
  shrinkImage: shrinkMock,
}));
vi.mock("@/lib/session.js", () => ({
  getSession: getSessionMock,
  isPlaceholderEmail: (email) => email.endsWith("@mygist.invalid"),
}));

const { FeedbackIsland } = await import("./FeedbackIsland");
const { openFeedback } = await import("@/lib/feedback.js");

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ id: 1 });
  shrinkMock.mockReset().mockResolvedValue(new Blob(["jpg"], { type: "image/jpeg" }));
  getSessionMock.mockReset().mockResolvedValue({ user: { email: "sam@example.com" } });
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
});

const open = async (user) => {
  await user.click(screen.getByRole("button", { name: "Feedback" }));
  return screen.getByRole("textbox");
};

describe("FeedbackIsland", () => {
  it("opens, keeps a draft when closed, and clears it once sent (sent state)", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "It broke");
    await user.keyboard("{Escape}");
    expect(await open(user)).toHaveValue("It broke");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(sendMock).toHaveBeenCalledWith({ kind: "problem", message: "It broke", screenshot: undefined });
    expect(await screen.findByText("Thanks. Your feedback is in.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close feedback" }));
    expect(await open(user)).toHaveValue("");
  });

  it("follows the kind with its label and hint", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    expect(screen.getByLabelText("What happened?")).toHaveAttribute(
      "placeholder",
      "What you did, what you expected, and what happened instead.",
    );
    await user.click(screen.getByRole("button", { name: "Idea" }));
    expect(screen.getByLabelText("What's your idea?")).toHaveAttribute("placeholder", "What it would let you do.");
    await user.click(screen.getByRole("button", { name: "Something else" }));
    expect(screen.getByLabelText("What's on your mind?")).toBeInTheDocument();
  });

  it("attaches a picked image, and Remove takes it off", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    await user.upload(document.querySelector('input[type="file"]'), new File(["png"], "s.png", { type: "image/png" }));
    expect(await screen.findByAltText("Your screenshot")).toBeInTheDocument();
    expect(screen.getByText(/crop out anything you'd rather not send/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove screenshot" }));
    expect(screen.queryByAltText("Your screenshot")).not.toBeInTheDocument();
  });

  it("attaches a pasted image from clipboard items, and lets text paste as text (paste)", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    const box = await open(user);
    const image = new File(["png"], "paste.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image }] } });
    expect(await screen.findByAltText("Your screenshot")).toBeInTheDocument();
    expect(shrinkMock).toHaveBeenCalledWith(image);
    shrinkMock.mockClear();
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "string", type: "text/plain" }] } });
    expect(shrinkMock).not.toHaveBeenCalled();
  });

  it("says when an image cannot be read", async () => {
    shrinkMock.mockRejectedValue(new Error("unreadable"));
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    await user.upload(document.querySelector('input[type="file"]'), new File(["x"], "s.heic", { type: "image/heic" }));
    expect(await screen.findByText("That image couldn't be read. Try a PNG or JPEG.")).toBeInTheDocument();
  });

  it("names where replies go, or links to Account when there is no address", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FeedbackIsland />);
    await open(user);
    expect(await screen.findByText("Replies go to sam@example.com.")).toBeInTheDocument();
    unmount();

    getSessionMock.mockResolvedValue({ user: { email: "sam@mygist.invalid" } });
    const onAddEmail = vi.fn();
    render(<FeedbackIsland onAddEmail={onAddEmail} />);
    await open(user);
    expect(await screen.findByText(/nowhere to send a reply/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add one" }));
    expect(onAddEmail).toHaveBeenCalled();
  });

  it("keeps the message when sending fails, and says why", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "Twice");
    sendMock.mockRejectedValueOnce(Object.assign(new Error("API Error 429"), { status: 429 }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("That's 10 reports in the last hour. Try again later.")).toBeInTheDocument();
    sendMock.mockRejectedValueOnce(new Error("Cannot connect"));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Couldn't send. Your message is still here, so try again.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Twice");
  });

  it("sends once however fast Send is pressed (sends once)", async () => {
    let finish;
    sendMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "Once");
    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    await act(async () => finish({ id: 1 }));
  });

  it("opens from a Report, as a Problem, and keeps a draft (keeps a draft)", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await user.type(await open(user), "My notes");
    await user.click(screen.getByRole("button", { name: "Idea" }));
    await user.keyboard("{Escape}");
    act(() => openFeedback({ kind: "problem", message: 'The app said: "Failed to save"' }));
    const box = await screen.findByRole("textbox");
    expect(box).toHaveValue('My notes\n\nThe app said: "Failed to save"\n\n');
    expect(screen.getByLabelText("What happened?")).toBeInTheDocument();
  });

  it("sends nothing while the message is empty", async () => {
    const user = userEvent.setup();
    render(<FeedbackIsland />);
    await open(user);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd frontend && npx vitest run src/components/FeedbackIsland.test.jsx`
Expected: FAIL, cannot find module `./FeedbackIsland`

- [ ] **Step 3: Write `frontend/src/components/FeedbackIsland.jsx`**

```jsx
/**
 * The feedback island: a pill in the bottom right of every signed-in screen
 * that opens into a short form (docs/superpowers/specs/2026-10-02-feedback-island-design.md).
 *
 * The panel grows from the pill's corner and the pill hides while it is open,
 * so the two read as one thing opening. What was typed survives closing it;
 * only a send clears it. Success is said in the panel, not a toast, because
 * onboarding has no Toaster and the island is there too.
 *
 * An error toast's Report opens it through FEEDBACK_EVENT (lib/feedback.js),
 * adding the error's words to whatever is already in the box.
 */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, MessageSquare, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { segmentClass } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_EVENT, sendFeedback, shrinkImage } from "@/lib/feedback.js";
import { getSession, isPlaceholderEmail } from "@/lib/session.js";
import { cn } from "@/lib/utils";

const KINDS = [
  {
    id: "problem",
    label: "Problem",
    prompt: "What happened?",
    hint: "What you did, what you expected, and what happened instead.",
  },
  { id: "idea", label: "Idea", prompt: "What's your idea?", hint: "What it would let you do." },
  { id: "other", label: "Something else", prompt: "What's on your mind?", hint: "" },
];

const IMAGE_ERRORS = {
  unreadable: "That image couldn't be read. Try a PNG or JPEG.",
  "too-large": "That image is too large, even after shrinking. Try cropping it.",
};

export function FeedbackIsland({ onAddEmail }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("problem");
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState(null); // { blob, url }
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState(null);
  // undefined while asking, null when there is nowhere to reply.
  const [email, setEmail] = useState(undefined);
  const pill = useRef(null);
  const box = useRef(null);
  const picker = useRef(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => {
        const address = s?.user?.email;
        if (!cancelled) setEmail(address && !isPlaceholderEmail(address) ? address : null);
      })
      .catch(() => !cancelled && setEmail(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onReport = (e) => {
      const said = e.detail?.message;
      setKind(e.detail?.kind || "problem");
      if (said) setMessage((m) => (m.trim() ? `${m.trimEnd()}\n\n${said}\n\n` : `${said}\n\n`));
      setStatus("idle");
      setError(null);
      setOpen(true);
    };
    window.addEventListener(FEEDBACK_EVENT, onReport);
    return () => window.removeEventListener(FEEDBACK_EVENT, onReport);
  }, []);

  // The thumbnail's object URL goes when the screenshot is replaced or removed.
  useEffect(() => () => shot && URL.revokeObjectURL(shot.url), [shot]);

  const attach = async (file) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await shrinkImage(file);
      setShot({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError(IMAGE_ERRORS[err.message] || IMAGE_ERRORS.unreadable);
    }
  };

  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find(
      (i) => i.kind === "file" && i.type.startsWith("image/"),
    );
    if (!item) return; // Text pastes as text.
    e.preventDefault();
    attach(item.getAsFile());
  };

  const sending = status === "sending";
  const send = async () => {
    // A ref, not state: two clicks in one frame both see the old state.
    if (busy.current || !message.trim()) return;
    busy.current = true;
    setStatus("sending");
    setError(null);
    try {
      await sendFeedback({ kind, message, screenshot: shot?.blob });
      setStatus("sent");
      setMessage("");
      setShot(null);
      setKind("problem");
    } catch (err) {
      setStatus("idle");
      setError(
        err?.status === 429
          ? "That's 10 reports in the last hour. Try again later."
          : "Couldn't send. Your message is still here, so try again.",
      );
    } finally {
      busy.current = false;
    }
  };

  const onOpenChange = (next) => {
    setOpen(next);
    if (!next && status === "sent") setStatus("idle");
  };

  const current = KINDS.find((k) => k.id === kind);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={pill}
          type="button"
          className={cn(
            "feedback-island fixed z-30 flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-lg transition-[background-color,bottom] duration-200 ease-standard hover:bg-muted motion-reduce:transition-none print:hidden coarse:min-h-11",
            open && "invisible",
          )}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Feedback
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        // Over the pill, so the panel grows out of where it was.
        sideOffset={-(pill.current?.offsetHeight ?? 38)}
        aria-labelledby="feedback-title"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          box.current?.focus();
        }}
        className="z-30 max-h-[calc(100dvh-6rem)] w-[calc(100vw-2rem)] origin-bottom-right overflow-y-auto rounded-xl p-4 shadow-lg motion-reduce:animate-none sm:w-[380px]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="feedback-title" className="text-sm font-medium">
            Send feedback
          </h2>
          <PopoverClose asChild>
            <Button variant="ghost" size="icon" className="-mr-2 h-7 w-7 text-muted-foreground" aria-label="Close feedback">
              <X className="h-4 w-4" />
            </Button>
          </PopoverClose>
        </div>

        {status === "sent" ? (
          <p role="status" className="py-6 text-center text-sm">
            Thanks. Your feedback is in.
          </p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div role="group" aria-label="Kind of feedback" className="flex rounded-lg bg-muted p-0.5">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={kind === k.id}
                  disabled={sending}
                  onClick={() => setKind(k.id)}
                  className={segmentClass(kind === k.id, false)}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="feedback-message" className="text-sm font-medium">
                {current.prompt}
              </label>
              <Textarea
                id="feedback-message"
                ref={box}
                rows={4}
                maxLength={5000}
                value={message}
                readOnly={sending}
                placeholder={current.hint}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={onPaste}
              />
            </div>

            {shot ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <img src={shot.url} alt="Your screenshot" className="h-16 w-auto max-w-[8rem] rounded border object-cover" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Remove screenshot"
                    disabled={sending}
                    onClick={() => setShot(null)}
                  >
                    Remove
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A screenshot shows everything on your screen, so crop out anything you&apos;d rather not send.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => picker.current?.click()}>
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add a screenshot
                </Button>
                or paste one into the box
                <input
                  ref={picker}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    attach(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Sent with this report: your username, the page you&apos;re on, the MyGist version, and your browser and
              screen size. Nothing from your persona is included.
            </p>
            {email !== undefined && (
              <p className="text-xs text-muted-foreground">
                {email ? (
                  `Replies go to ${email}.`
                ) : (
                  <>
                    There&apos;s no recovery email on your account, so there&apos;s nowhere to send a reply.{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        setOpen(false);
                        onAddEmail?.();
                      }}
                    >
                      Add one
                    </Button>
                  </>
                )}
              </p>
            )}

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={sending || !message.trim()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

Append to `frontend/src/globals.css`:

```css
/* The feedback island (components/FeedbackIsland.jsx): clear of the iPhone
   home bar, and lifted over Review's selection bar while it shows, whose
   Approve and Reject would otherwise sit under it. */
.feedback-island {
  right: calc(1rem + env(safe-area-inset-right));
  bottom: calc(1rem + env(safe-area-inset-bottom));
}
body:has([data-selection-bar]) .feedback-island {
  bottom: calc(5.5rem + env(safe-area-inset-bottom));
}
```

- [ ] **Step 4: Run it**

Run: `cd frontend && npx vitest run src/components/FeedbackIsland.test.jsx`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FeedbackIsland.jsx frontend/src/components/FeedbackIsland.test.jsx frontend/src/globals.css
git commit -m "feat: the feedback island"
```

---

### Task 7: Wiring: App, the toast's Report, the selection bar

**Files:**
- Modify: `frontend/src/components/ui/use-toast.js` (Report on destructive toasts)
- Modify: `frontend/src/components/ui/toaster.test.jsx` (tests appended)
- Modify: `frontend/src/App.jsx` (render the island in the shell and onboarding; move `addEmail` above the onboarding branch; `pb-24`)
- Modify: `frontend/src/components/onboarding/OnboardingFlow.jsx:236` (`pb-24`)
- Modify: `frontend/src/components/ProposalsPanel.jsx:804-807` (`data-selection-bar`)

**Interfaces:**
- Consumes: `openFeedback` (Task 5), `FeedbackIsland` (Task 6), `ToastAction`.

- [ ] **Step 1: Write the failing tests** (append to `frontend/src/components/ui/toaster.test.jsx`, reusing its existing render setup; read the top of the file first and match how it renders `<Toaster />` and calls `toast`)

```jsx
describe("Report on an error", () => {
  it("adds Report to a destructive toast, which opens the island with the error", async () => {
    const heard = vi.fn();
    window.addEventListener("mygist:feedback", heard);
    render(<Toaster />);
    act(() => {
      toast({ variant: "destructive", title: "Failed to save", description: "Could not reach the server." });
    });
    await userEvent.click(await screen.findByRole("button", { name: "Report this problem" }));
    expect(heard.mock.calls[0][0].detail).toEqual({
      kind: "problem",
      message: 'The app said: "Failed to save. Could not reach the server."',
    });
    window.removeEventListener("mygist:feedback", heard);
  });

  it("leaves a toast's own action alone, and adds nothing to a plain toast", async () => {
    render(<Toaster />);
    act(() => {
      toast({ variant: "destructive", title: "Removed", action: <ToastAction altText="Undo">Undo</ToastAction> });
      toast({ title: "Saved" });
    });
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report this problem" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/components/ui/toaster.test.jsx`
Expected: the two new tests FAIL (no "Report this problem" button)

- [ ] **Step 3: Change `frontend/src/components/ui/use-toast.js`**

```js
import { openFeedback } from "@/lib/feedback.js";

import { ToastAction, ToastCard } from "./toast";

// Every destructive toast in the app is a failure, and with no error tracking
// a report from the person who saw it is how the owner hears of one. One place
// rather than fourteen; a toast with its own action keeps it.
function withReport(props) {
  if (props.variant !== "destructive" || props.action) return props;
  const said = [props.title, props.description].filter((s) => typeof s === "string" && s).join(". ");
  return {
    ...props,
    action: createElement(
      ToastAction,
      {
        altText: "Report this problem",
        onClick: () => openFeedback({ kind: "problem", message: `The app said: "${said}"` }),
      },
      "Report",
    ),
  };
}
```

and in `toast()`, draw the card from `withReport(props)`:

```js
function toast({ onClose, duration = DURATION, ...rest }) {
  const props = withReport(rest);
  // ...the body as it was, using `props`
```

(`ToastAction` moves from `./toast`'s import list into this file's import; `ToastCard` was already imported.)

- [ ] **Step 4: Wire App, onboarding and Review**

`frontend/src/App.jsx`:
- `import { FeedbackIsland } from "@/components/FeedbackIsland";`
- Move the `const addEmail = () => { ... }` block (currently after the onboarding branch, ~line 815) to just above `if (isOnboardingRoute(activeSection)) {`, so the onboarding branch can use it.
- The onboarding branch returns `<>`, the `<OnboardingFlow ... />` as it is, and `<FeedbackIsland onAddEmail={addEmail} />` `</>`.
- In the shell, next to `<Toaster />`: `<FeedbackIsland onAddEmail={addEmail} />`.
- The shell's `<div className="mx-auto max-w-6xl px-4 py-8">` becomes `<div className="mx-auto max-w-6xl px-4 pb-24 pt-8">`, with a comment: `{/* pb-24: the end of every page scrolls clear of the feedback island. */}`

`frontend/src/components/onboarding/OnboardingFlow.jsx`: `px-4 py-10 sm:py-16` becomes `px-4 pb-24 pt-10 sm:pt-16`.

`frontend/src/components/ProposalsPanel.jsx`: the selection bar `<div role="region" aria-label="Selected" ...>` gains `data-selection-bar=""` (globals.css lifts the island over it).

- [ ] **Step 5: Run the frontend suite**

Run: `cd frontend && npx vitest run > /tmp/fe.txt 2>&1; grep -E "Test Files|Tests " /tmp/fe.txt`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/use-toast.js frontend/src/components/ui/toaster.test.jsx frontend/src/App.jsx frontend/src/components/onboarding/OnboardingFlow.jsx frontend/src/components/ProposalsPanel.jsx
git commit -m "feat: the island on every signed-in screen, and Report on error toasts"
```

---

### Task 8: Version, docs, environment

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (0.4.0)
- Modify: `backend/main.py` (`version="0.4.0"`)
- Modify: `backend/.env.example` (email block)
- Modify: `docs-site/content/docs/run/troubleshooting.mdx` (new `## Reporting a problem`, before `## Getting more detail`)
- Modify: `docs-site/content/docs/changelog.mdx` (`## 0.4.0` above `## 0.3.0`)

- [ ] **Step 1: Version**

Run: `cd frontend && npm version 0.4.0 --no-git-tag-version` and set `version="0.4.0"` in `backend/main.py`.

- [ ] **Step 2: `backend/.env.example`**, appended:

```
# OPTIONAL - Email. RESEND_API_KEY and EMAIL_FROM are the auth service's two,
# read here too: by scripts/access.py for invites, and for the owner's copy of
# each feedback report. Unset, mail is printed rather than sent.
# RESEND_API_KEY=re_...
# EMAIL_FROM=MyGist <mygist@example.com>
#
# Where feedback from the island is emailed. Unset, reports are saved and not
# emailed; read them with `python scripts/feedback.py`.
# FEEDBACK_TO=you@example.com
```

- [ ] **Step 3: `troubleshooting.mdx`**, before `## Getting more detail`:

```mdx
## Reporting a problem

Signed in, **Feedback** in the bottom right of every screen sends a report to
whoever runs this instance. Choose Problem, Idea or Something else, say what
happened, and add a screenshot if it helps: pick an image, or paste one into
the box. The browser shrinks it and saves it again, which drops the location a
phone photo carries.

A report carries your username, the page you were on, the MyGist version, and
your browser and screen size. Nothing from your persona is attached. Replies
go to your recovery email, so add one in **Settings → Account** if you want an
answer. Error messages in the app have a **Report** button that opens the same
form with the error filled in.

If you run the instance, reports are saved in the `feedback` table and emailed
to `FEEDBACK_TO` through Resend (`RESEND_API_KEY` and `EMAIL_FROM` on the API).
Read them with `python scripts/feedback.py`, one in full with `show <id>`, and
close one with `done <id>`. An account can send 10 an hour, and deleting an
account deletes its reports.
```

- [ ] **Step 4: `changelog.mdx`**, above `## 0.3.0`:

```mdx
## 0.4.0

A Feedback button in the bottom right of every signed-in screen opens a short
form for a problem, an idea or anything else, with a screenshot you attach or
paste. Error messages have a Report button that opens it with the error filled
in.

- A report carries your username, the page, the version, and your browser and
  screen size, never your persona. A screenshot is shrunk in your browser,
  which drops a photo's location.
- Reports are saved, emailed to whoever runs the instance, and deleted with
  the account. An account can send 10 an hour.

### Upgrading

One migration, `0012_feedback`, which runs on start. To have reports emailed,
set `FEEDBACK_TO` on the API with `RESEND_API_KEY` and `EMAIL_FROM`. Without
them, reports are saved and `python scripts/feedback.py` lists them.
```

- [ ] **Step 5: Verify the docs**

Run: `cd docs-site && rm -rf out && npm run build > /tmp/docs.txt 2>&1 && npm run check:links`
Expected: build succeeds; "All internal links and anchors resolve."

Run: `grep -c '—' docs-site/content/docs/run/troubleshooting.mdx docs-site/content/docs/changelog.mdx` and compare against `git show HEAD:<file> | grep -c '—'`.
Expected: no increase.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json backend/main.py backend/.env.example docs-site/content/docs/run/troubleshooting.mdx docs-site/content/docs/changelog.mdx
git commit -m "docs: reporting a problem, and 0.4.0"
```

---

### Task 9: Walkthrough on the local preview

**Files:**
- Create (scratchpad, not committed): `verify/feedback.mjs`

- [ ] **Step 1: Rebuild the preview from the branch**

Run: `PORT=1120 AUTH_MCP_RESOURCE=http://localhost:1120/mcp ./scripts/local-preview.sh` (rebuilds the working tree; migration 0012 runs on start). Expected: `/health` 200, `/api/openapi.json` shows 0.4.0 and `/api/feedback`.

- [ ] **Step 2: Write and run the walkthrough** (Playwright, the same shape as `verify/card.mjs`: throwaway account `fb-walk`, deleted at the end)

It must check, with screenshots at 1280×800 and 390×844:
1. The pill shows on Profile, bottom right, and not on the sign-in screen.
2. Open, attach a real PNG (`docs-site/public/screenshots/onboarding-assistant.png`), type, Send; the panel says "Thanks. Your feedback is in."; `psql` shows one `feedback` row for the account with `screenshot_type = 'jpeg'`; the preview's log shows `FEEDBACK_TO is unset`.
3. Review with an item selected (a proposal made over MCP with a minted token, as in `card.mjs`): the pill sits above the selection bar, at 1280 and 390.
4. Onboarding Connect at 390: scrolled to the end, Continue is not under the pill.
5. A forced save failure (`page.route` the persona PUT to 500): the toast's Report opens the island with `The app said: "Failed to save` in the box.
6. No page errors.

- [ ] **Step 3: The bundle**

Run: grep the built `frontend/dist/assets/index-*.js` for "Thanks. Your feedback is in.", "Report this problem" and "or paste one into the box", and count em dashes in the island's strings (none).

- [ ] **Step 4: Clean up**

Delete the account (`db.delete_account`) and confirm `select count(*) from users where username='fb-walk'` is 0 and no `feedback` rows remain for it.
