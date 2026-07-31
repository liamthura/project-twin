"""What a credential may do, as opposed to who it is.

The escalation test is the one that matters: a read-only token that can mint a
full-scope token is not a read-only token."""

import asyncio
import re

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

import db
import jwt_auth
import main
import scopes

# Shared secret + issuer/resource for the OAuth-access-token and session-JWT
# tests. Mirrors tests/test_oauth_token_verify.py's pattern: monkeypatch
# jwt_auth's module-level configuration and its JWKS lookup so a token minted
# here verifies without any real JWKS endpoint.
OAUTH_SECRET = "test-secret-not-used-in-production"
OAUTH_ISSUER = "https://mygist.example/auth"
OAUTH_MCP_RESOURCE = "https://mygist.example/mcp"


def _client():
    return TestClient(main.app)


@pytest.fixture
def jwt_configured(monkeypatch):
    """Configure jwt_auth so both verify() (session JWTs, aud=ISSUER) and
    verify_access_token() (OAuth, aud=MCP_RESOURCE) accept tokens minted by
    _oauth_token / _session_token below."""
    monkeypatch.setattr(jwt_auth, "JWKS_URL", "https://mygist.example/auth/jwks")
    monkeypatch.setattr(jwt_auth, "ISSUER", OAUTH_ISSUER)
    monkeypatch.setattr(jwt_auth, "AUDIENCE", OAUTH_ISSUER)
    monkeypatch.setattr(jwt_auth, "MCP_RESOURCE", OAUTH_MCP_RESOURCE)
    monkeypatch.setattr(jwt_auth, "ALGORITHMS", ["HS256"])

    class _Key:
        key = OAUTH_SECRET

    monkeypatch.setattr(jwt_auth, "_signing_key_for", lambda token: _Key())
    jwt_auth.reset_cache()
    yield
    jwt_auth.reset_cache()


def _oauth_token(sub, scope="persona:read persona:write", **overrides):
    claims = {
        "sub": sub,
        "aud": OAUTH_MCP_RESOURCE,
        "iss": OAUTH_ISSUER,
        "scope": scope,
        "azp": "client-abc",
        "exp": 9999999999,
        "iat": 1,
    }
    claims.update(overrides)
    return pyjwt.encode(claims, OAUTH_SECRET, algorithm="HS256")


def _session_token(sub, **overrides):
    claims = {
        "sub": sub,
        "aud": OAUTH_ISSUER,
        "iss": OAUTH_ISSUER,
        "exp": 9999999999,
        "iat": 1,
    }
    claims.update(overrides)
    return pyjwt.encode(claims, OAUTH_SECRET, algorithm="HS256")


# ---------------------------------------------------------------------------
# The escalation hole, and ordinary scope enforcement
# ---------------------------------------------------------------------------


