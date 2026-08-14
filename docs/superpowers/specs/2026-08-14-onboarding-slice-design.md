# Onboarding slice — design

Date: 2026-08-14
Status: approved, not yet planned
Umbrella: `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md` (slice 4)
Prototype: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`

## Read this first

The "## Onboarding" section of the reshaped-design spec **describes a design
that was reversed**. Its own header says so. It documents onboarding as a rail
destination inside the app shell; the prototype was later rebuilt, at the
owner's direction, as a **standalone stepped flow with no app shell**.

The divergence record is the authority. Read together, it says:

- The **standalone flow** — `Welcome`, `About you`, `How you like answers`,
  `Complete`, plus a mobile variant — is the work itself.
- The **spine card** survives deliberately, living on the Profile screen as the
  entry point and resume affordance.
- Neither supersedes the other.

This spec builds both. Nothing here comes from the reversed section except the
field list and the scope caveat, both of which the divergence record leaves
standing.

## What exists today

Nothing. There is no onboarding in the frontend or the backend — one stale
comment in `SectionRenderer.jsx:124` mentions "the old onboarding" and that is
all. This slice is greenfield, which is why it is worth being precise about
what it may lean on.

## Routing

`#/onboarding/about-you` already parses as `{section: "onboarding", band:
"about-you"}`. The step **is** the band, so `parseRoute` needs no change.

`lib/routes.js` gains, beside `AUTH_ROUTES` and `isAuthRoute`:

```js
export const ONBOARDING_STEPS = ["welcome", "about-you", "how-you-like", "complete"];
export function isOnboardingRoute(section) { return section === "onboarding"; }
```

`App.jsx`'s render decision goes from two-way to three:

1. no credential → the auth screens
2. credential, and `section === "onboarding"` → the flow, with no shell
3. otherwise → the shell

That is one added branch. It keeps the promise `routes.js` already makes in its
own header — that the families never appear at once — rather than quietly
breaking it.

An unknown step (`#/onboarding/nonsense`) is corrected to `welcome` with
`replaceState`, matching how the shell already handles an unknown band. A
correction nobody navigated to must not become a history entry.

## The four screens

| Screen | Holds |
| --- | --- |
| **Welcome** | What this is, the delegate offer, `Get started` and `Skip for now` |
| **About you** | `name`, `preferred_name`, `current_role`, `organisation`, `location`, `bio` |
| **How you like answers** | `tone`, `locale`, `detail_level`, `response_format` |
| **Complete** | What was filled, optional extras, and the way into the app |

Every About-you field and `tone`/`locale`/`detail_level` were confirmed present
in the v2 manifests. Two notes for planning:

- **`detail_level` is typed `longtext`, not `enum`.** It gets a textarea, not a
  select, unless the manifest says otherwise at planning time.
- **`response_format` is a list entity** whose identifier is `item`, so it is a
  chip input rather than a single field.
- **`learning_style.preferred` / `.avoid` did not resolve** in the manifest
  walk. The reversed section listed them. They are **out of scope** unless
  planning finds them, and planning must not invent a path.

  **Corrected 2026-08-14, during planning: they do resolve.** They are
  `kind: "strings"` nodes at `["learning_style", "preferred"]` and
  `["learning_style", "avoid"]`, inside the Learning Style **group** in
  `preferences/manifest.json`. The original walk read
  `sections[].element.fields` and missed them, because a group holds its
  children under `sections` -- the same key the top level uses -- not
  `children`. They stay out of the flow anyway, on scope grounds rather than
  availability: `How you like answers` already carries four controls, and six
  would make it a form rather than a step.

### The delegate offer belongs on Welcome

Above everything, before any field. The divergence record shows this was
specifically moved there after first landing below a step's own fields — the
point is that delegating is a choice offered *before* the work, not a
consolation found after it.

### Complete carries the optional extras

The reversed section had four field bands; the prototype has two. `top_of_mind`
and one `goal.title` are offered on Complete as a quick optional add, so the
flow stays short without losing the fields entirely.

### Fields reuse the editor's controls

`components/controls.jsx` and the existing field components, not bespoke
inputs. The reversed section made this argument and it survives the reversal
intact: the flow teaches the interface by being the interface, and it cannot
drift from the editor's design because it is that design.

## The spine card

Lives on the Profile screen. Three steps, and it routes rather than collects.

```
┌──────────────────────────────────────────────────────────────┐
│ Getting started                                 1 of 3   ✕   │
│                                                              │
│ ✓ 1  Connect a client            ● connected · Claude        │
│   2  Fill in the basics                    [ Start ]         │
│   3  Ask your client to fill in the rest   optional          │
└──────────────────────────────────────────────────────────────┘
```

### Step 1 says only what is true

`waiting for first call… → connected · <name>` is detectable for one connection
type and not the other, and the card says what it can prove:

- **Token connection.** `tokens.last_used_at` is touched only by
  `db.resolve_token`, so a non-null value is genuine evidence a client called.
  The name comes from `tokens.label`. This gets the real waiting-then-connected
  moment.
- **OAuth grant.** OAuth clients authenticate as Better Auth JWTs through
  `db.resolve_user_by_id`, which the **web app itself also uses**, so
  `users.last_seen_at` cannot distinguish a client call from the reader
  browsing their own persona. The card shows connected and names the client
  from the consent row, and does not claim a call landed.

