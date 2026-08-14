# Auth slice — design

Date: 2026-08-14
Status: approved, not yet planned
Umbrella: `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md` (slice 5, second half)
Prototype: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`
First half: `docs/superpowers/specs/2026-08-14-settings-slice-design.md`

## Read this first

Slice 5 was split in two. 5a rebuilt the settings dialog. This is the rest: the
screens shown to someone who has no credential, plus the consent screen an OAuth
client sends them to.

Two rulings were recorded in the 5a spec so this slice would not ask again:

> **"Use an access token instead" is removed** from the sign-in screens, per the
> prototype's change 5 ("BetterAuth supersedes it").
>
> **Auth validation goes per-field on blur**, with the form-level line kept for
> errors the server reports.

Both stand. One sentence of the first ruling's justification was wrong, and the
correction is below.

### The umbrella row overstates what is left

Slice 5's row in the umbrella spec reads "`AuthShell` three states, `InviteGate`
segmented field, `ResetPassword` match hint, ... `Consent` with a neutral Deny".
Checked against the code:

- `InviteGate` **already is** the segmented field — four cells, a prerendered
  dash, four cells, through `input-otp` (`InviteGate.jsx:132-143`). Nothing to
  build.
- `Consent` **already** states grants in plain language and **already** pairs
  Allow with a neutral `variant="outline"` Deny (`Consent.jsx:285-303`).

So the prototype's auth section is mostly shipped. What is genuinely missing is
narrower than the row suggests, and this spec is scoped to it rather than to
re-treading the row.

## What exists today

| File | Lines | Tests |
|---|---|---|
| `AuthShell.jsx` | 51 | none of its own |
| `WelcomeAuth.jsx` | 501 | 30 |
| `InviteGate.jsx` | 188 | 15 |
| `ResetPassword.jsx` | 127 | 9 |
| `Consent.jsx` | 327 | 16 |

Seventy tests across four files. All of them stay green; this slice adds to them
rather than replacing them.

Render sites: `App.jsx:96` (the `/sign-in` path, used mid-OAuth-flow),
`App.jsx:613` (first run), `App.jsx:559` (`ResetPassword`), `App.jsx:81`
(`Consent`).

## Correction: deleting the token link does strand a case

The 5a spec justified the deletion this way:

> Checked before agreeing: it strands nobody. The manual-token field stays
> reachable from the Connection Failed screen's Configure Server button
> (`App.jsx:660`).

That is not true. `App.jsx:309` reads:

```js
const showingAuth = error && !hasCredential;
```

and the `if (error)` branch that draws Connection Failed sits *below* the two
`showingAuth` branches. With no credential you get the welcome screen; you never
reach Configure Server. So the link at `WelcomeAuth.jsx:485` is currently the
only route to the token field on a first run, and deleting it also leaves the
`SettingsDialog` mounted at `App.jsx:631` with nothing to open it.

**Ruled by the owner: accept the gap.** They are the only person testing, and a
bare access token is not how anyone is expected to arrive. Stated plainly rather
than hidden: after this slice, a first run with no account has **no way to enter
an access token**. The Server panel becomes reachable again the moment a
credential exists, through the header's Settings.

If a second tester ever needs it, the cheapest restoration is not this link. It
is an optional token field inside `WelcomeAuth`'s own Server section, which
already picks cloud versus self-hosted and already stores a token on the
detached path — the affordance would sit next to the server it belongs to
instead of behind a dialog.

What goes, therefore:

- the link and its `<div>` (`WelcomeAuth.jsx:482-498`), keeping the Server
  toggle that shares the row
- the `onUseToken` prop, and both call sites' arguments (`App.jsx:109`, `:619`)
  — including the four-line comment at `:105` that exists only to explain why
  the prop is passed a no-op
- the `SettingsDialog` on the `showingAuth` branch (`App.jsx:631-639`) and the
  fragment wrapping it. `showConnectionSettings` itself stays; the Connection
  Failed branch and the header still use it.

## The Field kit

Every auth form repeats this shape:

```jsx
<div className="space-y-1.5">
  <Label htmlFor="..." className="text-xs font-medium">…</Label>
  <Input id="..." … />
  <p className="text-xs text-muted-foreground">…</p>
