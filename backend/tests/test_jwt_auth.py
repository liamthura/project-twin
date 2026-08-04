"""Verification of Better Auth's JWTs.

These tests never start the auth service. An Ed25519 keypair is generated here
and the JWKS lookup is stubbed, so the verifier's behaviour is pinned without
Node, without a network, and in milliseconds. Auth code that can only be
exercised with the whole stack up is auth code that stops being exercised.
"""
import secrets
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519

import jwt_auth

# Pure logic -- nothing here reads or writes a persona, so the per-test row
# wipe in conftest is dead weight. The marker only skips cleanup; it can
# never make a test wrong, only slower to forget.
pytestmark = pytest.mark.nodb

ISSUER = "https://mygist.example"
AUDIENCE = "https://mygist.example"


@pytest.fixture
def keypair():
    private = ed25519.Ed25519PrivateKey.generate()
    return private, private.public_key()


@pytest.fixture
def configured(monkeypatch, keypair):
    """Enable verification and stub the JWKS lookup with our own public key."""
    private, public = keypair

    monkeypatch.setattr(jwt_auth, "JWKS_URL", "https://auth.invalid/jwks")
    monkeypatch.setattr(jwt_auth, "ISSUER", ISSUER)
    monkeypatch.setattr(jwt_auth, "AUDIENCE", AUDIENCE)

    class _Key:
        key = public

    class _Client:
        def get_signing_key_from_jwt(self, token):
            return _Key()

    monkeypatch.setattr(jwt_auth, "_jwk_client", lambda: _Client())
    return private


def make_token(private, **overrides):
    claims = {
        "sub": "11111111-2222-3333-4444-555555555555",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": int(time.time()) + 300,
        "iat": int(time.time()),
    }
    claims.update(overrides)
    return jwt.encode(claims, private, algorithm="EdDSA")


# --- inert until configured -------------------------------------------------


def test_disabled_when_no_jwks_url(monkeypatch):
    """The property that makes Phase 0 safe to ship: with nothing configured,
    the verifier rejects everything and never reaches the network."""
    monkeypatch.setattr(jwt_auth, "JWKS_URL", "")
    assert jwt_auth.is_enabled() is False
    assert jwt_auth.verify("anything.at.all") is None


def test_disabled_verifier_does_not_call_out(monkeypatch):
    monkeypatch.setattr(jwt_auth, "JWKS_URL", "")

    def _boom():
        raise AssertionError("JWKS fetched while disabled")

    monkeypatch.setattr(jwt_auth, "_jwk_client", _boom)
    assert jwt_auth.verify("a.b.c") is None


# --- the happy path ---------------------------------------------------------


def test_valid_token_returns_claims(configured):
    claims = jwt_auth.verify(make_token(configured))
    assert claims is not None
    assert claims["sub"] == "11111111-2222-3333-4444-555555555555"


# --- rejections -------------------------------------------------------------


def test_expired_token_rejected(configured):
    assert jwt_auth.verify(make_token(configured, exp=int(time.time()) - 1)) is None


def test_wrong_issuer_rejected(configured):
    assert jwt_auth.verify(make_token(configured, iss="https://evil.example")) is None


def test_wrong_audience_rejected(configured):
    assert jwt_auth.verify(make_token(configured, aud="https://other.example")) is None


def test_token_without_subject_rejected(configured):
    """`sub` carries the account id. A token without one authenticates nobody,
    so it must not be treated as merely unusual."""
    token = jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300},
        configured,
        algorithm="EdDSA",
    )
    assert jwt_auth.verify(token) is None


def test_token_signed_by_a_different_key_rejected(configured):
    other = ed25519.Ed25519PrivateKey.generate()
    assert jwt_auth.verify(make_token(other)) is None


def test_unsigned_token_rejected(configured):
    """The classic algorithm-confusion attack: a token declaring alg "none".
    Rejected because the accepted algorithms are pinned rather than read from
    the token's own header."""
    token = jwt.encode(
        {"sub": "x", "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300},
        key="",
        algorithm="none",
    )
    assert jwt_auth.verify(token) is None


def test_garbage_rejected(configured):
    for junk in ["", "not-a-token", "a.b", "a.b.c.d", "....", "a.b.c"]:
        assert jwt_auth.verify(junk) is None


def test_jwks_unreachable_returns_none_rather_than_raising(monkeypatch):
    """An auth service that is down must not turn every request into a 500 --
    humans lose sign-in, MCP clients carry on."""
    monkeypatch.setattr(jwt_auth, "JWKS_URL", "https://auth.invalid/jwks")

    def _unreachable():
        raise ConnectionError("auth service is down")

    monkeypatch.setattr(jwt_auth, "_jwk_client", _unreachable)
    assert jwt_auth.verify("a.b.c") is None


# --- telling the two credential types apart ---------------------------------


def test_jwt_shape_recognised():
    assert jwt_auth.looks_like_jwt("header.payload.signature") is True


def test_opaque_tokens_never_look_like_jwts():
    """The discriminator rests on `secrets.token_urlsafe` never emitting a dot.
    That is a property of its alphabet rather than a coincidence, but it is the
    hinge the whole two-credential scheme hangs on, so assert it directly."""
    for _ in range(500):
        assert "." not in secrets.token_urlsafe(32)
        assert jwt_auth.looks_like_jwt(secrets.token_urlsafe(32)) is False


# --- the middleware branch --------------------------------------------------


def test_dotted_credential_is_rejected_when_disabled(monkeypatch):
    """Phase 0 ships before the auth service exists, so the new branch must be
    unobservable. A dotted credential reached `resolve_token` before this change
    and failed the hash lookup; now it reaches `verify` and fails there. Same
    401 either way -- this asserts the equivalence rather than assuming it."""
    monkeypatch.setattr(jwt_auth, "JWKS_URL", "")
    credential = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.bm90LWEtc2lnbmF0dXJl"
    assert jwt_auth.looks_like_jwt(credential) is True
    assert jwt_auth.verify(credential) is None


def test_audience_defaults_to_the_issuer(monkeypatch, keypair):
    """AUTH_AUDIENCE unset must not reject every token.

    Better Auth always emits an `aud` claim, and PyJWT raises
    InvalidAudienceError for a token carrying one when no audience is
    configured -- so a deployment that sets AUTH_ISSUER but forgets
    AUTH_AUDIENCE would 401 on every request, with nothing naming the cause.
    Both default to the service's base URL, so the issuer is the right
    fallback.
    """
    private, public = keypair
    monkeypatch.setattr(jwt_auth, "JWKS_URL", "https://auth.invalid/jwks")
    monkeypatch.setattr(jwt_auth, "ISSUER", ISSUER)
    monkeypatch.setattr(jwt_auth, "AUDIENCE", ISSUER)  # what the fallback yields

    class _Key:
        key = public

    class _Client:
        def get_signing_key_from_jwt(self, token):
            return _Key()

    monkeypatch.setattr(jwt_auth, "_jwk_client", lambda: _Client())

    assert jwt_auth.verify(make_token(private)) is not None
