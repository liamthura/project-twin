"""The waitlist half of scripts/access.py.

The invite half is covered in test_invite_codes.py, which owns the CLI as the
authorisation model for minting. This file covers what unifying the two scripts
was for: `admit`, which mints a code and stamps the waitlist row together, so
the list cannot drift from the codes.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import waitlist_store  # noqa: E402


def run_cli(*args):
    return subprocess.run(
        [sys.executable, str(BACKEND / "scripts" / "access.py"), *args],
        capture_output=True,
        text=True,
        env={**os.environ, "DATABASE_URL": os.environ["DATABASE_URL"]},
        cwd=str(BACKEND),
    )


@pytest.fixture
def waiting():
    waitlist_store.join("maya@example.com")
    return "maya@example.com"


def test_waitlist_lists_who_is_waiting(waiting):
    result = run_cli("waitlist")
    assert result.returncode == 0
    assert waiting in result.stdout
    assert "1 waiting" in result.stdout


def test_waitlist_says_so_when_nobody_is_waiting():
    result = run_cli("waitlist")
    assert result.returncode == 0
    assert "Nobody waiting" in result.stdout
    # An empty list is the most likely moment for someone to wonder where the
    # addresses were supposed to come from, so the empty state answers it.
    assert "landing page" in result.stdout


def test_admit_mints_a_code_and_stamps_the_row(waiting):
    result = run_cli("admit", waiting)

    assert result.returncode == 0
    assert waiting in result.stdout
    # The code is the reason to run this, so it must be readable in the output.
    assert any("-" in word and len(word) == 9 for word in result.stdout.split())
    assert waitlist_store.pending_count() == 0


def test_admit_labels_the_code_with_the_address(waiting):
    """An unlabelled code cannot be revoked with any confidence weeks later,
    and here the address is the only label that means anything."""
    run_cli("admit", waiting)
    assert waiting in run_cli("codes").stdout


def test_admit_refuses_an_address_that_is_not_waiting():
    result = run_cli("admit", "nobody@example.com")

    assert result.returncode != 0
    combined = result.stdout + result.stderr
    assert "not on the waitlist" in combined
    # And it says what to do instead, rather than only what went wrong.
    assert "mint" in combined


def test_admit_is_idempotent_on_the_stamp(waiting):
    """Running it twice mints a second code -- that is a real thing to want,
    when the first email bounced -- but must not move the invited timestamp,
    which answers "when did we first tell them"."""
    run_cli("admit", waiting)
    first = waitlist_store.listing(include_invited=True)[0]["invited_at"]

    run_cli("admit", waiting)
    second = waitlist_store.listing(include_invited=True)[0]["invited_at"]

    assert first == second


def test_an_invited_address_drops_out_of_the_default_list(waiting):
    run_cli("admit", waiting)

    assert waiting not in run_cli("waitlist").stdout
    assert waiting in run_cli("waitlist", "--all").stdout


def test_drop_removes_an_address(waiting):
    result = run_cli("drop", waiting)

    assert result.returncode == 0
    assert waitlist_store.pending_count() == 0
    assert waiting not in run_cli("waitlist", "--all").stdout


def test_drop_fails_loudly_on_an_unknown_address():
    result = run_cli("drop", "nobody@example.com")
    assert result.returncode != 0
    assert "not on the waitlist" in (result.stdout + result.stderr)


def test_case_and_padding_do_not_defeat_admit_or_drop(waiting):
    """The endpoint case-folds on the way in, so the CLI has to as well --
    otherwise an address typed from an email client fails to match the row it
    obviously is."""
    assert run_cli("admit", "  MAYA@Example.COM ").returncode == 0
    assert waitlist_store.pending_count() == 0
    assert run_cli("drop", "MAYA@EXAMPLE.COM").returncode == 0


def test_output_is_not_buried_in_pool_shutdown_noise(waiting):
    """psycopg's pool complains for five seconds per worker thread if it is not
    closed, which would bury the code you just minted."""
    result = run_cli("admit", waiting)
    assert "couldn't stop thread" not in result.stderr


# --- finding your way around ------------------------------------------------


def test_bare_invocation_explains_itself_without_a_database():
    """argparse's own answer to a missing subcommand is "invalid choice", which
    tells someone who typed the script name hoping to be told what it does
    precisely nothing. And it must not need DATABASE_URL, because not knowing
    what the script is and not having the variable set are the same moment."""
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    result = subprocess.run(
        [sys.executable, str(BACKEND / "scripts" / "access.py")],
        capture_output=True, text=True, env=env, cwd=str(BACKEND),
    )

    assert result.returncode == 0
    assert "WAITLIST" in result.stdout
    assert "CODES" in result.stdout
    assert "access.py admit" in result.stdout


def test_help_is_a_command_as_well_as_a_flag():
    result = run_cli("help")
    assert result.returncode == 0
    assert "WAITLIST" in result.stdout


def test_listings_end_with_what_to_do_next(waiting):
    run_cli("mint", "--label", "somebody")

    assert "access.py admit" in run_cli("waitlist").stdout
    assert "access.py revoke" in run_cli("codes").stdout


def test_empty_listings_say_how_to_fill_them(waiting):
    """The empty state is the moment someone most needs the next command, and
    the moment a bare table gives them the least."""
    assert "access.py mint" in run_cli("codes").stdout

    run_cli("drop", waiting)
    assert "landing page" in run_cli("waitlist").stdout


def test_columns_are_sized_to_the_content_not_truncated():
    """A long address must survive intact. The fixed 38-column version cut it
    at 37 characters, which is a silent corruption of the one field you need
    in order to email the person."""
    long_address = "maya.ellis.marketing.assistant@northgate-studio.example.com"
    waitlist_store.join(long_address)

    assert long_address in run_cli("waitlist").stdout
