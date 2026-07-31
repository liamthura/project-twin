# OAuth for MCP Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an MCP client connect to MyGist by signing in and consenting, instead of pasting an opaque token into a config file.

**Architecture:** The Better Auth Node service becomes an OAuth 2.1 authorization server via `@better-auth/oauth-provider`. FastAPI stays the resource server: its existing bearer middleware gains a third branch for audience-bound OAuth access tokens, serves RFC 9728 protected-resource metadata, and proxies the root-level RFC 8414 authorization-server metadata. Opaque tokens are kept permanently and gain the same three scopes plus an `mg_` prefix.

**Tech Stack:** Better Auth 1.6.25 + `@better-auth/oauth-provider` (Node, ESM, no build step) · FastAPI + FastMCP 2.14.2 (Python) · Alembic · React 18 + Vite + Vitest · Postgres

**Spec:** `docs/superpowers/specs/2026-07-31-oauth-mcp-auth-design.md`

## Global Constraints

- **Scope names, exactly:** `persona:read`, `persona:propose`, `persona:write`. Hierarchical: `persona:write` ⊃ `persona:propose` ⊃ `persona:read`.
- **`persona:read` is the floor.** No grant and no token may exist without it.
- **Existing credentials must keep working.** Every existing `tokens` row grandfathers to all three scopes. Bare unprefixed tokens resolve forever.
- **New tokens carry the `mg_` prefix.** Lowercase, underscore.
- **Do NOT set `disabledPaths: ["/token"]`.** Verified: `@better-auth/oauth-provider` registers `/oauth2/token`, never a bare `/token`. The SPA's `/auth/token` (jwt plugin) must keep working — `session.js:187` depends on it.
- **`validAudiences` must include the MCP canonical URI** or every token request 400s.
- **Reject access tokens with no `sub`.** Do not enable the `client_credentials` grant.
- **`azp` is display/telemetry only, never an identity input.** Identity comes from `sub`.
- **Register every new FastAPI route BEFORE `app.mount("/", mcp_app)`** in `backend/main.py` — the mount matches everything.
- **No catch-all route, no client-side router change.** The SPA stays on its hash router (`frontend/src/lib/routes.js`).
- **Python:** run tests with `cd backend && pytest -q`. Test DB is already up on `localhost:5433`.
- **Node auth service:** `cd auth && npm test` (`node --test`).
- **Frontend:** `cd frontend && npm test` (vitest).
- **Run only the tests relevant to the task.** Full suites run in CI.

---

### Task 1: Scope vocabulary

**Files:**
- Create: `backend/scopes.py`
- Test: `backend/tests/test_scopes.py`

**Interfaces:**
- Consumes: nothing
- Produces: `scopes.READ`, `scopes.PROPOSE`, `scopes.WRITE`, `scopes.ALL_SCOPES: tuple[str, ...]`, `scopes.expand(granted: Iterable[str]) -> frozenset[str]`, `scopes.has(granted: Iterable[str], required: str) -> bool`, `scopes.TOOL_SCOPES: dict[str, str]`, `scopes.scope_for_method(method: str) -> str`, `scopes.current_scopes: ContextVar[frozenset[str]]`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scopes.py
import pytest

import scopes


def test_write_implies_propose_and_read():
    granted = scopes.expand([scopes.WRITE])
    assert granted == {scopes.WRITE, scopes.PROPOSE, scopes.READ}


def test_propose_implies_read_but_not_write():
    granted = scopes.expand([scopes.PROPOSE])
    assert granted == {scopes.PROPOSE, scopes.READ}
    assert not scopes.has(granted, scopes.WRITE)


def test_read_implies_only_itself():
    assert scopes.expand([scopes.READ]) == {scopes.READ}


def test_unknown_scopes_are_dropped():
    """openid and offline_access are granted by the AS but mean nothing here."""
    assert scopes.expand(["openid", "offline_access", scopes.READ]) == {scopes.READ}


def test_expand_handles_empty():
    assert scopes.expand([]) == frozenset()


def test_method_maps_get_to_read_and_everything_else_to_write():
    assert scopes.scope_for_method("GET") == scopes.READ
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert scopes.scope_for_method(method) == scopes.WRITE


def test_every_mcp_tool_has_a_scope():
    expected = {
        "get_context": scopes.READ,
        "get_raw": scopes.READ,
        "search_context": scopes.READ,
        "get_entity": scopes.READ,
        "get_schema": scopes.READ,
        "propose_update": scopes.PROPOSE,
        "persona_modify": scopes.WRITE,
        "persona_batch": scopes.WRITE,
    }
    assert scopes.TOOL_SCOPES == expected


def test_current_scopes_has_no_default():
    """Fail closed: an unauthenticated code path must raise, not pass."""
    with pytest.raises(LookupError):
        scopes.current_scopes.get()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_scopes.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scopes'`

- [ ] **Step 3: Write the implementation**

```python
# backend/scopes.py
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
    "propose_update": PROPOSE,
    "persona_modify": WRITE,
    "persona_batch": WRITE,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_scopes.py -q`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/scopes.py backend/tests/test_scopes.py
git commit -m "feat: the scope vocabulary, hierarchical and fail-closed"
```

---

### Task 2: Migration — OAuth tables and `tokens.scopes`

**Files:**
- Create: `backend/migrations/versions/0004_oauth_and_token_scopes.py`
- Test: `backend/tests/test_oauth_migration.py`

**Interfaces:**
- Consumes: `scopes.ALL_SCOPES` (Task 1)
- Produces: tables `better_auth."oauthClient"`, `better_auth."oauthAccessToken"`, `better_auth."oauthRefreshToken"`, `better_auth."oauthConsent"`; column `public.tokens.scopes text[] not null default`

Read `backend/migrations/versions/0003_better_auth_schema.py` first — it establishes the quoting and idempotency conventions this migration must match. Better Auth's column names are camelCase and **must** be double-quoted in Postgres.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_oauth_migration.py
"""The OAuth tables and tokens.scopes, and the grandfathering that protects
credentials already sitting in other people's config files."""

import db


def _columns(table, schema="public"):
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select column_name from information_schema.columns"
            " where table_schema = %s and table_name = %s",
            (schema, table),
        ).fetchall()
    return {row["column_name"] for row in rows}


def test_oauth_tables_exist_in_the_better_auth_schema():
    for table in ("oauthClient", "oauthAccessToken", "oauthRefreshToken", "oauthConsent"):
        assert _columns(table, "better_auth"), f"{table} missing"


def test_tokens_has_a_scopes_column():
    assert "scopes" in _columns("tokens")


def test_existing_rows_grandfather_to_every_scope(as_user):
    """A token minted before this migration must keep working unchanged."""
    import scopes as scopes_module

    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into tokens (user_id, token_hash, label) values (%s, %s, 'legacy')",
            (as_user, "legacy-hash-for-grandfathering-test"),
        )
        row = conn.execute(
            "select scopes from tokens where token_hash = %s",
            ("legacy-hash-for-grandfathering-test",),
        ).fetchone()

    assert set(row["scopes"]) == set(scopes_module.ALL_SCOPES)


def test_migration_is_idempotent(rerun_migrations):
    """Replay every migration over a database that already has the data."""
    rerun_migrations()
    assert "scopes" in _columns("tokens")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_oauth_migration.py -q`
