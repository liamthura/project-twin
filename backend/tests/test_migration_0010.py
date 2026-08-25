"""The 1.7 account identity change, over data that already exists.

The backfill is the whole risk here. Better Auth 1.7 keys an account on
(issuer, accountId) rather than (providerId, accountId), and the generated
migration cannot choose issuers for you -- on MySQL it silently backfills
empty strings. On Postgres a missed row fails the NOT NULL instead, which is
why this asserts the value rather than merely that the column exists.
"""
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402

CREDENTIAL_ISSUER = "local:credential"


def _make_credential_account(user_id):
    """A credential account in the shape seed_better_auth.py writes."""
    account_id = str(uuid.uuid4())
    with db.get_pool().connection() as conn:
        conn.execute(
            'insert into better_auth."user"'
            ' ("id", "name", "email", "emailVerified", "updatedAt", "username")'
            " values (%s, %s, %s, false, now(), %s)",
            (str(user_id), "Test", f"{user_id}@mygist.invalid", str(user_id)[:8]),
        )
        conn.execute(
            'insert into better_auth."account"'
            ' ("id", "accountId", "providerId", "userId", "password",'
            ' "createdAt", "updatedAt", "issuer")'
            " values (%s, %s, 'credential', %s, 'x', now(), now(), %s)",
            (account_id, str(user_id), str(user_id), CREDENTIAL_ISSUER),
        )
    return account_id


def test_credential_accounts_are_backfilled_with_the_local_issuer(
    rerun_migrations, fresh_schema
):
    user_id = uuid.uuid4()
    _make_credential_account(user_id)

    # Put the row back into its pre-1.7 shape. Inserting it that way is not
    # possible -- the column is NOT NULL once the migration has run -- and
    # without this the backfill's `where "issuer" is null` matches nothing and
    # the test passes without exercising anything.
    with db.get_pool().connection() as conn:
        conn.execute(
            'alter table better_auth."account" alter column "issuer" drop not null'
        )
        conn.execute(
            'update better_auth."account" set "issuer" = null where "userId" = %s',
            (str(user_id),),
        )

    rerun_migrations()

    with db.get_pool().connection() as conn:
        row = conn.execute(
            'select "issuer" from better_auth."account" where "userId" = %s',
            (str(user_id),),
        ).fetchone()
    assert row["issuer"] == CREDENTIAL_ISSUER


def test_issuer_and_account_id_are_unique_together():
    user_id = uuid.uuid4()
    _make_credential_account(user_id)

    # Same (issuer, accountId) as the row above -- the pair Better Auth 1.7
    # now treats as the identity, so a second one must be refused.
    with pytest.raises(psycopg.errors.UniqueViolation):
        with db.get_pool().connection() as conn:
            conn.execute(
                'insert into better_auth."account"'
                ' ("id", "accountId", "providerId", "userId",'
                ' "createdAt", "updatedAt", "issuer")'
                " values (%s, %s, 'credential', %s, now(), now(), %s)",
                (str(uuid.uuid4()), str(user_id), str(user_id), CREDENTIAL_ISSUER),
            )
