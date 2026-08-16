"""The tool descriptions are the only channel that reaches every client every
session. The server `instructions` string is not -- see
docs/superpowers/specs/2026-08-16-tool-triggering-design.md. These guards exist
so trigger material cannot drift back into the channel that does not arrive.
"""
from pathlib import Path

import sections
import server


def test_section_block_names_every_loaded_pack():
    block = sections.describe_sections()
    for key, meta in sections.PACK_META.items():
        assert key in block, f"pack '{key}' loads but is invisible to get_context"
        assert meta["description"] in block


def test_section_block_is_indented_and_aligned():
    lines = sections.describe_sections().splitlines()
    assert len(lines) == len(sections.PACK_META)
    assert all(line.startswith("    ") for line in lines)


def test_get_context_leads_with_the_deficiency_argument():
    desc = server.get_context.description
    # Prose is hard-wrapped, so phrase assertions run against a flattened copy.
    flat = " ".join(desc.split())
    assert desc.startswith("Load the user's persona before you answer.")
    assert "you have never met this user" in flat.lower()
    # The line that generalises: it stays true for a pack nobody has written yet.
    assert "about them rather than about the world" in flat
    # No token count: persona sizes vary per user, so any number here is wrong
    # for nearly everyone.
    assert "tokens" not in desc


def test_get_context_description_carries_the_generated_section_block():
    assert sections.describe_sections() in server.get_context.description


# The quoted phrases are the only pattern-matchable trigger material MyGist has.
# They lived in the `instructions` string, which is the channel measured not to
# arrive. They belong in a tool description, and in exactly one place.
TRIGGER_PHRASES = [
    "we've switched to X",
    "I've been doing X for a month",
    "we shipped it",
    "always give me X first",
    "I can't stand X",
    "my sister just started a PhD",
    "I want to be running 10k by March",
    "I got the job",
]


def test_propose_update_leads_with_the_trigger_phrases():
    desc = server.propose_update.description
    head = desc[: desc.index("ARGS:")]
    for phrase in TRIGGER_PHRASES:
        assert phrase in head, f"{phrase!r} is not in propose_update's opening"
    assert "asked writes, inferred proposes" in desc.lower()


def test_propose_update_keeps_the_field_rules_and_does_not_defer_to_get_schema():
    desc = server.propose_update.description
    assert "ONLY what changes" in desc
    assert "mygist-writing" in desc


def test_search_context_opens_with_a_when_not_a_comparison():
    desc = server.search_context.description
    assert "CALL THIS when" in desc.split("Args:")[0]


def _instructions_source() -> str:
    source = (Path(server.__file__).parent / "server.py").read_text()
    start = source.index('instructions="""')
    return source[start + len('instructions="""') : source.index('"""', start + 16)]


def test_the_triggers_are_in_the_description_and_not_in_the_instructions():
    """Two assertions, so the material cannot end up in both places or neither.

    `instructions` is written once by the server and delivered whenever by the
    client -- measured stale in every live session on 2026-08-16 while
    production served the current copy. Anything it is the SOLE carrier of is
    something an unknown share of users will never see.
    """
    instructions = _instructions_source()
    for phrase in TRIGGER_PHRASES:
        assert phrase in server.propose_update.description
        assert phrase not in instructions