Per-grant call tracking was considered and rejected for this slice: it is new
state, a migration, and a write on a hot auth path, to earn one word of copy.

### Step 3 and the silent-failure trap

Step 3 is a copy-paste prompt the client runs, using `propose_update`. No
backend work, nothing written directly, and the reader's first real task
becomes approving rows in Review — which teaches the review mechanic on day
one.

The trap: `mcp_scopes.py` **hides** out-of-scope tools rather than failing
them. A connection without `propose` makes the pasted prompt do nothing at all,
with no error anywhere. So where `propose` is absent, step 3 says so and points
at reconnecting instead of offering a copy button. Without this the feature's
failure mode is complete silence.

### Dismissal is not destructive

Dismissing hides the card. Nothing is deleted: the flow is a view over fields
that already exist, and `#/onboarding/welcome` still works if typed.

**Where it comes back from, corrected.** The reversed section said "the account
menu". There is no account menu — `shell/Header.jsx:112` has an account
*button* that opens Connection Settings. So the restore control is one entry in
**Connection Settings → Account**, which that button already reaches.

That is a foothold into slice 5, which owns `ConnectionSettings`. The umbrella
spec's rule is that footholds are ruled in deliberately rather than discovered,
so it is ruled in here: one control, in the panel the account button already
opens, rather than a header dropdown built for a single item.

## Onboarding state

`/api/settings` is not a general settings store. GET returns section
enablement plus pack metadata; PUT's `SettingsUpdate` accepts only
`disabled_sections` and `enabled_sections`. The `settings_store` blob is
free-form on the Python side, but nothing reaches it over HTTP.

So this slice adds one key, end to end:

```json
"onboarding": { "dismissed": false, "steps": { "about-you": "done", "how-you-like": "skipped" } }
```

- `settings_store` gains `get_onboarding()` / `set_onboarding()`, in the style
  of the existing `get_disabled_sections` / `set_disabled_sections` pair.
- `GET /api/settings` returns `onboarding`.
- `SettingsUpdate` gains an optional `onboarding` field, validated: unknown
  step keys and unknown status values are rejected, the same way an
  undisablable section is rejected today.

Storing it rather than deriving it buys one thing that matters: **skipped is
distinct from empty**. A reader who deliberately passed over a step has not
failed it, and a progress count derived from field values could not tell the
difference.

## First run

A brand-new account lands on `#/onboarding/welcome` rather than an empty
Profile. That is the moment intent is highest, and Welcome carries the delegate
offer, so handing the work to a client is offered before any typing.

It is **skippable throughout**. `Skip for now` on Welcome, and leaving at any
point, both go to Profile with the spine card showing. Nothing blocks.

The trigger is the signup moment, which the client already knows without
asking the server anything.

## Saving

Autosave through the existing `/files/{key}` endpoint, one request per affected
section, debounced identically to the editor. There is no onboarding-specific
write path.

This is what makes the flow genuinely non-blocking: leaving mid-step costs
nothing, and there is no "finish" to abandon.

## Testing

- **`routes.js`** — pure, so `isOnboardingRoute` and the step list are table
  tests. An unknown step corrects to `welcome` via `replaceState`, not
  `pushState`.
- **The three-way render branch in `App.jsx`** — the case worth pinning is that
  a credentialed reader on `#/onboarding/welcome` sees no rail and no header,
  since the whole point is the absent shell.
- **Step 1's two connection types** — a token with `last_used_at` null shows
  waiting; non-null shows connected and its label; an OAuth grant shows
  connected without a waiting state. Three tests, one per truth.
- **The `propose`-absent branch** — step 3 offers no copy button and says why.
  This is the silent-failure guard and it is the one most worth having.
- **Backend** — `onboarding` round-trips through GET and PUT; an unknown step
  key is rejected; an unknown status is rejected; an absent key defaults rather
  than erroring for accounts that predate it.
- **Autosave** — a field edited on About you writes to `/files/profile`, and
  leaving mid-step does not lose it.

## Out of scope

- **Per-grant MCP call tracking**, as above.
- **`learning_style`**, unless planning finds a real path.
- **The mobile variant** of the flow beyond what the existing responsive
  patterns give for free. The prototype has one; matching it pixel for pixel is
  not this slice's job.
- **Re-running the flow from the account menu.** Dismissal returning from the
  account menu is in scope; a full replay of the stepped flow is not.

## Files touched

Frontend:

- `lib/routes.js` — `ONBOARDING_STEPS`, `isOnboardingRoute`
- `components/onboarding/OnboardingFlow.jsx` — new, the shell-less container
- `components/onboarding/StepWelcome.jsx` — new, carries the delegate offer
- `components/onboarding/StepAboutYou.jsx` — new
- `components/onboarding/StepHowYouLike.jsx` — new
- `components/onboarding/StepComplete.jsx` — new, optional extras
- `components/GettingStartedCard.jsx` — new, the spine on Profile
- `App.jsx` — the third render branch, first-run redirect
- `lib/api.js` — `onboarding` on the settings helpers

Backend:

- `settings_store.py` — `get_onboarding` / `set_onboarding`
- `main.py` — `onboarding` on GET and on `SettingsUpdate`
- `tests/test_settings_store.py` — the store accessors
- `tests/test_settings_api.py` — the round-trip and validation cases

Slice 5's file, reached deliberately:

- `components/ConnectionSettings.jsx` — one control to bring the spine card
  back, per "Dismissal is not destructive" above
