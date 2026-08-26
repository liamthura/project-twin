"""Pass /auth/* through to the Better Auth service.

Why FastAPI proxies this rather than the platform doing path-based routing:
`run/self-hosting` promises reverse proxies "one upstream, one port". Routing
/auth at the platform breaks that promise for everyone who self-hosts, who would
need two upstreams in the right order or watch sign-in silently reach the wrong
service. Proxying here keeps the public contract identical and changes only what
happens behind it. It also puts the rule in code, where it is reviewed, tested
and deployed atomically, rather than in a dashboard -- this project has already
lost time to a container port and a DNS record that lived only in dashboards.

Cost is one loopback hop, on auth calls only. /api and /mcp never touch this.

The service's own baseURL is set to the public origin, so it never infers its
own address from forwarded headers.

Everything the caller sends crosses this hop untouched -- Cookie, Origin,
Authorization, the body -- with ONE exception: X-Forwarded-For is overwritten
with this server's own view of the peer, and whatever the caller put there is
discarded. That header is not data from the caller, it is an assertion ABOUT the
caller, and only the hop that terminates their connection is in a position to
make it. So this is a passthrough for everything except the one header that
cannot be one. `_request_headers` is where it happens.

Why it has to happen here. The auth service resolves a client IP out of that
header (`getIPFromHeader`, @better-auth/core/utils/ip), keys rate limiting on
the result -- `/sign-in*` allows 3 requests per 10 seconds per `ip|path` -- and
persists it to `session.ipAddress`. Measured against that resolver with no
`trustedProxies` configured, which is the default:

  "9.9.9.9"                 -> 9.9.9.9   a single entry is trusted outright
  "203.0.113.99, 1.1.1.1"   -> null      a chain resolves to nothing

Both lines are a caller's to write if this hop forwards the header, and neither
outcome is acceptable: the first hands them any address they like, the second is
the shared-bucket case the auth service's own comment describes. Configuring
`trustedProxies` cannot fix it either -- trusting a range makes the walk from the
right stop at the rightmost entry it does not trust, so two public entries return
the caller's own value and let them pick a fresh rate-limit bucket per request.

And nothing between a browser and here validated the header against the real TCP
peer: uvicorn only rewrites `request.client` from it when the connecting peer is
itself in FORWARDED_ALLOW_IPS (default `127.0.0.1`), and run/self-hosting
documents a bare `docker run -p 1120:1120` with no reverse proxy at all as a
supported deployment.
"""

import json
import logging
import os
from http.cookiejar import CookieJar
from typing import Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

# Internal address of the Better Auth container, e.g. http://auth:3001. Unset
# means the service is not deployed and /auth is not registered at all.
SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "")

# A hung auth service must not hold a worker open indefinitely. Sign-in is
# interactive: a user gives up long before ten seconds.
TIMEOUT = httpx.Timeout(10.0, connect=2.0)

# RFC 7230 hop-by-hop headers, which describe a single connection and must not
# be forwarded across one.
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

# Dropped from the RESPONSE on top of the hop-by-hop set. httpx has already
# decompressed the body, so upstream's content-encoding now describes something
# that is no longer true, and its content-length is the compressed size. Passing
# either on produces a response the client cannot parse.
_DROP_FROM_RESPONSE = _HOP_BY_HOP | {"content-encoding", "content-length"}

# The header this proxy asserts rather than forwards. See the module docstring.
_CLIENT_IP = "x-forwarded-for"

# Dropped from the REQUEST. Host is left to httpx so it matches the upstream
# address rather than the public one. The inbound client-IP header is dropped
# here -- by lowered name, so every casing and every repeat of it goes -- and
# `_request_headers` then sets our own.
_DROP_FROM_REQUEST = _HOP_BY_HOP | {"host", _CLIENT_IP}


class _NoCookieJar(CookieJar):
    """A cookie jar that never stores and never sends anything.

    httpx clients keep cookies by default, and this client is a process-wide
    singleton shared by every request from every visitor. That combination is a
    cross-user session leak, not a performance detail: the auth service sets a
    session cookie on sign-in, the jar stored it, and the proxy then attached it
    to EVERY later request -- so an unauthenticated stranger calling
    /auth/token was handed a JWT belonging to whoever signed in last.

    A proxy has no session of its own. Its job is to carry the caller's own
    Cookie header through untouched, which `_request_headers` already does, and
    to carry Set-Cookie back, which `_response_headers` already does. Anything
    it remembers between requests belongs to somebody, and it cannot know whom.

    Written as a CookieJar rather than an httpx.Cookies subclass because that is
    the extension point httpx actually honours: `Cookies(...)` re-wraps anything
    it recognises and keeps only unrecognised objects as the jar itself, so a
    Cookies subclass is silently discarded. Both hooks below are exactly the two
    it delegates to.
    """

    def add_cookie_header(self, request):  # noqa: D102 - CookieJar hook
        return

    def extract_cookies(self, response, request):  # noqa: D102 - CookieJar hook
        return


