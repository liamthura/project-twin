"""The actions a user can pick from their client's own UI.

An MCP prompt is not a tool. The model does not choose it -- the person does,
from a menu the client draws, and what it returns is injected as though they had
typed it. That makes prompts the one surface here aimed at a user rather than at
an agent.

Which is why they exist. The skills are published at skill://mygist/<name>/
SKILL.md, but a client only benefits if something actually fetches them, and in a
chat client resources tend to be surfaced for the user to attach rather than read
by the model unprompted. Every prompt below names the skill it depends on and
tells the agent to read it first, so a user picking an action is what makes the
skill load -- no plugin, any client.

Three of them, deliberately. A menu of actions nobody uses is noise.

Each needs a scope, listed in scopes.PROMPT_SCOPES and enforced by
mcp_scopes.ScopeMiddleware. Offering "catch up my persona" to a connection that
cannot propose would be an action in the menu that cannot do what it says.
"""

CATCH_UP = """\
Review this conversation for anything durable about me that is not yet in my \
MyGist persona, and propose it.

First read skill://mygist/mygist-capture/SKILL.md and follow it. In short: \
something qualifies if it will still be true in a month AND you can quote me \
saying it. Put my own words in `evidence` -- if you are paraphrasing an \
impression of me, do not send it.

Send one propose_update containing everything you found, not one call per item. \
Nothing is written: it goes to my review queue and I decide.

If nothing qualifies, say so in one line. Do not pad the queue to look useful."""


WHATS_ON_FILE_ALL = """\
Show me what my MyGist persona has on me.

Read it with get_context, then summarise what is actually there -- the sections \
that have content, and roughly what is in each. Use detail="titles" where a \
section is long rather than reciting every entry.

Attribute it. "I've got you down as X" is honest; "You prefer X" states a stored \
record as though you remembered it, and some of these entries came from another \
assistant's inference that I approved months ago and have forgotten.

Then tell me anything that looks stale or contradictory. Do not change anything."""


WHATS_ON_FILE_TOPIC = """\
Show me what my MyGist persona has about {topic}.

Use search_context for "{topic}" and then get_entity on what it returns, rather \
than pulling a whole scope. If nothing matches, say so plainly instead of \
answering from a wider read and letting me think it was on file.

Attribute what you find -- "I've got you down as X", not "You prefer X" -- and \
tell me if any of it looks stale. Do not change anything."""


LOG_LEARNING = """\
Record what I worked out in this conversation to my MyGist learning log.

I am asking you to do this, so write it now with persona_modify -- entity \
"learning_entry" -- rather than proposing it. Read \
skill://mygist/mygist-writing/SKILL.md first for the field shape, and call \
get_schema(entity="learning_entry") if anything is unclear.

Write it as the mechanism, not the diary: what is actually true and reusable, in \
a title someone would recognise in a year. "vitest testTimeout cannot stop a \
synchronous hang", not "Debugging session with Claude". Include the decisions \
that were taken and anything left to follow up.

Read the result. A duplicate warning means update the existing entry instead of \
adding a second."""


def register(mcp) -> list[str]:
    """Attach the prompts to a FastMCP server. Returns the names registered."""

    @mcp.prompt(
        name="catch_up",
        title="Catch up my persona",
        description=(
            "Review this conversation and propose anything durable about me to my "
            "MyGist review queue. Nothing is written without my approval."
        ),
    )
    def catch_up() -> str:
        return CATCH_UP

    @mcp.prompt(
        name="whats_on_file",
        title="What's on file about me",
        description=(
            "Summarise what my MyGist persona holds, and where it came from. "
            "Optionally about one topic. Changes nothing."
        ),
    )
    def whats_on_file(topic: str = "") -> str:
        # Two texts rather than one with an "if a topic was given" paragraph: a
        # prompt is injected verbatim as the user's own turn, and a conditional
        # instruction the agent has to resolve reads like something the user did
        # not mean to send.
        subject = topic.strip()
        if not subject:
            return WHATS_ON_FILE_ALL
        return WHATS_ON_FILE_TOPIC.format(topic=subject)

    @mcp.prompt(
        name="log_learning",
        title="Log what I learned",
        description=(
            "Write what I worked out in this conversation to my MyGist learning "
            "log. Writes immediately, because I asked for it."
        ),
    )
    def log_learning() -> str:
        return LOG_LEARNING

    return ["catch_up", "whats_on_file", "log_learning"]
