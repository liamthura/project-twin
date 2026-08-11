"""The semantic rules a v2 manifest must satisfy that JSON Schema cannot state.

Every rule here describes a mistake that is SILENT today: a `facets` entry naming
a field that does not exist, an `identifier` pointing at nothing, two fields
sharing a stored key. v1 could not check any of them, because the two halves of
each rule lived in different blocks -- `facets: ["level"]` sat on the node while
`level`'s vocabulary sat in the entity's `valid_values`, so no single reader saw
both. v2 puts them in one declaration, which is what makes these checkable.

Three rules from the spec's list of eleven are NOT here:

- Rules 4 and 5 (`values` iff `type: "enum"`, `element` on `type: "list"`) turned
  out to be statable structurally and are enforced by meta_schema.v2.json, tested
  in test_manifest_v2_schema.py. So is "pin only on a bool field", half of rule 7.
  They are not duplicated here; two tests for one rule is two things to update.
- Rule 11 (`key` equals the directory name) lives in `load_packs`, which is the
  only caller that knows the directory. Tested in test_section_bindings.py.

Every fixture below is asserted SCHEMA-VALID before the cross-check runs. Without
that, a fixture with a typo in it passes `pytest.raises(PackError)` on a shape
error and proves nothing about the rule under test -- and the failure mode is
invisible, because the test is green either way.
"""
import copy

import pytest

import pack_loader

BASE = {
    "key": "goals",
    "title": "Goals",
    "description": "What you are working towards",
    "core": True,
    "position": 30,
    "defaults": {"goals": []},
    "id_lists": [["goals", "goal"]],
    "sections": [
        {
            "kind": "list",
            "path": ["goals"],
            "title": "Goals",
            "element": {
                "entity": "goal",
                "identifier": "title",
                "fields": [
                    {"name": "title", "role": "title", "required": True},
                    {"name": "status", "type": "enum", "values": ["open", "done"]},
                ],
            },
        }
    ],
}


def _node():
    return copy.deepcopy(BASE["sections"][0])


def _with_sections(*nodes):
    m = copy.deepcopy(BASE)
    m["sections"] = list(nodes)
    return m


def _without_the_goals_list(*nodes):
    """`_with_sections`, for fixtures that drop the `goals` list node entirely.

    BASE's `id_lists` names `goals`, and rule 9 requires a top-level list node to
    bind it -- so a fixture that replaces the tree must drop the id_list too, or
    rule 9 fires first and the test passes for the wrong reason.
    """
    m = _with_sections(*nodes)
    m["id_lists"] = []
    return m


def _rejects(manifest, match):
    """The fixture must be schema-valid, then the cross-check must reject it.

    The first assertion is the point: it stops a malformed fixture from making a
    cross-check test pass for the wrong reason.
    """
    shape_errors = list(pack_loader._validator().iter_errors(manifest))
    assert not shape_errors, f"fixture is schema-invalid, so it tests nothing: {shape_errors[0].message}"
    with pytest.raises(pack_loader.PackError, match=match):
        pack_loader.validate_manifest(manifest)


def _accepts(manifest):
    pack_loader.validate_manifest(manifest)  # must not raise


def test_the_baseline_manifest_is_valid():
    # If this ever fails, every test below is testing the wrong thing.
    _accepts(copy.deepcopy(BASE))


# --- rule 1: identifier names a declared field ----------------------------


def test_identifier_naming_no_declared_field_is_rejected():
    node = _node()
    node["element"]["identifier"] = "name"  # the field is called `title`
    _rejects(_with_sections(node), "name")


def test_identifier_naming_a_declared_field_is_accepted():
    _accepts(copy.deepcopy(BASE))


# --- rule 2: exactly one role: "title" ------------------------------------


def test_two_title_roles_in_one_item_is_rejected():
    node = _node()
    node["element"]["fields"][1]["role"] = "title"
    _rejects(_with_sections(node), "role")


def test_list_item_without_a_title_role_is_rejected():
    # A list row with nothing marked as its name renders a row with no heading.
    node = _node()
    del node["element"]["fields"][0]["role"]
    _rejects(_with_sections(node), "role")


