"""What a section node BINDS: the storage keys its controls read and write.

Format v2 declares a field once, so this module lost half its former job and
kept the half that matters. Read both before touching it.

**The spelling check is gone, and that is not a loss of coverage.** v1 stated a
field twice -- the node named it, the entity's `required`/`optional` named it
again -- and `test_ui_fields_are_covered_by_the_entity` compared the two copies.
That comparison was an accidental checksum on typos, and v2 removes the second
copy: the entity vocabulary is DERIVED from these field names, so any name here
is in the vocabulary by construction and the check can only ever pass. The
`fields_outside_entity` declarations that existed to excuse legitimate
divergences went with it.

What catches a misspelled binding now is stronger and lives in
`test_stored_key_audit.py`: it drives the real MCP write path for every declared
field of every entity and asserts the value comes back stored. A typo used to be
caught only if it disagreed with a hand-maintained second copy; now it is caught
because nothing stores it. And because v2 derives the contract from these
bindings, that audit covers the UI's field names for the first time -- in v1 it
saw only the authored `entities` block.

**The alias guard remains, and is the only phantom-key check with an authority
behind it.** `entities` is a TOOL CONTRACT: the vocabulary an MCP client may
pass. A node's fields are a STORAGE BINDING: the keys the renderer reads and
writes. `execute_modify` normalises input spellings before writing --
`get_field(data, "name", "person", "contact", "connection_name")` accepts four
and persists one -- so a field bound to one of the other three renders a control
whose edits vanish: a silent, permanent, unreadable write. `FIELD_ALIASES` in
server.py is the only enumeration of those spellings, so it is the only thing
this can be checked against.

Its limits, so they are not mistaken for coverage:

  - It is INERT for any entity `FIELD_ALIASES` does not name. Absence means "no
    authority", never "verified safe".
  - Nothing in this repo enumerates what `execute_modify`'s 37 hand-written
    branches store, so a field that is neither in an alias list nor exercised by
    the stored-key audit is unguarded. `sleep`'s `day_type` is the example: a
    router that selects which sub-object to write and is never itself stored.

The schema's own accept/reject cases are NOT here. They live in
`test_manifest_v2_schema.py` (shape) and `test_pack_cross_checks.py` (semantics),
which is where the v1 versions of them went.
"""
import copy
import json
from unittest.mock import patch

import pytest

import pack_loader

# ---------------------------------------------------------------------------
# The storage-key authority, such as it is.
#
# `FIELD_ALIASES[entity]` in server.py is a list of spellings `get_field`
# accepts for that entity's identifier. `get_field` returns the first one
# present and `execute_modify` writes the result under ONE key -- so at most
# one member of each list is ever persisted, and every other member is
# input-only.
#
# The brief for this guard assumed the persisted key is always element 0.
# It is NOT: verified branch by branch against `execute_modify` in server.py,
# that convention holds for 9 of the 20 entries and breaks for 9 (two of them
# entities wave 4 migrates, plus the four *_reference entities grouped below),
# with 2 more storing bare strings under no key at all. So the persisted key is
# recorded explicitly here rather than derived from list position. Each entry
# was read off the write in the named branch.
#
#   value = the key `execute_modify` persists the identifier under
#   None      = nothing in the list is ever persisted (the branch stores a
#               bare string, or forwards to another entity under a key the
#               list does not contain)
#
# Everything in FIELD_ALIASES[entity] other than this value is an input alias
# and must never be a field's stored `name`.
CANONICAL_STORED_KEY = {
    # first element is the stored key (the assumed convention holds)
    "name": "name",              # normalize_data writes normalized["name"]
    "hobby": "name",             # execute_modify `hobby`: {"id":..., "name": name, ...}
    "project": "name",           # execute_modify `project`: {"id":..., "name": name, ...}
    "domain": "name",            # execute_modify `domain`: {"id":..., "name": name, ...}
    "language": "name",          # execute_modify `language`: {"name": name, "fluency": ...}
    "email": "address",          # execute_modify `email`: {"address": address, ...}
    "link": "url",               # execute_modify `link`: {"url": url, "label": label}
    "passion": "name",           # forwards to `interest` as {"name": name, "kind": ...}
    "connection": "name",        # execute_modify `connection`: {"id":..., "name": name}
    # convention BROKEN -- stored key is not element 0
    "curiosity": "name",         # list starts "topic"; forwards to `interest` as {"name": ...}
    "mental_tab": "title",       # list starts "name"; stores {"title": topic, ...}
    "top_of_mind": "idea",       # list starts "topic"; stores {"idea": item, "note": ...}
    # the four *_reference entities: list starts "ref_name", every branch
    # writes {"name": ref_name or ""} -- server.py:2102, 2333, 2446, 2486.
    # `ref_name` is the spelling all four MANIFESTS declare as `identifier`,
    # which is exactly why the spelling check cannot catch a ui node binding
    # it (it is in the entity's `required`) and why these entries have to
    # exist for the alias check to catch it instead.
    "hobby_reference": "name",
    "project_reference": "name",
    "domain_reference": "name",
    "mental_tab_reference": "name",
    # nothing in the list is persisted
    "value": None,               # lifestyle["values"] is a list of bare strings
    "trait": None,               # lifestyle["personality_traits"] is a list of bare strings
    "aspiration": None,          # `career_aspiration` forwards to `goal` as {"title": ...}
    "learning_item": None,       # `current_learning` forwards to `goal` as {"title": ...}
}


