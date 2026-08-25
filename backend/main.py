"""
MyGist API + MCP Server

Single entry point serving:
- REST API at /api/*
- MCP server at /mcp
- Health check at /health
"""

import base64
import contextlib
import copy
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sys
import zipfile
import io
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urljoin
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response, JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Persona data + auth now live in Postgres (see db.py / persona_store.py).
import auth_preflight
import auth_proxy
import db
import jwt_auth
import mcp_activity
import persona_store
import proposals_store
import scopes
import sections
import settings_store
import waitlist_store

# StaticFiles types a response from `mimetypes.guess_type`, and Python 3.11's
# built-in table has no `.webp`. The runtime image is slim enough to have no
# /etc/mime.types to fall back on either, so the landing page's gradients went
# out as `text/plain; charset=utf-8` -- and this app sends
# X-Content-Type-Options: nosniff, so a browser refuses to render them at all.
# Invisible artwork, 200 OK, nothing in any log.
#
# Registered here rather than fixed in the Dockerfile (by installing a mime
# database) so it holds wherever this runs, including a bare `uvicorn main:app`
# on a developer's machine. `vite dev` sets the type itself, which is why this
# never showed up until the image was run.
mimetypes.add_type("image/webp", ".webp")
from persona_store import VALID_FILES

# Aliases keep every existing route body -- read_json_file(file_type) /
# write_json_file(file_type, data) -- byte-for-byte unchanged.
read_json_file = persona_store.load
write_json_file = persona_store.save

# Import MCP server
import server
from server import mcp

# Scope enforcement for MCP tools. Added before http_app() so it is part of the
# app that gets mounted.
import mcp_scopes  # noqa: E402

# Guarded because `mcp` is a module-global in server.py and this module can be
# reloaded without it -- tests/test_oauth_metadata.py does exactly that to
# rebuild `app` under a different environment. `add_middleware` is a plain
# list append, so an unguarded call stacks a second, third, ... copy of the
# same middleware onto the one long-lived server: every tool listing then gets
# filtered N times and every refused call raises N times over. Harmless by
# luck, since both halves happen to be idempotent -- but it is accumulating
# state in a process that is supposed to be reset, and the next middleware
# added here may not be so forgiving.
if not any(isinstance(m, mcp_scopes.ScopeMiddleware) for m in mcp.middleware):
    mcp.add_middleware(mcp_scopes.ScopeMiddleware())

# Create MCP HTTP app. Default path is "/mcp" - FastMCP registers this as an
# exact route internally, so mounting the whole app at "/" below lets "/mcp"
# resolve directly (no trailing-slash redirect, unlike mounting at "/mcp" with
# an internal path of "/", which required a "/mcp/" -> would 307 on "/mcp").
mcp_app = mcp.http_app()


@contextlib.asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    """FastMCP's lifespan, plus the auth issuer check.

    Wrapped rather than replaced: `mcp_app.lifespan` is what starts the MCP
    session manager, and an app mounted without it accepts connections and then
    fails on the first tool call. The check hangs off the inside so it only
    runs once the rest of startup has succeeded.
    """
    async with mcp_app.lifespan(fastapi_app):
        auth_preflight.start()
        try:
            yield
        finally:
            auth_preflight.stop()