def test_fields_node_needs_no_title_role():
    # A `fields` node is one record, not a row in a list: there is no collapsed
    # row for a title to name. Only a list item must have one.
    manifest = _without_the_goals_list(
        {"kind": "fields", "path": [], "element": {"entity": "basic_info", "fields": [{"name": "name"}]}}
    )
    _accepts(manifest)


def test_two_title_roles_in_a_fields_node_is_still_rejected():
    manifest = _without_the_goals_list(
        {
            "kind": "fields",
            "path": [],
            "element": {
                "entity": "basic_info",
                "fields": [
                    {"name": "name", "role": "title"},
                    {"name": "preferred_name", "role": "title"},
                ],
            },
        }
    )
    _rejects(manifest, "role")


# --- rule 3: facets and sort.field ----------------------------------------


def test_facet_naming_no_declared_field_is_rejected():
    node = _node()
    node["facets"] = ["priority"]
    _rejects(_with_sections(node), "priority")


def test_facet_on_a_non_enum_field_is_rejected():
    # A filter chip row needs a closed vocabulary to build the chips from. In v1
    # this was uncheckable: the node named the facet, the entity held the values.
    node = _node()
    node["facets"] = ["title"]
    _rejects(_with_sections(node), "title")


def test_facet_on_an_enum_field_is_accepted():
    node = _node()
    node["facets"] = ["status"]
    _accepts(_with_sections(node))


def test_sort_field_naming_no_declared_field_is_rejected():
    node = _node()
    node["sort"] = {"field": "timestamp", "dir": "desc"}
    _rejects(_with_sections(node), "timestamp")


def test_sort_field_naming_a_declared_field_is_accepted():
    # learning_log sorts on `timestamp`, which server.py writes on every add and
    # which the entity vocabulary does not carry -- so it must be DECLARED in v2,
    # not merely stored. That is the whole point of `name` being the authority.
    node = _node()
    node["element"]["fields"].append({"name": "timestamp", "show": ["row"], "format": "datetime"})
    node["sort"] = {"field": "timestamp", "dir": "desc"}
    _accepts(_with_sections(node))


# --- rule 6: no duplicate names, no alias collisions ----------------------


def test_two_fields_sharing_a_name_is_rejected():
    node = _node()
    node["element"]["fields"].append({"name": "status", "type": "bool"})
    _rejects(_with_sections(node), "status")


def test_alias_colliding_with_another_fields_name_is_rejected():
    # The trap this catches: `status`'s alias claims `title`'s stored key, so an
    # MCP write to one silently lands on the other.
    node = _node()
    node["element"]["fields"][1]["alias"] = ["state", "title"]
    _rejects(_with_sections(node), "title")


def test_alias_colliding_with_its_own_name_is_rejected():
    node = _node()
    node["element"]["fields"][1]["alias"] = ["status"]
    _rejects(_with_sections(node), "status")


def test_two_fields_sharing_an_alias_is_rejected():
    # Neither alias repeats its own field's name -- that is a different rule, and
    # if it fired here the test would pass while proving nothing about collisions
    # BETWEEN fields.
    node = _node()
    node["element"]["fields"][0]["alias"] = ["goal_title", "label"]
    node["element"]["fields"][1]["alias"] = ["state", "label"]
    _rejects(_with_sections(node), "label")


def test_the_same_name_in_two_different_items_is_accepted():
    # `name` is scoped to its item. profile's coursework and clubs both declare
    # one, and they are different stored keys on different rows.
    node = _node()
    node["element"]["fields"].append(
        {
            "name": "coursework",
            "type": "list",
            "element": {
                "entity": "coursework",
                "identifier": "title",
                "fields": [{"name": "title", "role": "title"}],
            },
        }
    )
    _accepts(_with_sections(node))


def test_a_nested_items_own_duplicate_is_still_rejected():
    # The walk must descend into a `type: "list"` field's item, or every nested
    # list is unchecked -- which is most of profile.
    node = _node()
    node["element"]["fields"].append(
        {
            "name": "coursework",
            "type": "list",
            "element": {
                "entity": "coursework",
                "identifier": "title",
                "fields": [
                    {"name": "title", "role": "title"},
                    {"name": "title", "type": "bool"},
                ],
            },
        }
    )
    _rejects(_with_sections(node), "title")


