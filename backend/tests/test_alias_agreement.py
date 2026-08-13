"""Do the aliases a v2 manifest DECLARES agree with the aliases the runtime
actually ACCEPTS?

A field's `alias` list (meta_schema.json's `alias` property) is a promise to
an MCP client: "you may also spell this field's name these ways." The only
code that honours such a promise is `normalize_data`, driven entirely by
`server.py`'s `FIELD_ALIASES` table -- so a spelling declared in a manifest
but missing from that table is a promise nothing keeps.

This module checks the other direction from `test_section_bindings.py`. That
module asks "does a RENDERED field's stored `name` collide with a phantom
alias" -- silent data loss. This one asks "does a DECLARED alias list agree
with the table that is supposed to make it true" -- a broken promise, not a
data-loss bug, but still a manifest asserting something false about the
running server. Both checks need `FIELD_ALIASES`; neither subsumes the
other, which is why this is a second file rather than more tests bolted onto
the first.

Two independent claims, scoped differently on purpose:

  Claim 1 (identity) is about the ONE field that names a row, so it only
  ever makes sense for the `identifier` field -- `test_claim_1_...` looks up
  exactly that field.

  Claim 2 (spelling) has no such restriction: `FIELD_ALIASES[entity]` is a
  table of accepted spellings, and nothing in `normalize_data` or the schema
  confines a manifest's `alias` declaration to the identifier field --
  `FIELD_ALIASES["link"]` is in fact the spelling list for `link`'s NON-
  identifier `url` field (see `NOT_A_PLAIN_IDENTITY_EQUALITY` below). So
  `test_claim_2_...` walks every field of every checked element, not just
  the identifier's.

Reuses `test_section_bindings.py`'s `CANONICAL_STORED_KEY` (hand-verified
against every `execute_modify` branch), `_elements` (the tree walk, nested
arrays included) and `_load`/`PACK_KEYS` rather than re-deriving any of it --
see that module's own docstring for why each exists.
"""
from server import FIELD_ALIASES

from tests.test_section_bindings import CANONICAL_STORED_KEY, PACK_KEYS, _elements, _load


def _identifier_field(element):
    """The field object `element['identifier']` names, or None.

    None covers exactly one shape: a `stringsElement` (meta_schema.json) may
    omit `fields` entirely -- a bare string has no named keys -- so its
    `identifier` names the MCP parameter for one string, not a field object
    in this element. `value`, below, is the one checked entity built this
    way; there is nothing to look up because nothing here HAS a name to
    compare.
    """
    fields = {f["name"]: f for f in element.get("fields", [])}
    return fields.get(element.get("identifier"))


def _checked_elements():
    """(pack, where, element) for every element whose entity `FIELD_ALIASES`
    names, across every shipped manifest (`_template` included, same as
    `test_section_bindings.py`'s parametrized guards).

    `FIELD_ALIASES` is the only authority this file can check against, so an
    element for an entity it does not name is not evidence of anything --
    see `test_the_skip_list_is_exactly_the_expected_size` below, which is
    the assertion that makes that skip a gate instead of a silent hole.
    """
    found = []
    for key in PACK_KEYS:
        manifest = _load(key)
        for where, element in _elements(manifest["sections"]):
            if element["entity"] in FIELD_ALIASES:
                found.append((key, where, element))
    return found


CHECKED = _checked_elements()
CHECKED_IDS = [f"{key}:{where}" for key, where, _ in CHECKED]

# Every entity any shipped manifest declares (`_template` included) that
# `FIELD_ALIASES` does NOT name -- inert for this guard by construction
# (`test_section_bindings.py`'s `alias_bindings` returns `set()` for exactly
# these). Recomputed from the live tree below and compared against a
# hardcoded expectation so a NEW entity landing here -- one nobody taught
# FIELD_ALIASES about -- fails this suite instead of silently enlarging a
# set nothing asserts the size of.
SKIPPED = {
    element["entity"]
    for key in PACK_KEYS
    for _, element in _elements(_load(key)["sections"])
    if element["entity"] not in FIELD_ALIASES
}


def test_the_skip_list_is_exactly_the_expected_size():
    """Fail-closed the same way `test_section_bindings.py`'s
    `test_canonical_stored_key_covers_every_alias_entity` does for
    `FIELD_ALIASES` itself: a hardcoded set, not just a hardcoded count, so a
    new unlisted entity is named in the diff rather than merely changing a
    number nobody reads closely."""
    # Computed by walking every shipped manifest (see `SKIPPED` above) and
    # subtracting FIELD_ALIASES' 20 keys. 25 entities, none of which
    # FIELD_ALIASES' table has ever heard of:
    expected = {
        "aesthetic", "basic_info", "club", "communication_default",
        "coursework", "education", "education_highlight", "energy_peak",
        "example_item", "goal", "hobby_specific", "interest",
        "learning_entry", "like", "media_item", "mood_override",
        "personality_trait", "project_highlight", "project_tag",
        "response_format", "sleep", "stress_trigger", "work_experience",
        "work_highlight", "work_skill",
    }
    assert len(expected) == 25
    assert SKIPPED == expected