# Initialize FastAPI
# The interactive API docs move under /api: "/docs" now serves the public
# documentation site from the static mounts near the bottom of this file.
app = FastAPI(
    title="MyGist API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# Tables come from Alembic, applied as a deploy step (`alembic upgrade head`
# in the Dockerfile CMD) rather than here -- schema changes should not race
# application startup. What remains is the pgvector detection, which depends
# on the server's capabilities and EMBEDDING_DIM rather than on a version.
db.ensure_vector_schema()

# Endpoints that manage the account rather than the persona in it.
_ACCOUNT_PATHS = frozenset({"/api/auth/set-password", "/api/auth/tokens"})


def _resource_metadata_url() -> str:
    """The absolute URL of the protected-resource metadata document.

    RFC 9728 derives it by inserting the well-known path at the resource URI's
    origin; `urljoin` with an absolute path does exactly that, discarding
    MCP_RESOURCE's own path rather than string-concatenating a second copy of
    the origin. `oauth_metadata.protected_resource_metadata()`'s `resource` key
    is already absolute, so a relative value here would be inconsistent within
    the same feature -- and MCP clients commonly do `new URL(value)` on it,
    which throws on a relative reference.
    """
    return urljoin(jwt_auth.MCP_RESOURCE, "/.well-known/oauth-protected-resource/mcp")


def _challenge(error: str = "", scope: str = "") -> str:
    """An RFC 6750 Bearer challenge naming where to find the metadata.

    Only sent on /mcp, and only once OAuth is actually configured -- see the
    call sites' `jwt_auth.mcp_resource_configured()` guard. The SPA has always
    received a plain JSON 401 from /api and its fetch path is written against
    that; adding a challenge there would be a change nobody asked for.
    """
    parts = []
    if error:
        parts.append(f'error="{error}"')
    if scope:
        parts.append(f'scope="{scope}"')
    parts.append(f'resource_metadata="{_resource_metadata_url()}"')
    return "Bearer " + ", ".join(parts)


def _unauthorized(is_mcp: bool) -> JSONResponse:
    # A deployment without OAuth configured must behave exactly as it did
    # before OAuth existed: oauth_metadata.register() never mounts the four
    # discovery routes when jwt_auth.MCP_RESOURCE is unset, so a client sent a
    # resource_metadata URL here would follow it to a 404. Gating on
    # mcp_resource_configured() keeps the plain 401 that predates this feature.
    send_challenge = is_mcp and jwt_auth.mcp_resource_configured()
    headers = (
        {"WWW-Authenticate": _challenge(scope=" ".join(scopes.ALL_SCOPES))}
        if send_challenge
        else None
    )
    return JSONResponse({"error": "Unauthorized"}, status_code=401, headers=headers)


def _insufficient_scope(is_mcp: bool, required: str) -> JSONResponse:
    send_challenge = is_mcp and jwt_auth.mcp_resource_configured()
    headers = (
        {"WWW-Authenticate": _challenge(error="insufficient_scope", scope=required)}
        if send_challenge
        else None
    )
    return JSONResponse({"error": "Forbidden"}, status_code=403, headers=headers)


def _oauth_scopes(claims: dict) -> frozenset:
    """The scopes an OAuth access token's `scope` claim grants.

    Better Auth emits a space-delimited string, per RFC 8693 -- but this claim
    rides in on a token an outside authorization server signed, so a value
    that is not a string (an array, say) must not raise `AttributeError` out
    of the middleware and surface as a 500. Anything other than a string or a
    list of strings is treated as no scopes rather than guessed at.
    """
    claim = claims.get("scope", "")
    if isinstance(claim, str):
        parts = claim.split()
    elif isinstance(claim, list):
        # Element by element, not the list wholesale: `["x"]` inside the list
        # is unhashable and would raise TypeError out of scopes.expand's set
        # update -- a 500 from the auth middleware, on a value an outside
        # authorization server chose.
        parts = [item for item in claim if isinstance(item, str)]
    else:
        parts = []
    return scopes.expand(parts)


# Bearer auth middleware for /mcp and /api routes
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Public routes (no auth required). The interactive API docs are listed
    # explicitly: they used to live at /docs, outside this middleware's reach,
    # and moving them under /api to free up /docs for the documentation site
    # would otherwise have quietly put them behind a token.
    if path in (
        # /healthz was listed here too and no route ever served it, so it was
        # a public exemption for a 404. Add it back to health_check's decorators
        # if something ever needs that spelling.
        "/health",
        "/api/health",
        "/api/auth/register",
        "/api/auth/login",
        "/api/docs",
        "/api/docs/oauth2-redirect",
        "/api/redoc",
        "/api/openapi.json",
        # Read before anyone has a credential, because it decides which sign-in
        # screen to show. Carries no user data.
        "/api/instance",
        # Left by someone who has no account and is asking for one. Requiring a
        # credential here would mean only existing users could join a waitlist.
        "/api/waitlist",
        # OAuth discovery. Read before the client has any credential at all --
        # that is the entire point of them.
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/auth",
    ):
        return await call_next(request)

    # Protected routes: /mcp/* and /api/* -- resolve the bearer credential to a
    # user, scope the request to them, and record what the credential may do.
    if path.startswith("/mcp") or path.startswith("/api"):
        is_mcp = path.startswith("/mcp")
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return _unauthorized(is_mcp)

        # Three kinds of bearer credential, told apart by shape and then by
        # audience. The opaque tokens come from secrets.token_urlsafe, whose
        # alphabet has no dot, so a JWS is unmistakable; among JWSs, the
        # audience says which surface the token was issued for. A session JWT
        # names the auth service and an OAuth access token names /mcp, so
        # neither can ever be presented where the other belongs.
        credential = auth[7:]
        granted: frozenset = frozenset()
        kind = "token"

        if jwt_auth.looks_like_jwt(credential):
            claims = jwt_auth.verify_access_token(credential)
            if claims:
                kind = "oauth"
                granted = _oauth_scopes(claims)
            else:
                claims = jwt_auth.verify(credential)
                kind = "session"
                # A browser session is the account holder in person. Scoping it
                # would be scoping the owner against themselves.
                granted = scopes.expand(scopes.ALL_SCOPES)
            user = db.resolve_user_by_id(claims["sub"]) if claims else None
        else:
            user = db.resolve_token(credential)
            granted = scopes.expand(user["scopes"]) if user else frozenset()

        if not user:
            return _unauthorized(is_mcp)

        # Each JWT is valid on exactly one surface, and both halves have to be
        # written down. The audience claim already says so -- an access token
        # names /mcp, a session JWT names the auth service -- but a token that
        # fails one check simply falls through to the other verifier above, so
        # without these two lines the *failure* is what selects the surface.
        #
        # An OAuth access token is valid on /mcp and nowhere else:
        if kind == "oauth" and not is_mcp:
            return _unauthorized(is_mcp)

        # and a session JWT is valid on /api and nowhere else. Not a
        # cross-user leak -- it is the same person either way -- but MCP
        # requires a resource server to prove a token was issued for it
        # specifically, and a credential minted for the browser was not.
        # Letting it through would also route around consent entirely:
        # anything holding a session JWT would reach /mcp with every tool
        # visible, having agreed to nothing.
        if kind == "session" and is_mcp:
            return _unauthorized(is_mcp)

        if not granted:
            return _insufficient_scope(is_mcp, scopes.READ)

        # Account management is not persona access. An OAuth-connected
        # application has no business changing a password or minting bearer
        # tokens, whatever its scope -- and a read-only token that can mint a
        # full one is not read-only. Requiring persona:write rather than a
        # session keeps detached mode working, where a manually configured
        # token is the ONLY credential the SPA has.
        if path in _ACCOUNT_PATHS or path.startswith("/api/auth/tokens"):
            if kind == "oauth" or not scopes.has(granted, scopes.WRITE):
                return _insufficient_scope(is_mcp, scopes.WRITE)
        elif path.startswith("/api"):
            required = scopes.scope_for_method(request.method)
            if not scopes.has(granted, required):
                return _insufficient_scope(is_mcp, required)

        db.current_user_id.set(user["id"])
        scopes.current_scopes.set(granted)
        request.state.username = user["username"]
        request.state.credential_kind = kind

    return await call_next(request)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://mygist.thuradev.qzz.io",
        "http://localhost:1120",
        "http://chat.orb.local",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# The web UI is same-origin now, so CORS only covers local dev and external
# clients. Compression is ours to do: Cloudflare compresses at the edge, but
# a request that reaches the origin directly would otherwise be uncompressed.
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ============================================================================
# Security headers
# ============================================================================
# Reduces the chance of an XSS bug existing at all, which is the cheaper half
# of the problem an httpOnly session cookie would address after the fact.

# Matches <script> elements with no src attribute, i.e. inline ones.
_INLINE_SCRIPT_RE = re.compile(r"<script(?![^>]*\ssrc=)[^>]*>(.*?)</script>", re.S | re.I)


def _inline_script_hashes(static_dir: Path) -> list[str]:
    """CSP source expressions for every inline script we serve.

    Computed from the built HTML at startup rather than hardcoded. index.html
    carries a deliberate inline script that applies the saved theme before
    first paint -- hardcoding its hash would mean a silent theme regression
    the day someone edits it, because CSP would block the script while the
    page still rendered. Scanning covers the docs site too, whose generated
    pages ship their own inline scripts.

    A hash is what makes this CSP worth having: 'unsafe-inline' on script-src
    would permit exactly the injection the policy exists to stop.
    """
    if not static_dir.is_dir():
        return []
    hashes: set[str] = set()
    for path in sorted(static_dir.rglob("*.html")):
        try:
            html = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for body in _INLINE_SCRIPT_RE.findall(html):
            digest = hashlib.sha256(body.encode("utf-8")).digest()
            hashes.add(f"'sha256-{base64.b64encode(digest).decode()}'")
    return sorted(hashes)


def _build_csp(static_dir: Path) -> str:
    script_src = " ".join(["'self'", *_inline_script_hashes(static_dir)])
    return "; ".join([
        "default-src 'self'",
        f"script-src {script_src}",
        # Tailwind and Radix set element styles at runtime, and the Google
        # Fonts <link> is a stylesheet from that origin.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        # Not 'self': the connection settings let someone point this UI at a
        # different MyGist server, so the browser must be allowed to reach
        # other hosts. Restricted to https so it cannot be downgraded.
        "connect-src 'self' https:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


STATIC_DIR = Path(__file__).parent / "static"
CONTENT_SECURITY_POLICY = _build_csp(STATIC_DIR)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Applied to every response, including the auth middleware's 401s.

    Registered last, so it is the outermost layer and sees responses the
    inner middleware short-circuits.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    # CSP only governs documents; sending it on JSON is noise.
    if response.headers.get("content-type", "").startswith("text/html"):
        response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
    return response

class FileUpdate(BaseModel):
    """Request body for updating a file."""
    data: Dict[str, Any]


# ============================================================================
# API Routes
# ============================================================================

@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Health check endpoint for container orchestration.

    Both paths, one handler, deliberately. There used to be a second bare
    `@app.get("/health")` defined earlier in this file, and because FastAPI
    keeps the first route it matches, that one won: `/health` answered
    `{"status": "ok"}` while `/api/health` answered the same thing plus
    `"service"`. Two probes, two different bodies, and the `/health` registered
    here was unreachable. Both Dockerfiles probe `/health`, so the shorter body
    is what container orchestration actually saw.
    """
    return {"status": "ok", "service": "mygist"}


# ============================================================================
# Auth: register, login, whoami, set-password, token management
# ============================================================================

MIN_PASSWORD_LENGTH = 8


def validate_new_password(password: str) -> None:
    """Shared length rules for any password being set (register/set-password).
    Login deliberately skips this: oversized passwords there are treated as an
    ordinary failed login (see db.verify_password) to avoid an oracle."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    if len(password.encode("utf-8")) > db.MAX_PASSWORD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"password must be at most {db.MAX_PASSWORD_BYTES} bytes",
        )


class RegisterRequest(BaseModel):
    username: str
    password: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class SetPasswordRequest(BaseModel):
    password: str
    current_password: Optional[str] = None


class CreateTokenRequest(BaseModel):
    label: str = "token"
    # Optional scope choice for the minted token, matching the consent
    # screen's vocabulary (persona:read/propose/write). None means every
    # scope, preserving a token's historical default. Anything outside
    # scopes.ALL_SCOPES is dropped rather than rejected -- a client sending
    # an unrecognised value gets a token as narrow as what it did ask for
    # that we understand, not a 400 over a scope we might add tomorrow.
    scopes: Optional[list[str]] = None


def invite_only() -> bool:
    """Whether this instance is running as a closed test.

    Read in one place so a feature-flag system later replaces this function
    rather than every call site. The auth service reads the same variable and
    owns the rule itself -- see auth/src/invite.js. Nothing here ever validates
    a code, which is the point: one rule, in one language.
    """
    return os.getenv("INVITE_ONLY", "").lower() == "true"


def sso_configured() -> bool:
    """Whether this instance federates sign-in to an identity provider.

    Read from the same AUTH_OIDC_DISCOVERY_URL the auth service gates its whole
    SSO surface on -- the "set it on both containers" rule AUTH_MCP_RESOURCE
    already teaches. This container never sees the client secret: all it does
    with the value is answer this question.

    Blank counts as unset. A variable declared in compose and left empty is the
    default state, not an opt-in.
    """
    return bool(os.getenv("AUTH_OIDC_DISCOVERY_URL", "").strip())


def build_commit() -> str:
    """The commit this image was built from, or "dev" when nothing stamped it.

    Both names are accepted because both are in use: APP_COMMIT is what the
    Dockerfile declares, SOURCE_COMMIT is what Coolify injects. The frontend's
    version label already reads the same pair at build time; this is the same
    answer for anyone who cannot open the UI.
    """
    return os.getenv("APP_COMMIT") or os.getenv("SOURCE_COMMIT") or "dev"


@app.get("/api/instance")
async def instance():
    """What this instance is like, before anyone has a credential.

    Deliberately says nothing about who is signed in or what exists here -- it
    is read by strangers by definition, since it decides which screen a stranger
    is shown.

    `mcp_oauth` says whether an AI client can connect by SIGNING IN rather than
    by being handed a token. It is not a preference: `oauth_metadata.register()`
    mounts no discovery routes when AUTH_MCP_RESOURCE is unset, so on an
    instance without it a client following that path reaches a 404. Onboarding
    reads this to decide which connection method to recommend, because
    recommending the one that cannot work here would be worse than recommending
    neither.

    `sso` says whether sign-in is federated to an identity provider. The SPA
    reads it to decide whether to lead with a redirect button or with the
    password form, and it is the one field on this endpoint that changes what a
    stranger is asked for rather than merely what they are told.

    `commit` is the build stamp, so "is this deploy live" costs one GET rather
    than a token and a handshake.
    """
    return {
        "invite_only": invite_only(),
        "mcp_oauth": jwt_auth.mcp_resource_configured(),
        "sso": sso_configured(),
        "commit": build_commit(),
    }


class WaitlistRequest(BaseModel):
    email: str


@app.post("/api/waitlist")
async def join_waitlist(body: WaitlistRequest):
    """Leave an address while the instance is invite-only.

    Public, because the person has no account -- that is what they are asking
    for. It is therefore the one write a stranger can reach, so it validates
    its own input rather than trusting an authenticated caller.

    The response does not distinguish a new address from one already on the
    list. Both get the same 200 and the same body. Saying "you are already on
    the list" would confirm an address to whoever typed it, which turns the
    form into a membership oracle for the price of one request.
    """
    try:
        waitlist_store.join(body.email)
    except waitlist_store.InvalidEmailError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"ok": True}


@app.post("/api/auth/register", deprecated=True)
async def register(body: RegisterRequest):
    """DEPRECATED. Same-origin sign-up goes through Better Auth at /auth.

    Kept because it is still required, not merely tolerated: a UI pointed at
    someone else's server cannot use a cross-site session cookie, so detached
    mode authenticates here. Removing it would break that, and would also lock
    out any client that scripted registration against this endpoint.
    """
    # Closed outright when this instance federates sign-in. This mints a MyGist
    # password; on an SSO instance the identity provider owns credentials, and a
    # second place to create one is a second place to attack.
    if sso_configured():
        raise HTTPException(
            status_code=403,
            detail="this instance uses single sign-on; sign in through its web app",
        )

    # The other door. Better Auth's sign-up is gated by an invite code; this is
    # the one detached mode uses, and a gate on one door is not a gate.
    #
    # Locked rather than taught the rule. Duplicating "is this code valid" in a
    # second language is precisely how two halves drift apart, and detached
    # self-serve registration against a closed test instance is not something
    # anyone is doing. Self-hosters run with the mode off and never see this.
    if invite_only():
        raise HTTPException(
            status_code=403,
            detail="this instance is invite-only; sign up through its web app",
        )

    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if body.password is not None:
        validate_new_password(body.password)
    try:
        user_id, token = db.create_user(username, body.password)
    except db.DuplicateUsernameError:
        raise HTTPException(status_code=409, detail="username already taken")
    return {"user_id": user_id, "username": username, "token": token}


@app.post("/api/auth/login", deprecated=True)
async def login(body: LoginRequest):
    """DEPRECATED. Same-origin sign-in goes through Better Auth at /auth.

    Still the only route that works for detached mode -- see register above.
    The token it mints stays valid, and resolveCredential in the SPA prefers a
    stored token over a session, so an account signed in this way keeps working
    until its token expires.
    """
    # Before the rate limiter and before the password check, so the refusal
    # costs no attempt slot and reveals nothing about whether the account
    # exists. This is a second password path -- it verifies a bcrypt hash in
    # Python and mints an opaque token, reachable by curl whatever the SPA
    # renders -- so hiding the form would not have closed it.
    #
    # Detached and CLI users sign in through the provider in a browser and mint
    # a token from Account -> API tokens, which already exists.
    if sso_configured():
        raise HTTPException(
            status_code=403,
            detail="this instance uses single sign-on; sign in through its web app",
        )

    # Rate limit before checking credentials. The counter is keyed on the
    # submitted username whether or not it exists, so a 429 says nothing about
    # whether the account is real -- see db.login_retry_after.
    retry_after = db.login_retry_after(body.username)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="too many sign-in attempts, try again later",
            headers={"Retry-After": str(retry_after)},
        )

    try:
        user = db.verify_password(body.username, body.password)
    except db.PasswordNotSetError:
        db.record_failed_login(body.username)
        raise HTTPException(
            status_code=401, detail="password sign-in not set up for this account"
        )
    if user is None:
        # Same body for unknown username and wrong password: never reveal
        # whether the account exists.
        db.record_failed_login(body.username)
        raise HTTPException(status_code=401, detail="invalid username or password")
    # A correct password clears the counter, so a user who mistypes a few times
    # and then succeeds is not left throttled.
    db.clear_login_attempts(body.username)
    # A sign-in mints a browser session, so it expires. Machine credentials --
    # the registration token, and anything created from Account -> API tokens --
    # stay non-expiring; see db.SESSION_TOKEN_DAYS.
    _, token = db.create_token(
        user["id"], "web", expires_in_days=db.SESSION_TOKEN_DAYS
    )
    return {"user_id": user["id"], "username": user["username"], "token": token}