# --- rule 7: at most one pin per item -------------------------------------


def test_two_pinned_fields_in_one_item_is_rejected():
    node = _node()
    pin = {"title": "Your pick", "empty": "None yet", "noun": "primary"}
    node["element"]["fields"].append({"name": "primary", "type": "bool", "pin": dict(pin)})
    node["element"]["fields"].append({"name": "secondary", "type": "bool", "pin": dict(pin)})
    _rejects(_with_sections(node), "pin")


def test_one_pinned_field_is_accepted():
    node = _node()
    node["element"]["fields"].append(
        {
            "name": "primary",
            "type": "bool",
            "exclusive": True,
            "pin": {"title": "Your design language", "empty": "None yet", "noun": "primary"},
        }
    )
    _accepts(_with_sections(node))


# --- rule 8: entity names, scoped ----------------------------------------
#
# The spec worded this "entity names are unique across the whole pack", which a
# shipped pack violates: `lifestyle` declares entity `sleep` on TWO `fields`
# nodes, wellness.sleep.weekday and wellness.sleep.weekend, and today's single
# `sleep` entity serves both. So the rule enforced here is the one the derivation
# actually needs -- two declarations of one entity must AGREE -- which still
# rejects the bug the original rule was aimed at, and additionally rejects a
# disagreement that "unique" would have had nothing to say about.


def test_two_nodes_declaring_the_same_entity_identically_is_accepted():
    weekday = {
        "kind": "fields",
        "path": ["wellness", "sleep", "weekday"],
        "title": "Sleep — weekdays",
        "element": {"entity": "sleep", "fields": [{"name": "bedtime"}, {"name": "wake_time"}]},
    }
    weekend = copy.deepcopy(weekday)
    weekend["path"] = ["wellness", "sleep", "weekend"]
    weekend["title"] = "Sleep — weekends"
    _accepts(_without_the_goals_list(weekday, weekend))


def test_two_nodes_declaring_the_same_entity_differently_is_rejected():
    weekday = {
        "kind": "fields",
        "path": ["wellness", "sleep", "weekday"],
        "title": "Sleep — weekdays",
        "element": {"entity": "sleep", "fields": [{"name": "bedtime"}, {"name": "wake_time"}]},
    }
    weekend = copy.deepcopy(weekday)
    weekend["path"] = ["wellness", "sleep", "weekend"]
    weekend["element"]["fields"] = [{"name": "bedtime"}, {"name": "rise_time"}]
    _rejects(_without_the_goals_list(weekday, weekend), "sleep")


def test_a_variant_colliding_with_a_real_entity_is_rejected():
    node = _node()
    node["element"]["variants"] = [{"entity": "goal", "description": "The same name."}]
    _rejects(_with_sections(node), "goal")


def test_two_variants_sharing_a_name_is_rejected():
    node = _node()
    node["element"]["variants"] = [
        {"entity": "aspiration", "description": "One."},
        {"entity": "aspiration", "description": "Two."},
    ]
    _rejects(_with_sections(node), "aspiration")


def test_a_distinct_variant_is_accepted():
    node = _node()
    node["element"]["variants"] = [{"entity": "aspiration", "description": "A softer goal."}]
    _accepts(_with_sections(node))


# --- rule 9: id_lists resolve to a list node AND to defaults --------------


def test_id_list_naming_no_list_node_is_rejected():
    # v1 checked only the `defaults` half, so an id_lists entry could name a key
    # with a seeded default and no editor at all.
    manifest = copy.deepcopy(BASE)
    manifest["defaults"]["archive"] = []
    manifest["id_lists"].append(["archive", "arch"])
    _rejects(manifest, "archive")


def test_id_list_naming_a_fields_node_is_rejected():
    manifest = _with_sections(
        {"kind": "fields", "path": ["goals"], "element": {"entity": "goal", "fields": [{"name": "title"}]}}
    )
    _rejects(manifest, "goals")