Expected: FAIL — the `oauthClient` assertion, then the `scopes` column assertion

- [ ] **Step 3: Write the migration**

Generate Better Auth's own DDL first so the columns match what the library expects:

```bash
cd auth && npm run schema:generate
```

Inspect the generated `backend/migrations/sql/better_auth.sql`, take only the four `oauth*` tables from it, and port them into the migration below in place of the `# --- generated DDL ---` marker. Keep every statement `if not exists`, matching migration 0003.

```python
# backend/migrations/versions/0004_oauth_and_token_scopes.py
"""oauth tables, and scopes on opaque tokens

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Better Auth's OAuth tables live beside its others, in its own schema. They
    # are created here rather than by Better Auth's CLI so that one tool owns
    # the schema -- the same rule migration 0003 established.
    #
    # Column names are camelCase and MUST stay double-quoted: unquoted,
    # Postgres folds them to lowercase and the library's queries stop matching.
    op.execute("create schema if not exists better_auth;")

    # --- generated DDL for oauthClient, oauthAccessToken, oauthRefreshToken,
    # --- oauthConsent goes here, from `npm run schema:generate`

    # Scopes on opaque tokens. The default is every scope, and that is the
    # load-bearing part: tokens already configured on other people's machines
    # get the behaviour they have always had, and only newly minted tokens can
    # be narrower. A default of '{}' would revoke every credential in the field
    # the moment this deployed.
    op.execute(
        "alter table tokens add column if not exists scopes text[]"
        " not null default '{persona:read,persona:propose,persona:write}';"
    )


def downgrade() -> None:
    op.execute("alter table tokens drop column if exists scopes;")
    for table in ("oauthConsent", "oauthRefreshToken", "oauthAccessToken", "oauthClient"):
        op.execute(f'drop table if exists better_auth."{table}" cascade;')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_oauth_migration.py -q`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/ backend/tests/test_oauth_migration.py
git commit -m "feat: oauth tables and tokens.scopes, grandfathered to full access"
```

---

### Task 3: Scoped, prefixed opaque tokens

**Files:**
- Modify: `backend/db.py` (`create_token`, `resolve_token`, `list_tokens`)
- Test: `backend/tests/test_token_scopes.py`

**Interfaces:**
- Consumes: `scopes.ALL_SCOPES`, `scopes.READ` (Task 1); `tokens.scopes` column (Task 2)
- Produces: `db.create_token(user_id, label="token", expires_in_days=None, token_scopes=None) -> tuple[str, str]`; `db.resolve_token(token)` result gains a `scopes: list[str]` key; `db.list_tokens` rows gain `scopes`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_token_scopes.py
import db
import scopes


def test_new_tokens_carry_the_mg_prefix(as_user):
    _, token = db.create_token(as_user, "cli")
    assert token.startswith("mg_")


def test_new_tokens_default_to_every_scope(as_user):
    _, token = db.create_token(as_user, "cli")
    assert set(db.resolve_token(token)["scopes"]) == set(scopes.ALL_SCOPES)


def test_a_token_can_be_minted_read_only(as_user):
    _, token = db.create_token(as_user, "readonly", token_scopes=[scopes.READ])
    assert db.resolve_token(token)["scopes"] == [scopes.READ]


def test_read_is_the_floor_even_if_omitted(as_user):
    """A token with no scopes is not narrower, it is broken."""
    _, token = db.create_token(as_user, "empty", token_scopes=[])
    assert scopes.READ in db.resolve_token(token)["scopes"]


def test_unprefixed_legacy_tokens_still_resolve(as_user):
    """The whole migration rests on this: credentials we cannot reach keep working."""
    import secrets

    legacy = secrets.token_urlsafe(32)
    with db.get_pool().connection() as conn:
        conn.execute(
            "insert into tokens (user_id, token_hash, label) values (%s, %s, 'legacy')",
            (as_user, db.hash_token(legacy)),
        )

    resolved = db.resolve_token(legacy)
    assert resolved is not None
    assert set(resolved["scopes"]) == set(scopes.ALL_SCOPES)


def test_list_tokens_reports_scopes_but_never_the_hash(as_user):
    db.create_token(as_user, "cli", token_scopes=[scopes.READ])
    row = db.list_tokens(as_user)[-1]
    assert row["scopes"] == [scopes.READ]
    assert "token_hash" not in row
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_token_scopes.py -q`
Expected: FAIL — `create_token()` has no `token_scopes` parameter

- [ ] **Step 3: Modify `backend/db.py`**

In `create_token`, replace the signature and the token generation:

```python
def create_token(
    user_id: str,
    label: str = "token",
    expires_in_days: Optional[int] = None,
    token_scopes: Optional[list[str]] = None,
) -> tuple[str, str]:
    """Issue a new named token. Returns (token_id, plaintext_token) --
    the plaintext is shown exactly once.

    expires_in_days=None stores NULL, meaning the token never expires. That is
    the right default for machine credentials: an MCP client configured once
    should not stop working on a timer. Browser sessions pass a finite value --
    see SESSION_TOKEN_DAYS.

    token_scopes=None means every scope, which is what a token has always had.
    `persona:read` is forced in regardless: a credential that cannot read has
    nothing to authorise.

    The `mg_` prefix makes the credential identifiable in a log and lets secret
    scanners match a pattern. It is hashed along with the rest of the string, so
    older unprefixed tokens keep resolving with no special case.
    """
    import scopes as scopes_module

    granted = list(scopes_module.ALL_SCOPES) if token_scopes is None else list(token_scopes)
    if scopes_module.READ not in granted:
        granted.append(scopes_module.READ)

    token = "mg_" + secrets.token_urlsafe(32)
```