@app.get("/api/auth/whoami")
async def whoami(request: Request):
    return {"user_id": db.current_user_id.get(), "username": request.state.username}


@app.get("/api/usage")
async def usage():
    """What each connected client has actually done, for this account.

    The answer to "is my assistant using MyGist at all", which until now could
    only be guessed at from the outside. `tools/list` is the row worth reading
    first: a client that has never fetched it is running on a cached tool
    schema, and no deploy will reach it.

    Counters only -- method names, tool names, the client's own label. Nothing
    from arguments and no persona content, which is why this needs no scope
    beyond the read every other /api GET already requires.
    """
    return {"activity": mcp_activity.usage(db.current_user_id.get())}


@app.post("/api/auth/set-password")
async def set_password(body: SetPasswordRequest):
    validate_new_password(body.password)
    try:
        db.set_password(db.current_user_id.get(), body.password, body.current_password)
    except db.InvalidCredentialsError:
        raise HTTPException(status_code=403, detail="current password is incorrect")
    return {"status": "ok"}


@app.get("/api/auth/tokens")
async def list_tokens():
    return {"tokens": db.list_tokens(db.current_user_id.get())}


@app.post("/api/auth/tokens")
async def create_token(body: CreateTokenRequest):
    label = body.label.strip() or "token"
    token_scopes = (
        [s for s in body.scopes if s in scopes.ALL_SCOPES] if body.scopes is not None else None
    )
    token_id, token = db.create_token(
        db.current_user_id.get(), label, token_scopes=token_scopes
    )
    return {"id": token_id, "label": label, "token": token}


