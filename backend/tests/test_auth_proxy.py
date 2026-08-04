"""The /auth passthrough to the Better Auth service.

No Node service is started. httpx responses are constructed directly, because
what is being pinned is the header handling -- and header handling is where a
proxy quietly corrupts things rather than failing loudly.
"""
import gzip

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import auth_proxy

# Pure logic -- nothing here reads or writes a persona, so the per-test row
# wipe in conftest is dead weight. The marker only skips cleanup; it can
# never make a test wrong, only slower to forget.
pytestmark = pytest.mark.nodb


def upstream_response(headers, body=b"ok", status=200):
    return httpx.Response(
        status,
        headers=headers,
        content=body,
        request=httpx.Request("POST", "http://auth.internal/auth/sign-in/email"),
    )


# --- Set-Cookie, the one that fails quietly ---------------------------------


def test_every_set_cookie_survives():
    """A sign-in response carries several cookies. Anything treating headers as
    a mapping keeps one and drops the rest, which shows up much later as a
    session that half-works. This is the reason this module has its own tests."""
    upstream = upstream_response(
        [
            ("set-cookie", "session=abc; Path=/; HttpOnly; SameSite=Lax"),
            ("set-cookie", "csrf=xyz; Path=/; SameSite=Lax"),
            ("set-cookie", "remember=1; Path=/; Max-Age=2592000"),
            ("content-type", "application/json"),
        ]
    )

    cookies = [
        value
        for key, value in auth_proxy.build_response(upstream).raw_headers
        if key.decode().lower() == "set-cookie"
    ]

    assert len(cookies) == 3
    assert any(b"session=abc" in c for c in cookies)
    assert any(b"csrf=xyz" in c for c in cookies)
    assert any(b"remember=1" in c for c in cookies)


def test_cookie_attributes_are_not_rewritten():
    """HttpOnly and SameSite are the difference between a session cookie and a
    liability. The proxy must not normalise them."""
    upstream = upstream_response(
        [("set-cookie", "session=abc; Path=/; HttpOnly; Secure; SameSite=Lax")]
    )
    header = next(
        value
        for key, value in auth_proxy.build_response(upstream).raw_headers
        if key.decode().lower() == "set-cookie"
    )
    assert header == b"session=abc; Path=/; HttpOnly; Secure; SameSite=Lax"


# --- headers that must not be forwarded -------------------------------------


def test_stale_content_headers_are_dropped():
    """httpx decompresses the body, so upstream's content-encoding describes
    something no longer true and its content-length is the compressed size.
    Forwarding either yields a response the browser cannot parse.

    The body really is gzipped here: httpx decodes on access, so a fake
    content-encoding would only prove the test harness lies."""
    plain = b'{"ok":true}'
    compressed = gzip.compress(plain)
    upstream = upstream_response(
        [
            ("content-encoding", "gzip"),
            ("content-length", str(len(compressed))),
            ("content-type", "application/json"),
        ],
        body=compressed,
    )

    response = auth_proxy.build_response(upstream)
    keys = {key.decode().lower() for key, _ in response.raw_headers}

    assert "content-encoding" not in keys
    assert response.body == plain
    # The length of what we are actually sending, not the compressed length.
    assert response.headers["content-length"] == str(len(plain))
    assert len(plain) != len(compressed)


@pytest.mark.parametrize(
    "header", ["connection", "keep-alive", "transfer-encoding", "upgrade"]
)
def test_hop_by_hop_headers_are_dropped(header):
    upstream = upstream_response([(header, "something")])
    keys = {
        key.decode().lower() for key, _ in auth_proxy.build_response(upstream).raw_headers
    }
    assert header not in keys


def test_ordinary_headers_pass_through():
    upstream = upstream_response(
        [("content-type", "application/json"), ("x-better-auth", "1")]
    )
    response = auth_proxy.build_response(upstream)
    assert response.headers["content-type"] == "application/json"
    assert response.headers["x-better-auth"] == "1"


def test_status_and_body_pass_through():
    upstream = upstream_response([("location", "/dashboard")], body=b"", status=302)
    response = auth_proxy.build_response(upstream)
    assert response.status_code == 302
    assert response.headers["location"] == "/dashboard"


# --- registration is conditional --------------------------------------------


def test_not_registered_without_a_service_url(monkeypatch):
    """Phase 0 merges before the auth service exists. With nothing configured,
    /auth must not resolve at all rather than resolving to an error."""
    monkeypatch.setattr(auth_proxy, "SERVICE_URL", "")
    app = FastAPI()
    assert auth_proxy.register(app) is False
    assert not any(getattr(r, "path", "").startswith("/auth") for r in app.routes)


def test_registered_when_configured(monkeypatch):
    monkeypatch.setattr(auth_proxy, "SERVICE_URL", "http://auth.internal:3001")
    app = FastAPI()
    assert auth_proxy.register(app) is True
    assert any("/auth" in getattr(r, "path", "") for r in app.routes)


def test_unreachable_service_gives_503_not_500(monkeypatch):
    """An auth service that is down must degrade, not crash. Humans lose
    sign-in; MCP clients never touch this path and carry on."""
    monkeypatch.setattr(auth_proxy, "SERVICE_URL", "http://auth.internal:3001")
    app = FastAPI()
    auth_proxy.register(app)

    async def _fail(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx.AsyncClient, "request", _fail)

    response = TestClient(app, raise_server_exceptions=False).get("/auth/session")
    assert response.status_code == 503


# --- The jar, which is where a proxy leaks other people's sessions ----------


def test_the_client_keeps_no_cookies_of_its_own():
    """A shipped cross-user session leak, found by driving a real browser.

    httpx clients keep cookies by default, and this one is a process-wide
    singleton shared by every visitor. The auth service set a session cookie on
    sign-in, the jar stored it, and the proxy attached it to EVERY later
    request -- so an unauthenticated stranger calling /auth/token was handed a
    JWT belonging to whoever had signed in last.

    Asserted on the client rather than on the class, because the defect was the
    default and a future edit that drops the argument would restore it.
    """
    auth_proxy._client = None
    client = auth_proxy._http()

    request = httpx.Request("GET", "http://auth.internal/auth/token")
    client.cookies.set("better-auth.session_token", "somebody-elses-session")
    client.cookies.set_cookie_header(request)

    assert "cookie" not in {k.lower() for k in request.headers}

    auth_proxy._client = None


def test_a_set_cookie_from_upstream_is_never_remembered():
    """The other half: storing is what fills the jar in the first place."""
    auth_proxy._client = None
    client = auth_proxy._http()

    client.cookies.extract_cookies(
        upstream_response({"set-cookie": "better-auth.session_token=leaked; Path=/"})
    )

    assert len(list(client.cookies.jar)) == 0

    auth_proxy._client = None