then add `scopes` to the INSERT column list and `%s` parameter list, passing `granted`.

In `resolve_token`, the CTE must return the scopes. Change the `update tokens` clause to `returning user_id, scopes`, carry `t.scopes` through, and add it to the final `returning`:

```python
            with t as (
                update tokens set last_used_at = now()
                where token_hash = %s
                  and (expires_at is null or expires_at > now())
                returning user_id, scopes
            )
            update users set last_seen_at = now()
            from t where users.id = t.user_id
            returning users.id, users.username, t.scopes
```

In `list_tokens`, add `scopes` to the select list.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_token_scopes.py tests/test_db.py -q`
Expected: PASS — including the existing `test_db.py`, which must not regress

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_token_scopes.py
git commit -m "feat: scoped, mg_-prefixed opaque tokens"
```

---

### Task 4: Verify OAuth access tokens

**Files:**
- Modify: `backend/jwt_auth.py`
- Test: `backend/tests/test_oauth_token_verify.py`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `jwt_auth.MCP_RESOURCE: str`, `jwt_auth.verify_access_token(token: str) -> Optional[dict]`, `jwt_auth.mcp_resource_configured() -> bool`

Read the existing `jwt_auth.py` docstring first: the three properties it names — inert until configured, never raises into the middleware, verified locally — apply to the new function too.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_oauth_token_verify.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_oauth_token_verify.py -q`
Expected: FAIL — `module 'jwt_auth' has no attribute 'MCP_RESOURCE'`

- [ ] **Step 3: Modify `backend/jwt_auth.py`**

Add the setting beside the existing ones:

```python
# The canonical URI of the MCP endpoint, e.g. https://mygist.example/mcp. An
# OAuth access token must name it in `aud` -- the MCP specification requires a
# resource server to prove a token was issued for it specifically, and this is
# the claim that proves it. Unset, OAuth access tokens are rejected outright and
# only the existing credential paths work.
MCP_RESOURCE = os.getenv("AUTH_MCP_RESOURCE", "")
```

Extract the signing-key lookup the existing `verify` performs into a helper so both functions share it and tests have one place to patch:

```python
def _signing_key_for(token: str):
    return _jwk_client().get_signing_key_from_jwt(token)
```

Then add:

```python
def mcp_resource_configured() -> bool:
    """Whether OAuth access tokens can be verified at all."""
    return bool(JWKS_URL and MCP_RESOURCE)


def verify_access_token(token: str) -> Optional[dict]:
    """Return an OAuth access token's claims, or None.

    Separate from `verify` because the two credentials differ in exactly one
    way that matters: the audience. A session JWT names the auth service, an
    access token names the MCP endpoint. Verifying each against its own audience
    means neither can ever be presented where the other belongs, and that
    property costs nothing beyond passing the right string here.

    `sub` is required. A client_credentials grant mints tokens without one, and
    every persona query in MyGist keys off a user id -- so a token with no
    subject has nothing to scope to. That grant is not enabled, and this is the
    belt to its braces.
    """
    if not mcp_resource_configured():
        return None
    try:
        return jwt.decode(
            token,
            _signing_key_for(token).key,
            algorithms=ALGORITHMS,
            audience=MCP_RESOURCE,
            issuer=ISSUER,
            options={"require": ["sub", "exp", "aud", "iss"]},
        )
    except Exception as exc:  # noqa: BLE001 - see module docstring
        logger.debug("access token rejected: %s", exc)
        return None
```

Rewrite the body of the existing `verify` to call `_signing_key_for(token)` instead of `_jwk_client().get_signing_key_from_jwt(token)`, leaving everything else unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_oauth_token_verify.py tests/test_auth_routes.py -q`
Expected: PASS — existing JWT tests must not regress

- [ ] **Step 5: Commit**

```bash
git add backend/jwt_auth.py backend/tests/test_oauth_token_verify.py
git commit -m "feat: verify OAuth access tokens by their MCP audience"
```

---

### Task 5: The authorization server

**Files:**
- Modify: `auth/package.json`
- Create: `auth/src/oauth.js`
- Modify: `auth/src/auth.js`
- Modify: `auth/.env.example`
- Test: `auth/src/oauth.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `oauthPlugin({ baseURL, publicOrigin })` from `auth/src/oauth.js`; the auth service serves `/auth/oauth2/*` and `/auth/.well-known/oauth-authorization-server`

- [ ] **Step 1: Bump dependencies**

```bash
cd auth && npm install better-auth@1.6.25 @better-auth/oauth-provider@1.6.25 --save-exact
```

- [ ] **Step 2: Write the failing test**

```js
// auth/src/oauth.test.js
import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_RESOURCE, SCOPES, oauthOptions } from "./oauth.js";

const BASE = "https://mygist.example/auth";
const ORIGIN = "https://mygist.example";

test("the MCP resource is the canonical URI, without a trailing slash", () => {
  assert.equal(MCP_RESOURCE(ORIGIN), "https://mygist.example/mcp");
  assert.equal(MCP_RESOURCE("https://mygist.example/"), "https://mygist.example/mcp");
});

test("the MCP resource is a valid audience, or every token request 400s", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.ok(options.validAudiences.includes("https://mygist.example/mcp"));
  assert.ok(options.validAudiences.includes(BASE));
});

test("all three persona scopes are offered", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  for (const scope of SCOPES) assert.ok(options.scopes.includes(scope));
});

test("client_credentials is not enabled -- it cannot carry a user", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.ok(!(options.grantTypes ?? []).includes("client_credentials"));
});

test("registration is rate limited", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.equal(options.rateLimit.register.max, 5);
});

test("access tokens are short lived so revocation bites quickly", () => {
  const options = oauthOptions({ baseURL: BASE, publicOrigin: ORIGIN });
  assert.equal(options.accessTokenExpiresIn, "10m");
  assert.equal(options.refreshTokenExpiresIn, "30d");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd auth && npm test`
Expected: FAIL — cannot find module `./oauth.js`

- [ ] **Step 4: Write `auth/src/oauth.js`**

```js
/**
 * MyGist as an OAuth 2.1 authorization server.
 *
 * This is what lets an MCP client connect by signing in and consenting instead
 * of being handed a token to paste into a config file. Opaque tokens are not
 * replaced by it: OAuth is how an application connects, a token is how you
 * script, and both are permanent.
 *
 * Split from auth.js because that file is already the length it wants to be,
 * and because everything here is one decision -- the OAuth surface -- that can
 * be read without the email flows and the invite gate around it.
 */