@app.delete("/api/auth/tokens/{token_id}")
async def revoke_token(token_id: str):
    if not db.revoke_token(db.current_user_id.get(), token_id):
        raise HTTPException(status_code=404, detail="token not found")
    return {"status": "revoked"}


@app.get("/api/files")
async def list_files():
    """List persona file types and whether the current user has data for them."""
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select file_type from persona_data where user_id = %s", (user_id,)
        ).fetchall()
    existing = {row["file_type"] for row in rows}
    return {"files": {ft: {"exists": ft in existing} for ft in VALID_FILES}}


@app.get("/api/files/{file_type}")
async def get_file(file_type: str):
    """Get the contents of a specific persona file."""
    data = read_json_file(file_type)
    return {"file_type": file_type, "data": data}


@app.put("/api/files/{file_type}")
async def update_file(file_type: str, update: FileUpdate):
    """Update a specific persona file."""
    if file_type not in VALID_FILES:
        raise HTTPException(status_code=400, detail=f"Unknown file type: {file_type}")
    write_json_file(file_type, update.data)
    return {"status": "saved", "file_type": file_type}


class SettingsUpdate(BaseModel):
    disabled_sections: list[str]
    enabled_sections: Optional[list[str]] = None
    # Omitted means "not my business", not "clear it". Every existing caller
    # sends only disabled_sections, and none of them may wipe onboarding
    # progress as a side effect of toggling a section.
    onboarding: Optional[dict] = None


