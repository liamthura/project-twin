"""The auth suite's schema fixture, pinned against the migrations.

`auth/src/__fixtures__/better-auth-schema.sql` exists because the Node suite has
no Python and CI's auth job runs a bare Postgres, so the OAuth handshake test
has to build its own `better_auth` schema. That is a copy, and a copy drifts:
a migration that adds a column would leave the fixture behind, and the auth
suite would keep passing against a shape production no longer has.

This is the other side of that seam -- the same arrangement
`auth/src/invite.test.js` documents for `invite_codes`. It asserts every table
and column the fixture declares still exists in the migrated schema. It
deliberately does NOT require the reverse: the fixture may lag behind columns
the handshake does not touch, and failing on those would be noise.
"""

import re
from pathlib import Path

import db

FIXTURE = (
    Path(__file__).resolve().parent.parent.parent
    / "auth"
    / "src"
    / "__fixtures__"
    / "better-auth-schema.sql"
)

# `CREATE TABLE better_auth.foo (` or `better_auth."fooBar" (`, then everything
# up to the closing paren of the column list.
_TABLE = re.compile(
    r'CREATE TABLE (?:IF NOT EXISTS )?better_auth\."?(?P<name>\w+)"?\s*\((?P<body>.*?)\n\);',
    re.DOTALL | re.IGNORECASE,
)


def _declared() -> dict[str, set[str]]:
    """{table: {column, ...}} as the fixture declares them."""
    sql = FIXTURE.read_text()
    tables: dict[str, set[str]] = {}
    for match in _TABLE.finditer(sql):
        columns = set()
        for line in match.group("body").splitlines():
            line = line.strip().rstrip(",")
            if not line or line.upper().startswith(("CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK")):
                continue
            name = line.split()[0].strip('"')
            if name:
                columns.add(name)
        tables[match.group("name")] = columns
    return tables


def _migrated() -> dict[str, set[str]]:
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select table_name, column_name from information_schema.columns"
            " where table_schema = 'better_auth'"
        ).fetchall()
    tables: dict[str, set[str]] = {}
    for row in rows:
        tables.setdefault(row["table_name"], set()).add(row["column_name"])
    return tables


def test_fixture_parses_into_tables():
    """A regex that silently matched nothing would make every test below vacuous."""
    declared = _declared()
    assert len(declared) >= 9, f"parsed only {sorted(declared)}"
    assert "oauthClient" in declared
    assert "clientId" in declared["oauthClient"]


def test_every_fixture_table_exists_in_the_migrated_schema():
    missing = sorted(set(_declared()) - set(_migrated()))
    assert not missing, (
        f"the auth suite's fixture declares tables the migrations no longer "
        f"create: {missing}. Regenerate it -- see the header of {FIXTURE.name}."
    )


def test_every_fixture_column_exists_in_the_migrated_schema():
    migrated = _migrated()
    drifted = {
        table: sorted(columns - migrated.get(table, set()))
        for table, columns in _declared().items()
        if columns - migrated.get(table, set())
    }
    assert not drifted, (
        f"the auth suite's fixture declares columns the migrations no longer "
        f"create: {drifted}. Regenerate it -- see the header of {FIXTURE.name}."
    )
