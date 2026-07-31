"""The keyword pipeline is gone, and stays gone.

It decided what was worth remembering by substring-matching a closed list of
~90 technology names. Datadog sat in knowledge.json at 'advanced' and was not
on the list. IGNORE_PATTERNS scanned the whole message and discarded anything
containing "ok" -- including "ok so I've decided to drop Neon and self-host".
"""
import pathlib

import server


def test_the_old_tool_is_gone():
    assert not hasattr(server, "suggest_persona_update")


def test_the_keyword_tables_are_gone():
    for name in ("CAPTURE_TRIGGERS", "IGNORE_PATTERNS", "KNOWN_SKILLS",
                 "KNOWN_CONCEPTS", "SKILL_HIERARCHY", "ENTITY_THRESHOLDS",
                 "SENTIMENT_MULTIPLIERS", "TRIGGER_STRENGTH_BOOSTS",
                 "EXPLICIT_STATE_PATTERNS", "PRONOUNS"):
        assert not hasattr(server, name), f"{name} survived"


def test_the_scoring_helpers_are_gone():
    for name in ("analyze_message_for_capture", "determine_skill_level",
                 "detect_explicit_state_changes", "calculate_evidence_boost",
                 "calculate_final_confidence_v2", "get_action_from_confidence",
                 "deduplicate_suggestions", "is_pronoun",
                 "resolve_pronoun_references", "find_in_persona",
                 "cross_reference_persona", "is_same_data",
                 "consolidate_suggestions_for_ux", "ConversationContext",
                 "conversation_context"):
        assert not hasattr(server, name), f"{name} survived"


def test_the_replacement_is_present():
    assert hasattr(server, "propose_update")


def test_the_validation_layer_survived():
    # These are what propose_update and persona_modify both lean on. Removing
    # the pipeline must not have taken them with it.
    for name in ("_find_strong_match", "normalize_data", "ENTITY_SCHEMA",
                 "_section_for_entity", "execute_modify"):
        assert hasattr(server, name), f"{name} was removed by mistake"


def test_the_archive_is_not_wired_into_anything():
    # The museum piece must not be importable as a dependency.
    src = pathlib.Path(server.__file__).read_text()
    assert "capture_heuristics" not in src


def test_the_server_no_longer_advertises_the_old_tool():
    assert "suggest_persona_update" not in server.mcp.instructions