@app.get("/api/settings")
async def get_settings():
    enabled = settings_store.enabled_sections()
    return {
        "disabled_sections": sorted(settings_store.get_disabled_sections()),
        "enabled_sections": sorted(settings_store.get_enabled_optins()),
        "toggleable": sorted(sections.toggleable_sections()),
        "always_on": sorted(sections.ALWAYS_ON_SECTIONS),
        "onboarding": settings_store.get_onboarding(),
        "packs": [
            {
                "key": key,
                "title": meta["title"],
                "description": meta["description"],
                "core": meta["core"],
                "default_enabled": meta["default_enabled"],
                "sections": meta["sections"],
                "entities": meta["entities"],
                "enabled": key in enabled,
            }
            for key, meta in sections.PACK_META.items()
        ],
    }


@app.put("/api/settings")
async def update_settings(update: SettingsUpdate):
    requested = set(update.disabled_sections)
    invalid = requested - sections.toggleable_sections()
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot disable: {sorted(invalid)}. "
                   f"Toggleable: {sorted(sections.toggleable_sections())}",
        )
    settings_store.set_disabled_sections(sorted(requested))
    if update.enabled_sections is not None:
        default_off = {k for k, on in sections.DEFAULT_ENABLED.items() if not on}
        bad_optins = set(update.enabled_sections) - default_off
        if bad_optins:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot opt into: {sorted(bad_optins)}. "
                       f"Opt-in packs: {sorted(default_off)}",
            )
        settings_store.set_enabled_optins(sorted(set(update.enabled_sections)))
    if update.onboarding is not None:
        steps = update.onboarding.get("steps") or {}
        if not isinstance(steps, dict):
            raise HTTPException(status_code=400, detail="onboarding.steps must be an object")
        bad_steps = set(steps) - settings_store.ONBOARDING_STEP_KEYS
        if bad_steps:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown onboarding steps: {sorted(bad_steps)}. "
                       f"Storable: {sorted(settings_store.ONBOARDING_STEP_KEYS)}",
            )
        bad_statuses = set(steps.values()) - settings_store.ONBOARDING_STATUSES
        if bad_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown onboarding statuses: {sorted(bad_statuses)}. "
                       f"Valid: {sorted(settings_store.ONBOARDING_STATUSES)}",
            )
        settings_store.set_onboarding(update.onboarding)
    return {"status": "saved", "disabled_sections": sorted(requested),
            "enabled_sections": sorted(settings_store.get_enabled_optins()),
            "onboarding": settings_store.get_onboarding()}


