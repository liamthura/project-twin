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
        "lifestyle": ["energy_peak", "hobby", "interest", "personality_trait", "stress_trigger", "value"],
        "media": ["media_item"],
        "preferences": [
            "dev_tool", "dislike", "framework", "learning_dislike", "learning_method",
            "like", "mood_override", "preferred_language", "response_format",
        ],
        "profile": ["education"],
        "projects": ["top_of_mind"],
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


def test_only_one_line_can_make_it_and_only_where_a_section_draws_it():
    targets = _targets()
    # hobby_specific needs its hobby as well, so a sentence cannot make one.
    assert "hobby_specific" not in targets["lifestyle"]
    # work_experience needs a company, role, type and period.
    assert "work_experience" not in targets["profile"]
    # `preference` is in the contract but no section draws it: promoted, it
    # would sit where the editor never shows it.
    assert "preference" not in targets["preferences"]


def test_types_are_named_as_the_editor_names_them():
    t = _targets()
    assert t["preferences"]["mood_override"]["title"] == "When I'm feeling..."
    assert t["preferences"]["mood_override"]["label"] == "Mood"
    # Two entities over one list are told apart, and each has its own meaning.
    assert t["preferences"]["dislike"]["title"] == "Likes & dislikes: dislike"
    assert t["preferences"]["dislike"]["about"] != t["preferences"]["like"]["about"]
    # A list of plain strings has no field of its own.
    assert t["preferences"]["response_format"]["label"] == "Text"
    # An untitled list goes by its noun, and a field by its stored name while
    # the promote sends the MCP spelling.
    assert t["circle"]["connection"]["title"] == "Person"
    assert (t["projects"]["top_of_mind"]["label"], t["projects"]["top_of_mind"]["field"]) == ("Idea", "item")