# One client for the process, created on first use so that importing this
# module opens no sockets and binds to no event loop. It is never explicitly
# closed: the app's lifespan is FastMCP's, and hanging a second shutdown hook
# off it would mean `on_event`, which FastAPI has deprecated. A connection pool
# living exactly as long as the process is the normal shape for a proxy, and
# the sockets go when the process does.
_client: Optional[httpx.AsyncClient] = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=TIMEOUT,
            follow_redirects=False,
            cookies=_NoCookieJar(),
        )
    return _client


def _request_headers(request: Request) -> dict:
    """The caller's headers, with X-Forwarded-For replaced by our own peer.

    Overwrite, never append. A chain is what makes the upstream resolver
    ambiguous in the first place; one authoritative entry is what makes it
    unforgeable, and it resolves with no `trustedProxies` configured at all.

    `request.client` is None when the ASGI server reports no peer, which the
    spec permits. The header is then omitted entirely rather than sent empty or
    filled with a placeholder: absent, the upstream finds no x-forwarded-for and
    resolves null, which is the honest answer. A malformed value would be
    indistinguishable from an attack, and a placeholder would be a lie about
    where the request came from.
    """
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in _DROP_FROM_REQUEST
    }
    if request.client is not None:
        headers[_CLIENT_IP] = request.client.host
    return headers


def build_response(upstream: httpx.Response) -> Response:
    """Turn an upstream response into ours, preserving every Set-Cookie.

    A sign-in response carries several Set-Cookie headers. Anything that treats
    headers as a mapping keeps one and silently drops the rest, which presents
    later as a session that half-works -- so this walks the multi-valued list
    and appends each header individually.
    """
    response = Response(content=upstream.content, status_code=upstream.status_code)

    # Response() has already set content-length for the body we are actually
    # sending. Everything else comes from upstream, unmerged.
    already_set = {key.decode("latin-1").lower() for key, _ in response.raw_headers}

    for key, value in upstream.headers.multi_items():
        lowered = key.lower()
        if lowered in _DROP_FROM_RESPONSE:
            continue
        if lowered != "set-cookie" and lowered in already_set:
            continue
        response.raw_headers.append(
            (key.encode("latin-1"), value.encode("latin-1"))
        )

    return response


# ---------------------------------------------------------------------------
# Registration errors, made actionable
#
# Better Auth refuses a redirect URI that is http:// on a non-loopback host, per
# RFC 8252 section 7.3 and the OAuth 2.1 BCP. The refusal is correct. Its message
# is not usable: it states the rule, names neither the URI that broke it nor what
# to do, and it arrives at the one moment a person is stuck with no other signal.
#
# The load-bearing property of everything below: IT NEVER DECIDES ANYTHING. The
# upstream has already refused by the time any of this runs, and nothing here can
# turn a refusal into an acceptance or the reverse. So the local host classifier
# cannot drift into a security problem -- if it ever disagreed with Better Auth's,
# the worst case is a message that omits the specific URI and falls back to the
# general explanation. That asymmetry is why it is safe to restate the rule here
# rather than import it across a language boundary.
# ---------------------------------------------------------------------------

_REGISTER_SUFFIX = "/oauth2/register"


def _is_loopback_host(host: str) -> bool:
    """RFC 8252 loopback, plus the RFC 6761 `.localhost` names Better Auth allows.

    Wider than the rule actually enforced at /oauth2/register. The oauth-provider
    plugin's own validateClientRedirectUri decides there, and for `native` it
    checks only the three literal hosts in NATIVE_HTTP_HOSTS
    (auth/src/oauth.js): `localhost`, `127.0.0.1`, `[::1]` -- not the wider
    RFC 6761 `.localhost` suffix or loopback IP range this function accepts.
    That is bounded: this function never decides anything (see the module
    docstring above), so a disagreement can only make the rejected-URI list
    below narrower than what actually got refused, i.e. help text that omits a
    URI -- never a wrong accept/refuse decision.
    """
    import ipaddress

    host = host.strip().lower().rstrip(".")
    if host.startswith("[") and "]" in host:
        host = host[1: host.index("]")]
    elif host.count(":") == 1:
        host = host.split(":", 1)[0]
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _rejected_redirect_uris(body: bytes) -> list[str]:
    """The redirect_uris in a registration request that the rule forbids."""
    from urllib.parse import urlsplit

    try:
        uris = json.loads(body or b"{}").get("redirect_uris") or []
    except (ValueError, AttributeError):
        return []
    out = []
    for uri in uris:
        if not isinstance(uri, str):
            continue
        parts = urlsplit(uri)
        if parts.scheme == "http" and not _is_loopback_host(parts.netloc):
            out.append(uri)
    return out


