"""An OAuth access token is not a session JWT, and the difference is the
audience. These tests pin that they can never be mistaken for each other."""

import jwt as pyjwt
import pytest

import jwt_auth

SECRET = "test-secret-not-used-in-production"
ISSUER = "https://mygist.example/auth"
MCP_RESOURCE = "https://mygist.example/mcp"


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setattr(jwt_auth, "JWKS_URL", "https://mygist.example/auth/jwks")
    monkeypatch.setattr(jwt_auth, "ISSUER", ISSUER)
    # What a session JWT's aud must be, set the way production sets it (it
    # defaults to the issuer). Only `verify` reads it -- but without it that
    # function would reject everything for want of configuration, and a test
    # asserting it rejects an MCP-audience token would prove nothing.
    monkeypatch.setattr(jwt_auth, "AUDIENCE", ISSUER)
    monkeypatch.setattr(jwt_auth, "MCP_RESOURCE", MCP_RESOURCE)
    monkeypatch.setattr(jwt_auth, "ALGORITHMS", ["HS256"])

    class _Key:
        key = SECRET

    monkeypatch.setattr(jwt_auth, "_signing_key_for", lambda token: _Key())
    jwt_auth.reset_cache()


def _token(**overrides):
    claims = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "aud": MCP_RESOURCE,
        "iss": ISSUER,
        "scope": "persona:read persona:write",
        "azp": "client-abc",
        "exp": 9999999999,
        "iat": 1,
    }
    claims.update(overrides)
    return pyjwt.encode(claims, SECRET, algorithm="HS256")


def test_accepts_a_token_bound_to_the_mcp_resource():
    claims = jwt_auth.verify_access_token(_token())
    assert claims["sub"] == "11111111-1111-1111-1111-111111111111"
    assert claims["scope"] == "persona:read persona:write"


def test_accepts_an_audience_array():
    """openid makes Better Auth append the userinfo endpoint to aud."""
    token = _token(aud=[MCP_RESOURCE, f"{ISSUER}/oauth2/userinfo"])
    assert jwt_auth.verify_access_token(token) is not None


def test_rejects_a_session_jwt():
    """aud is the auth base, not the MCP resource. Must not drive MCP."""
    assert jwt_auth.verify_access_token(_token(aud=ISSUER)) is None


def test_verify_rejects_a_token_minted_for_the_mcp_resource():
    """The mirror of test_rejects_a_session_jwt, and the half that was missing.

    Both directions have to hold or the audience is not separating anything:
    the session verifier must refuse an OAuth access token just as firmly as
    the access-token verifier refuses a session JWT. The second assertion is
    what makes the first mean something -- without it, a fixture that had left
    `verify` unconfigured would pass by rejecting every token alike.
    """
    assert jwt_auth.verify(_token(aud=MCP_RESOURCE)) is None
    assert jwt_auth.verify(_token(aud=ISSUER)) is not None


def test_rejects_a_token_with_no_sub():
    """client_credentials mints these. There is no user to scope data to."""
    token = _token()
    payload = pyjwt.decode(token, SECRET, algorithms=["HS256"], audience=MCP_RESOURCE)
    payload.pop("sub")
    assert jwt_auth.verify_access_token(
        pyjwt.encode(payload, SECRET, algorithm="HS256")
    ) is None


def test_rejects_a_wrong_issuer():
    assert jwt_auth.verify_access_token(_token(iss="https://evil.example")) is None


def test_returns_none_rather_than_raising_on_garbage():
    assert jwt_auth.verify_access_token("not-a-jwt") is None


def test_inert_when_no_mcp_resource_is_configured(monkeypatch):
    monkeypatch.setattr(jwt_auth, "MCP_RESOURCE", "")
    assert jwt_auth.verify_access_token(_token()) is None