def _load(key):
    path = pack_loader.PACKS_DIR / key / "manifest.json"
    return json.loads(path.read_text())


def _on_disk_pack_keys():
    return sorted(
        p.name
        for p in pack_loader.PACKS_DIR.iterdir()
        if p.is_dir() and (p / "manifest.json").exists()
    )


def _elements(nodes, trail=""):
    """Yield (where, element) for every element in a section tree.

    Nested arrays are elements too -- a `list` field carries the descriptors of
    one of its members -- and skipping them would drop most of `profile` out of
    the guard, which is where the four *_reference entities live.
    """
    for node in nodes or []:
        where = f"{trail}{node.get('title') or '.'.join(node.get('path') or [])}"
        if node["kind"] == "group":
            yield from _elements(node["sections"], f"{where} > ")
            continue
        element = node.get("element")
        if element is None:
            continue
        yield where, element
        for field in element.get("fields", []):
            nested = field.get("element")
            if nested:
                yield f"{where} > {field['name']}", nested


def bound_names(element):
    """Every storage key an element binds.

    One line, where v1's equivalent had to enumerate fifteen node keys and could
    silently miss a new one -- `name` IS the stored key in v2, and every position,
    placeholder and default hangs off the field that declares it.

    `write_only` fields are excluded: they are input the tools accept and the
    renderer never binds, so they are the one place an input alias legitimately
    appears as a field name (`profile.link`'s `new_label`).
    """
    return {f["name"] for f in element.get("fields", []) if not f.get("write_only")}


def alias_bindings(entity, named):
    """Names in `named` that are MCP input aliases for `entity` rather than the
    key `execute_modify` persists.

    Returns an empty set for entities `FIELD_ALIASES` does not cover -- the
    table is the only authority available, so absence of an entry means "not
    known to be a phantom", never "verified safe"."""
    from server import FIELD_ALIASES

    aliases = FIELD_ALIASES.get(entity)
    if aliases is None:
        return set()
    alias_only = set(aliases) - {CANONICAL_STORED_KEY[entity]}
    return set(named) & alias_only


PACK_KEYS = _on_disk_pack_keys()


# --- every shipped manifest is valid --------------------------------------


def test_every_in_repo_manifest_validates():
    packs = pack_loader.load_packs()
    # load_packs() swallows invalid manifests as warnings, so assert the
    # full on-disk set was actually loaded -- a schema regression that
    # rejects a manifest would otherwise silently shrink this set.
    on_disk = [k for k in PACK_KEYS if not k.startswith("_")]
    assert set(packs) == set(on_disk)
    for manifest in packs.values():
        pack_loader.validate_manifest(copy.deepcopy(manifest))  # must not raise

    # `_template` itself is excluded from `on_disk`/`packs` above (leading
    # underscore, never loaded by load_packs()) but it's the exact shape
    # third-party authors copy to start a new pack. If it drifts out of
    # schema unnoticed, every pack cloned from it fails validation and is
    # silently skipped by load_packs() -- so validate it directly here too.
    pack_loader.validate_manifest(_load("_template"))  # must not raise


