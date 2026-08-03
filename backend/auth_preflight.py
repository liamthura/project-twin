"""A boot-time check that this API and the auth service agree on the issuer.

`AUTH_ISSUER` has to equal the `iss` claim the auth service signs, and there is
nothing about either value that hints at the other. Set to the bare origin when
the service mounts at /auth, every JWT is refused -- session tokens at /api and
OAuth access tokens at /mcp alike -- and the only symptom is a 401 that names no
claim, on a request that is otherwise indistinguishable from an expired tab.

That is a bad thing to debug from the outside, and an easy thing to answer from
the inside: the auth service publishes the value it signs, at
/.well-known/oauth-authorization-server. Fetching it once at startup and
comparing turns an evening into one line in the deploy log.

**It only ever logs.** A mismatch has already broken every JWT by the time this
runs, but the opaque tokens in the `tokens` table are unaffected by it, and so
is everything on /api that does not need a session. Refusing to start, or
pulling the discovery routes, would take those down too -- turning a
misconfiguration that breaks sign-in into one that breaks the whole instance.
The guard exists to name the problem, not to widen it.

**Undetermined is not failure.** The two containers usually start together and
this one is often first, so an unreachable auth service at boot is ordinary
rather than wrong. That case retries, and then says only that it could not
check -- never that the values disagree.

One other answer is worth having: a service that responds 404 here is up and
telling us it has no OAuth endpoints, which is `AUTH_MCP_RESOURCE` set on this
container and not on that one. Clients then discover an authorization server
that registers nothing, and the connection fails after the browser has already
opened. Same shape of problem, same fix -- name it in the log.
"""

import asyncio
import logging
from typing import Optional, Tuple

import httpx

import auth_proxy
import jwt_auth

logger = logging.getLogger(__name__)

# RFC 8414 metadata, on the auth service's own base path. Fetched over the
# internal address rather than the public one so this works before DNS, TLS or
# a reverse proxy do -- what is being compared is a value the service holds,
# not the route a client would take to it.
_METADATA_PATH = "/auth/.well-known/oauth-authorization-server"

# Long enough for a co-starting container to finish booting, short enough that
# a genuinely absent service is reported while someone is still watching the
# deploy. Five tries five seconds apart is a little over twenty seconds.
_ATTEMPTS = 5
_RETRY_SECONDS = 5.0

# A check nobody is waiting on must still not hold a socket open for a minute.
_TIMEOUT = httpx.Timeout(5.0, connect=2.0)

_task: Optional[asyncio.Task] = None


def configured() -> bool:
    """Whether there is anything to compare, and anywhere to compare it.

    `AUTH_MCP_RESOURCE` is in here for a practical reason rather than a
    conceptual one: the issuer matters just as much to an instance that only
    signs people in, but the document that advertises it is part of the OAuth
    surface and does not exist when OAuth is off. There is nothing to ask, so
    this says nothing -- better than a warning on every boot of an instance
    where nothing is wrong.
    """
    return bool(
        auth_proxy.SERVICE_URL and jwt_auth.ISSUER and jwt_auth.MCP_RESOURCE
    )


async def _advertised_issuer() -> Tuple[Optional[str], str, Optional[int]]:
    """The issuer the auth service publishes, or why it is unknown.

    Returns `(issuer, "", status)` or `(None, reason, status)`, with `status`
    None when the request never got an answer. The status is carried back
    because one value of it -- 404 -- is a diagnosis rather than a failure to
    reach anything, and the caller reports it differently.
    """
    url = f"{auth_proxy.SERVICE_URL.rstrip('/')}{_METADATA_PATH}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(url)
    except httpx.RequestError as exc:
        return None, f"{type(exc).__name__}: {exc}", None

    if response.status_code != 200:
        return None, f"HTTP {response.status_code} from {url}", response.status_code

    try:
        issuer = response.json().get("issuer")
    except ValueError:
        return None, f"{url} did not return JSON", response.status_code

    if not issuer:
        return (
            None,
            f"{url} returned metadata with no issuer",
            response.status_code,
        )
    return issuer, "", response.status_code


def compare(advertised: str) -> bool:
    """Log the verdict. Returns whether the two agree.

    Split from the fetching so the message -- the entire point of this module --
    is testable without a network, and so the remediation lives next to the
    comparison that decides to print it.
    """
    if advertised == jwt_auth.ISSUER:
        logger.info("auth issuer agreed with the auth service: %s", advertised)
        return True

    logger.error(
        "auth issuer mismatch: OAuth cannot work.\n"
        "    AUTH_ISSUER = %s\n"
        "    advertised  = %s\n"
        "  The auth service is right -- it signs what it advertises. Set "
        "AUTH_ISSUER to the advertised value and recreate this container "
        "(a restart reuses the old environment). Until then every OAuth "
        "access token is rejected at /mcp and every session JWT at /api, "
        "both as a bare 401 that names no claim.",
        jwt_auth.ISSUER or "(unset)",
        advertised,
    )
    return False


async def run() -> Optional[bool]:
    """Fetch, compare, log. True agreed, False mismatched, None undetermined."""
    if not configured():
        return None

    reason = ""
    status = None
    for attempt in range(1, _ATTEMPTS + 1):
        advertised, reason, status = await _advertised_issuer()
        if advertised is not None:
            return compare(advertised)
        if attempt < _ATTEMPTS:
            await asyncio.sleep(_RETRY_SECONDS)

    if status == 404:
        # Not a failure to reach anything -- the service answered, and what it
        # said was that it has no OAuth endpoints. That is AUTH_MCP_RESOURCE
        # set here and not there, which leaves clients discovering an
        # authorization server that serves nothing.
        logger.error(
            "the auth service has no OAuth endpoints, but this API expects "
            "them (AUTH_MCP_RESOURCE = %s).\n"
            "  Set AUTH_MCP_RESOURCE to the same value on the auth container "
            "and recreate it. Until then clients will discover an "
            "authorization server that registers nothing, and connecting will "
            "fail after the browser has already opened.",
            jwt_auth.MCP_RESOURCE,
        )
        return None

    # Deliberately warning, not error. The auth service being unreachable is
    # already reported by anything that actually needs it; all this can say is
    # that it did not get to check, which is not itself a fault.
    logger.warning(
        "could not verify AUTH_ISSUER against the auth service after %d "
        "attempts (%s). If sign-in works, nothing is wrong here.",
        _ATTEMPTS,
        reason,
    )
    return None


async def _guarded() -> None:
    """`run`, with nothing able to escape it.

    This runs detached, so an exception would surface as asyncio's
    "Task exception was never retrieved" at some later garbage collection --
    a confusing thing to print during a deploy, from a check whose whole
    purpose is to make a deploy less confusing.
    """
    try:
        await run()
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - a diagnostic may not become a fault
        logger.warning("auth issuer check did not complete: %s", exc)


def start() -> None:
    """Kick the check off in the background.

    Detached rather than awaited because the retries take twenty seconds and
    nothing depends on the answer. Blocking startup on it would delay the port
    binding, and therefore the health check, to learn something that changes no
    behaviour.
    """
    global _task
    if not configured() or _task is not None:
        return
    _task = asyncio.create_task(_guarded(), name="auth-issuer-preflight")


def stop() -> None:
    """Cancel a check still retrying at shutdown, and forget it.

    A task holding the only reference to itself is the documented way to have
    it collected mid-flight; keeping `_task` is what stops that, and clearing it
    here is what lets a reloaded process start a new one.
    """
    global _task
    if _task is not None and not _task.done():
        _task.cancel()
    _task = None