@app.get("/api/all")
async def get_all_files():
    """Get all persona files in one request."""
    all_data = {}
    for file_type in VALID_FILES:
        all_data[file_type] = read_json_file(file_type)
    return {"data": all_data}


@app.put("/api/all")
async def update_all_files(updates: Dict[str, Dict[str, Any]]):
    """Update multiple persona files at once."""
    saved = []
    for file_type, data in updates.items():
        if file_type in VALID_FILES:
            write_json_file(file_type, data)
            saved.append(file_type)
    return {"status": "saved", "files": saved}


@app.post("/api/reset/{file_type}")
async def reset_file(file_type: str):
    """Reset a file to its default state."""
    if file_type not in sections.SECTION_REGISTRY:
        raise HTTPException(status_code=400, detail=f"No default for: {file_type}")
    write_json_file(file_type, copy.deepcopy(sections.SECTION_REGISTRY[file_type].default))
    return {"status": "reset", "file_type": file_type}


# ============================================================================
# Backup & Restore
# ============================================================================

@app.get("/api/export")
async def export_data():
    """Export the current user's MyGist data as a downloadable zip file."""
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        file_names = []
        for file_type in VALID_FILES:
            data = persona_store.load(file_type)
            name = f"{file_type}.json"
            zf.writestr(name, json.dumps(data, indent=2))
            file_names.append(name)
        metadata = {
            "exported_at": datetime.now().isoformat(),
            "version": "2.0.0",
            "files": file_names,
        }
        zf.writestr("_metadata.json", json.dumps(metadata, indent=2))

    zip_buffer.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"mygist_backup_{timestamp}.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def deep_merge(existing: dict, incoming: dict) -> dict:
    """Deep merge two dicts. Arrays are concatenated (with dedup for objects with 'id')."""
    result = existing.copy()
    
    for key, incoming_val in incoming.items():
        if key not in result:
            result[key] = incoming_val
        elif isinstance(result[key], dict) and isinstance(incoming_val, dict):
            result[key] = deep_merge(result[key], incoming_val)
        elif isinstance(result[key], list) and isinstance(incoming_val, list):
            # Merge arrays - dedupe by 'id' if objects have it
            existing_list = result[key]
            existing_ids = {item.get('id') for item in existing_list if isinstance(item, dict) and 'id' in item}
            
            for item in incoming_val:
                if isinstance(item, dict) and 'id' in item:
                    if item['id'] not in existing_ids:
                        existing_list.append(item)
                        existing_ids.add(item['id'])
                elif item not in existing_list:  # Simple values - avoid duplicates
                    existing_list.append(item)
            result[key] = existing_list
        else:
            # Scalar values - incoming overwrites
            result[key] = incoming_val
    
    return result


@app.post("/api/import")
async def import_data(file: UploadFile = File(...), mode: str = "replace"):
    """
    Import the current user's MyGist data from an uploaded zip file.

    mode: "replace" (default) - overwrites each file type
          "merge" - merges with existing data (arrays concatenated, objects merged)
    """
    if mode not in ("replace", "merge"):
        raise HTTPException(status_code=400, detail="Mode must be 'replace' or 'merge'")
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a .zip archive")

    zip_data = await file.read()
    try:
        zip_buffer = io.BytesIO(zip_data)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            # Security check: reject path-traversal names
            for name in zf.namelist():
                if not name.endswith(".json"):
                    continue
                if ".." in name or name.startswith("/"):
                    raise HTTPException(status_code=400, detail=f"Invalid filename: {name}")

            imported_files = []
            for name in zf.namelist():
                if not (name.endswith(".json") and not name.startswith("_")):
                    continue
                file_type = name[:-5]
                if file_type not in VALID_FILES:
                    continue
                incoming_data = json.loads(zf.read(name))
                if mode == "merge":
                    existing_data = persona_store.load(file_type)
                    incoming_data = deep_merge(existing_data, incoming_data)
                persona_store.save(file_type, incoming_data)
                imported_files.append(name)

            return {"status": "success", "mode": mode, "imported_files": imported_files}
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")


# ============================================================================
# The review queue: what agents proposed and the user has not resolved yet
# ============================================================================


class ResolveRequest(BaseModel):
    """Optional overrides supplied when resolving a proposal.

    `data` lets the user correct an entity proposal before approving it --
    agents get details slightly wrong often enough that edit-then-approve is
    the difference between a usable queue and an abandoned one.
    `entity` names the destination when promoting a note.
    """
    data: Optional[Dict[str, Any]] = None
    entity: Optional[str] = None


@app.get("/api/proposals")
async def list_proposals(kind: str = "entity"):
    """Pending proposals of one kind. Listing marks them seen, which is what
    protects a row from eviction."""
    if kind not in ("entity", "note"):
        raise HTTPException(status_code=400, detail="kind must be 'entity' or 'note'")
    return {"proposals": proposals_store.list_pending(kind)}


