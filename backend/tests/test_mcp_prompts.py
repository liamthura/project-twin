"""The prompts a user picks from their client's menu.

Two things are being guarded. First, that each prompt actually points the agent
at the skill it depends on -- that pointer is the whole reason prompts exist here,
since a skill:// resource only helps if something fetches it. Second, that a
prompt is never offered to a connection that cannot carry it out, which for a
person clicking a menu item reads as a broken product rather than a scope problem.
"""

import pytest
from fastmcp import Client, FastMCP

import mcp_prompts
import scopes
from mcp_scopes import ScopeMiddleware


ALL_PROMPTS = {"catch_up", "whats_on_file", "log_learning"}


@pytest.fixture
def server():
    mcp = FastMCP("test")
    mcp_prompts.register(mcp)
    return mcp


@pytest.fixture
def scoped_server():
    mcp = FastMCP("test")
    mcp_prompts.register(mcp)
    mcp.add_middleware(ScopeMiddleware())
    return mcp


def granted(*names):
    """A request-scoped grant, expanded the way the auth middleware expands it."""
    return scopes.expand(names)


class TestWhatIsRegistered:
    @pytest.mark.anyio
    async def test_all_three_with_a_title_and_a_description(self, server):
        async with Client(server) as client:
            listed = {p.name: p for p in await client.list_prompts()}

        assert set(listed) == ALL_PROMPTS
        for prompt in listed.values():
            # The title is what a user sees in the menu; the description is what
            # tells them what it will do. Neither is optional for a surface aimed
            # at a person rather than a model.
            assert prompt.title, f"{prompt.name} has no title"
            assert prompt.description, f"{prompt.name} has no description"

    def test_every_prompt_has_a_scope(self):
        # The middleware defaults an unclassified prompt to WRITE, so a missing
        # entry hides it from everyone but a full grant -- a silent disappearance
        # rather than an error. This is what stops that happening.
        assert set(scopes.PROMPT_SCOPES) == ALL_PROMPTS

    @pytest.mark.anyio
    async def test_the_real_server_registers_exactly_these(self):
        """Against server.mcp, not a double.

        Everything else in this file builds its own FastMCP and registers the
        prompts onto it, which proves mcp_prompts.register works and nothing
        about what actually ships. A prompt added to the module but never
        registered in server.py -- or registered there and missing from
        PROMPT_SCOPES -- would pass every other test here.

        Mirrors test_mcp_scopes.test_every_registered_tool_has_a_scope.
        """
        import server

        registered = set(await server.mcp.get_prompts())
        assert registered == ALL_PROMPTS
        assert registered - set(scopes.PROMPT_SCOPES) == set(), (
            "a prompt is registered with no entry in scopes.PROMPT_SCOPES -- add "
            "one, choosing the narrowest scope it can honestly run under"
        )

    @pytest.mark.anyio
    async def test_registered_names_match_what_register_reports(self, server):
        async with Client(server) as client:
            listed = {p.name for p in await client.list_prompts()}
        assert listed == set(mcp_prompts.register(FastMCP("probe")))


class TestTheTextPointsAtASkill:
    """The pointer is the point. Without it a prompt is just a canned sentence."""

    @pytest.mark.anyio
    async def test_catch_up_sends_the_agent_to_the_capture_skill(self, server):
        async with Client(server) as client:
            got = await client.get_prompt("catch_up")

        text = got.messages[0].content.text
        assert "skill://mygist/mygist-capture/SKILL.md" in text
        # The two rules that make a proposal safe to send, restated here because
        # the agent may act on this prompt before it reads the skill.
        assert "evidence" in text
        assert "still be true in a month" in text
        # And it must not imply the write happens immediately.
        assert "review queue" in text

    @pytest.mark.anyio
    async def test_log_learning_sends_the_agent_to_the_writing_skill(self, server):
        async with Client(server) as client:
            got = await client.get_prompt("log_learning")

        text = got.messages[0].content.text
        assert "skill://mygist/mygist-writing/SKILL.md" in text
        # This one is an explicit instruction, so it must name the writing tool
        # rather than the proposing one -- it is the one prompt that demonstrates
        # the asked/inferred boundary instead of describing it.
        assert "persona_modify" in text
        # Naming the write tool is not enough on its own -- the prompt has to say
        # which of the two it is NOT doing, or an agent that half-read it defaults
        # to the safer-looking one and the user's explicit ask silently becomes a
        # queue item they have to approve.
        assert "rather than proposing" in text

    @pytest.mark.anyio
    async def test_whats_on_file_changes_nothing_and_says_so(self, server):
        async with Client(server) as client:
            got = await client.get_prompt("whats_on_file")

        text = got.messages[0].content.text
        assert "Do not change anything" in text
        # Attribution, which is the rule this prompt exists to enforce: some of
        # what it reads back came from another agent's inference.
        assert "I've got you down as" in text


