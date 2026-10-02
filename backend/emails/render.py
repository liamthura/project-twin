"""The emails people get, as HTML and text: auth/src/emails/render.js in Python.

layout.html and copy.json are copies of the auth service's (tests/test_emails.py
fails if they drift), and the golden files hold both renderers to the same
output, so a preview from scripts/emails.py is what the auth service sends.

Copy is plain text and always escaped; a {placeholder}'s value is bold in HTML.
Links, codes and the footer come from the caller, never from copy. Edits live
in email_copy and are read at send time.
"""
import json
import logging
import re
from pathlib import Path
from urllib.parse import urlparse

import db

logger = logging.getLogger(__name__)

HERE = Path(__file__).resolve().parent
DECK = json.loads((HERE / "copy.json").read_text())
_SOURCE = (HERE / "layout.html").read_text()
_BLOCK = re.compile(r"<!-- block (\w+) -->\n([\s\S]*?)<!-- end -->\n")
BLOCKS = dict(_BLOCK.findall(_SOURCE))
PAGE = _BLOCK.sub("", _SOURCE)


def _esc(s) -> str:
    # The same four as render.js, not html.escape, which also turns ' into
    # &#x27; and would make the two renderers disagree on every "Didn't".
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _fill(template: str, values: dict) -> str:
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values.get(m.group(1)) or "", template)


def _words(entry, overrides, slot, values, html):
    # An optional line belongs to the value it is named after, so it goes when
    # that value does, whatever an edit has made its wording say.
    if slot in entry["optional"] and values.get(slot) in (None, ""):
        return None
    raw = overrides.get(slot, entry["slots"].get(slot))
    if raw is None:
        return None
    missing = False
    out = []
    for part in re.split(r"(\{\w+\})", raw):
        m = re.fullmatch(r"\{(\w+)\}", part)
        if not m:
            out.append(_esc(part) if html else part)
            continue
        value = values.get(m.group(1))
        if value is None or value == "":
            missing = True
            continue
        out.append(f"<b>{_esc(value)}</b>" if html else str(value))
    return None if missing and slot in entry["optional"] else "".join(out)


def render(name: str, values: dict, overrides: dict | None = None, origin: str = "") -> dict:
    entry = DECK[name]
    overrides = overrides or {}

    def w(slot, html=True):
        return _words(entry, overrides, slot, values, html)

    footer = f"MyGist · {urlparse(origin).netloc}" if origin else "MyGist"
    url = _esc(values["url"])
    detail = " ".join(x for x in (w("detail"), w("fallback")) if x)
    lines = [x for x in (w(slot) for slot in entry["optional"]) if x]
    html = _fill(PAGE, {
        "subject": _esc(w("subject", False)),
        "preheader": _esc(w("intro", False)),
        "mark": _esc(f"{origin}/landing/email-mark.png"),
        "heading": w("heading"),
        "intro": w("intro"),
        "button": w("button"),
        "url": url,
        "detail": (_fill(BLOCKS["detail"], {"detail": detail}) if detail else "")
        + (_fill(BLOCKS["link"], {"url": url}) if w("fallback") else ""),
        "code": _fill(BLOCKS["code"], {"code": _esc(values["code"])})
        + "".join(_fill(BLOCKS["line"], {"line": line}) for line in lines)
        if values.get("code")
        else "",
        "note": _fill(BLOCKS["note"], {"note": w("note")}) if w("note") else "",
        "footer": _esc(footer),
    })
    text = "\n\n".join(
        x
        for x in (
            w("heading", False),
            w("intro", False),
            f"{w('button', False)}: {values['url']}",
            w("detail", False),
            values.get("code") or None,
            *(w(slot, False) for slot in entry["optional"]),
            w("note", False),
            f"--\n{footer}",
        )
        if x
    )
    return {"subject": w("subject", False), "html": html, "text": f"{text}\n"}


def overrides(name: str) -> dict:
    """This email's edited slots. A failed read is the defaults, never a lost email."""
    try:
        with db.get_pool().connection() as conn:
            rows = conn.execute("select slot, value from email_copy where email = %s", (name,)).fetchall()
        return {r["slot"]: r["value"] for r in rows}
    except Exception as exc:
        logger.warning("could not read email_copy for %s, sending the defaults: %s", name, exc)
        return {}


def compose(name: str, values: dict, origin: str = "") -> dict:
    return render(name, values, overrides(name), origin)
