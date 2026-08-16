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

The service's own baseURL is set to the public origin, so it never infers
anything from forwarded headers and this stays a dumb passthrough.
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

# Dropped from the REQUEST. Host is left to httpx so it matches the upstream
# address rather than the public one.
_DROP_FROM_REQUEST = _HOP_BY_HOP | {"host"}


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
    return {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in _DROP_FROM_REQUEST
    }


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

    Mirrors @better-auth/core's isLoopbackHost. Used only to point at which URI
    in a rejected list was the offending one.
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
        "This server accepts a redirect URI that is https:// on any host, "
        "http:// on a loopback host only (127.0.0.1, [::1], localhost), or a "
        f"private-use scheme such as myapp://callback.{named} "
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
    message = str(payload.get("message", ""))
    if "redirect" not in message.lower() or "https" not in message.lower():
        return None

    rejected = _rejected_redirect_uris(body)
    enriched = dict(payload)
    enriched["message"] = f"{message}. {_redirect_uri_help(rejected)}"
    enriched["rejected_redirect_uris"] = rejected
    enriched["docs"] = "https://mygist.thuradev.qzz.io/docs/run/troubleshooting"
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
