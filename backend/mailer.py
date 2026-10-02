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


def send_email(to, subject, text, reply_to=None, attachments=None, html=None) -> bool:
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
    if html:
        payload["html"] = html
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
            # before Resend ever saw the key. Any honest agent string gets
            # through; auth/src/email.js never hit this only because fetch sends
            # one of its own.
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