class TestTheTopicArgument:
    @pytest.mark.anyio
    async def test_a_topic_narrows_the_instruction(self, server):
        async with Client(server) as client:
            got = await client.get_prompt("whats_on_file", {"topic": "consulting"})

        text = got.messages[0].content.text
        assert "consulting" in text
        # Narrowing means search_context then get_entity, not a wider scope --
        # otherwise the answer could come from a broad read and look like a hit.
        assert "search_context" in text
        assert "say so plainly" in text

    @pytest.mark.anyio
    async def test_whitespace_is_not_a_topic(self, server):
        async with Client(server) as client:
            blank = await client.get_prompt("whats_on_file", {"topic": "   "})
            none = await client.get_prompt("whats_on_file")

        assert blank.messages[0].content.text == none.messages[0].content.text


class TestScopeFiltering:
    @pytest.mark.anyio
    async def test_a_read_only_grant_sees_only_the_read_prompt(self, scoped_server):
        token = scopes.current_scopes.set(granted(scopes.READ))
        try:
            async with Client(scoped_server) as client:
                listed = {p.name for p in await client.list_prompts()}
        finally:
            scopes.current_scopes.reset(token)

        assert listed == {"whats_on_file"}

    @pytest.mark.anyio
    async def test_a_propose_grant_sees_two(self, scoped_server):
        token = scopes.current_scopes.set(granted(scopes.PROPOSE))
        try:
            async with Client(scoped_server) as client:
                listed = {p.name for p in await client.list_prompts()}
        finally:
            scopes.current_scopes.reset(token)

        # propose implies read, so the read one comes along.
        assert listed == {"whats_on_file", "catch_up"}

    @pytest.mark.anyio
    async def test_a_full_grant_sees_all_three(self, scoped_server):
        token = scopes.current_scopes.set(granted(scopes.WRITE))
        try:
            async with Client(scoped_server) as client:
                listed = {p.name for p in await client.list_prompts()}
        finally:
            scopes.current_scopes.reset(token)

        assert listed == ALL_PROMPTS

    @pytest.mark.anyio
    async def test_naming_a_hidden_prompt_anyway_is_refused(self, scoped_server):
        # A client that remembers the prompt from a wider grant, or guessed it.
        # Hiding it from the list is not the same as making it uncallable.
        token = scopes.current_scopes.set(granted(scopes.READ))
        try:
            async with Client(scoped_server) as client:
                with pytest.raises(Exception) as caught:
                    await client.get_prompt("log_learning")
        finally:
            scopes.current_scopes.reset(token)

        message = str(caught.value)
        assert "persona:write" in message
        # The message has to say what to do about it, not just refuse.
        assert "reconnect" in message.lower()

    @pytest.mark.anyio
    async def test_no_grant_at_all_shows_nothing(self, scoped_server):
        # The HTTP middleware refuses before this point, so this is a path that
        # never authenticated. Showing nothing is the fail-closed answer, and it
        # matches what on_list_tools already does.
        async with Client(scoped_server) as client:
            listed = await client.list_prompts()

        assert listed == []
