#!/usr/bin/env python3
"""Who gets in: the waitlist, and the invite codes that admit them.

Run where the database is reachable -- in the container, where DATABASE_URL
already is. That IS the authorisation model: it requires database access, which
is a stronger gate than any admin role this project would otherwise have to
build, and it needs no new UI, no new endpoints and no new attack surface.

This replaces `invite.py`, which did half the job. The waitlist had no tooling
at all, so the only way to read the queue was raw SQL -- and the one operation
that matters, "send this person a code", spanned both halves and belonged to
neither.

    DATABASE_URL=... python scripts/access.py waitlist [--all]
    DATABASE_URL=... python scripts/access.py admit sarah@example.com [--expires 30d] [--send]
    DATABASE_URL=... python scripts/access.py drop sarah@example.com

    DATABASE_URL=... python scripts/access.py mint --label "sarah" [--uses N] [--expires 30d]
    DATABASE_URL=... python scripts/access.py codes [--all]
    DATABASE_URL=... python scripts/access.py revoke CODE

`admit` is the reason the two halves are one script. It mints a code, stamps the
waitlist row and emails the sign-up link in one go, so the list cannot drift
from the codes -- which is exactly what happens when the two are separate
commands and you get distracted between them.

Mail goes through Resend, reading `RESEND_API_KEY` and `EMAIL_FROM`, the same
two variables the auth service reads. With either unset it prints the message
instead of sending, which is the same choice auth/src/email.js makes and for the
same reason: the flow can be walked end to end before anyone has a Resend
account, and a silent no-op would be worse than either sending or failing.

The link needs a public origin, from `--url`, `PUBLIC_URL` or `BETTER_AUTH_URL`.
The app container sets none of those today, so pass `--url` or add one.

The rule that decides whether a code admits someone lives in the auth service
(auth/src/invite.js) and is the single implementation of it. Nothing here
duplicates that logic; this only ever writes and reads rows.
"""
import argparse
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import waitlist_store  # noqa: E402

# Crockford base32 minus I, L, O and U -- the characters people mistype for one
# another, plus the one Crockford drops so a code can never spell a word. Must
# stay identical to ALPHABET in auth/src/invite.js; the pattern there rejects
# anything outside it, so a code minted from a wider alphabet would be
# unusable by construction.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

GROUP = 4


def generate_code() -> str:
    """XXXX-XXXX. secrets, not random: these are credentials."""
    body = "".join(secrets.choice(ALPHABET) for _ in range(GROUP * 2))
    return f"{body[:GROUP]}-{body[GROUP:]}"


def parse_expiry(value: str) -> datetime:
    """Accepts 30d, 12h, or an ISO date. Rejects anything else loudly."""
    match = re.fullmatch(r"(\d+)([dh])", value.strip().lower())
    if match:
        amount, unit = int(match.group(1)), match.group(2)
        delta = timedelta(days=amount) if unit == "d" else timedelta(hours=amount)
        return datetime.now(timezone.utc) + delta

    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise SystemExit(
            f"could not read --expires {value!r}: use 30d, 12h, or 2026-08-30"
        )
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def normalise_code(code: str) -> str:
    normalised = code.strip().upper()
    if "-" not in normalised and len(normalised) == GROUP * 2:
        normalised = f"{normalised[:GROUP]}-{normalised[GROUP:]}"
    return normalised


# --------------------------------------------------------------- invite links
RESEND_ENDPOINT = "https://api.resend.com/emails"


def base_url(explicit: str | None) -> str | None:
    """Where the sign-up form lives.

    `BETTER_AUTH_URL` is checked because it already means "the public origin the
    browser uses" -- the auth service builds its cookies and redirects from it,
    so if it is wrong here it is wrong everywhere. `--url` wins so a link can be
    minted for production from a machine pointed at a local database.
    """
    for candidate in (explicit, os.environ.get("PUBLIC_URL"), os.environ.get("BETTER_AUTH_URL")):
        if candidate:
            return candidate.rstrip("/")
    return None


def invite_link(base: str, code: str) -> str:
    """`?invite=CODE`, which WelcomeAuth reads once at mount and uses to skip
    the code-entry screen. A query parameter rather than a hash, because the
    hash never reaches the server and this has to survive the auth redirects."""
    return f"{base}/?invite={code}"


def invite_email(code: str, link: str, uses: int, expires_at: datetime | None) -> tuple[str, str]:
    """Subject and body. Plain text, because an invite is four lines and HTML
    would be four lines wrapped in a table."""
    lines = [
        "You asked for an invite to MyGist, so here is one.",
        "",
        f"  {link}",
        "",
        f"That link fills the code in. To type it by hand instead, it is {code}.",
    ]
    if expires_at:
        lines.append(f"It stops working on {expires_at.strftime('%-d %B %Y')}.")
    if uses > 1:
        lines.append(f"It is good for {uses} accounts.")
    lines += ["", "MyGist is invite-only while it is small. Thanks for waiting."]
    return "Your MyGist invite", "\n".join(lines)


