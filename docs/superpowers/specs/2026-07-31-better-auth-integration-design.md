# Better Auth integration — design

**Status:** draft for review
**Date:** 2026-07-31

Replace MyGist's hand-rolled human authentication with [Better Auth](https://better-auth.com),
running as a Node service beside the Python API, without breaking a single
existing credential.

---

## Decisions taken

| Question | Answer |
|---|---|
| Approach | Better Auth as a **separate Node service**; FastAPI verifies its JWTs via JWKS |
| Topology | **Same origin** at `/auth`, proxied **by FastAPI** rather than by the platform |
| Identity | **Add email, keep username** — username stays the handle |
| Features | Email flows, MFA, session/device management. OAuth **designed for, not built yet** |
| Audience | Me plus a few trusted people |
| Migration | **Existing passwords and MCP tokens must both keep working** |
| Email | Resend |

## What this is not

Not a rewrite. The Python backend keeps the MCP server, the persona logic, the
entity vocabulary and all 655 tests. Better Auth owns **human sign-in only**.

Machine authentication — the bearer tokens MCP clients use — stays exactly
where it is. That is not conservatism: those tokens live in config files on
other people's machines, and this project has just had a first-hand lesson in
what happens when a credential you cannot reach stops working.

---

## Verified against current docs

Three assumptions this design rests on, each confirmed rather than assumed:

**Existing bcrypt hashes stay verifiable.** Better Auth defaults to scrypt but
accepts a custom `password.hash` / `password.verify` pair. Its own Auth0,
Supabase and Clerk migration guides use exactly this to keep bcrypt-hashed
passwords working. This is the single fact the whole migration depends on.

```ts
emailAndPassword: {
  enabled: true,
  password: {
    hash:   async (password) => bcrypt.hash(password, 12),
    verify: async ({ hash, password }) => bcrypt.compare(password, hash),
  },
}
```

**Python can verify Better Auth's tokens.** The JWT plugin exposes a JWKS
endpoint, and the docs state plainly that it exists for services that are not
JavaScript. FastAPI fetches the public keys over HTTP and verifies locally —
no call to the Node service on the request path.

**Mounting at `/auth` is supported.** `basePath` and `trustedOrigins` are
first-class options.

One caveat that shapes everything below: the JWT plugin **is not a replacement
for the session**. Sessions remain cookie-based. The SPA exchanges its cookie
for a short-lived JWT and uses that to call FastAPI.

---

## Architecture

```text
                    mygist.thuradev.qzz.io
                             │
              ┌──────────────┴───────────────┐
              │ proxy: path-based routing    │
              └──────┬────────────────┬──────┘
                     │                │
              /auth/*│                │ /  /api  /mcp  /docs
                     ▼                ▼
        ┌────────────────────┐   ┌──────────────────────┐
        │  Node              │   │  FastAPI             │
        │  Better Auth       │   │  API · MCP · SPA     │
        │  :3001             │   │  :1120               │
        └─────────┬──────────┘   └──────────┬───────────┘
                  │                          │
                  │   JWKS (public keys,     │
                  │   fetched and cached) ──►│
                  │                          │
                  └────────┬─────────────────┘
                           ▼
                   Postgres (one instance)
              better_auth.*      public.users
              (its own schema)   (persona owner)
```

### Request flows

**Human, browser**

```
1. POST /auth/sign-in/email        → Better Auth verifies (bcrypt), sets cookie
2. GET  /auth/token                → short-lived JWT, signed EdDSA
3. GET  /api/files                 → Authorization: Bearer <jwt>
                                     FastAPI verifies via cached JWKS
```

**Machine, MCP client — unchanged**

```
POST /mcp   Authorization: Bearer <opaque token>
            → sha256 → tokens table → user_id
```

### Telling the two apart

FastAPI's middleware gains one branch. A Better Auth JWT has exactly two dots;
`secrets.token_urlsafe(32)` has none. The discriminator is unambiguous and
needs no prefix scheme:

```python
if credential.count(".") == 2:
    user_id = verify_jwt(credential)        # new path, JWKS
else:
    user_id = db.user_id_for_token(credential)  # existing path, untouched
```

Opaque tokens keep their current code path exactly. No MCP client changes, no
reconfiguration, no deprecation window.

---

## Identity model

Two user tables is the real risk in this design — drift between them is how
this kind of integration usually rots.

**Resolution: one id space.** Better Auth's `user.id` *is* `public.users.id`.
No mapping table, no join, nothing to fall out of step.

- **Existing accounts** are seeded into Better Auth's table preserving their
  current UUID. The migration guides do exactly this.
- **New accounts** are created by Better Auth, and FastAPI provisions the
  matching `public.users` row on first authenticated request, taking the id
  and username from the JWT claims.

`public.users` gains one nullable column:

| Column | Why |
|---|---|
| `email text unique` | Required by verification, reset and (later) OAuth matching |

Nullable, because existing accounts have none. Every email-dependent flow
needs a "you have not set one yet" branch — that is the accepted cost of
keeping current accounts working, and it should be a single shared guard
rather than scattered checks.

`users.password_hash` stays. Better Auth reads it through the bcrypt verifier.
`users.token_hash` — the legacy single-token column — is untouched by this
work and should be audited separately.

---

## Phases