import { oauthProvider } from "@better-auth/oauth-provider";

export const READ = "persona:read";
export const PROPOSE = "persona:propose";
export const WRITE = "persona:write";

/** Offered on the consent screen, in the order shown there. */
export const SCOPES = [READ, PROPOSE, WRITE];

/**
 * The canonical URI of the MCP endpoint, per RFC 8707 and RFC 9728.
 *
 * The trailing slash is stripped deliberately: the MCP specification says
 * implementations SHOULD use the form without one, and an audience is compared
 * by exact string, so `https://host/mcp/` and `https://host/mcp` are two
 * different resources to every client that follows the rule.
 */
export const MCP_RESOURCE = (publicOrigin) =>
  `${publicOrigin.replace(/\/+$/, "")}/mcp`;

/** The plugin's options, exported separately so they can be asserted on. */
export function oauthOptions({ baseURL, publicOrigin }) {
  return {
    // Real paths, not hash routes: Better Auth appends query parameters to
    // these, and anything after a `#` lands in the fragment rather than in
    // location.search. FastAPI serves the SPA shell at both.
    loginPage: "/sign-in",
    consentPage: "/consent",

    scopes: [...SCOPES, "offline_access"],

    // Load-bearing. This defaults to [baseURL], which is `.../auth` -- while
    // every MCP client sends resource=`.../mcp`. Left at the default, Better
    // Auth throws invalid_request and EVERY connection attempt fails at the
    // token endpoint, with an error that names neither this option nor the fix.
    validAudiences: [baseURL, MCP_RESOURCE(publicOrigin)],

    // Claude and ChatGPT have no pre-issued client_id for this server; they
    // register at connect time. The MCP specification now marks dynamic
    // registration deprecated in favour of Client ID Metadata Documents, which
    // Better Auth does not yet support -- so this is a compatibility bridge,
    // not the destination. Registering grants nothing on its own: a real,
    // invited human still has to sign in and consent.
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,

    // Short, so that revoking a connection bites in minutes rather than hours.
    // The refresh token dies immediately on revoke; this bounds how long the
    // access token already in flight outlives it.
    accessTokenExpiresIn: "10m",
    refreshTokenExpiresIn: "30d",

    rateLimit: {
      register: { window: 60, max: 5 },
      token: { window: 60, max: 20 },
      authorize: { window: 60, max: 30 },
    },
  };
}

export function oauthPlugin({ baseURL, publicOrigin }) {
  return oauthProvider(oauthOptions({ baseURL, publicOrigin }));
}
```

Note on `client_credentials`: the plugin does not enable it unless a client is registered with that grant type, and `oauthOptions` never sets `grantTypes`. The test above pins that we do not turn it on.

- [ ] **Step 5: Wire it into `auth/src/auth.js`**

Add the import beside the others:

```js
import { oauthPlugin } from "./oauth.js";
```

Add to the `plugins` array, after `jwt()` and before `invitePlugin()`:

```js
    // MyGist as an OAuth 2.1 authorization server, so an MCP client connects by
    // signing in rather than by being handed a token.
    //
    // NOT accompanied by `disabledPaths: ["/token"]`, which both the OAuth and
    // JWT plugin docs recommend. Verified against the published package: this
    // plugin registers /oauth2/token and never a bare /token, so there is no
    // collision -- and disabling /token would break the SPA, which exchanges
    // its session cookie for a JWT there on every page load.
    oauthPlugin({ baseURL, publicOrigin: new URL(baseURL).origin }),
```

- [ ] **Step 6: Document the new setting in `auth/.env.example`**

Append:

```
# The MCP endpoint's canonical URI is derived from BETTER_AUTH_URL -- it is
# always <public origin>/mcp -- so nothing extra is needed here. The API side
# needs it spelled out; see AUTH_MCP_RESOURCE in the backend environment.
```

- [ ] **Step 7: Run tests**

Run: `cd auth && npm test`
Expected: PASS — the new file plus the existing invite and db-config tests

- [ ] **Step 8: Commit**

```bash
git add auth/
git commit -m "feat: MyGist as an OAuth 2.1 authorization server"
```

---

### Task 6: Discovery documents

**Files:**
- Create: `backend/oauth_metadata.py`
- Modify: `backend/auth_proxy.py` (extract a reusable `forward`)
- Modify: `backend/main.py` (register the routes, make them public)
- Test: `backend/tests/test_oauth_metadata.py`

**Interfaces:**
- Consumes: `jwt_auth.MCP_RESOURCE` (Task 4)
- Produces: `oauth_metadata.protected_resource_metadata() -> dict`, `oauth_metadata.register(app) -> bool`; `auth_proxy.forward(upstream_path: str, request: Request) -> Response`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_oauth_metadata.py
"""Discovery is the first thing an MCP client does and the first thing that can
silently fail. These pin the four documents and, above all, that they are
reachable -- the MCP app is mounted at "/" and swallows anything registered
after it."""

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_MCP_RESOURCE", "https://mygist.example/mcp")
    monkeypatch.setenv("AUTH_ISSUER", "https://mygist.example/auth")
    import importlib

    import jwt_auth
    import main
    import oauth_metadata

    importlib.reload(jwt_auth)
    importlib.reload(oauth_metadata)
    importlib.reload(main)
    return TestClient(main.app)


def test_protected_resource_metadata_names_the_resource_and_its_server(client):
    body = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert body["resource"] == "https://mygist.example/mcp"
    assert body["authorization_servers"] == ["https://mygist.example/auth"]


def test_all_three_scopes_are_advertised(client):
    body = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert body["scopes_supported"] == [
        "persona:read",
        "persona:propose",
        "persona:write",
    ]


def test_offline_access_is_not_advertised(client):
    """The spec: refresh tokens are not a resource requirement."""
    body = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert "offline_access" not in body["scopes_supported"]


def test_the_bare_path_serves_the_same_document(client):
    """Clients that fail to parse WWW-Authenticate fall back to this."""
    assert (
        client.get("/.well-known/oauth-protected-resource").json()
        == client.get("/.well-known/oauth-protected-resource/mcp").json()
    )


def test_metadata_needs_no_credential(client):
    """Discovery happens before the client has any token at all."""
    assert client.get("/.well-known/oauth-protected-resource/mcp").status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_oauth_metadata.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'oauth_metadata'`