def send_email(to: str, subject: str, text: str) -> bool:
    """Send through Resend, or print when there is no provider.

    Printing is deliberate rather than a fallback, and it is the same choice
    auth/src/email.js makes for password reset: the whole flow can be walked
    locally before anyone has a Resend account. A silent no-op would be worse
    than either sending or failing, because you would think the mail went.

    Returns True if it actually left the building.
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

    request = urllib.request.Request(
        RESEND_ENDPOINT,
        data=json.dumps({"from": sender, "to": to, "subject": subject, "text": text}).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15):
            pass
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:200]
        # Raised, not swallowed. The code is already minted and the row already
        # stamped, so silence here would leave someone marked invited with
        # nothing in their inbox and no record of why.
        raise SystemExit(f"Resend responded {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"could not reach Resend: {exc.reason}")
    return True


# ------------------------------------------------------------------ printing
def table(headers: list[str], rows: list[list[str]]) -> None:
    """Columns sized to their contents, not to a guess.

    The old fixed widths truncated a 38-character address to 37 and padded a
    short one by twenty spaces. Both are the same mistake: the column knows how
    wide it needs to be, so let it work it out.
    """
    widths = [
        max(len(headers[i]), *(len(row[i]) for row in rows)) for i in range(len(headers))
    ]
    line = "  " + "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    print(line.rstrip())
    for row in rows:
        print(("  " + "  ".join(c.ljust(widths[i]) for i, c in enumerate(row))).rstrip())


def hint(*lines: str) -> None:
    """What to do next.

    Every command that shows a list ends with one. Someone reading a waitlist
    wants to invite somebody off it, and making them go back to --help to find
    out how is a small tax charged every single time.

    Lines shaped `label: command` are aligned on the colon, by measuring rather
    than by padding them by hand -- the hand-padded version was already crooked
    the first time it printed, because "Show invited too:" is a character wider
    than the two lines above it.
    """
    print()
    labelled = [line.split(":", 1) for line in lines if ":" in line]
    width = max((len(label) for label, _ in labelled), default=0)
    for line in lines:
        if ":" in line:
            label, rest = line.split(":", 1)
            print(f"  {(label + ':').ljust(width + 1)} {rest.strip()}")
        else:
            print(f"  {line}")


def overview() -> None:
    """What `access.py` on its own prints.

    argparse's own error for a missing subcommand is "invalid choice", which
    tells someone who typed the script name hoping to be told what it does
    exactly nothing. This is what they were asking for.
    """
    print(__doc__.strip().split("\n")[0])
    print()
    print("  WAITLIST")
    print("    waitlist [--all]            who is waiting, oldest first")
    print("    admit EMAIL [--send]        mint a code, stamp them, email the link")
    print("    drop EMAIL                  remove an address")
    print()
    print("  CODES")
    print("    codes [--all]               invite codes and their state")
    print('    mint --label "who"          a code with no waitlist row')
    print("    revoke CODE                 close a code to new sign-ups")
    print()
    print("  EXAMPLES")
    print("    access.py waitlist")
    print("    access.py admit sarah@example.com --expires 30d")
    print("    access.py admit sarah@example.com --send --url https://mygist.example.com")
    print('    access.py mint --label "reddit thread" --uses 10 --expires 30d')
    print()
    print("  Links need a public origin: --url, PUBLIC_URL or BETTER_AUTH_URL.")
    print("  --send needs RESEND_API_KEY and EMAIL_FROM, or it prints the message.")
    print()
    print("  Run where DATABASE_URL reaches the database -- in the container.")
    print("  access.py <command> --help explains one command.")


# ------------------------------------------------------------------- invites
def create_code(label: str, uses: int, expires: str | None) -> str:
    if uses < 1:
        raise SystemExit("--uses must be at least 1")

    expires_at = parse_expiry(expires) if expires else None
    code = generate_code()

    with db.get_pool().connection() as conn:
        conn.execute(
            """insert into invite_codes (code, label, max_uses, expires_at)
               values (%s, %s, %s, %s)""",
            (code, label, uses, expires_at),
        )
    return code


def mint(label: str, uses: int, expires: str | None, url: str | None) -> None:
    code = create_code(label, uses, expires)
    expires_at = parse_expiry(expires) if expires else None
    plural = "use" if uses == 1 else "uses"
    when = expires_at.strftime("%Y-%m-%d") if expires_at else "no expiry"
    # One line, still. This output IS the code, and a test holds it to that.
    print(f"  {code}   {uses} {plural}   {when}")

    base = base_url(url)
    if base:
        print(f"  {invite_link(base, code)}")


def status_of(row) -> str:
    """What a human needs to know, in one word.

    Deliberately more informative than the auth service's rejection message:
    that one is read by strangers and says nothing, this one is read by whoever
    minted the code and should say everything.
    """
    if row["revoked_at"] is not None:
        return "revoked"
    if row["expires_at"] is not None and row["expires_at"] <= datetime.now(timezone.utc):
        return "expired"
    if row["uses"] >= row["max_uses"]:
        return "spent"
    return "active"


def list_codes(show_all: bool) -> None:
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select * from invite_codes order by created_at desc"
        ).fetchall()

    rows = [r for r in rows if show_all or status_of(r) == "active"]
    if not rows:
        print("  No active codes." if not show_all else "  No codes at all.")
        hint('Mint one:  access.py mint --label "who it is for"')
        return

    table(
        ["CODE", "LABEL", "USED", "EXPIRES", "STATUS"],
        [
            [
                row["code"],
                row["label"],
                f"{row['uses']}/{row['max_uses']}",
                row["expires_at"].strftime("%Y-%m-%d") if row["expires_at"] else "—",
                status_of(row),
            ]
            for row in rows
        ],
    )

    if show_all:
        hint(
            "active = usable   spent = all uses taken",
            "expired = past its date   revoked = closed by hand",
            "Revoke one: access.py revoke <code>",
        )
    else:
        hint(
            "Revoke one: access.py revoke <code>",
            "Include the rest: access.py codes --all",
        )


def revoke(code: str) -> None:
    normalised = normalise_code(code)

    with db.get_pool().connection() as conn:
        row = conn.execute(
            """update invite_codes set revoked_at = now()
                where code = %s and revoked_at is null
            returning code, uses""",
            (normalised,),
        ).fetchone()

        if row is None:
            existing = conn.execute(
                "select revoked_at from invite_codes where code = %s", (normalised,)
            ).fetchone()
            if existing is None:
                raise SystemExit(f"no such code: {normalised}")
            print(f"  {normalised} was already revoked.")
            return

    # Said out loud because the opposite is a reasonable thing to assume and a
    # bad thing to discover: revoking closes a code to NEW sign-ups and does
    # nothing to accounts already created with it.
    accounts = row["uses"]
    if accounts:
        noun = "account" if accounts == 1 else "accounts"
        print(
            f"  {normalised} revoked. {accounts} {noun} already created with it "
            f"{'is' if accounts == 1 else 'are'} unaffected."
        )
    else:
        print(f"  {normalised} revoked. It was never used.")


# ------------------------------------------------------------------ waitlist
def show_waitlist(show_all: bool) -> None:
    rows = waitlist_store.listing(include_invited=show_all)
    if not rows:
        print("  Nobody waiting." if not show_all else "  The waitlist is empty.")
        hint("The form on the landing page adds people here.")
        return

    table(
        ["EMAIL", "JOINED", "INVITED"],
        [
            [
                row["email"],
                row["created_at"].strftime("%Y-%m-%d"),
                row["invited_at"].strftime("%Y-%m-%d") if row["invited_at"] else "—",
            ]
            for row in rows
        ],
    )

    pending = waitlist_store.pending_count()
    print(f"\n  {pending} waiting.")
    hint(
        "Send one a code: access.py admit <email> --expires 30d",
        "Remove one: access.py drop <email>",
        *([] if show_all else ["Show invited too: access.py waitlist --all"]),
    )


def admit(email: str, uses: int, expires: str | None, url: str | None, send: bool) -> None:
    """Mint a code for someone on the list and stamp them invited.

    Order matters. The code is minted first: if the stamp fails, you have a
    spare code and a row that still says "waiting", which is recoverable by
    running this again. Stamping first and failing to mint would mark someone
    invited who never received anything, and nothing would ever show that.

    The email goes last, for the same reason. A send that fails leaves a real
    code and a stamped row, and re-running produces a second code that works.
    Sending first would risk mailing a code that was never written down.
    """
    email = waitlist_store.normalise(email)
    on_list = any(r["email"] == email for r in waitlist_store.listing(include_invited=True))
    if not on_list:
        raise SystemExit(
            f"{email} is not on the waitlist. Mint an unattached code instead:\n"
            f'  access.py mint --label "{email}"'
        )

    base = base_url(url)
    if send and not base:
        # Checked before minting, because this one is pure user error and
        # failing here costs nothing. An email with a bare code in it and no
        # link is not the thing that was asked for.
        raise SystemExit(
            "--send needs to know where the sign-up form is.\n"
            "  access.py admit EMAIL --send --url https://mygist.example.com\n"
            "  or set PUBLIC_URL in this container."
        )

    code = create_code(label=email, uses=uses, expires=expires)
    waitlist_store.mark_invited(email)

    expires_at = parse_expiry(expires) if expires else None
    when = expires_at.strftime("%Y-%m-%d") if expires_at else "no expiry"
    table(["EMAIL", "CODE", "USES", "EXPIRES"], [[email, code, str(uses), when]])
    if base:
        print(f"\n  {invite_link(base, code)}")
    print(f"\n  {waitlist_store.pending_count()} still waiting.")

    if send:
        subject, text = invite_email(code, invite_link(base, code), uses, expires_at)
        if send_email(email, subject, text):
            hint(f"Sent to {email}.")
        else:
            hint("Copy the message above, or set the two variables and run it again.")
    elif base:
        hint(
            "Email it yourself, or add --send.",
            "Nothing has been sent.",
        )
    else:
        hint(
            "Add a link: access.py admit <email> --url https://your-host",
            "Nothing has been sent.",
        )


def drop(email: str) -> None:
    if waitlist_store.remove(email):
        print(f"  {waitlist_store.normalise(email)} removed from the waitlist.")
    else:
        raise SystemExit(f"{waitlist_store.normalise(email)} is not on the waitlist.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n")[0],
        epilog=(
            "examples:\n"
            "  access.py waitlist\n"
            "  access.py admit sarah@example.com --expires 30d\n"
            '  access.py mint --label "reddit thread" --uses 10 --expires 30d\n'
            "\nRun where DATABASE_URL reaches the database -- in the container."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    # Not required: a bare `access.py` prints the overview instead of argparse's
    # "invalid choice", which tells someone who typed the name hoping to be told
    # what it does precisely nothing.
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("help", help="what all of this does")

    p_waitlist = sub.add_parser("waitlist", help="who is waiting")
    p_waitlist.add_argument(
        "--all", action="store_true", help="include people already invited"
    )

    p_admit = sub.add_parser("admit", help="mint a code for someone waiting, and stamp them")
    p_admit.add_argument("email")
    p_admit.add_argument("--uses", type=int, default=1, help="how many accounts (default 1)")
    p_admit.add_argument("--expires", help="30d, 12h, or 2026-08-30")
    p_admit.add_argument(
        "--url", help="where the sign-up form is, if PUBLIC_URL is not set here"
    )
    p_admit.add_argument(
        "--send",
        action="store_true",
        help="email the invite to them. Prints it instead when RESEND_API_KEY "
        "and EMAIL_FROM are unset",
    )

    p_drop = sub.add_parser("drop", help="remove an address from the waitlist")
    p_drop.add_argument("email")

    p_mint = sub.add_parser("mint", help="create a code with no waitlist row")
    p_mint.add_argument(
        "--label",
        required=True,
        help="who it is for. Required: an unlabelled code cannot be revoked "
        "with any confidence weeks later",
    )
    p_mint.add_argument("--uses", type=int, default=1, help="how many accounts (default 1)")
    p_mint.add_argument("--expires", help="30d, 12h, or 2026-08-30")
    p_mint.add_argument(
        "--url", help="where the sign-up form is, if PUBLIC_URL is not set here"
    )

    p_codes = sub.add_parser("codes", help="show invite codes")
    p_codes.add_argument(
        "--all", action="store_true", help="include spent, expired and revoked"
    )

    p_revoke = sub.add_parser("revoke", help="close a code to new sign-ups")
    p_revoke.add_argument("code")

    args = parser.parse_args()

    # No database connection for these two, so they work in a checkout with no
    # DATABASE_URL set -- which is exactly when someone is trying to find out
    # what the script is.
    if args.command in (None, "help"):
        overview()
        return

    try:
        if args.command == "waitlist":
            show_waitlist(args.all)
        elif args.command == "admit":
            admit(args.email, args.uses, args.expires, args.url, args.send)
        elif args.command == "drop":
            drop(args.email)
        elif args.command == "mint":
            mint(args.label, args.uses, args.expires, args.url)
        elif args.command == "codes":
            list_codes(args.all)
        elif args.command == "revoke":
            revoke(args.code)
    finally:
        # Without this the pool's worker threads outlive main() and psycopg
        # spends five seconds per thread complaining on the way out -- which
        # here would bury the code you just minted. Same reasoning as
        # seed_better_auth.py.
        db.get_pool().close()


if __name__ == "__main__":
    main()
