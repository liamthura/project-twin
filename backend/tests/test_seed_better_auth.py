"""Seeding MyGist accounts into Better Auth.

The case-normalisation test here exists because the bug it covers reached a real
user. Better Auth's username plugin lowercases a username before looking it up,
so a row seeded as "Liam" was unreachable: typing "Liam" normalised to "liam",
matched nothing, and failed as "invalid username or password" -- without the
password ever being checked. Every account with an uppercase letter was locked
out, and the failure named the wrong cause.

None of the earlier verification could have caught it. The end-to-end proof used
an account created with an all-lowercase name, so the normalisation never
mattered.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
from scripts.seed_better_auth import PLACEHOLDER_DOMAIN, seed  # noqa: E402


def better_auth_user(username_lookup):
    with db.get_pool().connection() as conn:
        return conn.execute(
            'select * from better_auth."user" where "username" = %s',
            (username_lookup,),
        ).fetchone()


def credential_for(user_id):
    with db.get_pool().connection() as conn:
        return conn.execute(
            'select * from better_auth."account"'
            ' where "userId" = %s and "providerId" = %s',
            (str(user_id), "credential"),
        ).fetchone()


@pytest.fixture
def seeded():
    def _seed():
        return seed()

    return _seed


def test_username_is_stored_lowercase_for_lookup(seeded):
    """The plugin normalises with toLowerCase() before matching, so a row
    stored with capitals can never be found."""
    db.create_user("MixedCase", "a-password-long-enough")
    seeded()

    assert better_auth_user("mixedcase") is not None
    # The un-normalised spelling must NOT be what lookup keys on.
    assert better_auth_user("MixedCase") is None


def test_original_spelling_is_preserved_for_display(seeded):
    """Normalising for lookup must not cost the user their capitals."""
    db.create_user("MixedCase", "a-password-long-enough")
    seeded()

    assert better_auth_user("mixedcase")["displayUsername"] == "MixedCase"


def test_existing_password_hash_is_carried_over_verbatim(seeded):
    """Better Auth verifies these with a bcrypt verifier configured to match.
    Altering the hash in transit would silently invalidate the password."""
    db.create_user("carryover", "a-password-long-enough")
    with db.get_pool().connection() as conn:
        original = conn.execute(
            "select password_hash from public.users where username = %s",
            ("carryover",),
        ).fetchone()["password_hash"]

    seeded()

    stored = credential_for(better_auth_user("carryover")["id"])["password"]
    assert stored == original
    assert stored.startswith("$2")  # still a bcrypt hash, not re-encoded


def test_ids_are_shared_so_a_jwt_subject_resolves(seeded):
    """The whole identity model: a JWT's `sub` addresses a MyGist account
    directly, with no mapping table to drift."""
    user_id, _ = db.create_user("shared_id", "a-password-long-enough")
    seeded()

    assert better_auth_user("shared_id")["id"] == str(user_id)
    assert db.resolve_user_by_id(str(user_id)) is not None


def test_accounts_without_a_password_get_no_credential(seeded):
    """Token-only accounts predate password sign-in. They need a user row so
    their id resolves, but inventing a credential would invent a way to sign in
    that never existed."""
    db.create_user("tokenonly")
    seeded()

    user = better_auth_user("tokenonly")
    assert user is not None
    assert credential_for(user["id"]) is None


def test_placeholder_email_cannot_be_delivered_to(seeded):
    """Better Auth requires an email; MyGist accounts have none. The stand-in
    must be undeliverable by construction, not merely unlikely -- .invalid is
    reserved by RFC 2606 and can never resolve."""
    db.create_user("noemail", "a-password-long-enough")
    seeded()

    assert better_auth_user("noemail")["email"].endswith(f"@{PLACEHOLDER_DOMAIN}")
    assert PLACEHOLDER_DOMAIN.endswith(".invalid")


def test_seeding_twice_changes_nothing(seeded):
    """It runs before every deploy while both stores are live, so it has to
    reconcile rather than duplicate."""
    db.create_user("idempotent", "a-password-long-enough")

    first = seeded()
    second = seeded()

    assert first["created"] >= 1
    assert second["created"] == 0
    assert second["updated"] >= 1
