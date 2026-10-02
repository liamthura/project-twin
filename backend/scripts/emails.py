#!/usr/bin/env python3
"""Email copy, changed without a deploy.

The wording of the four emails people get lives in emails/copy.json as
defaults; an edit made here goes in the email_copy table, and both the auth
service and the backend read it when they send. So `set` applies to the very
next email, and `unset` puts the default back.

Run where the database is reachable, the same gate as access.py.

    python scripts/emails.py                          every email, with edited slots marked
    python scripts/emails.py show reset               each slot: its wording, the default if edited
    python scripts/emails.py set reset intro "..."    checked, then saved
    python scripts/emails.py unset reset intro        back to the default
    python scripts/emails.py preview reset            writes reset.html and reset.txt
    python scripts/emails.py send-test reset ADDRESS  a real one through Resend, marked [Test]

Only words can be edited. Links, codes and the footer come from the code, so
no edit can break a link or point it somewhere else.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import mailer  # noqa: E402
from emails import render as emails  # noqa: E402
from scripts.access import hint, table  # noqa: E402

MAX_LENGTH = 1000
# The same sample values the golden files are rendered from.
SAMPLES = json.loads((emails.HERE / "golden" / "fixtures.json").read_text())


def origin() -> str:
    """This instance's address, for the footer and the mark; the sample one
    where neither variable is set."""
    found = os.environ.get("PUBLIC_URL") or os.environ.get("BETTER_AUTH_URL") or SAMPLES["origin"]
    return found.rstrip("/")


def entry(name: str) -> dict:
    if name not in emails.DECK:
        raise SystemExit(f"No email {name}. There are: {', '.join(emails.DECK)}.")
    return emails.DECK[name]


def overview() -> None:
    table(
        ["EMAIL", "SUBJECT", "EDITED"],
        [
            [name, e["slots"]["subject"], ", ".join(emails.overrides(name)) or "-"]
            for name, e in emails.DECK.items()
        ],
    )
    hint("See one: emails.py show <email>", 'Change a slot: emails.py set <email> <slot> "text"')


def show(name: str) -> None:
    e = entry(name)
    edited = emails.overrides(name)
    allowed = ", ".join(f"{{{p}}}" for p in e["placeholders"]) or "none"
    print(f"\n  {name}, placeholders: {allowed}\n")
    for slot, default in e["slots"].items():
        if slot in edited:
            print(f"  {slot} (edited)\n    {edited[slot]}\n    default: {default}\n")
        else:
            print(f"  {slot}\n    {default}\n")
    hint(f'Change one: emails.py set {name} <slot> "text"', f"Back to the default: emails.py unset {name} <slot>")


def set_slot(name: str, slot: str, value: str) -> None:
    e = entry(name)
    if slot not in e["slots"]:
        raise SystemExit(f"{name} has no slot {slot}. It has: {', '.join(e['slots'])}.")
    value = value.strip()
    if not value:
        raise SystemExit(f"A slot can't be empty. To go back to the default: emails.py unset {name} {slot}")
    if len(value) > MAX_LENGTH:
        raise SystemExit(f"A slot can be at most {MAX_LENGTH:,} characters.")
    unknown = sorted(set(re.findall(r"\{(\w+)\}", value)) - set(e["placeholders"]))
    if unknown:
        allowed = ", ".join(f"{{{p}}}" for p in e["placeholders"]) or "none"
        raise SystemExit(f"{name} can't use {', '.join(f'{{{u}}}' for u in unknown)}. It can use: {allowed}.")
    if "—" in value:
        print("\n  Warning: this has an em dash, which house style avoids. Saved anyway.")
    with db.get_pool().connection() as conn:
        conn.execute(
            """
            insert into email_copy (email, slot, value) values (%s, %s, %s)
            on conflict (email, slot) do update set value = excluded.value, updated_at = now()
            """,
            (name, slot, value),
        )
    print(f"\n  Saved. The next {name} email uses it.")


def unset(name: str, slot: str) -> None:
    entry(name)
    with db.get_pool().connection() as conn:
        conn.execute("delete from email_copy where email = %s and slot = %s", (name, slot))
    print(f"\n  {name} {slot} is back to the default.")


def rendered(name: str) -> dict:
    entry(name)
    return emails.render(name, SAMPLES["values"][name], emails.overrides(name), origin())


def preview(name: str, out: str) -> None:
    email = rendered(name)
    for ext, body in (("html", email["html"]), ("txt", email["text"])):
        path = Path(out) / f"{name}.{ext}"
        path.write_text(body)
        print(f"  {path}")


def send_test(name: str, address: str) -> None:
    email = rendered(name)
    if mailer.send_email(address, f"[Test] {email['subject']}", email["text"], html=email["html"]):
        print(f"\n  Sent to {address}.")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Change the emails' wording without a deploy.")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("show").add_argument("name")
    set_cmd = commands.add_parser("set")
    for arg in ("name", "slot", "value"):
        set_cmd.add_argument(arg)
    unset_cmd = commands.add_parser("unset")
    for arg in ("name", "slot"):
        unset_cmd.add_argument(arg)
    preview_cmd = commands.add_parser("preview")
    preview_cmd.add_argument("name")
    preview_cmd.add_argument("--out", default=".")
    send_cmd = commands.add_parser("send-test")
    send_cmd.add_argument("name")
    send_cmd.add_argument("address")
    args = parser.parse_args(argv)

    if args.command == "show":
        show(args.name)
    elif args.command == "set":
        set_slot(args.name, args.slot, args.value)
    elif args.command == "unset":
        unset(args.name, args.slot)
    elif args.command == "preview":
        preview(args.name, args.out)
    elif args.command == "send-test":
        send_test(args.name, args.address)
    else:
        overview()


if __name__ == "__main__":
    try:
        main()
    finally:
        # As in access.py: left open, the pool's worker threads each take five
        # seconds to give up on the way out, burying what was just printed.
        db.get_pool().close()