def test_every_field_alias_entity_named_by_a_manifest_is_checked():
    """The mirror of the skip-list assertion: nothing that IS in scope is
    accidentally filtered out of `CHECKED` by `_checked_elements`. If this
    count drops, the guard below is silently checking fewer entities, which
    is exactly the failure mode a fixed-size assertion is supposed to catch."""
    assert len(CHECKED) == 14
    assert {element["entity"] for _, _, element in CHECKED} == {
        "connection", "domain", "domain_reference", "email", "hobby",
        "hobby_reference", "language", "link", "mental_tab",
        "mental_tab_reference", "project", "project_reference",
        "top_of_mind", "value",
    }


# ---------------------------------------------------------------------------
# Two entities in CHECKED do not reduce Claim 1 ("the identifier field's
# stored name is CANONICAL_STORED_KEY[entity]") to a plain equality. Both
# are read off `execute_modify` below rather than assumed, and neither is a
# bug -- recorded here, once, so the general parametrized test does not have
# to special-case them silently.
#
#   value -- CANONICAL_STORED_KEY["value"] is None: lifestyle.json stores
#            `values` as a list of bare strings (server.py:1793), so no
#            spelling is EVER persisted under a key. Its element is a
#            `stringsElement`, which may omit `fields` entirely, so
#            `_identifier_field` returns None -- there is no field object
#            for "stored name" to mean anything about. Asserted directly in
#            `test_the_none_canonical_entity_has_no_identifier_field_object`.
#
#   link  -- CANONICAL_STORED_KEY["link"] is "url", but profile/manifest.json
#            declares `identifier: "label"`. Read against the `link` branch
#            of execute_modify (server.py:1060-1096): `label` is the row's
#            real identity -- `find_in_array(links, label, "label")` locates
#            it for `update` and `remove`, and `update` needs a SEPARATE
#            `new_label` input precisely because renaming the identifying
#            value can't otherwise be told apart from editing a row that
#            doesn't exist yet. `url` is a second, co-required field, and
#            FIELD_ALIASES["link"] happens to enumerate ITS spellings
#            (url/link/href/website) -- `label`'s own synonyms ("name",
#            "title", "platform") are hardcoded inline at server.py:1063 and
#            were never added to FIELD_ALIASES at all. So `identifier` (what
#            names the row) and CANONICAL_STORED_KEY (what this table's
#            alias list resolves to) are both correct answers to different
#            questions that happen to coincide for every other entity in
#            CHECKED but have no reason to for an entity with two identity-
#            shaped fields. It is not a data-loss risk either: `label` is
#            stored under its own literal spelling on every branch (`add`
#            appends {"url": url, "label": label}; `update` and `remove`
#            both key off "label" directly) -- nothing about a control bound
#            to `label` writes a key nothing reads.
NOT_A_PLAIN_IDENTITY_EQUALITY = {"value", "link"}


def test_the_none_canonical_entity_has_no_identifier_field_object():
    """Ties `value`'s exemption from Claim 1 to the two facts that justify
    it, so the exemption breaks loudly if either stops being true: if
    CANONICAL_STORED_KEY["value"] ever stops being None, or if the manifest
    ever gives this element real `fields`, this test -- not a silent skip --
    is what notices."""
    assert CANONICAL_STORED_KEY["value"] is None
    (element,) = [e for k, w, e in CHECKED if e["entity"] == "value"]
    assert "fields" not in element, (
        "value's element grew `fields` -- re-examine whether it still "
        "belongs in NOT_A_PLAIN_IDENTITY_EQUALITY"
    )
    assert _identifier_field(element) is None


def test_the_link_entity_identifier_names_the_row_not_the_aliased_field():
    """Ties `link`'s exemption to the two facts that justify it (see the
    comment above `NOT_A_PLAIN_IDENTITY_EQUALITY`): the manifest's row
    identifier really is `label`, CANONICAL_STORED_KEY really names a
    different field (`url`), and `label` -- the field actually bound to a
    control -- declares no alias, so nothing here promises a spelling
    FIELD_ALIASES doesn't keep."""
    assert CANONICAL_STORED_KEY["link"] == "url"
    (element,) = [e for k, w, e in CHECKED if e["entity"] == "link"]
    assert element["identifier"] == "label"
    idfield = _identifier_field(element)
    assert idfield is not None and idfield["name"] == "label"
    assert idfield.get("alias") is None, (
        "label now declares an alias -- it isn't in FIELD_ALIASES at all, "
        "so this can no longer be waved through as harmless"
    )