def test_every_pack_is_discovered_and_declares_sections():
    """If discovery silently returned nothing, the parametrized checks below
    would generate zero cases and the suite would stay green -- the exact
    failure mode a hand-maintained pack list has."""
    assert PACK_KEYS, "no manifest was discovered on disk"
    for key in PACK_KEYS:
        assert _load(key)["sections"], f"{key}: declares no sections"


# --- the alias guard -------------------------------------------------------


def test_canonical_stored_key_covers_every_alias_entity():
    """Fail-closed against server.py drift. A new `FIELD_ALIASES` entry has an
    unknown write path until someone reads the branch, so it must land here
    before the alias guard will run -- unlike a pack list, forgetting this
    breaks the suite rather than silently shrinking it."""
    from server import FIELD_ALIASES

    assert set(CANONICAL_STORED_KEY) == set(FIELD_ALIASES), (
        "FIELD_ALIASES changed: verify the new/removed entity's write path in "
        "execute_modify and update CANONICAL_STORED_KEY"
    )


def test_the_first_element_convention_is_not_assumed():
    """Documents, executably, why CANONICAL_STORED_KEY exists instead of
    `FIELD_ALIASES[entity][0]`. If these entries are ever brought into line
    with the convention, this test fails and the map can be simplified."""
    from server import FIELD_ALIASES

    assert FIELD_ALIASES["mental_tab"][0] == "name"
    assert CANONICAL_STORED_KEY["mental_tab"] == "title"  # stored key, index 3
    assert FIELD_ALIASES["top_of_mind"][0] == "topic"
    assert CANONICAL_STORED_KEY["top_of_mind"] == "idea"  # not in the list at all
    assert FIELD_ALIASES["curiosity"][0] == "topic"
    assert CANONICAL_STORED_KEY["curiosity"] == "name"  # stored key, index 4


def test_a_binding_may_not_be_an_mcp_input_alias():
    """One member of FIELD_ALIASES[entity] is the stored key; the rest are
    input aliases that execute_modify resolves and never persists. A field bound
    to one would render a control writing a key nothing reads.

    Synthetic, so it does not depend on a shipped pack staying wrong, but
    asserted against the real FIELD_ALIASES so it cannot drift from source."""
    from server import FIELD_ALIASES

    aliases = FIELD_ALIASES["connection"]
    assert CANONICAL_STORED_KEY["connection"] == "name", (
        "canonical key moved; this guard needs updating"
    )
    assert "contact" in aliases, "contact is no longer an alias; pick another"

    offenders = alias_bindings(entity="connection", named={"name", "relationship", "contact"})
    assert offenders == {"contact"}


def test_the_alias_check_is_inert_for_unknown_entities():
    """Absence from FIELD_ALIASES means "no authority", not "safe". Stated as a
    test so the limitation is not mistaken for coverage."""
    assert alias_bindings(entity="media_item", named={"anything"}) == set()


def test_a_strings_element_binds_no_field_names():
    """A `strings` array stores the bare string, under no key at all, so its
    element declares an entity and no fields. There is nothing for the guard to
    compare -- stated as a test so the empty result reads as a property of the
    kind rather than an oversight."""
    assert bound_names({"entity": "value", "identifier": "value"}) == set()


def test_a_write_only_field_may_carry_an_alias_spelling():
    """The one legitimate case. `profile.link`'s `new_label` is input the tool
    accepts to rename a row; no control binds it, so it is not a phantom."""
    element = {
        "entity": "link",
        "fields": [{"name": "url"}, {"name": "new_label", "write_only": True}],
    }
    assert "new_label" not in bound_names(element)