@app.get("/api/sweep")
async def sweep_status():
    """When the unattended sweep last ran, and what it found.

    A background process with no surface is one nobody can tell has silently
    stopped -- and this one's failure mode looks exactly like a persona with
    nothing wrong with it. `null` means it has never run here.
    """
    return {"last_sweep": settings_store.get_settings().get("last_sweep")}


@app.get("/api/history/{file_type}")
async def list_history(file_type: str):
    """Previous versions of one section, newest first.

    Deliberately REST-only, with no MCP tool alongside it: an agent that can
    revert can undo a rejection, and "anything you reject is never raised again"
    is a guarantee this product makes. History is a user affordance.
    """
    if file_type not in VALID_FILES:
        raise HTTPException(status_code=404, detail=f"{file_type} not found")
    return {"history": persona_store.history(file_type)}


@app.post("/api/history/{file_type}/revert/{history_id}")
async def revert_history(file_type: str, history_id: int):
    """Restore one section to a previous version.

    Itself reversible: the revert goes through persona_store.save(), so the
    version it replaces is snapshotted like any other write.
    """
    if file_type not in VALID_FILES:
        raise HTTPException(status_code=404, detail=f"{file_type} not found")
    if not persona_store.revert(file_type, history_id):
        raise HTTPException(status_code=404, detail="no such version")
    return {"status": "reverted", "section": file_type}


@app.get("/api/proposals/for/{entity_id}")
async def proposals_for_entity(entity_id: str):
    """Why is this in my persona?

    The resolved proposals that produced one entity, with the client that
    proposed it, its reasoning, and the user's own words as evidence. Answerable
    only because approve and promote now record the entity id rather than the
    entity type.
    """
    return {"proposals": proposals_store.for_entity(entity_id)}


@app.get("/api/proposals/count")
async def count_proposals():
    """How many proposals are waiting. Drives the sidebar dot, so it is polled
    from every tab -- and unlike listing, it does not mark anything seen."""
    return proposals_store.pending_counts()


def _written_entity_id() -> Optional[str]:
    """The entity id the write that just ran assigned, or None.

    Read from db.last_write, which persona_store.save() fills by diffing the
    section before and after -- so this works for every entity in every section
    without execute_modify's thirty branches having to return anything new.

    Only ever one id: an approve or a promote performs a single add. Anything
    else means the diff saw something this cannot attribute, and None is the
    honest answer.
    """
    added = (db.last_write.get() or {}).get("added") or []
    return added[0] if len(added) == 1 else None


def _load_pending(proposal_id: str) -> dict:
    try:
        proposal = proposals_store.get(proposal_id)
    except Exception:  # malformed uuid, etc -- indistinguishable from absent
        proposal = None
    if proposal is None or proposal["status"] != "pending":
        raise HTTPException(status_code=404, detail="proposal not found")
    return proposal


@app.post("/api/proposals/{proposal_id}/approve")
async def approve_proposal(proposal_id: str, body: Optional[ResolveRequest] = None):
    """Approve an entity proposal, writing it through the same path
    persona_modify uses so every existing validation and advisory applies."""
    proposal = _load_pending(proposal_id)
    if proposal["kind"] != "entity":
        raise HTTPException(status_code=400, detail="notes are promoted, not approved")

    data = (body.data if body and body.data else proposal["data"]) or {}
    result = server.execute_modify(proposal["action"], proposal["entity"], data)
    if result.startswith("❌"):
        raise HTTPException(status_code=400, detail=result)

    # The id, not the type. This is the only link back from a line in the
    # persona to the quote that justified it.
    proposals_store.resolve(proposal_id, "approved",
                            promoted_to=_written_entity_id())
    return {
        "status": "approved",
        "result": result,
        # Which section moved, so the UI can link the user straight to it.
        # Derived here rather than in the frontend: the entity -> section map
        # is manifest-owned and should have exactly one reader.
        "section": server._section_for_entity(proposal["entity"]),
    }


