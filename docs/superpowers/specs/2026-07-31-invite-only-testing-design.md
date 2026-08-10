# Invite-only testing — design

**Status:** draft for review
**Date:** 2026-07-31

Gate account creation on the hosted instance behind codes you mint by hand, so
MyGist can be put in front of testers without being open to the world.

Builds on [Better Auth integration](2026-07-31-better-auth-integration-design.md).
Assumes Phase 2 has landed, because the gate hangs off Better Auth's sign-up
pipeline.

---

## Decisions taken

| Question | Answer |
|---|---|
| Code shape | **Unique per tester**, `XXXX-XXXX`, minted individually |
| Minting | **CLI script**, run where the database is reachable. No admin role, no admin UI |
| Enforcement | **Inside Better Auth**, one module, two callers |
| `/api/auth/register` | **403 while invite-only is on** — a closed door, not a second copy of the rule |
| Switch | **`INVITE_ONLY` environment variable**, off by default |
| Screen | **Code first**, then the account form. `input-otp` with slots and a separator |
| Redemption | **Validate before, redeem after** — see [Redemption](#redemption) for the trade |

## What this is not

Not a permissions system. There is no admin role, no tester role, no tiering.
An account created with a code is an ordinary account and is indistinguishable
from one created before this existed, apart from the `invited_with` column that
records where it came from.

Not a feature-flag system. `INVITE_ONLY` is one environment variable read in one
function per service. Flags are planned separately; when they arrive, they
replace those two functions and nothing else.

Not a change to what MyGist is. Invite-only is a **mode the hosted instance
runs in**. Off by default, so self-hosters and local development never see it.

---

## Verified before designing

**Better Auth has a first-class hook for this.** `hooks.before` with
`createAuthMiddleware` gives `ctx.path` and `ctx.body`, and `APIError` rejects
the request. The documented example is rejecting sign-ups whose email is not on
an allowed domain — structurally the same problem.

```js
hooks: {
  before: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/sign-up/email") return;
    // ctx.body carries the invite code; throw APIError to reject
  }),
}
```

This matters because it decides where the rule lives. A hook here is fifteen
lines against a supported API; the alternative was the FastAPI proxy parsing
request bodies and making authorisation decisions.

### Two load-bearing assumptions — both now confirmed

These were open when this spec was written, and a wrong answer to either would
have moved enforcement to the FastAPI front door. Settled by a spike against a
running service on a clean database, before the migration existed.

1. **Does `ctx.body` still carry an unrecognised field?** The code travels as
   `inviteCode` in the sign-up body, and zod could have stripped unknown keys
   before `hooks.before` ran. **It does not.** Measured:

   ```
   q1_bodyKeys           ["username","name","email","password","inviteCode"]
   q1_inviteCodeVisible  "7F2K-QX91"
   ```

2. **Does `databaseHooks.user.create.after` receive the request context?** The
   existing hook takes `(user)`; redemption needs to know which code was used.
   **It receives `(user, ctx)`, and `ctx.body` is intact:**

   ```
   q2_ctxDefined          true
   q2_inviteCodeFromCtx   "7F2K-QX91"
   ```

The spike was deleted rather than kept. What it proved belongs in tests that
run every time, not in a file nobody executes again.

**`input-otp` carries no styling.** Version 1.4.2, zero runtime dependencies,
React 18 in its peer range. It is headless — it owns keyboard handling, paste,
and the hidden input, and renders through your own components.

It is worth being explicit that this **fails the letter of the standing UI rule**
("no new runtime dependency; hand-roll the simpler control instead"). That rule
exists to stop a second styling system entering the codebase, and a headless
package brings none. Adopted deliberately, with the conversion to MyGist's
tokens counted as part of its cost.

---

## The gate has to cover two doors

After Phase 2 there are two ways to create an account:

| Path | Used by |
|---|---|
| `/auth/sign-up/email` (proxied to the auth service) | Same-origin sign-up — the normal path |
| `POST /api/auth/register` | Detached mode — a UI pointed at someone else's server |

A gate on one is not a gate.

The second door does not need the rule, only a lock. While invite-only is on,
`/api/auth/register` returns 403 — self-serve registration in detached mode is
off for the duration of the closed test. This costs nothing real: detached mode
means a UI pointed at *someone else's* server, which nobody is doing against a
closed test instance, and self-hosters run with the mode off.

So the rule exists once, in JavaScript, and Python only ever asks whether the
mode is on.

---

## Architecture

```
                    ┌──────────────────────────────────────┐
  browser ─────────►│ FastAPI                              │
                    │                                      │
                    │  GET  /api/instance   → invite_only  │  ← "which screen?"
                    │  POST /api/auth/register → 403       │  ← door locked
                    │                                      │
                    │  /auth/* ──proxy──┐                  │
                    └───────────────────┼──────────────────┘
                                        ▼
                    ┌──────────────────────────────────────┐
                    │ auth service (Better Auth)           │
                    │                                      │
                    │  invite.js  ── the rule, once        │
                    │    ├── hooks.before /sign-up/email   │  ← the gate
                    │    └── POST /auth/invite/check       │  ← step 1 of the screen
                    │                                      │
                    │  databaseHooks.user.create.after     │  ← redeem + provision
                    └──────────────────────────────────────┘
                                        │
                                        ▼
                              invite_codes  (Alembic owns the schema)
```

`/auth/invite/check` lives in the auth service rather than in FastAPI
specifically so that the check endpoint and the gate cannot drift apart. They
are two callers of one function.

---

## Data

Alembic migration `0005_invite_codes`. The schema is owned by Alembic for the
same reason `better_auth` is: one tool creates tables, so there is one place to
look when they are not there.

```sql
create table invite_codes (
    code        text primary key,
    label       text        not null,
    max_uses    integer     not null default 1,
    uses        integer     not null default 0,
    expires_at  timestamptz,
    revoked_at  timestamptz,
    created_at  timestamptz not null default now()
);

alter table users add column invited_with text references invite_codes(code);
```

`label` is not optional. A code with no label is a code you cannot revoke with
confidence six weeks later, because you no longer know who has it.

`uses` is a counter rather than a derived count, because it is what the
validity check reads. `invited_with` is the attribution record and can
disagree with `uses` by one in the race described below; the counter is
authoritative for admission, the column for "who came in on what".

### Code format

`XXXX-XXXX`, uppercase, from Crockford base32 **minus `I L O U`**:

```
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

32⁸ ≈ 1.1 × 10¹² combinations. No two characters in the alphabet look alike, so
a code read aloud or typed from a screenshot survives the trip.

Stored uppercase; input is uppercased and stripped of the separator before
lookup, so `7f2k-qx91`, `7F2KQX91` and `7F2K-QX91` are the same code. This is
the same class of trap as the username lowercasing that locked out `Liam` —
normalise on the way in, once, in the shared module.

---

## Redemption

**Validate read-only in `hooks.before`. Redeem in
`databaseHooks.user.create.after`** — the hook that already inserts into
`public.users`, so the MyGist account and the redemption record are written in
the same step.

The alternative is reserving the use up front (`update ... set uses = uses + 1
where uses < max_uses returning *`). That is atomic, and it burns a use whenever
sign-up subsequently fails — most obviously on a duplicate username, which is a
thing testers will hit. A tester who mistypes a username and is then told their
code is spent has been failed by the system.

**The accepted failure mode:** two people racing the last use of a code can both
be admitted, taking `uses` to `max_uses + 1`. With hand-minted codes this is
visible in `list` and harmless. The trade is deliberate — over-admitting by one
on a genuine race is better than rejecting someone holding a valid code.

If the codes ever become self-serve rather than hand-minted, revisit this: at
that point silent over-admission stops being visible.

### Validity

A code admits when **all** hold:

- it exists
- `revoked_at is null`
- `expires_at is null or expires_at > now()`
- `uses < max_uses`

Rejection is one message — *"That invite code isn't valid."* — for every one of
those. Distinguishing "expired" from "already used" from "never existed" tells a
guesser which codes are worth pursuing, and tells a genuine tester nothing they
can act on. They will message you either way.

---

## The screen

Two steps, because the code should fail fast rather than after a filled-in form.

```
  ┌─────────────────────────────────────┐     ┌─────────────────────────────────┐
  │  MyGist is in closed testing        │     │  Create your account            │
  │                                     │     │                                 │
  │  ┌───┬───┬───┬───┐ ─ ┌───┬───┬───┬───┐    │  ┌───────────────────────────┐  │
  │  │ 7 │ F │ 2 │ K │   │ Q │ X │ 9 │ 1 │    │  │ Username                  │  │
  │  └───┴───┴───┴───┘   └───┴───┴───┴───┘    │  └───────────────────────────┘  │
  │                                     │     │  ┌───────────────────────────┐  │
  │  Enter your invite code             │ ──► │  │ Password                  │  │
  │                                     │     │  └───────────────────────────┘  │
  │  Already have an account? Sign in   │     │        invite 7F2K-QX91 ✓       │
  └─────────────────────────────────────┘     └─────────────────────────────────┘
```

**Step 1** is `input-otp`: 8 slots, separator after the fourth, `pattern`
restricted to the alphabet above, auto-uppercase. Format is checked locally
before any request, so a short or mistyped code costs no round trip and no
rate-limit budget.

**Step 2** is the existing username/password form, unchanged, with the accepted
code shown and the ability to go back.

**Sign-in is never gated.** Existing accounts, and testers returning, go
straight to the sign-in tab without a code. Only account *creation* passes
through step 1.

**`?invite=7F2K-QX91`** validates in the background on load and lands the tester
directly on step 2. Most testers never see step 1; it exists for whoever arrives
without a link.

### On this being a screen rather than a gate

Step 1 does not protect anything. The code it accepts can be exhausted in the
seconds before the tester picks a password, so `hooks.before` validates again at
creation. Step 1 is there to fail fast and to set the expectation; the gate is
server-side and always was.

The cost is `/auth/invite/check`, which answers whether a code is valid and is
therefore an enumeration oracle that does not otherwise exist. At 32⁸ with ~100
codes live, a guesser at 100 requests per second needs roughly three years for a
single hit, and Better Auth's rate limiting sits on top. Accepted knowingly.

### Styling

`input-otp` ships headless; shadcn's wrapper ships Tailwind defaults. Neither is
adopted verbatim. The slots convert to MyGist's tokens — `border`, `card`,
`--radius` 0.5rem, `FOCUS_RING` from `frontend/src/components/controls.jsx`,
Geist Mono for the characters — matching every other control in the app.

`frontend/` has no `components.json`, so the component is adapted by hand rather
than through `npx shadcn add`, which would want an `init` that rewrites
`tailwind.config.js` and the global stylesheet.

---

## Minting

`backend/scripts/access.py`, beside `seed_better_auth.py` and run the same way —
in the container, where `DATABASE_URL` already is.

**This was `invite.py` until the waitlist arrived.** The waitlist had no tooling
at all, so reading the queue meant raw SQL — and the operation that matters,
"send this person a code", spans both halves and belonged to neither. The two
are one script now, with `list` renamed to `codes` so the noun is never
ambiguous.

```
$ python scripts/access.py mint --label "sarah (course)"
  7F2K-QX91   1 use   no expiry

$ python scripts/access.py mint --label "reddit thread" --uses 10 --expires 30d
  3B8M-KP44   10 uses   expires 2026-08-30

$ python scripts/access.py codes
  CODE       LABEL            USED   EXPIRES      STATUS
  7F2K-QX91  sarah (course)   1/1    —            spent
  3B8M-KP44  reddit thread    4/10   2026-08-30   active

$ python scripts/access.py revoke 3B8M-KP44
  3B8M-KP44 revoked. 4 accounts already created with it are unaffected.
```

## Working the waitlist

```
$ python scripts/access.py waitlist
  EMAIL                                  JOINED       INVITED
  maya@example.com                       2026-08-09   —

  1 waiting.

$ python scripts/access.py admit maya@example.com --expires 30d
  maya@example.com
  QF4T-8N2K   1 use   2026-09-09

  0 still waiting.
```

`admit` mints and stamps in one command, which is the whole reason the two
halves share a script: run separately, you send a code and forget the stamp, and
the list quietly disagrees with the codes.

The code is minted **before** the row is stamped. If the stamp fails you have a
spare code and a row that still says waiting, which running the command again
fixes. The other order marks someone invited who never received anything, and
nothing in the system would ever show it.

Running `admit` twice mints a second code — the first email bounced, it happens
— but never moves `invited_at`, because that column answers "when did we first
tell them" and the answer does not change because you ran a command twice.

Revoking closes a code to new sign-ups and does nothing to accounts already
created with it — stated in the output, because the opposite is a reasonable
thing to assume and a bad thing to discover.

Minting requires database access. That is the whole authorisation model, and it
is stronger than any admin role this project would otherwise build.

---

## Configuration

`INVITE_ONLY` — `true` turns the mode on. Read by **both** services:

| Service | Reads it for |
|---|---|
| auth | whether `hooks.before` enforces |
| API | whether `/api/auth/register` returns 403, and what `/api/instance` reports |

Each reads it in **one function**, so a later feature-flag system replaces two
functions rather than every call site.

**Both log the mode at boot.** A deploy with the variable set on one service and
not the other leaves a door open, and the failure is silent — nobody notices an
ungated sign-up endpoint until someone walks through it. The auth service
already prints a preflight line; this joins it:

```
[preflight] database mygist_local as mygist — all 5 better_auth tables visible
[invite] invite-only ON — 3 active codes
```

The count is there so that turning the mode on with no codes minted, which
locks out everyone including you, is visible in the same line.

---

## Tests

**`auth/`** (`node:test`, already wired into CI) — the validity rule, which is
the part with real logic:

- unknown code rejected
- revoked rejected
- expired rejected; `expires_at` in the future accepted
- `uses = max_uses` rejected; `uses < max_uses` accepted
- lowercase and separator-less input accept the same code
- every rejection returns the same message
- the gate is inert when `INVITE_ONLY` is off

**`backend/`** (pytest) — the door and the CLI:

- `/api/auth/register` 403 when on, works when off
- `/api/instance` reports the mode
- mint produces a code in the alphabet and never one containing `I L O U`
- revoke closes it; accounts already created keep working
- `list` shows spent, active and revoked distinctly

**`frontend/`** (vitest) — the screen:

- step 2 is unreachable until a code is accepted
- a malformed code is rejected without a network call
- `?invite=` prefills and skips to step 2
- an invalid `?invite=` lands on step 1 with the error, not a blank screen
- sign-in is reachable without a code

---

## Consequences to accept

**Detached-mode registration is off while testing.** Anyone pointing a UI at
this instance from another origin cannot create an account. Sign-in with an
existing token still works.

**A race can over-admit by one.** Described above. Chosen over burning a valid
tester's code on a failed sign-up.

**`/auth/invite/check` is an enumeration oracle.** Bounded by the alphabet size
and rate limiting; accepted.

**Turning the mode on with no codes minted locks everyone out**, including you.
Mitigated by printing the active count at boot, not prevented.

**One new runtime dependency**, `input-otp`, against a standing rule that says
not to. Headless, zero transitive dependencies; taken deliberately.

---

## Open questions

None blocking. Two worth revisiting after testing starts:

- **Does a tester need more than one account?** Currently a spent code cannot
  make a second. Probably right; worth confirming with a real tester.
- **Should expiry be the default rather than opt-in?** A code with no expiry is
  a code that outlives the test it was minted for.

---

## First step

The spike is done and both answers came back the way this design needed, so the
next step is migration `0005_invite_codes` and `auth/src/invite.js` with its
tests. The rule and the table are what everything else depends on, and both can
be proven before a single line of UI exists.