def test_id_list_not_in_defaults_is_rejected():
    manifest = copy.deepcopy(BASE)
    manifest["defaults"] = {}
    _rejects(manifest, "goals")


# --- rule 10: scope_contributions name top-level stored keys -------------
#
# Restated from the spec's "names paths that exist in the tree", which no shipped
# pack satisfies. These are top-level keys of the STORED FILE, selected for
# context output at server.py:313 alongside `default.keys()` -- so `defaults` is
# the authority. profile names `bio` and `current_role` (fields of a `path: []`
# node, not nodes), and lifestyle names `wellness` (a storage prefix that only a
# group sits over). Both are correct; a tree-path rule would reject them.


def test_scope_contribution_not_in_defaults_is_rejected():
    manifest = copy.deepcopy(BASE)
    manifest["scope_contributions"] = {"personal": ["aspirations"]}
    _rejects(manifest, "aspirations")


def test_scope_contribution_naming_a_defaults_key_is_accepted():
    manifest = copy.deepcopy(BASE)
    manifest["scope_contributions"] = {"personal": ["goals"]}
    _accepts(manifest)


def test_scope_contribution_may_name_a_scalar_field_not_a_node():
    # profile's case: `bio` is a field inside a `path: []` fields node, and a
    # legitimate top-level stored key.
    manifest = copy.deepcopy(BASE)
    manifest["defaults"]["bio"] = ""
    manifest["sections"].append(
        {"kind": "fields", "path": [], "element": {"entity": "basic_info", "fields": [{"name": "bio"}]}}
    )
    manifest["scope_contributions"] = {"minimal": ["bio"]}
    _accepts(manifest)


def test_unknown_scope_name_is_still_rejected():
    manifest = copy.deepcopy(BASE)
    manifest["scope_contributions"] = {"spiritual": ["goals"]}
    _rejects(manifest, "spiritual")


# --- a field that claims no position ------------------------------------


def _goal_with(field):
    node = _node()
    node["element"]["fields"].append(field)
    return _with_sections(node)


def test_a_field_that_claims_no_position_and_draws_no_block_is_rejected():
    # Neither a labelled block nor an admitted UI-only value: nothing renders it,
    # and nothing outside the app knows it exists.
    _rejects(_goal_with({"name": "priority", "show": []}), "claims no position")


def test_a_ui_only_field_may_claim_no_position():
    # knowledge's `created_at`: stamped on save, shown nowhere, because its two
    # write paths disagree about the timezone.
    _accepts(_goal_with({"name": "created_at", "show": [], "default": "@now", "ui_only": True}))


def test_a_labelled_collection_may_claim_no_position():
    # It draws its own titled block under the row, so it needs no slot in the form.
    _accepts(
        _goal_with(
            {"name": "steps", "type": "strings", "show": [], "label": "Steps"}
        )
    )


# --- a labelled block field may not also claim the `form` position -------
#
# elementShape.js already skips `form` for a block field (`if (isBlock &&
# position === "form") continue`) -- a block draws its own titled control, so a
# text input over an array in the parent's form is incoherent. But that skip was
# the ONLY place the rule existed: meta_schema.json happily accepted
# `{label, type: "strings", show: ["form"]}`, and the renderer just quietly
# threw the position away. This closes that gap in the manifest itself.


def test_a_labelled_strings_field_may_not_claim_the_form_position():
    _rejects(
        _goal_with(
            {"name": "steps", "type": "strings", "show": ["form"], "label": "Steps"}
        ),
        "form",
    )


def test_a_labelled_list_field_may_not_claim_the_form_position():
    node = _node()
    node["element"]["fields"].append(
        {
            "name": "coursework",
            "type": "list",
            "show": ["form"],
            "label": "Coursework",
            "element": {
                "entity": "coursework",
                "identifier": "title",
                "fields": [{"name": "title", "role": "title"}],
            },
        }
    )
    _rejects(_with_sections(node), "form")