- [ ] **Step 3: Extract `forward` in `backend/auth_proxy.py`**

Move the body of the existing `auth_proxy` route function into a module-level coroutine, and have the route call it. The route's behaviour must not change:

```python
async def forward(upstream_path: str, request: Request) -> Response:
    """Send a request to the auth service at `upstream_path`, verbatim.

    Split out from the /auth/* route so the OAuth discovery documents can reach
    the same service at a path the public URL does not mirror -- RFC 8414 puts
    authorization-server metadata at the ROOT with the issuer's path appended,
    which /auth/{path} cannot express.
    """
    base = SERVICE_URL.rstrip("/")
    try:
        upstream = await _http().request(
            request.method,
            f"{base}{upstream_path}",
            params=request.query_params,
            content=await request.body(),
            headers=_request_headers(request),
            follow_redirects=False,
        )
    except httpx.RequestError as exc:
        logger.warning("auth service unreachable: %s", exc)
        return JSONResponse(
            {"error": "Authentication service unavailable"}, status_code=503
        )
    return build_response(upstream)
```

The existing route body becomes `return await forward(f"/auth/{path}", request)`.

- [ ] **Step 4: Write `backend/oauth_metadata.py`**

```python
"""OAuth discovery documents.

An MCP client's first move against a protected server is to be refused, read the
WWW-Authenticate header, and follow it to a metadata document. Everything else
depends on these four URLs resolving, and when they do not the symptom is a
client that simply says it cannot connect.

Two of them are ours to write; two belong to the auth service and are forwarded.
The forwarded pair exist because Better Auth is mounted at /auth, so its issuer
is https://host/auth -- and RFC 8414 tells clients to look for the metadata at
the ROOT with the issuer's path appended, i.e. /.well-known/oauth-authorization-
server/auth, which the /auth/{path} proxy cannot reach.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

import auth_proxy
import jwt_auth
import scopes

logger = logging.getLogger(__name__)

# Where the auth service serves its own metadata, under its base path.
_UPSTREAM_AS_METADATA = "/auth/.well-known/oauth-authorization-server"


def protected_resource_metadata() -> dict:
    """RFC 9728. Names this resource and the server that can authorise it.

    scopes_supported lists all three persona scopes. offline_access is
    deliberately absent: "MCP Servers SHOULD NOT include offline_access in
    WWW-Authenticate scope or Protected Resource Metadata scopes_supported, as
    refresh tokens are not a resource requirement." Clients ask for it directly.
    """
    return {
        "resource": jwt_auth.MCP_RESOURCE,
        "authorization_servers": [jwt_auth.ISSUER],
        "scopes_supported": list(scopes.ALL_SCOPES),
        "bearer_methods_supported": ["header"],
    }


def register(app: FastAPI) -> bool:
    """Mount the discovery routes. Returns whether they were.

    MUST be called before the MCP app is mounted at "/": FastAPI matches routes
    in registration order, and that mount matches everything. This is the same
    trap that once made a bare /docs 404, and here it would make every one of
    these documents unreachable while /health kept saying ok.
    """
    if not jwt_auth.MCP_RESOURCE:
        return False

    @app.get("/.well-known/oauth-protected-resource", include_in_schema=False)
    @app.get("/.well-known/oauth-protected-resource/mcp", include_in_schema=False)
    async def protected_resource() -> Response:
        # Both paths serve the same document. The path-inserted form is what a
        # client derives from the resource URI; the bare one is where clients
        # that fail to parse WWW-Authenticate fall back.
        return JSONResponse(protected_resource_metadata())

    @app.api_route(
        "/.well-known/oauth-authorization-server",
        methods=["GET", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    @app.api_route(
        "/.well-known/oauth-authorization-server/auth",
        methods=["GET", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    async def authorization_server(request: Request) -> Response:
        return await auth_proxy.forward(_UPSTREAM_AS_METADATA, request)

    return True
```

- [ ] **Step 5: Register in `backend/main.py`**

Beside the existing `AUTH_PROXIED = auth_proxy.register(app)` line, and after it:

```python
# OAuth discovery, for MCP clients. Registered here for the same reason as the
# static and auth routes: the MCP app is mounted at "/" below and matches
# everything, so anything needing its own path must come first.
import oauth_metadata  # noqa: E402

OAUTH_METADATA_MOUNTED = oauth_metadata.register(app)
```

Add the four paths to the middleware's public-route tuple, with a comment:

```python
        # OAuth discovery. Read before the client has any credential at all --
        # that is the entire point of them.
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/auth",
```

- [ ] **Step 6: Run tests**

Run: `cd backend && pytest tests/test_oauth_metadata.py tests/test_auth_proxy.py -q`
Expected: PASS — the proxy refactor must not regress its own tests

- [ ] **Step 7: Commit**

```bash
git add backend/oauth_metadata.py backend/auth_proxy.py backend/main.py backend/tests/test_oauth_metadata.py
git commit -m "feat: OAuth discovery documents, reachable before the MCP mount"
```

---

### Task 7: Middleware enforcement

**Files:**
- Modify: `backend/main.py` (the `auth_middleware` function, ~line 79-133)
- Test: `backend/tests/test_scope_enforcement.py`

