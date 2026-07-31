"""Invite codes, from the Python side.

Three separate jobs here, and the first is the one worth explaining.

**The schema pin.** The rule that decides whether a code admits someone lives in
JavaScript (auth/src/invite.js) and is tested there against a table that suite
creates for itself, because it has no Python and cannot run Alembic. That leaves
a seam: the JS DDL could drift from the migration's, and both suites would stay
green while production had a table the rule could not use. These tests pin the
migrated schema to exactly what the rule assumes, so drift fails here.

**The locked door.** /api/auth/register is not taught the rule -- it is closed
while the mode is on. Duplicating "is this code valid" in a second language is
how two halves drift; a lock has nothing to drift from.

**The CLI**, which is the entire authorisation model for minting.
"""
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import db  # noqa: E402
import main  # noqa: E402
from scripts.invite import ALPHABET, generate_code, parse_expiry  # noqa: E402


@pytest.fixture
def client():
    return TestClient(main.app)


# ---------------------------------------------------------------------------
# The schema the JS rule assumes
# ---------------------------------------------------------------------------

def columns_of(table):
    with db.get_pool().connection() as conn:
        return {
            r["column_name"]: r
            for r in conn.execute(
                """select column_name, data_type, is_nullable, column_default
                     from information_schema.columns
                    where table_schema = 'public' and table_name = %s""",
                (table,),
            ).fetchall()
        }


def test_invite_codes_has_every_column_the_rule_reads():
    """auth/src/invite.js selects on all of these. A rename here is a runtime
    failure there, in a language this suite cannot see."""
    columns = columns_of("invite_codes")
    assert set(columns) == {
        "code",
        "label",
        "max_uses",
        "uses",
        "expires_at",
        "revoked_at",
        "created_at",
    }


def test_uses_and_max_uses_are_integers_that_default_sanely():
    """`uses < max_uses` is the admission test. Both must be numeric, and a
    freshly minted code must start unused or it would admit nobody."""
    columns = columns_of("invite_codes")
    assert columns["uses"]["data_type"] == "integer"
    assert columns["max_uses"]["data_type"] == "integer"
    assert "0" in columns["uses"]["column_default"]
    assert "1" in columns["max_uses"]["column_default"]


def test_expiry_and_revocation_are_nullable():
    """The rule reads `expires_at is null or expires_at > now()`. A NOT NULL
    here would mean every code needed an expiry, which is not the design."""
    columns = columns_of("invite_codes")
    assert columns["expires_at"]["is_nullable"] == "YES"
    assert columns["revoked_at"]["is_nullable"] == "YES"


def test_label_is_required():
    """A code with no label cannot be revoked with confidence weeks later."""
    assert columns_of("invite_codes")["label"]["is_nullable"] == "NO"


def test_users_carries_the_attribution_column():
    """redeem() writes users.invited_with."""
    assert columns_of("users")["invited_with"]["is_nullable"] == "YES"


def test_timestamps_carry_a_timezone():
    """The rule compares against now() in Postgres. A naive column would
    compare wrongly for half the year and be right for the other half, which is
    the worst way for a bug like this to behave."""
    columns = columns_of("invite_codes")
    for column in ("expires_at", "revoked_at", "created_at"):
        assert columns[column]["data_type"] == "timestamp with time zone"


def test_a_code_cannot_be_minted_with_zero_uses():
    """max_uses of 0 would admit nobody while looking active in `list`."""
    with pytest.raises(Exception):
        with db.get_pool().connection() as conn:
            conn.execute(
                "insert into invite_codes (code, label, max_uses) values (%s, %s, 0)",
                ("AAAA-AAAA", "broken"),
            )


# ---------------------------------------------------------------------------
# The mode switch and the locked door
# ---------------------------------------------------------------------------

def test_invite_only_is_off_unless_explicitly_on(monkeypatch):
    for value in ["", "false", "0", "no", "TRUE_ISH"]:
        monkeypatch.setenv("INVITE_ONLY", value)
        assert main.invite_only() is False

    monkeypatch.delenv("INVITE_ONLY", raising=False)
    assert main.invite_only() is False


def test_invite_only_is_case_insensitive_when_on(monkeypatch):
    for value in ["true", "TRUE", "True"]:
        monkeypatch.setenv("INVITE_ONLY", value)
        assert main.invite_only() is True


