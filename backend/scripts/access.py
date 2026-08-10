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
    DATABASE_URL=... python scripts/access.py admit sarah@example.com [--expires 30d]
    DATABASE_URL=... python scripts/access.py drop sarah@example.com

    DATABASE_URL=... python scripts/access.py mint --label "sarah" [--uses N] [--expires 30d]
    DATABASE_URL=... python scripts/access.py codes [--all]
    DATABASE_URL=... python scripts/access.py revoke CODE

`admit` is the reason the two halves are one script. It mints a code and stamps
the waitlist row in one go, so the list cannot drift from the codes -- which is
exactly what happens when the two are separate commands and you get distracted
between them.

The rule that decides whether a code admits someone lives in the auth service
(auth/src/invite.js) and is the single implementation of it. Nothing here
duplicates that logic; this only ever writes and reads rows.
"""
import argparse
import re
import secrets
import sys
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
    print("    admit EMAIL [--expires 30d] mint a code and stamp them invited")
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
    print('    access.py mint --label "reddit thread" --uses 10 --expires 30d')
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


def mint(label: str, uses: int, expires: str | None) -> None:
    code = create_code(label, uses, expires)
    expires_at = parse_expiry(expires) if expires else None
    plural = "use" if uses == 1 else "uses"
    when = expires_at.strftime("%Y-%m-%d") if expires_at else "no expiry"
    print(f"  {code}   {uses} {plural}   {when}")


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


def admit(email: str, uses: int, expires: str | None) -> None:
    """Mint a code for someone on the list and stamp them invited.

    Order matters. The code is minted first: if the stamp fails, you have a
    spare code and a row that still says "waiting", which is recoverable by
    running this again. Stamping first and failing to mint would mark someone
    invited who never received anything, and nothing would ever show that.
    """
    email = waitlist_store.normalise(email)
    on_list = any(r["email"] == email for r in waitlist_store.listing(include_invited=True))
    if not on_list:
        raise SystemExit(
            f"{email} is not on the waitlist. Mint an unattached code instead:\n"
            f'  access.py mint --label "{email}"'
        )

    code = create_code(label=email, uses=uses, expires=expires)
    waitlist_store.mark_invited(email)

    expires_at = parse_expiry(expires) if expires else None
    when = expires_at.strftime("%Y-%m-%d") if expires_at else "no expiry"
    table(
        ["EMAIL", "CODE", "USES", "EXPIRES"],
        [[email, code, str(uses), when]],
    )
    print(f"\n  {waitlist_store.pending_count()} still waiting.")
    hint(
        "Send them the code with the sign-up link.",
        "Nothing has emailed them -- that part is still you.",
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
            admit(args.email, args.uses, args.expires)
        elif args.command == "drop":
            drop(args.email)
        elif args.command == "mint":
            mint(args.label, args.uses, args.expires)
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