**Interfaces:**
- Consumes: `scopes.*` (Task 1), `db.resolve_token` scopes (Task 3), `jwt_auth.verify_access_token` (Task 4), `oauth_metadata.protected_resource_metadata` (Task 6)
- Produces: `scopes.current_scopes` set on every authenticated request; `request.state.credential_kind` in `{"session", "oauth", "token"}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scope_enforcement.py
"""What a credential may do, as opposed to who it is.

The escalation test is the one that matters: a read-only token that can mint a
full-scope token is not a read-only token."""

import db
import scopes
from fastapi.testclient import TestClient


def _client():
    import main

    return TestClient(main.app)


def test_a_read_only_token_can_read(as_user):
    _, token = db.create_token(as_user, "ro", token_scopes=[scopes.READ])
    res = _client().get("/api/files", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


def test_a_read_only_token_cannot_write(as_user):
    _, token = db.create_token(as_user, "ro", token_scopes=[scopes.READ])
    res = _client().put(
        "/api/settings",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_a_read_only_token_cannot_mint_a_token(as_user):
    """The escalation hole. Without this, scoping is decorative."""
    _, token = db.create_token(as_user, "ro", token_scopes=[scopes.READ])
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "escalated"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_a_full_token_can_still_mint_a_token(as_user):
    """Detached mode and pre-Better-Auth accounts both depend on this."""
    _, token = db.create_token(as_user, "full")
    res = _client().post(
        "/api/auth/tokens",
        json={"label": "second"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200


def test_unauthenticated_mcp_gets_a_challenge_naming_the_metadata(as_user):
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_scope_enforcement.py -q`
Expected: FAIL — a read-only token is currently allowed to write

- [ ] **Step 3: Rewrite the protected branch of `auth_middleware`**

Replace everything from `if path.startswith("/mcp") or path.startswith("/api"):` to the end of that block:

```python
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
                granted = scopes.expand(claims.get("scope", "").split())
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

        # An OAuth access token is valid on /mcp and nowhere else. The audience
        # already says so; this makes the refusal explicit rather than relying
        # on a claim check to have the side effect.
        if kind == "oauth" and not is_mcp:
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
```

Add above `auth_middleware`:

```python
# Endpoints that manage the account rather than the persona in it.
_ACCOUNT_PATHS = frozenset({"/api/auth/set-password", "/api/auth/tokens"})


def _challenge(error: str = "", scope: str = "") -> str:
    """An RFC 6750 Bearer challenge naming where to find the metadata.

    Only sent on /mcp. The SPA has always received a plain JSON 401 from /api
    and its fetch path is written against that; adding a challenge there would
    be a change nobody asked for.
    """
    parts = []
    if error:
        parts.append(f'error="{error}"')
    if scope:
        parts.append(f'scope="{scope}"')
    parts.append('resource_metadata="/.well-known/oauth-protected-resource/mcp"')
    return "Bearer " + ", ".join(parts)


def _unauthorized(is_mcp: bool) -> JSONResponse:
    headers = (
        {"WWW-Authenticate": _challenge(scope=" ".join(scopes.ALL_SCOPES))}
        if is_mcp
        else None
    )
    return JSONResponse({"error": "Unauthorized"}, status_code=401, headers=headers)


def _insufficient_scope(is_mcp: bool, required: str) -> JSONResponse:
    headers = (
        {"WWW-Authenticate": _challenge(error="insufficient_scope", scope=required)}
        if is_mcp
        else None
    )
    return JSONResponse({"error": "Forbidden"}, status_code=403, headers=headers)
```

Add `import scopes` to the imports at the top of `main.py`.

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_scope_enforcement.py tests/test_auth_routes.py tests/test_auth_password.py -q`
Expected: PASS — existing auth route tests must not regress

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_scope_enforcement.py
git commit -m "feat: enforce scopes, and close the token-minting escalation"
```

---

### Task 8: MCP tool filtering

**Files:**
- Create: `backend/mcp_scopes.py`
- Modify: `backend/main.py` (attach the middleware to `mcp`)
- Test: `backend/tests/test_mcp_scopes.py`

**Interfaces:**
- Consumes: `scopes.TOOL_SCOPES`, `scopes.current_scopes`, `scopes.has` (Task 1)
- Produces: `mcp_scopes.ScopeMiddleware` — a `fastmcp.server.middleware.Middleware` subclass

Check FastMCP 2.14.2's middleware API before writing: `from fastmcp.server.middleware import Middleware, MiddlewareContext`, hooks `on_list_tools` and `on_call_tool`. Confirm the hook names in the installed package (`backend/venv/lib/python*/site-packages/fastmcp/server/middleware/`) rather than assuming.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_mcp_scopes.py
"""A connection that cannot write should not be shown the write tools.

Filtering is better than failing: a client that can see persona_modify will try
it, and an error mid-conversation is a worse experience than a tool that was
never offered. It also means the tool list is an honest description of what the
connection can do."""

import pytest

import scopes
from mcp_scopes import tools_for_scopes


def test_a_read_only_grant_sees_only_read_tools():
    visible = tools_for_scopes(scopes.expand([scopes.READ]))
    assert visible == {
        "get_context",
        "get_raw",
        "search_context",
        "get_entity",
        "get_schema",
    }


def test_a_propose_grant_adds_propose_update():
    visible = tools_for_scopes(scopes.expand([scopes.PROPOSE]))
    assert "propose_update" in visible
    assert "persona_modify" not in visible


def test_a_write_grant_sees_everything():
    visible = tools_for_scopes(scopes.expand([scopes.WRITE]))
    assert visible == set(scopes.TOOL_SCOPES)


def test_an_unknown_tool_is_visible_by_default():
    """A tool with no entry in TOOL_SCOPES is one someone forgot to classify.
    Hiding it silently would make a new tool vanish for every client; showing
    it makes the omission obvious in review instead."""
    visible = tools_for_scopes(scopes.expand([scopes.READ]), names=["brand_new_tool"])
    assert "brand_new_tool" in visible
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_mcp_scopes.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_scopes'`

- [ ] **Step 3: Write `backend/mcp_scopes.py`**