def test_a_read_only_token_can_read(as_user):
    _, token = db.create_token(
        db.current_user_id.get(), "ro", token_scopes=[scopes.READ]
    )
    res = _client().get("/api/files", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


def test_a_read_only_token_cannot_write(as_user):
    _, token = db.create_token(
        db.current_user_id.get(), "ro", token_scopes=[scopes.READ]
    )
    res = _client().put(
        "/api/settings",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_a_read_only_token_cannot_mint_a_token(as_user):
    """The escalation hole. Without this, scoping is decorative."""
    _, token = db.create_token(
        db.current_user_id.get(), "ro", token_scopes=[scopes.READ]
    )
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "escalated"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_a_full_token_can_still_mint_a_token(as_user):
    """Detached mode and pre-Better-Auth accounts both depend on this."""
    _, token = db.create_token(db.current_user_id.get(), "full")
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "second"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200


def test_a_read_only_token_is_refused_at_set_password(as_user):
    """Account management requires persona:write specifically, not just an
    authenticated credential."""
    _, token = db.create_token(
        db.current_user_id.get(), "ro", token_scopes=[scopes.READ]
    )
    res = _client().post(
        "/api/auth/set-password",
        json={"password": "newpassword1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_delete_token_requires_persona_write(as_user):
    uid = db.current_user_id.get()
    victim_id, _ = db.create_token(uid, "victim")
    _, ro_token = db.create_token(uid, "ro", token_scopes=[scopes.READ])

    res = _client().delete(
        f"/api/auth/tokens/{victim_id}",
        headers={"Authorization": f"Bearer {ro_token}"},
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# OAuth access tokens: /mcp only, never account endpoints, whatever the scope
# ---------------------------------------------------------------------------


def test_oauth_access_token_is_refused_on_api(as_user, jwt_configured):
    token = _oauth_token(db.current_user_id.get())
    res = _client().get("/api/files", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_oauth_access_token_is_refused_on_account_endpoints_regardless_of_scope(
    as_user, jwt_configured
):
    """Even a token scoped persona:write must not touch account management --
    the audience alone disqualifies it from /api entirely."""
    token = _oauth_token(db.current_user_id.get(), scope="persona:write")
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "escalated"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 401


def test_session_jwt_is_refused_on_mcp(as_user, jwt_configured):
    """The mirror of the /api refusal above, and the one that was missing.

    A session JWT fails verify_access_token on its audience and then falls
    through to verify(), which accepts it -- so without an explicit check the
    credential arrives at /mcp classified as a full-scope session, and `is_mcp`
    means no scope test fires afterwards. Same user, so nothing leaks between
    accounts; but MCP requires a resource server to prove a token was issued
    for it specifically, and a browser credential reaching /mcp with every tool
    visible is the consent model bypassed rather than enforced.
    """
    token = _session_token(db.current_user_id.get())
    res = _client().post("/mcp", headers={"Authorization": f"Bearer {token}"}, json={})
    assert res.status_code == 401


def test_session_jwt_is_still_accepted_on_api(as_user, jwt_configured):
    """The other half: refusing it on /mcp must not disturb the SPA, whose
    every request to /api carries exactly this credential."""
    token = _session_token(db.current_user_id.get())
    res = _client().get("/api/files", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


def test_session_jwt_is_treated_as_full_scope(as_user, jwt_configured):
    """The account holder in person, scoped against nobody -- including at an
    account-management endpoint that an opaque token would need persona:write
    for."""
    token = _session_token(db.current_user_id.get())
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "from-session"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200


# ---------------------------------------------------------------------------
# Finding 4: a malformed `scope` claim must not 500 the middleware
# ---------------------------------------------------------------------------


def test_oauth_scopes_accepts_a_list_valued_scope_claim():
    granted = main._oauth_scopes({"scope": ["persona:read", "persona:write"]})
    assert granted == scopes.expand(["persona:read", "persona:write"])


def test_oauth_scopes_treats_a_non_string_non_list_claim_as_no_scopes():
    assert main._oauth_scopes({"scope": 12345}) == frozenset()


def test_oauth_scopes_ignores_non_string_elements_inside_a_list_claim():
    """A nested list is unhashable, so passing the elements through untouched
    raised TypeError inside scopes.expand and surfaced as a 500 from the auth
    middleware -- on a value an outside authorization server chose."""
    assert main._oauth_scopes({"scope": [["x"]]}) == frozenset()
    assert main._oauth_scopes({"scope": ["persona:read", None, 7]}) == scopes.expand(
        ["persona:read"]
    )


def test_oauth_access_token_with_a_list_scope_claim_does_not_500(
    as_user, jwt_configured
):
    """Integration-level companion to the two unit tests above: drives the
    real middleware (bypassing the actual mcp_app/call_next, which needs a
    running lifespan TestClient doesn't start for a plain call) to prove the
    list-valued claim survives the full credential-resolution path intact."""
    token = _oauth_token(
        db.current_user_id.get(), scope=["persona:read", "persona:write"]
    )

    async def _run():
        from starlette.responses import PlainTextResponse

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/mcp",
            "headers": [(b"authorization", f"Bearer {token}".encode())],
            "query_string": b"",
        }
        request = Request(scope)

        async def call_next(_request):
            return PlainTextResponse("ok")

        response = await main.auth_middleware(request, call_next)
        assert response.status_code != 500
        assert scopes.current_scopes.get() == scopes.expand(
            ["persona:read", "persona:write"]
        )

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# WWW-Authenticate: only on /mcp, only when OAuth is configured, and absolute
# ---------------------------------------------------------------------------


def test_unauthenticated_mcp_gets_a_challenge_naming_the_metadata(
    as_user, jwt_configured
):
    res = _client().post("/mcp", json={})
    assert res.status_code == 401
    challenge = res.headers["www-authenticate"]
    assert "resource_metadata=" in challenge
    assert "persona:read" in challenge


def test_unauthenticated_api_gets_no_challenge_header(as_user):
    """The SPA's fetch path has always seen a plain 401 here; leave it alone."""
    res = _client().get("/api/files")
    assert res.status_code == 401
    assert "www-authenticate" not in {k.lower() for k in res.headers}


def test_unauthenticated_mcp_without_oauth_configured_gets_a_plain_401(as_user):
    """Finding 1: a deployment without OAuth configured must behave exactly as
    it always has. oauth_metadata.register() never mounts the discovery routes
    when jwt_auth.MCP_RESOURCE is unset (see oauth_metadata.py), so a client
    sent a resource_metadata URL here would follow it straight to a 404."""
    assert not jwt_auth.mcp_resource_configured()
    res = _client().post("/mcp", json={})
    assert res.status_code == 401
    assert "www-authenticate" not in {k.lower() for k in res.headers}


def test_resource_metadata_in_the_challenge_is_an_absolute_url(
    as_user, jwt_configured
):
    """Finding 2: RFC 9728 specifies a URL, and MCP clients commonly do `new
    URL(value)` on it, which throws on a relative reference."""
    res = _client().post("/mcp", json={})
    challenge = res.headers["www-authenticate"]
    match = re.search(r'resource_metadata="([^"]+)"', challenge)
    assert match, challenge
    url = match.group(1)
    assert url.startswith("https://") or url.startswith("http://")
    assert url == "https://mygist.example/.well-known/oauth-protected-resource/mcp"


# ---------------------------------------------------------------------------
# Finding 3: a rejected request must leave no trace in the scope contextvar
# ---------------------------------------------------------------------------


def test_current_scopes_is_not_set_after_a_rejected_request():
    """scopes.current_scopes has no default (see scopes.py) so that a code
    path reaching persona data without authenticating raises rather than
    quietly proceeding with an empty grant. Checked from inside the same
    asyncio task the middleware ran in -- TestClient's own request cycle runs
    each call in an isolated task, so a contextvar set there is invisible to
    the test function afterwards regardless of what the middleware does; the
    only way to observe the real behaviour is to call the middleware directly
    and check in the same task before that task ends.
    """

    async def _run():
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/files",
            "headers": [],
            "query_string": b"",
        }
        request = Request(scope)

        async def call_next(_request):
            raise AssertionError("call_next must not run for a rejected request")

        response = await main.auth_middleware(request, call_next)
        assert response.status_code == 401
        with pytest.raises(LookupError):
            scopes.current_scopes.get()

    asyncio.run(_run())
