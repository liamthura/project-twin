"""Schema coverage for manifest format v2: does meta_schema.v2.json have teeth?

Everything here is a SHAPE check, on synthetic manifests. The semantic rules that
need to look at two places at once -- does `identifier` name a declared field,
is a `facets` entry actually an enum, is this entity name used twice in the pack
-- belong to the loader's cross-checks and are tested in test_pack_cross_checks.py.
The line between the two files is: if JSON Schema can state it structurally, it
lives here.

Two of the spec's eleven cross-checks turn out to be statable structurally, so
they are enforced here instead of in `_cross_check`: `values` iff `type: "enum"`
(rule 4) and `element` on `type: "list"` (rule 5). That is strictly better -- a
shape error is reported before any semantic pass runs -- and it costs the loader
tests nothing, because both layers raise PackError through the same entry point.

`_template` is not converted or validated here. Task 11 rewrites it by hand as
the format's worked minimum.
"""
import copy

import pytest

import pack_loader

# A minimal, valid v2 manifest. Every test below is this, with one thing changed,
# so that what is under test is the diff and nothing else.
#
# `id_lists` is deliberately EMPTY. `validate_manifest_v2` runs the loader's
# cross-checks after schema validation, and one of them requires every id_lists
# entry to be bound by a top-level list node -- so a fixture that replaces
# `sections` with a group or a fields node would be rejected by THAT rule, not by
# the schema. Four accept-tests here failed that way, and two reject-tests passed
# that way, which is worse. id_lists is exercised properly in
# test_pack_cross_checks.py.
BASE = {
    "key": "goals",
    "title": "Goals",
    "description": "What you are working towards",
    "core": True,
    "position": 30,
    "defaults": {"goals": []},
    "id_lists": [],
    "sections": [
        {
            "kind": "list",
            "path": ["goals"],
            "element": {
                "entity": "goal",
                "identifier": "title",
                "fields": [{"name": "title", "role": "title", "required": True}],
            },
        }
    ],
}


# Every reject-test below asserts the SCHEMA is what rejected the manifest. The
# loader's cross-checks raise PackError through the same entry point, so without
# this a cross-check firing first would make a schema test green while the schema
# itself had a hole -- which is exactly what happened to two tests here before
# `id_lists` was emptied above.
_SHAPE = "manifest schema violation"


def _with_sections(*nodes):
    m = copy.deepcopy(BASE)
    m["sections"] = list(nodes)
    return m


def _with_field(field):
    """BASE's list element, with `field` appended to its one declared field."""
    m = copy.deepcopy(BASE)
    m["sections"][0]["element"]["fields"].append(field)
    return m


# --- the four kinds, each accepted in its minimal form ---------------------


def test_minimal_list_node_is_accepted():
    pack_loader.validate_manifest_v2(copy.deepcopy(BASE))  # must not raise


def test_minimal_fields_node_is_accepted():
    manifest = _with_sections(
        {
            "kind": "fields",
            "path": [],
            "element": {"entity": "basic_info", "fields": [{"name": "name"}]},
        }
    )
    pack_loader.validate_manifest_v2(manifest)  # must not raise


def test_minimal_strings_node_is_accepted():
    pack_loader.validate_manifest_v2(_with_sections({"kind": "strings", "path": ["values"]}))


def test_minimal_group_node_is_accepted():
    manifest = _with_sections(
        {
            "kind": "group",
            "title": "Wellness",
            "sections": [{"kind": "strings", "path": ["values"]}],
        }
    )
    pack_loader.validate_manifest_v2(manifest)  # must not raise


# --- closed key sets ------------------------------------------------------


def test_unknown_key_on_a_node_is_rejected():
    node = copy.deepcopy(BASE["sections"][0])
    node["badges"] = ["status"]  # a real v1 key, deleted in v2
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


def test_unknown_key_on_a_field_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "status", "badge": True}))


def test_a_key_from_another_kind_is_rejected():
    # `search` belongs to a list node. On a fields node it is not "ignored", it is
    # an error -- that is what the per-kind closed sets buy.
    manifest = _with_sections(
        {
            "kind": "fields",
            "path": [],
            "element": {"entity": "basic_info", "fields": [{"name": "name"}]},
            "search": True,
        }
    )
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(manifest)


def test_unknown_kind_is_rejected():
    node = copy.deepcopy(BASE["sections"][0])
    node["kind"] = "scalar"  # never existed; the 2026-08-04 spec said it did
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


def test_unknown_top_level_key_is_rejected():
    manifest = copy.deepcopy(BASE)
    manifest["entities"] = {"goal": {}}  # the block v2 derives instead of authoring
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(manifest)