def test_claim_1_identifier_field_names_the_canonical_stored_key():
    """The real guard for Claim 1: for every OTHER checked entity (the 12
    that are not documented exceptions above), the field the manifest calls
    `identifier` is, by name, the key `execute_modify` actually persists.
    If a future manifest pointed an entity's `identifier` at one of the
    OTHER spellings in FIELD_ALIASES[entity] -- an alias, not the stored key
    -- this is what would catch it, because that spelling would not equal
    CANONICAL_STORED_KEY[entity]."""
    checked_here = 0
    for key, where, element in CHECKED:
        entity = element["entity"]
        if entity in NOT_A_PLAIN_IDENTITY_EQUALITY:
            continue
        checked_here += 1
        idfield = _identifier_field(element)
        assert idfield is not None, f"{key}/{where}: identifier names no declared field"
        assert idfield["name"] == CANONICAL_STORED_KEY[entity], (
            f"{key}/{where}: entity '{entity}' declares identifier "
            f"'{idfield['name']}', but execute_modify persists it under "
            f"'{CANONICAL_STORED_KEY[entity]}' -- FIELD_ALIASES' other "
            f"spellings for this entity are input-only and must never be "
            f"the identifier."
        )
    assert checked_here == 12  # 14 checked entities minus the 2 exceptions above


def test_claim_2_every_declared_alias_is_a_spelling_the_table_accepts():
    """The real guard for Claim 2: every spelling ANY field of a checked
    element lists under `alias` must be one FIELD_ALIASES[entity] also
    lists. A declared alias missing from the table is a spelling
    `normalize_data` will not resolve -- the manifest promises an MCP client
    something the server does not do.

    Deliberately NOT identifier-only, unlike Claim 1. `FIELD_ALIASES[entity]`
    is not scoped to the identifier by anything in the runtime -- it is a
    plain spelling table for whatever field `execute_modify`'s `get_field`
    call happens to consult, and `link` already proves the two can differ:
    FIELD_ALIASES["link"] is the accepted-spelling list for `url`, which is
    NOT `link`'s identifier (`label` is -- see
    `NOT_A_PLAIN_IDENTITY_EQUALITY`). A manifest could just as easily declare
    a phantom alias on `link.url`, a non-identifier field on an entity
    FIELD_ALIASES does name, and an identifier-only version of this loop
    would never look at it. So every field of every checked element is
    walked here, not just the one Claim 1 cares about.

    Runs over the full CHECKED set, exceptions included: `value`'s element
    has no `fields` at all, so its contribution is an empty loop, and
    `link`'s `label` field carries no alias, so it simply contributes an
    empty comparison -- neither needs excluding."""
    total_fields_examined = 0
    fields_with_alias = 0
    for key, where, element in CHECKED:
        entity = element["entity"]
        accepted = FIELD_ALIASES[entity]
        for field in element.get("fields", []):
            total_fields_examined += 1
            declared = field.get("alias") or []
            if declared:
                fields_with_alias += 1
            offenders = [a for a in declared if a not in accepted]
            assert not offenders, (
                f"{key}/{where}: entity '{entity}' field '{field['name']}' "
                f"declares alias(es) {offenders} that "
                f"FIELD_ALIASES[{entity!r}] ({accepted}) does not accept -- "
                f"normalize_data will not resolve that spelling, so the "
                f"manifest promises input handling the server does not "
                f"implement."
            )
    # Pinned so the widening above can't quietly collapse back to
    # identifier-only and still pass: 51 fields are inspected across the 14
    # checked elements' TOP-LEVEL `fields` arrays -- far more than the 14
    # identifier fields an identifier-only version of this loop would visit
    # (one per checked element). If this count ever equals 14, the loop
    # stopped widening.
    assert total_fields_examined == 51
    # A loop whose body never runs a real comparison passes for free. Of
    # those 51 fields, exactly 5 currently declare an `alias` -- one on each
    # of the identifier fields for top_of_mind, hobby_reference,
    # domain_reference, mental_tab_reference and project_reference (six
    # `alias` declarations exist across the repo's manifests in total --
    # profile x1, lifestyle x1, knowledge x2, projects x2 -- but the sixth,
    # on profile's `coursework.name`, is for an entity FIELD_ALIASES does
    # not name, so it never reaches CHECKED). None of the 5 sit on a
    # non-identifier field TODAY, which is exactly why the widening matters:
    # an identifier-only loop would happen to look correct for the same
    # reason. Pinned so this can't quietly become a no-op check.
    assert fields_with_alias == 5
