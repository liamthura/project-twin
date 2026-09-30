"""What an observation can be promoted to: one rule, from the manifests.

The Promote dialog lists these and routing asks Jev to choose among them, so
this set is both what a reader is offered and what a model is told exists.
"""

import pytest

import pack_loader

pytestmark = pytest.mark.nodb


def _targets():
    return {
        key: {t["entity"]: t for t in pack_loader.derive_promotion_targets(m)}
        for key, m in pack_loader.manifests().items()
    }


def test_the_shipped_packs_offer_these_types():
    offered = {key: sorted(t) for key, t in _targets().items() if t}
    assert offered == {
        "aesthetics": ["aesthetic"],
        "circle": ["connection"],
        "goals": ["goal"],
        "inventory": ["inventory_item"],
        "knowledge": ["domain", "mental_tab"],
        "learning_log": ["learning_entry"],
        "lifestyle": ["energy_peak", "hobby", "interest", "personality_trait", "stress_trigger", "value"],
        "media": ["media_item"],
        "preferences": [
            "dev_tool", "dislike", "framework", "learning_dislike", "learning_method",
            "like", "mood_override", "preferred_language", "response_format",
        ],
        "profile": ["education", "email", "language", "link", "work_experience"],
        "projects": ["project", "top_of_mind"],
    }


def test_every_type_a_shipped_pack_offers_says_what_it_is():
    # `about` is the dialog's help text and Jev's criterion. Without it a type
    # is routed on its title alone, which is how "cooks to decompress" once
    # went to "When I'm feeling...".
    missing = [
        f"{key}.{entity}"
        for key, targets in _targets().items()
        for entity, t in targets.items()
        if not (t["about"] or {}).get("what")
    ]
    assert missing == []


def test_only_a_top_level_type_a_section_draws():
    targets = _targets()
    # hobby_specific belongs to a hobby, which a sentence cannot name.
    assert "hobby_specific" not in targets["lifestyle"]
    # `preference` is in the contract but no section draws it: promoted, it
    # would sit where the editor never shows it.
    assert "preference" not in targets["preferences"]
    # A type needing more than a name is offered, with its fields to fill.
    work = targets["profile"]["work_experience"]
    assert [(f["key"], f["required"]) for f in work["fields"]][:4] == [
        ("company", True), ("role", True), ("type", True), ("period", True)]


def test_each_type_carries_the_fields_a_person_fills_in():
    t = _targets()
    hobby = {f["key"]: f for f in t["lifestyle"]["hobby"]["fields"]}
    assert set(hobby) == {"name", "notes", "skill_level", "status"}  # not specifics, references
    assert hobby["name"]["identifier"] and hobby["name"]["required"]
    assert hobby["status"]["values"] == ["active", "inactive", "paused"]
    # Nobody types a rename helper or a server timestamp.
    assert "new_topic" not in {f["key"] for f in t["learning_log"]["learning_entry"]["fields"]}
    # A list of plain strings is one text field.
    assert t["preferences"]["response_format"]["fields"] == [{
        "key": "item", "label": "Text", "type": "text", "required": True,
        "identifier": True, "placeholder": None, "values": None}]
    # The stance that tells like from dislike is the type itself, never filled.
    assert [f["key"] for f in t["preferences"]["dislike"]["fields"]] == ["item"]
    # A field goes by its MCP spelling, which is what a write sends.
    assert t["projects"]["top_of_mind"]["fields"][0]["key"] == "item"


def test_types_are_named_as_the_editor_names_them():
    t = _targets()
    assert t["preferences"]["mood_override"]["title"] == "When I'm feeling..."
    assert t["preferences"]["dislike"]["title"] == "Likes & dislikes: dislike"
    assert t["preferences"]["dislike"]["about"] != t["preferences"]["like"]["about"]
    assert t["circle"]["connection"]["title"] == "Person"
    top = t["projects"]["top_of_mind"]["fields"][0]
    assert (top["label"], top["placeholder"]) == ("Idea", "Project idea or thing you want to build...")
