"""The skills the MCP server publishes.

These files used to live in one developer's ~/.claude/skills, which meant an
agent connecting from anywhere else got the tool schemas and no idea how to use
them. Serving them as resources is what makes them travel.

The test worth reading is the last one: it fails if the `instructions` string
points an agent at a skill nobody shipped.
"""

import json
from pathlib import Path

import pytest
from fastmcp import Client

import skill_resources


SKILLS_DIR = Path(skill_resources.__file__).parent / "skills"


def test_every_directory_on_disk_is_published():
    # Not a hardcoded list: adding a skill and forgetting to register it is
    # exactly the failure this guards, and a literal here would be updated in
    # the same commit that caused it.
    on_disk = {p.name for p in SKILLS_DIR.iterdir() if (p / "SKILL.md").is_file()}
    published = {s.name for s in skill_resources.discover()}
    assert on_disk == published
    assert len(on_disk) >= 4


def test_each_skill_has_a_name_and_a_description():
    for skill in skill_resources.discover():
        assert skill.name, f"{skill.path} has no name in its frontmatter"
        assert skill.description, f"{skill.name} has no description"
        # The description is what a client matches on to decide whether to load
        # the skill. A one-word one cannot do that job.
        assert len(skill.description) > 40, f"{skill.name}'s description is too thin"


def test_uri_shape_matches_what_figma_serves():
    # skill://mygist/<name>/SKILL.md -- a client that understands one server's
    # skill URIs understands this one's.
    uris = {s.uri for s in skill_resources.discover()}
    assert "skill://mygist/mygist-capture/SKILL.md" in uris
    for uri in uris:
        assert uri.startswith("skill://mygist/")
        assert uri.endswith("/SKILL.md")


class TestFrontmatter:
    def test_reads_the_two_keys(self):
        parsed = skill_resources.parse_frontmatter(
            "---\nname: thing\ndescription: Does a thing.\n---\n\n# Body\n"
        )
        assert parsed == {"name": "thing", "description": "Does a thing."}

    def test_a_value_containing_a_colon_survives(self):
        # Every one of the real descriptions contains a colon, so splitting on
        # the last one -- or on all of them -- would truncate the thing clients
        # match against.
        parsed = skill_resources.parse_frontmatter(
            "---\nname: thing\ndescription: Use when: a colon appears.\n---\n"
        )
        assert parsed["description"] == "Use when: a colon appears."

    def test_ignores_a_line_it_cannot_read(self):
        parsed = skill_resources.parse_frontmatter(
            "---\nname: thing\nnonsense\ndescription: Fine.\n---\n"
        )
        assert parsed == {"name": "thing", "description": "Fine."}

    def test_no_frontmatter_is_empty_rather_than_a_guess(self):
        assert skill_resources.parse_frontmatter("# Just a heading\n") == {}


class TestOverMcp:
    """Through a real client, because that is how anyone will actually reach it."""

    @pytest.fixture
    def server(self):
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        skill_resources.register(mcp)
        return mcp

    @pytest.mark.anyio
    async def test_the_skills_are_listed(self, server):
        async with Client(server) as client:
            listed = {str(r.uri): r for r in await client.list_resources()}

        for skill in skill_resources.discover():
            assert skill.uri in listed
            entry = listed[skill.uri]
            assert entry.mimeType == "text/markdown"
            assert entry.name == skill.name
            assert entry.description == skill.description

    @pytest.mark.anyio
    async def test_a_skill_reads_back_the_real_file(self, server):
        target = next(s for s in skill_resources.discover() if s.name == "mygist-capture")
        async with Client(server) as client:
            got = await client.read_resource(target.uri)

        assert got[0].text == target.path.read_text()
        assert "propose_update" in got[0].text

    @pytest.mark.anyio
    async def test_the_index_lists_exactly_what_is_on_disk(self, server):
        async with Client(server) as client:
            got = await client.read_resource("skill://index.json")

        index = json.loads(got[0].text)
        assert {entry["name"] for entry in index["skills"]} == {
            s.name for s in skill_resources.discover()
        }
        for entry in index["skills"]:
            assert entry["uri"].startswith("skill://mygist/")
            assert entry["description"]


def test_instructions_stay_within_their_budget():
    """The instructions ride in every conversation's system prompt, in every client.

    Growing them is easy to do and hard to notice, which is the only reason this
    assertion exists. If a change genuinely needs the room, raise the number
    deliberately and say why in the spec -- do not delete the test.
    """
    source = (Path(skill_resources.__file__).parent / "server.py").read_text()
    start = source.index('instructions="""')
    instructions = source[start + len('instructions="""') : source.index('"""', start + 16)]

    # A floor as well as a ceiling. Without it, a slicing mistake that extracted
    # an empty string would satisfy the assertion below and this test would pass
    # for the rest of its life while checking nothing.
    assert 20 <= len(instructions.splitlines()) <= 45
    assert "propose_update" in instructions

    # Whatever it does say, it must not go back to re-listing the tools the
    # client already has in its tool schema, which is what it used to be.
    assert "Available tools:" not in instructions


def test_instructions_only_name_skills_that_exist():
    """The failure this prevents: telling an agent to load something unshipped.

    Reading server.py's source rather than importing it -- importing pulls in the
    database, the embedding provider and the auth stack, none of which this
    assertion needs.
    """
    source = (Path(skill_resources.__file__).parent / "server.py").read_text()
    start = source.index('instructions="""')
    instructions = source[start : source.index('"""', start + 16)]

    published = {s.name for s in skill_resources.discover()}
    named = {name for name in published if name in instructions}

    # Every skill mentioned resolves, and the hub skill is mentioned at all --
    # instructions that point at nothing are the same bug as instructions that
    # point at the wrong thing.
    assert "mygist-capture" in named
    for token in instructions.split():
        candidate = token.strip("`,.()").rstrip(":")
        if candidate.startswith("mygist-"):
            assert candidate in published, f"instructions name a missing skill: {candidate}"