```python
"""Scope enforcement at the MCP layer.

The HTTP middleware knows the request; only this layer knows which tool is being
called. Both are needed, and they do different jobs: the middleware decides
whether the credential may touch /mcp at all, and this decides which of the
eight tools it may see and use.

Filtering rather than failing is deliberate. A client shown persona_modify will
call it, and a mid-conversation error is a worse experience than a tool that was
never offered -- and the tool list then honestly describes what the connection
can do. It does mean protocol-level scope step-up can never fire, which is a
trade this design makes knowingly: step-up is an HTTP mechanism, and a per-tool
refusal lives inside a JSON-RPC response that cannot carry a WWW-Authenticate
header.
"""

from typing import Iterable, Optional

from fastmcp.server.middleware import Middleware, MiddlewareContext

import scopes


def tools_for_scopes(
    granted: Iterable[str], names: Optional[Iterable[str]] = None
) -> set[str]:
    """Which tool names an already-expanded grant may see.

    A tool absent from TOOL_SCOPES is visible. That is not laxity: an
    unclassified tool is one somebody forgot to add, and hiding it would make a
    newly added tool silently vanish for every client, which is far harder to
    notice than the reverse.
    """
    candidates = set(names) if names is not None else set(scopes.TOOL_SCOPES)
    return {
        name
        for name in candidates
        if name not in scopes.TOOL_SCOPES
        or scopes.has(granted, scopes.TOOL_SCOPES[name])
    }


class ScopeMiddleware(Middleware):
    """Hides out-of-scope tools, and refuses them if called anyway."""

    async def on_list_tools(self, context: MiddlewareContext, call_next):
        tools = await call_next(context)
        try:
            granted = scopes.current_scopes.get()
        except LookupError:
            # No grant on this request. The HTTP middleware refuses before we
            # get here, so this only happens on a path that never authenticated
            # -- showing nothing is the fail-closed answer.
            return []
        allowed = tools_for_scopes(granted, names=[tool.name for tool in tools])
        return [tool for tool in tools if tool.name in allowed]

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        required = scopes.TOOL_SCOPES.get(context.message.name)
        if required is not None:
            try:
                granted = scopes.current_scopes.get()
            except LookupError:
                granted = frozenset()
            if not scopes.has(granted, required):
                raise ValueError(
                    f"This connection is not authorised to use "
                    f"{context.message.name}. It needs the {required} scope; "
                    f"reconnect from MyGist's settings to grant it."
                )
        return await call_next(context)
```

If FastMCP 2.14.2's hook signatures differ from the above, adapt to the installed API and keep the behaviour identical.

- [ ] **Step 4: Attach it in `backend/main.py`**

After `from server import mcp`:

```python
# Scope enforcement for MCP tools. Added before http_app() so it is part of the
# app that gets mounted.
import mcp_scopes  # noqa: E402

mcp.add_middleware(mcp_scopes.ScopeMiddleware())
```

- [ ] **Step 5: Run tests**

Run: `cd backend && pytest tests/test_mcp_scopes.py -q`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/mcp_scopes.py backend/main.py backend/tests/test_mcp_scopes.py
git commit -m "feat: hide out-of-scope MCP tools rather than failing them"
```

---

### Task 9: Concurrency isolation test

**Files:**
- Create: `backend/tests/test_tenant_isolation.py`

**Interfaces:**
- Consumes: everything from Tasks 1-8

This task adds no production code. It exists because the failure it looks for lives in the seam between Starlette, FastMCP's session handling and the contextvar — exactly where no unit test looks — and `requirements.txt` pins Starlette specifically for "contextvar/request.state propagation" behaviour, so it has bitten once already.

- [ ] **Step 1: Write the test**

```python
# backend/tests/test_tenant_isolation.py
"""Two users, interleaved. Nobody sees anybody else's persona.

db.current_user_id is set per request and never reset, so isolation rests on
each request running in its own copied context. That is a property of the ASGI
stack rather than of our code, which is precisely why it is worth a test that
would fail loudly if a future dependency bump changed it.
"""

import concurrent.futures

import db
import persona_store
from fastapi.testclient import TestClient


def _make_user(username: str) -> str:
    user_id, _ = db.register_user(username, password="correct horse battery")
    return user_id


