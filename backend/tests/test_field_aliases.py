"""The input spellings each entity's fields answer to.

An MCP client may send `{"characteristic": "Curious"}` for a personality trait
or `{"employer": "Acme"}` for a work highlight, and the server understands
both. That tolerance was never declared anywhere: it lived inside the
per-entity branches as `get_field(data, "trait", "personality_trait",
"characteristic", ...)` calls, 89 of them, and nothing tested that any
particular spelling still worked.

So it is declared now, in `server.ENTITY_FIELD_ALIASES`, and this is what makes
the declaration true: for every alias, the same write sent under the alias and
under the field's own name must leave the persona in the SAME state. Not a
weaker "it did not error" -- the identical blob, compared key for key.

The two writes run as two different users, which is the cheapest way to get two
clean persona stores inside one test. Nothing about the comparison depends on
the write path's shape, so this survives the branches being replaced -- which
is the point of writing it before they were.
"""
import uuid

import pytest

import db
import server
import settings_store
from tests.test_execute_modify_golden import (
    DEFAULT_OFF, DESCRIPTORS, SCHEMA, _payload, _scrub, _seed_parent,
)

CASES = sorted(
    (entity, field, alias)
    for entity, fields in server.ENTITY_FIELD_ALIASES.items()
    for field, aliases in fields.items()
    for alias in aliases
)


# Entity names execute_modify still answers to that the published vocabulary
# no longer lists: each is translated into a current entity on the way in
# (passion/curiosity -> interest, career_aspiration and current_learning ->
# goal), so there is no schema entry to read their section off.
LEGACY_SECTIONS = {
    "passion": "lifestyle",
    "curiosity": "lifestyle",
    "career_aspiration": "goals",
    "current_learning": "goals",
}

# Nothing here is expected to fail. There was a list: the four *_reference
# entities used to normalise their identifier through their PARENT's alias
# list, so `{"domain_name": "Rust", "title": "The Book"}` stored a reference
# called "Rust". `_name_aliases_for` reads each entity's own entry now and bars
# the parent's spellings, and the eight cases that documented the bug are
# ordinary passing cases. See test_section_bindings for the rule itself.


def _section_of(entity):
    for section, entities in SCHEMA.items():
        if entity in entities:
            return section
    return LEGACY_SECTIONS.get(entity)


def _fresh_user():
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "insert into users (username, token_hash) values (%s, %s) returning id",
            (f"alias-{uuid.uuid4().hex[:12]}", uuid.uuid4().hex),
        ).fetchone()
    return str(row["id"])


def _write(entity, desc, payload, section, action):
    """Run one write as a brand-new user and hand back what it stored."""
    token = db.current_user_id.set(_fresh_user())
    try:
        settings_store.set_enabled_optins(sorted(DEFAULT_OFF))
        if desc.get("parent"):
            _seed_parent(desc)
        message = server.execute_modify(action, entity, payload)
        # Scrubbed: a row's generated id is the one thing two users' copies of
        # the same write are MEANT to differ on.
        return message, _scrub(server.load_json(f"{section}.json"))
    finally:
        db.current_user_id.reset(token)


@pytest.mark.parametrize("entity,field,alias", CASES, ids=lambda v: v)
def test_an_alias_writes_what_the_field_name_writes(entity, field, alias, clean_database):
    section = _section_of(entity)
    assert section, f"{entity} is not in the vocabulary"
    desc = DESCRIPTORS.get(entity)
    if desc is None:
        pytest.skip(f"{entity} is a legacy name with no element of its own")

    spec = SCHEMA[section][entity]
    canonical = _payload(entity, desc, spec)
    if field not in canonical:
        pytest.skip(f"{entity}.{field} is not in a generated payload")
    aliased = dict(canonical)
    aliased[alias] = aliased.pop(field)

    # A singleton (sleep, basic_info, communication_default) is only ever
    # updated; there is no row to add.
    action = "add" if "add" in spec["actions"] else "update"
    expected_message, expected = _write(entity, desc, canonical, section, action)
    actual_message, actual = _write(entity, desc, aliased, section, action)

    assert expected_message.startswith("✅"), (
        f"the canonical spelling did not even work: {expected_message}"
    )
    assert actual == expected, (
        f"{entity}: sending '{alias}' instead of '{field}' stored something else "
        f"({actual_message})"
    )