Each phase is independently shippable and independently revertible. Nothing
user-visible changes until Phase 2.

### Phase 0 — foundations, invisible

- Node service in `auth/`, Better Auth with the Postgres adapter and its own schema
- JWT plugin enabled; JWKS reachable
- FastAPI gains JWT verification **alongside** the existing token path
- Both credential types work; the SPA still uses the old flow

*Done when:* a hand-made JWT authenticates against `/api/files`, and every
existing test still passes.

### Phase 1 — seed and verify

- Seed Better Auth's user table from `public.users`, preserving ids
- Configure the bcrypt verifier
- Prove an existing account signs in through Better Auth with its **current** password

*Done when:* all existing accounts authenticate through the new service without
a password change. This is the phase that either validates the whole approach
or kills it — do not build further until it passes.

### Phase 2 — cut the SPA over

- Sign-in and registration move to `/auth`
- SPA exchanges cookie for JWT, sends it to `/api`
- Old `/api/auth/login` and `/api/auth/register` kept, marked deprecated
- **Token management stays on FastAPI** — MCP tokens are not Better Auth's

*Done when:* a human can register, sign in, sign out and manage MCP tokens
entirely through the new path.

### Phase 3 — email (Resend)

- `email` column, plus a UI prompt for accounts without one
- Verification, password reset, optionally magic links
- Provider behind a thin interface so it is swappable

*Done when:* an account with no email can add and verify one, and reset a
forgotten password.

### Phase 4 — MFA

- TOTP, **with recovery codes** — without them this is a lockout generator
- Optional per account
- Recovery path documented before it is enabled, not after

### Phase 5 — sessions and devices

- List active sessions, revoke individually
- Surface both session and MCP-token revocation in one place, since from a
  user's point of view they are the same question: *what can reach my data?*

### Deferred — OAuth

Providers deliberately not chosen. The email column and id model above are what
OAuth needs, so adding Google or GitHub later is configuration plus an
account-linking rule, not a redesign.

---

## Consequences to accept

**The single-container property ends.** This is a documented design claim, and
these pages assert it and will become wrong: `run/index`, `run/self-hosting`,
`run/development`, `run/infrastructure`. They must change in the same PR that
adds the second container, not afterwards.

**Auth becomes a network hop that can fail.** If Node is down, humans cannot
sign in. Note the asymmetry, which is a genuinely good property: **MCP clients
keep working**, because their path never touches the Node service. Worth
stating in the docs — during an auth outage, assistants still read your persona.

**Two runtimes in production.** Node returns to the image after being
deliberately removed. `docs-site` builds with Node but ships nothing; this
does ship.

**FastAPI proxies `/auth/*` to the Node container.** Decided against putting
the rule in platform config.

The deciding argument is the one made to self-hosters. `run/self-hosting`
promises *"nothing special is required: one upstream, one port."* Platform-level
path routing breaks that for everyone who runs their own, who would need two
upstreams correctly ordered or sign-in silently reaches the wrong service.
Proxying in FastAPI keeps the public contract identical — one upstream, one
port — and changes only what happens behind it.

Secondary, but real: the rule is then versioned, reviewable and testable, and
deploys atomically with the code that depends on it. This project has already
lost time twice to dashboard state — a container port, and a DNS record
outliving its origin. A rule that routes *authentication* is worse to forget
than either.

Cost is one loopback hop on auth calls only. `/api` and `/mcp` never touch it,
and the failure asymmetry survives: Node down means humans cannot sign in while
MCP clients keep working.

**The sharp edge is `Set-Cookie`.** A sign-in response carries several, and any
code treating headers as a dict collapses them into one — you get a session
cookie and silently lose the rest. Copy the raw multi-value header list, and
pin it with a test that asserts on two cookies, because this fails quietly.

Better Auth's `baseURL` is set to the public origin explicitly, so it never
infers anything from forwarded headers and the proxy stays a dumb passthrough.

**Rate limiting moves.** Login throttling currently lives in FastAPI
(`login_attempts`, keyed on the submitted username so a 429 reveals nothing
about whether an account exists). Better Auth has its own. Do not run both —
pick one, and keep the property that the response says nothing about account
existence.

**Timing-attack hardening is currently deliberate.** `db.verify_password`
performs exactly one bcrypt operation on every failure branch so latency cannot
distinguish "no such user" from "wrong password". Better Auth's own handling
must be checked for the same property; it is not free.

**CI needs a fourth job.** The `docs` job precedent applies: anything that
ships in the image gets built in CI, or it breaks at deploy time.

---

## Open questions

1. **Where does the Node service get its database URL** — same Postgres, its
   own schema? Recommended: yes, one instance, `better_auth` schema, separate
   credentials if practical.
2. **Session lifetime.** Current browser sessions are 30 days. Keep, or shorten
   now that reset flows exist?
3. **Does Better Auth's username plugin do what we need**, or is username better
   kept as a MyGist-side field? Affects Phase 1.
4. **What happens to `/api/auth/login` long term** — deprecate and remove, or
   keep as a break-glass path if the Node service is down?

---

## First step

Phase 0 and Phase 1, together, behind no user-visible change. If an existing
account cannot sign in with its existing password through Better Auth, the
whole design is wrong and it is better to find that out in an afternoon than
after the SPA has been cut over.