def test_a_labelled_block_field_may_claim_form_together_with_other_positions():
    # `form` specifically is illegal; any OTHER position beside it is fine, and
    # must stay fine -- this rule must not overreach into rejecting `count`.
    _accepts(
        _goal_with(
            {"name": "steps", "type": "strings", "show": ["count"], "label": "Steps"}
        )
    )


def test_an_unlabelled_strings_field_may_claim_the_form_position():
    # Without a `label` the field is an inline chip control, not a block -- `form`
    # is exactly where it belongs, and always has been (e.g. education's
    # `coursework.topics`).
    _accepts(_goal_with({"name": "tags", "type": "strings", "show": ["form"]}))


# --- a nested element's `parent` must name the enclosing row -------------
#
# The rule this closes has a proven cost: profile's Education block declared
# `work_highlight` (parent `company`, work experience's identifier) and Work
# Experience declared `education_highlight` (parent `institution`, education's
# identifier) -- SWAPPED -- and shipped that way. Nothing noticed, because each
# nested entity supplies its own `parent`, so the derived MCP contract was
# self-consistent either way; only cross-referencing the declaration against the
# row it actually sits under catches the swap.


def _education_like_node_with_highlight_parent(parent):
    """An `education`-shaped list row (identifier `institution`) with a nested
    `highlights` strings block whose `parent` is under test. Mirrors the actual
    shipped shape closely enough to reconstruct the historical bug verbatim."""
    return {
        "kind": "list",
        "path": ["education"],
        "title": "Education",
        "element": {
            "entity": "education",
            "identifier": "institution",
            "fields": [
                {"name": "institution", "role": "title", "required": True},
                {
                    "name": "highlights",
                    "type": "strings",
                    "show": [],
                    "label": "Highlights",
                    "element": {
                        "entity": "education_highlight",
                        "identifier": "highlight",
                        "parent": parent,
                    },
                },
            ],
        },
    }


def test_the_historical_swap_is_rejected():
    # Reconstructs the actual bug: a `highlights` block under an
    # Education-shaped row (identifier `institution`) declaring the parent name
    # that belongs to Work Experience's row (`company`) instead of its own.
    node = _education_like_node_with_highlight_parent("company")
    _rejects(_without_the_goals_list(node), "company")


def test_nested_parent_matching_the_bare_identifier_is_accepted():
    node = _education_like_node_with_highlight_parent("institution")
    _accepts(_without_the_goals_list(node))


def test_nested_parent_matching_the_entity_prefixed_identifier_is_accepted():
    # knowledge's `domain.references`: entity `domain`, identifier `name`,
    # parent `domain_name` -- the OTHER legal spelling. `title` here plays the
    # role `name` plays there (BASE's title field is already the identifier).
    node = _node()
    node["element"]["entity"] = "domain"
    node["element"]["fields"][1] = {
        "name": "references",
        "type": "list",
        "show": [],
        "label": "References",
        "element": {
            "entity": "domain_reference",
            "identifier": "name",
            "parent": "domain_title",
            "fields": [{"name": "name", "role": "title"}],
        },
    }
    _accepts(_with_sections(node))


def test_nested_parent_naming_neither_spelling_is_rejected():
    node = _education_like_node_with_highlight_parent("some_other_name")
    _rejects(_without_the_goals_list(node), "some_other_name")


# --- the error says where -----------------------------------------------


def test_the_error_names_the_pack_and_the_node():
    node = _node()
    node["facets"] = ["priority"]
    with pytest.raises(pack_loader.PackError) as exc:
        pack_loader.validate_manifest(_with_sections(node))
    message = str(exc.value)
    assert "goals" in message  # the pack
    assert "Goals" in message  # the node
    assert "priority" in message  # the offending value


def test_a_shape_error_is_reported_before_a_semantic_one():
    # Both wrong at once: an unknown key AND a facet naming nothing. The shape
    # error must win, because a cross-check reading a malformed node reports a
    # confusing consequence of the real mistake.
    node = _node()
    node["badges"] = ["status"]
    node["facets"] = ["priority"]
    with pytest.raises(pack_loader.PackError, match="badges"):
        pack_loader.validate_manifest(_with_sections(node))