def test_the_ui_wrapper_is_rejected():
    manifest = copy.deepcopy(BASE)
    manifest["ui"] = {"sections": manifest.pop("sections")}
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(manifest)


# --- what each kind may and may not bind ----------------------------------


def test_group_with_a_path_is_rejected():
    manifest = _with_sections(
        {
            "kind": "group",
            "title": "Wellness",
            "path": ["wellness"],
            "sections": [{"kind": "strings", "path": ["values"]}],
        }
    )
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(manifest)


def test_group_without_sections_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections({"kind": "group", "title": "Wellness"}))


def test_list_without_an_element_block_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections({"kind": "list", "path": ["goals"]}))


def test_list_with_an_empty_path_is_rejected():
    # An empty path addresses the containing object, and setAt returns the new
    # value for a zero-length path -- so the first write replaces the section's
    # whole stored object. Array.isArray([]) is true, so nothing downstream sees it.
    node = copy.deepcopy(BASE["sections"][0])
    node["path"] = []
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


def test_strings_with_an_empty_path_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections({"kind": "strings", "path": []}))


def test_fields_node_with_an_empty_path_is_accepted():
    # The one kind for which `path: []` is meaningful: it addresses the section
    # root, which is how profile's Personal Information binds its scalars.
    manifest = _with_sections(
        {"kind": "fields", "path": [], "element": {"entity": "basic_info", "fields": [{"name": "name"}]}}
    )
    pack_loader.validate_manifest_v2(manifest)  # must not raise


def test_fields_node_without_an_entity_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(
            _with_sections({"kind": "fields", "path": [], "element": {"fields": [{"name": "name"}]}})
        )


def test_element_without_an_entity_is_rejected():
    node = copy.deepcopy(BASE["sections"][0])
    del node["element"]["entity"]
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


def test_element_without_an_identifier_is_rejected():
    node = copy.deepcopy(BASE["sections"][0])
    del node["element"]["identifier"]
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


def test_empty_field_list_is_rejected():
    node = copy.deepcopy(BASE["sections"][0])
    node["element"]["fields"] = []
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


# --- the field descriptor -------------------------------------------------


def test_field_without_a_name_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"label": "Status", "type": "text"}))


def test_values_without_enum_type_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(
            _with_field({"name": "status", "values": ["current", "done"]})
        )


def test_enum_type_without_values_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "status", "type": "enum"}))


def test_well_formed_enum_is_accepted():
    pack_loader.validate_manifest_v2(
        _with_field(
            {
                "name": "status",
                "type": "enum",
                "values": ["current", "done"],
                "default": "current",
                "show": ["badge", "form"],
            }
        )
    )


def test_list_type_without_an_element_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "coursework", "type": "list"}))


def test_element_on_a_non_array_field_is_rejected():
    # `text` is not an array, so there is no "one element" for `element` to describe.
    # (A `strings` field MAY carry one -- that is a different test, below.)
    field = {
        "name": "coursework",
        "type": "text",
        "element": {"entity": "coursework", "identifier": "name", "fields": [{"name": "name"}]},
    }
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field(field))


def test_nested_list_field_is_accepted():
    # v2's replacement for `children`: the nested record binds against the ROW,
    # which as a field inside item.fields is the only reading available.
    field = {
        "name": "coursework",
        "type": "list",
        "show": ["count"],
        "label": "Coursework / Modules",
        "element": {
            "entity": "coursework",
            "identifier": "name",
            "actions": ["add", "remove"],
            "fields": [{"name": "name", "role": "title", "required": True}],
        },
    }
    pack_loader.validate_manifest_v2(_with_field(field))  # must not raise


def test_empty_show_is_rejected():
    # A field that renders nowhere says write_only: true. One way to say one thing.
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "status", "show": []}))


def test_write_only_field_is_accepted():
    pack_loader.validate_manifest_v2(
        _with_field({"name": "conversation_metadata", "write_only": True})
    )


def test_unknown_show_position_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "status", "show": ["chip"]}))


def test_unknown_type_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "notes", "type": "long_text"}))


def test_allow_custom_on_a_non_enum_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "type", "allow_custom": True}))


def test_allow_custom_on_an_enum_is_accepted():
    # Replaces the `custom_` naming convention: a magic prefix ScalarField matched
    # on, declared nowhere.
    pack_loader.validate_manifest_v2(
        _with_field(
            {"name": "type", "type": "enum", "values": ["habit", "milestone"], "allow_custom": True}
        )
    )