@app.post("/api/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: str):
    """Reject it. The row becomes a tombstone so no agent raises it again."""
    _load_pending(proposal_id)
    proposals_store.resolve(proposal_id, "rejected")
    # Nothing changed, so there is nothing for the UI to link to.
    return {"status": "rejected", "section": None}


@app.post("/api/proposals/{proposal_id}/promote")
async def promote_proposal(proposal_id: str, body: ResolveRequest):
    """Turn a note into typed data.

    Provenance is recorded on the ledger row regardless -- `promoted_to` says
    what the note became, and the row keeps the evidence and the client that
    proposed it. The agent-observation tag is applied on top wherever the
    target entity declares a `tags` field, which today is four of them.
    """
    proposal = _load_pending(proposal_id)
    if proposal["kind"] != "note":
        raise HTTPException(status_code=400, detail="only notes are promoted")
    if not body.entity or not body.data:
        raise HTTPException(status_code=400, detail="entity and data are required")

    entity = body.entity.lower()
    data = dict(body.data)
    section = server._section_for_entity(entity)
    spec = server.ENTITY_SCHEMA.get(section, {}).get(entity, {}) if section else {}
    if "tags" in set(spec.get("required", [])) | set(spec.get("optional", [])):
        tags = list(data.get("tags") or [])
        if "agent-observation" not in tags:
            tags.append("agent-observation")
        data["tags"] = tags

    result = server.execute_modify("add", entity, data)
    if result.startswith("❌"):
        raise HTTPException(status_code=400, detail=result)

    # Prefer the assigned id over the entity type: `project_c140959c` makes the
    # ledger reversible, where `project` only says what kind of thing it became.
    proposals_store.resolve(proposal_id, "promoted",
                            promoted_to=_written_entity_id() or entity)
    return {"status": "promoted", "result": result, "section": section}


# ============================================================================
# Static assets: the SPA, and the docs site once Phase 2 lands
# ============================================================================
# The root Dockerfile builds frontend/ and copies the result to backend/static
# (and docs-site/ to backend/static/docs). Neither exists in a plain source
# checkout, so every route here is conditional and backend-only development is
# unaffected. STATIC_DIR is defined above, where the CSP scans it for inline
# script hashes.


class ImmutableStaticFiles(StaticFiles):
    """StaticFiles that adds a one-year immutable cache header.

    Only ever mounted at /assets, whose filenames Vite content-hashes -- a
    new build produces new names, so a cached file can never go stale.
    index.html must never be served this way: it *names* the hashed files.
    """

    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def register_static_routes(app: FastAPI, static_dir: Path) -> bool:
    """Register the SPA and docs routes. Returns whether anything mounted.

    MUST be called before the MCP app is mounted at "/" below: FastAPI
    matches routes in registration order and a mount at "/" matches
    everything. The SPA has no client-side router, so only these concrete
    paths are needed -- no catch-all -- which is what lets the two coexist.
    """
    if not static_dir.is_dir():
        return False

    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", ImmutableStaticFiles(directory=assets_dir), name="assets")

    docs_dir = static_dir / "docs"
    if docs_dir.is_dir():
        # A mount at "/docs" serves everything UNDER /docs/ but does not match
        # the bare "/docs" itself -- that fell through to the MCP mount at "/"
        # and 404'd. StaticFiles issues its own 307 for sub-directories
        # ("/docs/use" -> "/docs/use/"), which is what made the gap easy to
        # miss: only the mount root was affected, and only without the slash.
        #
        # Every human-typed link is the bare form, and so is every link in the
        # README and the docs themselves, so this is the common case rather
        # than an edge one. Registered BEFORE the mount because FastAPI matches
        # in registration order.
        @app.get("/docs", include_in_schema=False)
        async def docs_index_redirect() -> Response:
            return RedirectResponse("/docs/", status_code=308)

        app.mount("/docs", StaticFiles(directory=docs_dir, html=True), name="docs")

    @app.get("/", include_in_schema=False)
    async def spa_index() -> Response:
        # The shell must not be cached: it names the hashed asset files.
        return FileResponse(
            static_dir / "index.html", headers={"Cache-Control": "no-cache"}
        )

    # OAuth redirect targets. Two named routes, deliberately not a catch-all:
    # the MCP app is mounted at "/" and matches everything, so a fallback would
    # need a hand-maintained exclusion list for /mcp, /api, /auth, /docs and
    # /.well-known. These are OAuth surface, not app navigation -- the app
    # itself stays on the hash router.
    @app.get("/sign-in", include_in_schema=False)
    @app.get("/consent", include_in_schema=False)
    async def spa_oauth_screens() -> Response:
        return FileResponse(
            static_dir / "index.html", headers={"Cache-Control": "no-cache"}
        )

    # Marketing-page artwork: the gradient edge strip and hero field.
    #
    # A mount rather than a route per file, unlike favicon.svg and logo.svg
    # below. Those two are a closed set; this is a directory that grows, and
    # the per-file alternative means remembering to add a route every time
    # something is added to it -- which is exactly how the first four of these
    # came to 404 in a built image while working perfectly under `vite dev`,
    # whose dev server serves the whole of public/ and so hides the problem.
    #
    # Plain StaticFiles, not ImmutableStaticFiles: these filenames are stable
    # rather than content-hashed, so immutable caching would pin a gradient
    # that had since been regenerated. ETag revalidation is the right trade.
    landing_dir = static_dir / "landing"
    if landing_dir.is_dir():
        app.mount("/landing", StaticFiles(directory=landing_dir), name="landing")

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon() -> Response:
        return FileResponse(static_dir / "favicon.svg")

    @app.get("/logo.svg", include_in_schema=False)
    async def logo() -> Response:
        return FileResponse(static_dir / "logo.svg")

    return True


STATIC_MOUNTED = register_static_routes(app, STATIC_DIR)

# /auth/* -> the Better Auth service, when one is configured. Registered here
# for the same reason the static routes are: the MCP app is mounted at "/"
# below and matches everything, so anything needing its own path must be
# registered before it. This is the trap that made a bare /docs 404 while
# /docs/ worked.
AUTH_PROXIED = auth_proxy.register(app)

# OAuth discovery, for MCP clients. Registered here for the same reason as the
# static and auth routes: the MCP app is mounted at "/" below and matches
# everything, so anything needing its own path must come first.
import oauth_metadata  # noqa: E402

OAUTH_METADATA_MOUNTED = oauth_metadata.register(app)


# ============================================================================
# Mount MCP app
# ============================================================================
# Mounted at root (not "/mcp") and registered last so the /api and /health
# routes above take precedence - the MCP app itself already owns the exact
# "/mcp" route internally.
app.mount("/", mcp_app)


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 1120))
    host = os.getenv("HOST", "127.0.0.1")
    
    print(f"Starting MyGist API...")
    print(f"Database: {'configured' if os.getenv('DATABASE_URL') else 'MISSING DATABASE_URL'}")
    print(f"Server: http://{host}:{port}")
    
    uvicorn.run(app, host=host, port=port)
