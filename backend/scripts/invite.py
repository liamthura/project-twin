#!/usr/bin/env python3
"""Mint, list and revoke invite codes.

Run where the database is reachable -- in the container, where DATABASE_URL
already is. That IS the authorisation model: minting requires database access,
which is a stronger gate than any admin role this project would otherwise have
to build, and it needs no new UI, no new endpoints and no new attack surface.

This script only ever writes and reads rows. The rule that decides whether a
code admits someone lives in the auth service (auth/src/invite.js) and is the
single implementation of it -- nothing here duplicates that logic.

Usage:
    DATABASE_URL=... python scripts/invite.py mint --label "sarah" [--uses N] [--expires 30d]
    DATABASE_URL=... python scripts/invite.py list [--all]
    DATABASE_URL=... python scripts/invite.py revoke CODE
"""
import argparse
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402

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


def mint(label: str, uses: int, expires: str | None) -> None:
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
        where = "" if show_all else " active"
        print(f"  no{where} codes. Mint one with:  invite.py mint --label ...")
        return

    print(f"  {'CODE':<11} {'LABEL':<24} {'USED':<7} {'EXPIRES':<12} STATUS")
    for row in rows:
        used = f"{row['uses']}/{row['max_uses']}"
        expires = row["expires_at"].strftime("%Y-%m-%d") if row["expires_at"] else "—"
        label = row["label"][:23]
        print(f"  {row['code']:<11} {label:<24} {used:<7} {expires:<12} {status_of(row)}")


def revoke(code: str) -> None:
    normalised = code.strip().upper()
    if "-" not in normalised and len(normalised) == GROUP * 2:
        normalised = f"{normalised[:GROUP]}-{normalised[GROUP:]}"

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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_mint = sub.add_parser("mint", help="create a code")
    p_mint.add_argument(
        "--label",
        required=True,
        help="who it is for. Required: an unlabelled code cannot be revoked "
        "with any confidence weeks later",
    )
    p_mint.add_argument("--uses", type=int, default=1, help="how many accounts (default 1)")
    p_mint.add_argument("--expires", help="30d, 12h, or 2026-08-30")

    p_list = sub.add_parser("list", help="show codes")
    p_list.add_argument(
        "--all", action="store_true", help="include spent, expired and revoked"
    )

    p_revoke = sub.add_parser("revoke", help="close a code to new sign-ups")
    p_revoke.add_argument("code")

    args = parser.parse_args()

    try:
        if args.command == "mint":
            mint(args.label, args.uses, args.expires)
        elif args.command == "list":
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