</div>
```

Seven times across the auth screens — four in `WelcomeAuth`, two in
`ResetPassword`, one in `InviteGate` — and more in the settings panels.
Per-field errors need a fifth slot in it, so this is the moment to make it a
component.

### Why not the registry's

shadcn's registry does have `field`. It was fetched and read rather than assumed:
248 lines, and its class strings lean on Tailwind v4 features this project does
not have — `nth-last-2:`, the `has-data-[state=checked]:` shorthand, and
`@container/field-group` with `@md/field-group:` variants. This frontend is
Tailwind 3.4 with `tailwindcss-animate` as its only plugin. Adapting it means
rewriting most of what makes it worth adapting.

So: take its API and its `data-slot` convention, write a Tailwind-3 version in
this codebase's existing idiom. About sixty lines in
`frontend/src/components/ui/field.jsx`:

| Export | Renders |
|---|---|
| `Field` | the `space-y-1.5` group, `data-invalid` when it has an error |
| `FieldLabel` | `Label` at `text-xs font-medium`, red when the group is invalid |
| `FieldDescription` | the muted helper line |
| `FieldError` | the message, `role="alert"`, `text-destructive`; renders nothing when there is no error |

The control keeps `aria-invalid` and `aria-describedby` pointing at whichever of
description and error is present. That is not new ground:
`landing/WaitlistForm.jsx:124-148` already does exactly this by hand, and its
choices are the ones being generalised.

`Input` gains one thing: an `aria-invalid:border-destructive` variant, so an
invalid field is visible without the label having to carry it alone.

## Validation on blur

A pure module, `frontend/src/lib/authValidation.js`, tested in the `node`
environment the way `renderers/isoDate.js` is. One function per field, each
returning a message string or `null`.

The messages are the ones already written, moved from the form-level line to the
field they are about:

| Field | When | Message |
|---|---|---|
| username | empty | `Enter a username.` |
| username | empty, sign-in with email accepted | `Enter a username or email.` |
| password | empty | `Enter a password.` |
| password | signing up, under 8 | `Password must be at least 8 characters.` |
| confirm | does not match | `Passwords do not match.` |
| reset email | empty | `Enter the email on your account.` |
| server URL | self-hosted and empty | `Server URL is required.` |
| invite code | short | `An invite code is 8 characters.` |

Four rules govern when they appear, and each exists because the alternative is
worse:

1. **A field is checked on blur only once it has been touched.** Nothing is red
   on first render, and tabbing through an untouched form does not paint it.
2. **An error clears on change, not on the next blur.** The alternative is a red
   field with a red message sitting under the correction being typed into it.
   `WaitlistForm.jsx:117-121` already works this way.
3. **Submit still checks everything.** Enter submits a form in which nothing was
   ever blurred, so the submit-time check is not replaced by the blur one — the
   blur one only moves the failure earlier.
4. **The form-level line stays**, for what the server says. A wrong password and
   a taken username are not field shape; they are answers, and they arrive after
   a round trip.

Confirm-password is the one field checked against another. It validates on its
own blur, and re-validates when the password above it changes — otherwise fixing
the first field leaves a stale "do not match" under the second.

`ResetPassword`'s "live match hint" from the prototype is this same rule: the
mismatch message under Confirm, appearing as soon as the field is left rather
than at submit.

## The card's heading follows the card's state

`AuthShell` takes `title` and `description` as props, and `App.jsx` supplies
them at the point it mounts `WelcomeAuth` inside. So the heading cannot change
when the form does. On the first-run screen the result is:

> **Welcome to MyGist**
> Your portable personal context for AI. Sign in or create an account to get
> started.

sitting above a *forgot password* form, and above the invite gate. The
prototype's "sign in, sign up and forgot become three states of one card" means
the heading is part of the state, not a frame around it.

**`WelcomeAuth` renders `AuthShell` itself**, and takes an `intent` prop for the
one thing `App` knows and it does not — whether this sign-in is the app's own or
the middle of an OAuth flow.

| intent | mode | Title | Description |
|---|---|---|---|
| `app` | signin | Welcome to MyGist | Your portable personal context for AI. |
| `app` | signup | Create your account | One account, and every AI client you use reads the same persona. |
| `app` | forgot | Reset your password | We will email you a link. |
| `app` | invite gate | You need an invite | MyGist is in closed testing. |
| `connect` | signin | Sign in to connect | Sign in to let this application connect to your persona. |
| `connect` | signup | Create your account | You will be asked to approve the connection next. |
| `connect` | forgot | Reset your password | We will email you a link. |
| `connect` | invite gate | You need an invite | MyGist is in closed testing. |

Copy stays short and says only what is true. "One account, and every AI client
you use reads the same persona" is the product in one line; the alternative
drafts either promised something the app does not do yet or padded the sentence.

The gate's copy is the same under both intents: it is a statement about the
instance, and nothing about it changes because a client is waiting.

Both `App.jsx` call sites then collapse to `<WelcomeAuth intent="…"
onSuccess={…} />` with no `AuthShell` around them. `AuthShell` itself is
unchanged and keeps its other callers — `ResetPassword`'s two states and
`Consent`'s five.

## Consent's rows become checkboxes

The prototype specifies a `CheckboxGroup`; the code uses `Switch`. This is not
cosmetic. A switch means the thing it controls is on or off *now* — that is how
it is used everywhere else in this app, in Preferences and in the autosave
setting. These rows are neither: they are a description of a grant that does not
exist until Allow is pressed. A checkbox is the control for "this is what I am
agreeing to".

Adds `frontend/src/components/ui/checkbox.jsx` and
`@radix-ui/react-checkbox@^1.3.11`. Checked against the skew that caused 5a's
dropdown bug: that release declares `@radix-ui/react-primitive@2.1.10` and
`@radix-ui/react-presence@1.1.10`, which are exactly the versions the
`overrides` block already pins. Nothing duplicates, and `overrides` needs no
change.

The read row stays checked and disabled — it is granted whenever it is asked for
and cannot be withdrawn, and `Consent.jsx:250-258` already says so in its help
text. Radix renders a disabled `role="checkbox"`, so `getByLabelText` and
`toBeChecked` keep working and the existing assertions
(`Consent.test.jsx:66,74`) do not change.

The two mutable labels come from `SCOPE_LABELS` in `lib/scopes.js` — the
constant 5a extracted for exactly this. The help text under each stays local:
it is longer than a label and one line of it is conditional on `write`.

The implication logic (`onWriteChange`, `onProposeChange`), the `carried` scopes,
and the four terminal states are untouched. Nothing about what gets posted
changes.

## The small ones

- **`AuthShell` re-inlines the logo.** `landing/Brand.jsx` exports `Mark` for
  this, taking `currentColor`. `AuthShell` uses it.
  `shell/Header.jsx:40-62` holds a third copy of the same path data; that is
  slice 1's file and out of scope here, noted so the next person finds it.
- **400px, not `max-w-sm`.** The prototype's auth card is 400 wide; `max-w-sm`
  is 384. A 16px difference nobody will notice, changed because it costs one
  token and leaves the file matching the spec it was built from.
- **The invite helper stops claiming the dash is optional.** It reads "case and
  the dash do not matter", written when the field was one text input. The dash
  is now prerendered between the two groups and cannot be typed into. Round-2
  change 6 calls this out directly. New copy: "MyGist is in closed testing.
  Paste the code from your invite — case does not matter."

## Testing

Existing: 70 tests across the four auth test files, plus 5 in
`App.onboarding.test.jsx`. All stay green. Expected churn is confined to the
`onUseToken` prop and to any test asserting the old heading copy.

New:

- `lib/authValidation.test.js` — `node` environment, one case per rule in the
  table above, including the ones that must *not* fire.
- Per-field blur tests in `WelcomeAuth.test.jsx` and `ResetPassword.test.jsx`:
  the message appears on blur, does not appear before the field is touched,
  clears on change, and still appears on a submit with nothing blurred.
- `Consent.test.jsx` gains one: the read row cannot be unchecked.

No Storybook story. The three that exist are there because jsdom cannot see
`pointer-events`, geometry, or the CSS cascade — nothing in this slice depends
on any of them. Adding one would be cargo cult, and would not run on a PR
anyway (see the risk below).

## Out of scope

- `shell/Header.jsx`'s copy of the logo path.
- Motion on the auth screens. `08 Motion` is a later phase of the prototype
  build and nothing in the app has it yet.
- Anything server-side: the invite alphabet, the reset token lifetime, Better
  Auth's endpoints.
- The token field's restoration, ruled above.
- The four native time inputs still using `color-scheme`, flagged during 5a.

## Risks

- **The Storybook project does not run on a PR.** `ci.yml` runs
  `npm test -- --project unit`, so any browser-mode test is checked locally
  only. This slice adds none, so nothing new is at risk — recorded because the
  gap is still open.
- **`main` has no wall clock on its test run.** The guard built after the
  runaway vitest worker sits unmerged on `fix/runaway-test-guard`, so
  `npm test` on `main` is still `vitest run` with no external timeout. This
  slice runs the suite repeatedly. Merging that branch first is the cheap
  insurance.
- **`WelcomeAuth` is 501 lines and this slice adds validation state to it.**
  Splitting it (a form per mode) is tempting and is not being done: its four
  modes share the invite state, the server state, and the submit path, and the
  routing effects at `:137-182` coordinate all of them. A split along mode lines
  would duplicate that coordination three times. The Field kit is what takes
  lines out; the file should come down, not up.
