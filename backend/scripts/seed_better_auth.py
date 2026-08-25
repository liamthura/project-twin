#!/usr/bin/env python3
"""Seed Better Auth's tables from MyGist's existing accounts.

Idempotent: re-running reconciles rather than duplicating, so it is safe to run
before every deploy while the two stores are both live.

The point of this script is that nobody has to change their password. Existing
bcrypt hashes are copied across verbatim and Better Auth verifies them with the
custom verifier configured in auth/src/auth.js. An account signs in afterwards
exactly as it did before, and never learns anything moved.

**Ids are preserved.** Better Auth's `user.id` is the same value as
`public.users.id`, so a JWT's `sub` addresses a MyGist account directly with no
mapping table and nothing to drift. That is the whole reason this is a seed
rather than a fresh sign-up flow.

**Placeholder emails.** Better Auth's `user.email` is NOT NULL, and MyGist
accounts have no email at all. Accounts without one get `<username>@mygist
.invalid`; `.invalid` is reserved by RFC 2606 and can never resolve, so a
placeholder can never be mistaken for a deliverable address or accidentally
sent to. They are replaced when a real address is added.

**Usernames are stored lowercase.** The username plugin normalises with
`toLowerCase()` before it looks anyone up, so a row stored as "Liam" is
unreachable: typing "Liam" normalises to "liam" and matches nothing, and the
attempt fails as "invalid username or password" without the password ever being
checked. `username` therefore holds the normalised form and `displayUsername`
the original, which is exactly how the plugin writes its own rows. Getting this
wrong locks out every account with an uppercase letter in its name.

Usage:
    DATABASE_URL=... python scripts/seed_better_auth.py [--dry-run]
"""
import argparse
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402

PLACEHOLDER_DOMAIN = "mygist.invalid"

# Better Auth models a password as the "credential" provider's account row,
# rather than a column on the user. Seeding an account therefore writes two
# rows, and the bcrypt hash belongs on the second.
CREDENTIAL_PROVIDER = "credential"
# Better Auth 1.7 keys an account on (issuer, accountId). Migration 0010
# backfills existing credential rows with this value; new ones must match it.
CREDENTIAL_ISSUER = "local:credential"


def placeholder_email(username: str) -> str:
    """Lowercase, because Better Auth lowercases an email before looking it up.

    Stored with capitals, the address is unreachable in exactly the way a
    capitalised username was: a reset request for "Liam@..." normalises to
    "liam@..." and matches nothing, and one for "liam@..." does not match the
    stored "Liam@..." either. Both fail as "user not found", and the account
    cannot be recovered at all.
    """
    return f"{username.lower()}@{PLACEHOLDER_DOMAIN}"


def is_placeholder(email: str) -> bool:
    return bool(email) and email.lower().endswith(f"@{PLACEHOLDER_DOMAIN}")


def seed(dry_run: bool = False) -> dict:
    stats = {"users": 0, "created": 0, "updated": 0, "credentials": 0, "skipped": 0}
    now = datetime.now(timezone.utc)

    with db.get_pool().connection() as conn:
        rows = conn.execute(
            """
            select id, username, password_hash, created_at
            from public.users
            order by created_at
            """
        ).fetchall()

        for row in rows:
            stats["users"] += 1
            user_id = str(row["id"])
            username = row["username"]

            existing = conn.execute(
                'select "id", "email" from better_auth."user" where "id" = %s',
                (user_id,),
            ).fetchone()

            if dry_run:
                print(
                    f"  {'update' if existing else 'create'}  {username:20} {user_id}"
                    f"{'  (+password)' if row['password_hash'] else '  (no password set)'}"
                )
                stats["created" if not existing else "updated"] += 1
                if row["password_hash"]:
                    stats["credentials"] += 1
                continue

            if existing:
                # Placeholders are normalised in place: they were seeded with
                # the original capitalisation before this was understood, and a
                # capitalised placeholder is unreachable. A REAL address is
                # never touched -- that is the point of the is_placeholder
                # guard, not an optimisation.
                email = existing["email"]
                if is_placeholder(email):
                    email = placeholder_email(username)

                conn.execute(
                    """
                    update better_auth."user"
                       set "username" = %s, "displayUsername" = %s,
                           "email" = %s, "updatedAt" = %s
                     where "id" = %s
                    """,
                    (username.lower(), username, email, now, user_id),
                )
                stats["updated"] += 1
            else:
                conn.execute(
                    """
                    insert into better_auth."user"
                        ("id", "name", "email", "emailVerified",
                         "username", "displayUsername", "createdAt", "updatedAt")
                    values (%s, %s, %s, false, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        username,
                        placeholder_email(username),
                        # Normalised for lookup; original preserved for display.
                        username.lower(),
                        username,
                        row["created_at"] or now,
                        now,
                    ),
                )
                stats["created"] += 1

            if not row["password_hash"]:
                # Token-only accounts predate password sign-in. They get a user
                # row so their id resolves, but no credential -- giving them one
                # would be inventing a way to sign in that never existed.
                stats["skipped"] += 1
                continue

            credential = conn.execute(
                """
                select "id" from better_auth."account"
                 where "userId" = %s and "providerId" = %s
                """,
                (user_id, CREDENTIAL_PROVIDER),
            ).fetchone()

            if credential:
                conn.execute(
                    """
                    update better_auth."account"
                       set "password" = %s, "updatedAt" = %s
                     where "id" = %s
                    """,
                    (row["password_hash"], now, credential["id"]),
                )
            else:
                conn.execute(
                    """
                    insert into better_auth."account"
                        ("id", "accountId", "providerId", "userId",
                         "password", "createdAt", "updatedAt", "issuer")
                    values (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        str(uuid.uuid4()),
                        user_id,
                        CREDENTIAL_PROVIDER,
                        user_id,
                        row["password_hash"],
                        now,
                        now,
                        CREDENTIAL_ISSUER,
                    ),
                )
            stats["credentials"] += 1

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="report what would change, write nothing"
    )
    args = parser.parse_args()

    if args.dry_run:
        print("Dry run — nothing will be written.\n")

    try:
        stats = seed(dry_run=args.dry_run)
    finally:
        # Without this the pool's worker threads outlive main() and psycopg
        # spends five seconds per thread complaining on the way out. Noise in a
        # deploy log is noise someone eventually learns to ignore.
        db.get_pool().close()

    print(
        f"\n{stats['users']} MyGist accounts: "
        f"{stats['created']} created, {stats['updated']} updated, "
        f"{stats['credentials']} with a password carried over, "
        f"{stats['skipped']} token-only (no credential)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