def test_register_is_closed_while_invite_only(client, monkeypatch):
    """The other door. Not taught the rule -- locked."""
    monkeypatch.setenv("INVITE_ONLY", "true")

    response = client.post(
        "/api/auth/register",
        json={"username": "uninvited", "password": "a-good-password"},
    )

    assert response.status_code == 403
    assert "invite-only" in response.json()["detail"]


def test_register_still_works_when_the_mode_is_off(client, monkeypatch):
    """Self-hosters and local development must be untouched by this."""
    monkeypatch.delenv("INVITE_ONLY", raising=False)

    response = client.post(
        "/api/auth/register",
        json={"username": "selfhoster", "password": "a-good-password"},
    )

    assert response.status_code == 200


def test_instance_reports_the_mode(client, monkeypatch):
    monkeypatch.setenv("INVITE_ONLY", "true")
    assert client.get("/api/instance").json() == {"invite_only": True}

    monkeypatch.delenv("INVITE_ONLY", raising=False)
    assert client.get("/api/instance").json() == {"invite_only": False}


def test_instance_is_readable_without_a_credential(client):
    """It decides which sign-in screen a stranger sees, so a stranger has to be
    able to read it."""
    response = client.get("/api/instance")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Minting
# ---------------------------------------------------------------------------

def test_generated_codes_use_only_the_shared_alphabet():
    """Must match ALPHABET in auth/src/invite.js. A code containing a character
    the rule's pattern rejects would be unusable the moment it was handed out,
    and the failure would look like the tester mistyping it."""
    for _ in range(200):
        code = generate_code()
        assert len(code) == 9 and code[4] == "-"
        assert set(code.replace("-", "")) <= set(ALPHABET)


def test_the_alphabet_excludes_the_confusable_characters():
    for excluded in "ILOU":
        assert excluded not in ALPHABET


def test_generated_codes_do_not_repeat():
    assert len({generate_code() for _ in range(500)}) == 500


def test_relative_expiries_are_understood():
    now = datetime.now(timezone.utc)
    assert timedelta(days=29) < parse_expiry("30d") - now < timedelta(days=31)
    assert timedelta(hours=11) < parse_expiry("12h") - now < timedelta(hours=13)


def test_an_absolute_date_is_understood_and_given_a_timezone():
    parsed = parse_expiry("2026-08-30")
    assert parsed.year == 2026 and parsed.month == 8 and parsed.day == 30
    # Naive would compare wrongly against Postgres's now().
    assert parsed.tzinfo is not None


def test_an_unreadable_expiry_is_refused_rather_than_guessed():
    with pytest.raises(SystemExit):
        parse_expiry("next tuesday")


# ---------------------------------------------------------------------------
# The CLI end to end
# ---------------------------------------------------------------------------

def run_cli(*args):
    return subprocess.run(
        [sys.executable, str(BACKEND / "scripts" / "invite.py"), *args],
        capture_output=True,
        text=True,
        env={**os.environ, "DATABASE_URL": os.environ["DATABASE_URL"]},
        cwd=str(BACKEND),
    )


def test_mint_then_list_shows_the_code(tmp_path):
    minted = run_cli("mint", "--label", "sarah (course)")
    assert minted.returncode == 0
    code = minted.stdout.split()[0]

    listed = run_cli("list")
    assert code in listed.stdout
    assert "sarah (course)" in listed.stdout
    assert "active" in listed.stdout


def test_revoke_closes_it_and_says_what_that_does_not_do():
    code = run_cli("mint", "--label", "to be revoked").stdout.split()[0]

    revoked = run_cli("revoke", code)

    assert revoked.returncode == 0
    assert code in revoked.stdout
    assert run_cli("list").stdout.count(code) == 0
    assert code in run_cli("list", "--all").stdout


def test_revoking_an_unknown_code_fails_loudly():
    result = run_cli("revoke", "0000-0000")
    assert result.returncode != 0
    assert "no such code" in (result.stdout + result.stderr)


def test_output_is_not_buried_in_pool_shutdown_noise():
    """psycopg's pool complains for five seconds per worker thread if it is not
    closed, which would bury the code you just minted. The whole point of this
    script is that someone reads its output."""
    result = run_cli("mint", "--label", "quiet please")
    assert "couldn't stop thread" not in result.stderr
    assert len(result.stdout.strip().splitlines()) == 1


def test_a_label_is_required():
    assert run_cli("mint").returncode != 0
