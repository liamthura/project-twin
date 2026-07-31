"""Verification of Better Auth's JWTs.

Human sign-in is handled by the Better Auth service; machine clients keep using
the opaque bearer tokens in the `tokens` table. This module is only the
verifying half: it turns a JWT into a set of claims, or into None.

Three properties are deliberate.

**Inert until configured.** With AUTH_JWKS_URL unset, `verify` returns None for
everything and no network call is ever made. That is what lets the Node service
be introduced without changing behaviour for anyone -- the code ships first, the
service arrives later, and nothing in between is observable.

**Never raises into the middleware.** An invalid, expired or malformed token is
an ordinary event on a public endpoint, not an error condition. Every failure
path returns None, so the caller has exactly one thing to check.

**Verified locally.** Public keys come from the JWKS endpoint and are cached, so
authenticating a request costs no call to the Node service. That keeps the
Python side serving even while the auth service is restarting, and keeps auth
off the network path for latency.
"""

import logging
import os
from typing import Optional

import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

# Where to fetch signing keys, and what to require in the token. All three are
# set from the Better Auth service's own configuration; leaving the first unset
# disables JWT auth entirely.
JWKS_URL = os.getenv("AUTH_JWKS_URL", "")
ISSUER = os.getenv("AUTH_ISSUER", "")

# Falls back to the issuer, because Better Auth sets both to its base URL by
# default. Without this, leaving AUTH_AUDIENCE unset rejects EVERY token:
# Better Auth always emits an `aud` claim, and PyJWT raises InvalidAudienceError
# for a token carrying one when no audience is configured. The symptom is a bare
# 401 on every request with nothing naming the cause, which is a poor thing to
# hand someone in the middle of a deploy.
AUDIENCE = os.getenv("AUTH_AUDIENCE", "") or ISSUER

# Better Auth signs with EdDSA (Ed25519) by default. Pinning the accepted
# algorithms is not optional: a verifier that accepts whatever the token's
# header claims will accept "none", or an HMAC signed with the public key.
ALGORITHMS = ["EdDSA", "RS256", "ES256"]

# PyJWKClient caches keys and refetches on an unknown `kid`, which is what makes
# key rotation work without a restart. One client for the process lifetime; it
# is created lazily so that importing this module never touches the network.
_client: Optional[PyJWKClient] = None


def is_enabled() -> bool:
    """Whether JWT verification is configured at all."""
    return bool(JWKS_URL)


def _jwk_client() -> PyJWKClient:
    global _client
    if _client is None:
        _client = PyJWKClient(JWKS_URL, cache_keys=True)
    return _client


def reset_cache() -> None:
    """Drop the cached client. For tests, and for a key rotation that PyJWT's
    own `kid` miss does not catch."""
    global _client
    _client = None


def verify(token: str) -> Optional[dict]:
    """Return the token's claims, or None if it is not a valid JWT for us.

    None covers every rejection -- not configured, wrong shape, bad signature,
    expired, wrong issuer, unreachable JWKS. The caller cannot act differently
    on any of them, and distinguishing them in the response would leak whether
    a given token merely expired.
    """
    if not is_enabled() or not token:
        return None

    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            issuer=ISSUER or None,
            audience=AUDIENCE or None,
            # `sub` is the account id and the whole point of the token; a token
            # without one is unusable rather than merely unusual.
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError as exc:
        # Routine on a public endpoint: an expired tab, a stale token, someone
        # probing. Debug, not warning -- at warning this is a log flood and a
        # denial-of-service on your own disk.
        logger.debug("JWT rejected: %s", exc)
        return None
    except Exception as exc:
        # A JWKS fetch failure lands here. This one IS worth noticing: it means
        # the auth service is unreachable, and every human sign-in is failing
        # while MCP clients carry on working.
        logger.warning("JWT verification unavailable: %s", exc)
        return None


def looks_like_jwt(credential: str) -> bool:
    """Whether a bearer credential should be tried as a JWT.

    A JWS compact serialisation is exactly three dot-separated segments. The
    opaque tokens in the `tokens` table come from `secrets.token_urlsafe`, whose
    alphabet has no dot at all, so the two can never be confused -- no prefix
    scheme, no ambiguity, and no need to try both.
    """
    return credential.count(".") == 2
