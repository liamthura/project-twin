"""The scope vocabulary, shared by every credential type.

Three scopes, hierarchical. `persona:write` implies `persona:propose` implies
`persona:read`, which the MCP specification requires rather than merely permits:
"Servers MUST account for scope hierarchies, where a broader scope implies
narrower ones." Expanding once at the edge means no call site has to remember
the rule.

`persona:read` is the floor everywhere. A credential that cannot read has
nothing to authorise -- withholding it produces a client that can write to a
persona it cannot see, which is not a narrower permission but an incoherent one.
"""

from contextvars import ContextVar
from typing import Iterable

READ = "persona:read"
PROPOSE = "persona:propose"
WRITE = "persona:write"

ALL_SCOPES: tuple[str, ...] = (READ, PROPOSE, WRITE)

# What each scope carries with it. Keys are the full vocabulary, so a scope
# absent from this map is one we do not recognise.
_IMPLIES: dict[str, tuple[str, ...]] = {
    WRITE: (PROPOSE, READ),
    PROPOSE: (READ,),
    READ: (),
}

# Which scope each MCP tool requires. Read tools outnumber the rest because
# reading is what MyGist is mostly for; propose_update is deliberately its own
# tier so an assistant can suggest without being able to mutate.
TOOL_SCOPES: dict[str, str] = {
    "get_context": READ,
    "get_raw": READ,
    "search_context": READ,
    "get_entity": READ,
    "get_schema": READ,
    "whoami": READ,
    "propose_update": PROPOSE,
    "persona_modify": WRITE,
    "persona_batch": WRITE,
}

# The same question for prompts, which are actions a user picks from their
# client's menu. A prompt needs whatever the tool it instructs the agent to call
# needs: catch_up ends in propose_update, log_learning in persona_modify.
#
# Filtered rather than left visible, which is the opposite of the choice made for
# an unclassified TOOL above -- and for a reason. A tool that appears and then
# refuses names the problem to whoever tries it. A prompt that appears and then
# cannot work looks like the product is broken, because the person who picked it
# never asked for a tool and has no way to connect the failure to a missing
# scope.
PROMPT_SCOPES: dict[str, str] = {
    "whats_on_file": READ,
    "catch_up": PROPOSE,
    "log_learning": WRITE,
}

# Set once per request by main.py's auth middleware, alongside
# db.current_user_id. No default, for the same reason that one has none: a code
# path that reaches persona data without authenticating must raise rather than
# quietly proceed with an empty grant that some future `if` treats as harmless.
current_scopes: ContextVar[frozenset[str]] = ContextVar("current_scopes")


def expand(granted: Iterable[str]) -> frozenset[str]:
    """Close a granted set under the hierarchy, dropping anything unrecognised.

    The authorization server also issues `openid` and `offline_access`; neither
    means anything to this resource, and silently dropping them is right --
    they are not permissions we failed to honour.
    """
    result: set[str] = set()
    for scope in granted or ():
        if scope in _IMPLIES:
            result.add(scope)
            result.update(_IMPLIES[scope])
    return frozenset(result)


def has(granted: Iterable[str], required: str) -> bool:
    """Whether an already-expanded grant satisfies `required`."""
    return required in granted


def scope_for_method(method: str) -> str:
    """The scope an /api request needs, keyed on HTTP method.

    Every /api route was checked against this: there is no GET that writes and
    no POST that only reads. A method test therefore needs no per-route table,
    and so has nothing to drift out of date when a route is added.
    """
    return READ if method.upper() == "GET" else WRITE