def test_pin_on_a_non_bool_field_is_rejected():
    field = {
        "name": "primary",
        "pin": {"title": "Your design language", "empty": "None yet", "noun": "primary"},
    }
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field(field))


def test_pin_on_a_bool_field_is_accepted():
    field = {
        "name": "primary",
        "type": "bool",
        "exclusive": True,
        "pin": {"title": "Your design language", "empty": "None yet", "noun": "primary"},
    }
    pack_loader.validate_manifest_v2(_with_field(field))  # must not raise


def test_unknown_role_is_rejected():
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field({"name": "status", "role": "subtitle"}))


# --- variants -------------------------------------------------------------


def test_variant_with_only_entity_and_description_is_accepted():
    node = copy.deepcopy(BASE["sections"][0])
    node["element"]["variants"] = [{"entity": "dislike", "description": "Something you dislike."}]
    pack_loader.validate_manifest_v2(_with_sections(node))  # must not raise


def test_variant_that_redeclares_fields_is_rejected():
    # A variant differs from its parent in name and description only. Anything
    # more and it is a second element shape, not a variant of this one.
    node = copy.deepcopy(BASE["sections"][0])
    node["element"]["variants"] = [{"entity": "dislike", "fields": [{"name": "item"}]}]
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


# --- error messages ------------------------------------------------------


def test_the_error_names_the_offending_key():
    # A schema violation that only says "not valid under any of the given schemas"
    # is why validate_manifest reaches for best_match (pack_loader.py:46), and why
    # the node dispatcher is allOf/if/then rather than oneOf. Keep it that way.
    node = copy.deepcopy(BASE["sections"][0])
    node["detail_fields"] = ["title"]
    with pytest.raises(pack_loader.PackError, match=_SHAPE + ".*detail_fields"):
        pack_loader.validate_manifest_v2(_with_sections(node))


# --- `element` on a string array: who may write it over MCP -------------------
#
# The amendment that made the format able to hold what ships. Eleven entities in
# the shipped packs write into a bare-string array -- `personality_trait` into
# `personality_traits`, `work_skill` into work_experience's `skills` -- and v2 as
# first specified had nowhere to say so: `strings` had eight keys and none of them
# named an entity. Those entities existed only in the authored `entities` block,
# with nothing tying them to the array they write.


def test_strings_node_with_a_writer_is_accepted():
    manifest = _with_sections(
        {
            "kind": "strings",
            "path": ["personality_traits"],
            "title": "Personality Traits",
            "element": {"entity": "personality_trait", "identifier": "trait"},
        }
    )
    pack_loader.validate_manifest_v2(manifest)  # must not raise


def test_strings_node_without_a_writer_is_accepted():
    # The common case, and why `element` is optional here: preferences ships six
    # `strings` nodes and only `response_format` is in the MCP contract.
    pack_loader.validate_manifest_v2(
        _with_sections({"kind": "strings", "path": ["key_decisions"], "title": "Key Decisions"})
    )


def test_strings_field_with_a_writer_is_accepted():
    field = {
        "name": "skills",
        "type": "strings",
        "element": {"entity": "work_skill", "identifier": "skill", "bulk": True},
    }
    pack_loader.validate_manifest_v2(_with_field(field))  # must not raise


def test_a_strings_writer_may_not_declare_fields():
    # A bare string has no named keys. Declaring fields means the array holds
    # records, which is `type: "list"`.
    field = {
        "name": "skills",
        "type": "strings",
        "element": {"entity": "work_skill", "identifier": "skill", "fields": [{"name": "skill"}]},
    }
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field(field))


def test_a_strings_writer_needs_an_identifier():
    # The parameter name for one string. Not derivable: `energy_peaks` takes
    # `peak`, `response_format` takes `item`.
    field = {"name": "skills", "type": "strings", "element": {"entity": "work_skill"}}
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field(field))


def test_bulk_on_a_list_each_is_rejected():
    # `bulk` means "the whole array may be passed under its own stored name",
    # which is only meaningful for an array of bare strings.
    node = copy.deepcopy(BASE["sections"][0])
    node["element"]["bulk"] = True
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_sections(node))


def test_a_strings_writer_may_not_declare_variants():
    # No shipped string array needs a second MCP name, and `coursework_topic` --
    # the one legacy alias of this kind -- aliases a LIST, not a string array.
    field = {
        "name": "skills",
        "type": "strings",
        "element": {
            "entity": "work_skill",
            "identifier": "skill",
            "variants": [{"entity": "work_technology"}],
        },
    }
    with pytest.raises(pack_loader.PackError, match=_SHAPE):
        pack_loader.validate_manifest_v2(_with_field(field))