@pytest.mark.parametrize("key", PACK_KEYS)
def test_no_shipped_binding_is_an_mcp_input_alias(key):
    """The real guard: no shipped node binds a control to a name that
    `execute_modify` resolves as input and never writes."""
    manifest = _load(key)
    for where, element in _elements(manifest["sections"]):
        entity = element["entity"]
        offenders = alias_bindings(entity, bound_names(element))
        assert not offenders, (
            f"{key}/{where}: the element for entity '{entity}' binds "
            f"{sorted(offenders)}, which execute_modify accepts as input but "
            f"never stores (it writes '{CANONICAL_STORED_KEY[entity]}'). Edits "
            f"to that control would be written to a key nothing reads."
        )


@pytest.mark.parametrize("key", PACK_KEYS)
def test_every_shipped_element_is_reachable_by_the_guard(key):
    """The guard above is a loop, and a loop over nothing passes. Every element
    a manifest declares must be visited -- the count is checked against a walk
    that does not share `_elements`' logic, so a bug that skipped a whole node
    kind cannot hide in both."""
    manifest = _load(key)
    visited = [where for where, _ in _elements(manifest["sections"])]

    expected = 0

    def count(nodes):
        nonlocal expected
        for node in nodes:
            if node["kind"] == "group":
                count(node["sections"])
                continue
            if "element" not in node:
                continue
            expected += 1
            stack = [node["element"]]
            while stack:
                for field in stack.pop().get("fields", []):
                    if "element" in field:
                        expected += 1
                        stack.append(field["element"])

    count(manifest["sections"])
    assert len(visited) == expected, f"{key}: visited {visited}"


# --- FIELD_ALIASES' four inert entries ------------------------------------

REFERENCE_ENTITIES = [
    "hobby_reference", "project_reference", "domain_reference",
    "mental_tab_reference",
]


@pytest.mark.parametrize("entity", REFERENCE_ENTITIES)
def test_reference_entities_are_inert_in_field_aliases(entity):
    """`FIELD_ALIASES` is not only a guard input -- `normalize_data` consumes it
    on the live MCP write path -- so adding an entity to it must be proved to
    change nothing there, not assumed to.

    It is inert because every branch of `normalize_data` looks the table up by
    a HARDCODED literal key rather than by the entity being normalised, and all
    four reference entities are routed to their PARENT's list (server.py:1149,
    :1151, :1169, :1173). Proved by deletion rather than by reading: with the
    entry removed, `normalize_data` must produce byte-identical output for
    every payload shape below -- including one carrying each of the four
    spellings the entity's own get_field accepts, which is exactly what a
    lookup-by-entity-name would react to.
    """
    import server

    payloads = [
        {},
        {"name": "N"},
        {"ref_name": "R"},
        {"reference_name": "R"},
        {"title": "T"},
        {"reference": "R"},
        {"ref_name": "R", "name": "N"},
        {"url": "u", "notes": "n"},
        # The parent selectors, which normalize_data DOES react to today (it
        # routes these entities to the parent's alias list, so e.g. a bare
        # `domain_name` becomes `name`). Included so the comparison would
        # catch a change to that existing behaviour too, not just the absence
        # of a new one.
        {"hobby_name": "H"},
        {"project_name": "P"},
        {"domain_name": "D"},
        {"topic": "T"},
    ]
    assert entity in server.FIELD_ALIASES, "this guard is about the entry being present"

    with_entry = [server.normalize_data(dict(p), entity) for p in payloads]
    with patch.dict(server.FIELD_ALIASES):
        del server.FIELD_ALIASES[entity]
        without_entry = [server.normalize_data(dict(p), entity) for p in payloads]
    assert with_entry == without_entry


@pytest.mark.parametrize("entity", REFERENCE_ENTITIES)
def test_a_reference_element_binding_ref_name_is_caught(entity):
    """The hole these four entries close, stated as a test.

    All four reference entities persist `name` and declared `ref_name` as their
    v1 manifest `identifier`. In v2 `ref_name` is where it belongs -- an `alias`
    on the `name` field, so the tool still accepts it and no control binds it --
    but nothing structural stops a future author from making it the stored name
    again, and the retired spelling check would have waved that through because
    `ref_name` sat in the entity's own `required`."""
    assert CANONICAL_STORED_KEY[entity] == "name"
    assert alias_bindings(entity, {"name", "url", "notes"}) == set()
    assert alias_bindings(entity, {"ref_name", "url"}) == {"ref_name"}