def test_interleaved_requests_never_cross_personas():
    import main

    client = TestClient(main.app)

    alice = _make_user("isolation-alice")
    bob = _make_user("isolation-bob")

    _, alice_token = db.create_token(alice, "alice")
    _, bob_token = db.create_token(bob, "bob")

    # Give each a distinguishable persona.
    for user_id, marker in ((alice, "alice-only"), (bob, "bob-only")):
        db.current_user_id.set(user_id)
        persona_store.save("profile", {"basic_info": {"name": marker}})

    def fetch(token: str) -> dict:
        res = client.get(
            "/api/files/profile", headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code == 200
        return res.json()

    # Interleaved and concurrent: a context leaking between requests shows up
    # here and essentially nowhere else.
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [
            pool.submit(fetch, alice_token if index % 2 == 0 else bob_token)
            for index in range(40)
        ]
        results = [
            (index, future.result()) for index, future in enumerate(futures)
        ]

    for index, body in results:
        expected = "alice-only" if index % 2 == 0 else "bob-only"
        name = body.get("basic_info", {}).get("name")
        assert name == expected, f"request {index} saw {name!r}, expected {expected!r}"
```

Adapt `db.register_user` and `persona_store.save` to their real signatures — check `backend/tests/conftest.py`'s `as_user` fixture for how a user is created in this codebase, and reuse that mechanism rather than inventing one.

- [ ] **Step 2: Run it**

Run: `cd backend && pytest tests/test_tenant_isolation.py -q`
Expected: PASS. **If it fails, stop and report** — a real cross-user leak outranks every remaining task.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_tenant_isolation.py
git commit -m "test: two users interleaved never cross personas"
```

---

### Task 10: Consent screen

**Files:**
- Create: `frontend/src/components/Consent.jsx`
- Create: `frontend/src/components/Consent.test.jsx`
- Modify: `frontend/src/App.jsx` (branch on pathname before the hash router runs)
- Modify: `backend/main.py` (`register_static_routes`: serve the shell at `/sign-in` and `/consent`)

**Interfaces:**
- Consumes: the auth service's `/auth/oauth2/consent` endpoint
- Produces: `<Consent />`

Read `frontend/src/components/WelcomeAuth.jsx` and `frontend/src/components/ui/` first, and match the existing component conventions — this must look like the rest of the app, not like a new one.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/components/Consent.test.jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Consent from "./Consent.jsx";

const CLIENT = { client_name: "Claude Desktop", scopes: ["persona:read", "persona:propose", "persona:write"] };

describe("Consent", () => {
  it("names the client and the account, so the wrong persona cannot be granted by accident", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    expect(screen.getByText(/Claude Desktop/)).toBeInTheDocument();
    expect(screen.getByText(/liamthura/)).toBeInTheDocument();
  });

  it("shows read as always granted rather than as a choice", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    const read = screen.getByLabelText(/Read your persona/i);
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
  });

  it("pre-selects propose and write, and lets them be declined", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    for (const label of [/Suggest changes/i, /Change your persona directly/i]) {
      const box = screen.getByLabelText(label);
      expect(box).toBeChecked();
      expect(box).not.toBeDisabled();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- Consent`
Expected: FAIL — cannot resolve `./Consent.jsx`

- [ ] **Step 3: Write `frontend/src/components/Consent.jsx`**

Requirements, all pinned by the tests above plus the spec:

- Names the client (`client.client_name`) and the signed-in account prominently.
- Three rows in this order and wording:
  - `persona:read` → "Read your persona" — checked, **disabled**, described as always granted
  - `persona:propose` → "Suggest changes for your approval" — checked, toggleable
  - `persona:write` → "Change your persona directly" — checked, toggleable
- Because the scopes are hierarchical, ticking *Change your persona directly* forces *Suggest changes* on and shows it as included.
- Approve posts the selected scopes to `/auth/oauth2/consent`; Deny posts the denial.
- Preserves every OAuth query parameter from `window.location.search` across the round trip.

- [ ] **Step 4: Branch on pathname in `frontend/src/App.jsx`**

At the top of the component, before any hash-route logic:

```jsx
  // Two real paths, not hash routes: Better Auth appends query parameters when
  // it redirects here, and anything after a `#` lands in the fragment rather
  // than in location.search. Everything else in the app stays on the hash
  // router -- see lib/routes.js for why.
  const oauthScreen = window.location.pathname;
  if (oauthScreen === "/consent") return <Consent />;
```

`/sign-in` renders the existing `WelcomeAuth` in its sign-in mode — do not build a second sign-in.

- [ ] **Step 5: Serve the shell at both paths in `backend/main.py`**

Inside `register_static_routes`, beside the existing `spa_index`:

```python
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
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npm test -- Consent`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Consent.jsx frontend/src/components/Consent.test.jsx frontend/src/App.jsx backend/main.py
git commit -m "feat: the consent screen, where the scope decision lives"
```

---

### Task 11: Connected apps, and scope choice when minting a token

**Files:**
- Create: `frontend/src/components/ConnectedApps.jsx`
- Create: `frontend/src/components/ConnectedApps.test.jsx`
- Modify: `frontend/src/lib/api.js` (list and revoke grants)
- Modify: `frontend/src/components/ConnectionSettings.jsx` (scope choice when minting)

**Interfaces:**
- Consumes: `/auth/oauth2/get-consents` and `/auth/oauth2/delete-consent` (verified present in the package); `db.create_token(token_scopes=...)` (Task 3)
- Produces: `<ConnectedApps />`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/components/ConnectedApps.test.jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConnectedApps from "./ConnectedApps.jsx";

const GRANTS = [
  {
    id: "consent-1",
    clientName: "Claude Desktop",
    scopes: ["persona:read", "persona:propose"],
    lastUsedAt: "2026-07-30T10:00:00Z",
  },
];

describe("ConnectedApps", () => {
  it("lists each app with what it may do", async () => {
    render(<ConnectedApps grants={GRANTS} onRevoke={vi.fn()} />);
    expect(await screen.findByText(/Claude Desktop/)).toBeInTheDocument();
    expect(screen.getByText(/Suggest changes/i)).toBeInTheDocument();
  });

  it("says access ends within ten minutes rather than implying it is instant", async () => {
    render(<ConnectedApps grants={GRANTS} onRevoke={vi.fn()} />);
    expect(await screen.findByText(/10 minutes/i)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is connected", () => {
    render(<ConnectedApps grants={[]} onRevoke={vi.fn()} />);
    expect(screen.getByText(/No applications/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ConnectedApps`
Expected: FAIL — cannot resolve `./ConnectedApps.jsx`

- [ ] **Step 3: Write the component and wire the API**

`ConnectedApps.jsx` lists each grant with its client name, scopes rendered in the consent screen's plain wording, last-used time, and a revoke button. Revoking must state plainly that the refresh token dies immediately and any access token in flight expires within 10 minutes — do not imply an instant cutoff.

In `api.js`, add `listConnectedApps()` and `revokeConnectedApp(consentId)` calling `/auth/oauth2/get-consents` and `/auth/oauth2/delete-consent`. Follow the existing `authFetch` pattern in `lib/session.js` — these are auth-service endpoints, not `/api` ones, so they need `credentials: "include"` and must not go through `getApiBase()`.

In `ConnectionSettings.jsx`, add a scope choice to the mint-a-token flow: read shown as always granted, propose and write as toggles, matching the consent screen's wording. Pass the selection to the existing create-token call.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- ConnectedApps ConnectionSettings`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: connected apps, and scope choice when minting a token"
```

---

### Task 12: Wire the backend setting, and document

**Files:**
- Modify: `backend/main.py` or the deployment env docs — wherever `AUTH_JWKS_URL` is currently documented
- Modify: `docs-site` pages covering connecting a client and self-hosting
- Modify: `.github/workflows/*.yml` if the auth job needs the new dependency

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Find where the existing auth settings are documented**

```bash
grep -rn "AUTH_JWKS_URL" --include="*.md" --include="*.yml" --include="*.example" . | grep -v node_modules
```

- [ ] **Step 2: Document `AUTH_MCP_RESOURCE` beside them**

It is the canonical URI of the MCP endpoint — `https://<public origin>/mcp`, no trailing slash. Unset, OAuth access tokens are rejected and only the existing credential paths work, which is exactly the behaviour before this feature.

- [ ] **Step 3: Update the docs-site pages**

Cover: connecting an MCP client over OAuth, what each scope means in plain words, that opaque tokens remain the right tool for scripting, and — for self-hosters — that the four `.well-known` routes are served by the app itself and need no proxy configuration, preserving the one-upstream-one-port promise.

- [ ] **Step 4: Verify the docs build**

Run: `cd docs-site && npm run check:links`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs-site/ backend/ .github/
git commit -m "docs: connecting over OAuth, and the AUTH_MCP_RESOURCE setting"
```

---

## Verification

After the final task, run the three suites the change actually touches:

```bash
cd backend && pytest -q
cd auth && npm test
cd frontend && npm test
```

Then confirm the end-to-end flow with MCP Inspector against a local instance: discovery resolves, registration succeeds, consent appears naming the account, and the resulting token reads the persona but cannot write when write is declined.