def _redirect_uri_help(rejected: list[str]) -> str:
    named = f" Yours: {', '.join(rejected)}." if rejected else ""
    return (
        "This server accepts a redirect URI that is https:// on any host, or "
        "http:// on a loopback host only (127.0.0.1, [::1], localhost)."
        f"{named} "
        "A private-use scheme is refused unless the client also registers an "
        "application_type of native, because RFC 7591 makes a registration that "
        "omits that field a web client, and a web client may only use https. "
        "A client whose dashboard you reach at a non-loopback address -- over a "
        "tunnel, a VPN, or a reverse proxy -- derives its callback from that "
        "origin, so give that origin HTTPS and the callback follows. On a "
        "tailnet, `tailscale serve` issues a real certificate for exactly this. "
        "Where the client lets you set the callback explicitly, "
        "http://127.0.0.1:<port>/callback is always accepted. "
        "Nothing was stored, so retrying costs nothing."
    )


def explain_registration_refusal(body: bytes, upstream: httpx.Response) -> Optional[Response]:
    """Rewrite a redirect-URI refusal into something a person can act on.

    Returns None for anything else, so every other response passes through
    untouched. `code` and the upstream's own sentence are preserved and appended
    to rather than replaced, because a client may already match on them.
    """
    if upstream.status_code != 400:
        return None
    try:
        payload = upstream.json()
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    # FIXME: dead since better-auth 1.7. It answers a redirect-URI refusal with
    # `error` / `error_description` and no `message` key at all, so this reads ""
    # and returns None, and the bare upstream refusal passes through un-enriched.
    # Deliberately not fixed on the 1.7 upgrade branch -- it is its own task, and
    # the tests below still pass because they feed a hand-written 1.6 payload.
    message = str(payload.get("message", ""))
    if "redirect" not in message.lower() or "https" not in message.lower():
        return None

    rejected = _rejected_redirect_uris(body)
    enriched = dict(payload)
    enriched["message"] = f"{message}. {_redirect_uri_help(rejected)}"
    enriched["rejected_redirect_uris"] = rejected
    # Relative, not absolute. The docs ship in the same image on the same
    # origin, and an absolute URL here would send every self-hosted instance's
    # users to whichever hostname happened to be in the author's editor.
    enriched["docs"] = "/docs/run/troubleshooting"
    logger.info(
        "rejected client registration: redirect_uris=%s", rejected or "unparsed"
    )
    return JSONResponse(enriched, status_code=400)


async def forward(upstream_path: str, request: Request) -> Response:
    """Send a request to the auth service at `upstream_path`, verbatim.

    Split out from the /auth/* route so the OAuth discovery documents can reach
    the same service at a path the public URL does not mirror -- RFC 8414 puts
    authorization-server metadata at the ROOT with the issuer's path appended,
    which /auth/{path} cannot express.
    """
    base = SERVICE_URL.rstrip("/")
    body = await request.body()
    try:
        upstream = await _http().request(
            request.method,
            f"{base}{upstream_path}",
            params=request.query_params,
            content=body,
            headers=_request_headers(request),
            # Redirects are part of the auth flow -- OAuth callbacks, and the
            # post-sign-in bounce. Following them here would resolve them
            # server-side and hand the browser the wrong page.
            follow_redirects=False,
        )
    except httpx.RequestError as exc:
        # The auth service is down or unreachable. Humans cannot sign in;
        # MCP clients are unaffected, because their path never comes here.
        logger.warning("auth service unreachable: %s", exc)
        return JSONResponse(
            {"error": "Authentication service unavailable"}, status_code=503
        )
    if upstream_path.endswith(_REGISTER_SUFFIX):
        explained = explain_registration_refusal(body, upstream)
        if explained is not None:
            return explained
    return build_response(upstream)


def register(app: FastAPI) -> bool:
    """Mount the proxy if an auth service is configured. Returns whether it was.

    Mirrors register_static_routes: conditional, so a deployment without the
    auth service behaves exactly as it did before this existed, and /auth simply
    does not resolve.
    """
    if not SERVICE_URL:
        return False

    @app.api_route(
        "/auth/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    async def auth_proxy(path: str, request: Request) -> Response:
        return await forward(f"/auth/{path}", request)

    return True
