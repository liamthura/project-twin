"""The waitlist: addresses left on the marketing page while access is closed.

Unauthenticated, unlike every other store here -- there is no user to scope to,
because the whole point is that the person has no account yet. That makes this
the one write path a stranger can reach, so it validates its own input rather
than trusting a caller who has already been authenticated.
"""
import re

import db

# Deliberately loose. Strict address grammar rejects things that are genuinely
# deliverable, and the only cost of accepting a bad address here is that one
# invite bounces. The parts that matter: something before an @, something after
# it, a dot in the domain, and no whitespace.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")

# Postgres would take far more, but an address this long is a mistake or an
# attempt at one, and the column should not be where that is discovered.
MAX_EMAIL_LENGTH = 254


class InvalidEmailError(ValueError):
    pass


def normalise(email: str) -> str:
    """Trim and case-fold. The local part of an address is technically
    case-sensitive; in practice no mail provider treats it that way, and
    treating it that way here would let one person take two slots."""
    return (email or "").strip().lower()


def validate(email: str) -> str:
    email = normalise(email)
    if not email or len(email) > MAX_EMAIL_LENGTH or not _EMAIL.match(email):
        raise InvalidEmailError("That does not look like an email address.")
    return email


def join(email: str) -> bool:
    """Add an address to the list. Returns True if this was a new entry.

    Idempotent: signing up twice is not an error and must not look like one.
    Telling someone "you are already on the list" is also a disclosure -- it
    confirms an address to whoever typed it -- so the caller is expected to
    give the same answer either way, and this return value is for counting.
    """
    email = validate(email)
    with db.get_pool().connection() as conn:
        row = conn.execute(
            """
            insert into waitlist (email)
            values (%s)
            on conflict (email) do nothing
            returning email
            """,
            (email,),
        ).fetchone()
    return row is not None


def pending_count() -> int:
    """How many are still waiting. For whoever works the list."""
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select count(*) as n from waitlist where invited_at is null"
        ).fetchone()
    return row["n"] if row else 0
