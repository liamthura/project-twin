# Settings slice — design

Date: 2026-08-14
Status: approved, not yet planned
Umbrella: `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md` (slice 5, first half)
Prototype: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`

## Read this first

The umbrella spec's slice 5 is one row covering seven components across two
surfaces: the settings dialog behind the account button, and the screens shown
to someone with no credential. They share almost no code. Split, at the owner's
direction, into two specs:

- **5a, this one.** The settings dialog: `ConnectionSettings`, `ConnectedApps`,
  `EmailSettings`.
- **5b, later.** `AuthShell`, `WelcomeAuth`, `InviteGate`, `ResetPassword`,
  `Consent`.

Slice 2 was split the same way, into editor, manifest format v2 and field
patterns.

### Two rulings recorded here for 5b

Both were decided while scoping this slice. They are written down so 5b starts
from them rather than asking again.

**"Use an access token instead" is removed** from the sign-in screens, per the
prototype's change 5 ("BetterAuth supersedes it"). Checked before agreeing: it
strands nobody. The manual-token field stays reachable from the Connection
Failed screen's Configure Server button (`App.jsx:660`), and a detached first
run can still sign in through the Server toggle, which uses the old
username/password endpoints and returns a token.

**Auth validation goes per-field on blur**, with the form-level line kept for
errors the server reports.

## What exists today

`frontend/src/components/ConnectionSettings.jsx` is 1172 lines with 10 tests,
plus 3 in `ConnectionSettings.onboarding.test.jsx`. That is the worst
coverage-to-size ratio in the frontend, and it is the file this slice rebuilds.

It holds four panels behind a hand-rolled segmented row:

| Tab | Holds |
|---|---|
| `connection` | signed-in row and Sign out, `EmailSettings`, the auto-save preference, the getting-started restore, cloud/self-hosted toggle, server URL, manual token entry, test result, current API, change-password disclosure |
| `tokens` | the list, revoke confirm, create form with scope switches, the reveal panel |
| `apps` | `ConnectedApps` |
| `data` | export, import, import mode |

Three render sites in `App.jsx` (631, 673, 857) and one import (25).

### Dead code

`ConnectionStatus` is exported at `ConnectionSettings.jsx:1119` and imported
nowhere. It polls `/health` every 30 seconds. Slice 1 replaced it with the
header's Disconnected badge and left this behind. This slice deletes it.

### Three copies of the scope constants

`persona:read`, `persona:propose` and `persona:write` are declared in
`ConnectionSettings.jsx:60`, `ConnectedApps.jsx:45` and `Consent.jsx:48`. Each
carries a comment saying it must match the others exactly. Their plain-language
labels are duplicated too.

## Decomposition

`frontend/src/components/settings/`, following `components/onboarding/`.

| File | Holds |
|---|---|
| `SettingsDialog.jsx` | the `Dialog`, the tab row, which panel is up |
| `AccountPanel.jsx` | identity, `EmailSettings`, password, preferences, sign out |
| `ServerPanel.jsx` | which instance, the custom-server state, test, save, reset |
| `TokenPanel.jsx` | the list, the create form, the reveal panel |
| `AppsPanel.jsx` | the fetch, wrapping `ConnectedApps` |
| `DataPanel.jsx` | export, import, import mode |
| `settingsTabs.js` | the tab vocabulary and the gating rule. Pure |

`ConnectionSettings` is renamed `SettingsDialog`. The name stopped describing the
component several features ago, and three render sites is a cheap rename.

`ConnectedApps.jsx` and `EmailSettings.jsx` stay where they are. Both are
already single-purpose and tested; moving them would churn imports for nothing.

### The tab row becomes shadcn `Tabs`

Today's row is `<button>` elements styled by `segmentClass`. They carry no
`role="tab"`, so the app's main settings surface has no tablist semantics and no
arrow-key navigation. `ProposalsPanel.jsx:6` already uses shadcn `Tabs`; this
matches it.

`segmentClass` stays for the two genuine segmented controls: import mode here,
and the server toggle in `WelcomeAuth`. Its header comment needs updating, since
it names the tab row it will no longer style.

### One scopes module

`frontend/src/lib/scopes.js` replaces all three copies:

```js
export const READ = "persona:read";
export const PROPOSE = "persona:propose";
export const WRITE = "persona:write";
export const PERSONA_SCOPES = [READ, PROPOSE, WRITE];

// One row each, in the order a grant widens. Read is the floor for every
// grant, so callers list it unconditionally rather than checking for it.
export const SCOPE_LABELS = [
  [PROPOSE, "Suggest changes for your approval"],
  [WRITE, "Change your persona directly"],
];

// One compact line, for a token row that has no space for three.
export function summariseScopes(scopes) // → string
```

`summariseScopes` is built from the scopes actually present rather than from the
widest one found. A token minted through this dialog always satisfies
`write ⊃ propose ⊃ read`, but one created directly against
`POST /api/auth/tokens` need not, and reporting `read + write` as "Read, propose
and change directly" would claim a permission the token does not carry.

| Scopes | Line |
|---|---|
| `read` | Read only |
| `read`, `propose` | Read and propose |
| `read`, `propose`, `write` | Read, propose and change directly |
| `read`, `write` | Read and change directly |

`Consent.jsx` is 5b's file, and this slice changes its import. That is a
foothold, ruled in here rather than discovered later, per the umbrella's rule.
It is an import swap with no change to what renders. Leaving a third copy of a
must-match-exactly constant while editing its two siblings is the worse option.

## The tabs

`Account · Server · Tokens · Connected apps · Data`. The prototype's four, plus
Data.

The prototype has no Data tab, and never designed export or import at all — the
word backup appears in it once, as the name of an example token. Export and
import are working features, so Data stays as a fifth tab rather than being
folded into Account, which would otherwise hold email, password, sign out, two
preferences, export and import.

### The gating rule inverts

Today every tab but `connection` is disabled without a credential, because
`connection` is the one holding server configuration. Once identity and server
configuration are separate tabs, the rule reverses: **Server is the only tab
available without a credential, and it is the default in that state.** Account is
the default when signed in.

This is why the tab could not be split before now. Account identity was mixed
into the one panel that has to stay open to a signed-out user.

```js
// settingsTabs.js
export const SETTINGS_TABS = [
  { id: "account", label: "Account", needsCredential: true },
  { id: "server", label: "Server", needsCredential: false },
  { id: "tokens", label: "Tokens", needsCredential: true },
  { id: "apps", label: "Connected apps", needsCredential: true },
  { id: "data", label: "Data", needsCredential: true },
];

export function isTabAvailable(id, isSignedIn)
export function defaultTab(isSignedIn)   // "account" | "server"
```

Five tabs need more width than `sm:max-w-lg` gives them, so the dialog goes to
`sm:max-w-xl` and Connected apps keeps its real label.

## Account

In order: who you are signed in as with Sign out beside it, `EmailSettings`,
the change-password disclosure, then a preferences group holding the auto-save
switch and the getting-started restore.

Those last two are slice 1's and slice 4's footholds. Both carry a comment
saying slice 5 rebuilds this dialog with an Account tab and that they sit in
`connection` only to avoid prejudging it. This is where they were going.

The prototype has Sign out as a red Critical button (change 3 notes it "was
already Critical"). Signing out destroys nothing and costs one click to undo, so
red here teaches that red means be careful rather than this cannot be undone,
which weakens it on revoke, where it matters. Following the prototype, and
flagging it as a judgement call to overrule.

## Server

The prototype's change 7: lead with MyGist Cloud, demote self-hosting to a
one-line hint plus a link, and move the URL field and connection test into their
own custom-server state (`Settings — Server (custom)`, `281:235`).

**Diverging on the first half.** Leading with Cloud reproduces a bug the code
already fixed elsewhere. `ConnectionSettings.jsx:166` reads
`if (!config || savedUrl === CLOUD_API_URL)` and selects Cloud, but `getApiBase()`
with no saved config returns `/api`, the serving origin. So on a self-hosted
instance with no config the dialog shows Cloud selected while talking to itself,
and prints `Current API: /api` two panels below, contradicting its own chip.
`WelcomeAuth.jsx:88-100` documents fixing this same mistake on the sign-up path,
where it sent self-hosters' registrations to `mygist.thuradev.qzz.io` and the
browser rejected the cross-origin preflight.

So the panel leads with **the instance that served this page**, showing the API
base in use. MyGist Cloud is what that resolves to when the serving origin is
the cloud, and nowhere else.

The demotion and the custom-server state both stand:

```
This instance
<the API base in use>

Running the app against a different server? Use a custom server →
```

The link reveals the URL field, the manual token field when there is no
credential, Test connection, and Save. A saved config pointing elsewhere opens
in that state with its URL filled, and offers a way back to this instance —
today's Reset to Default, relabelled to say what it does.

`Use MyGist Cloud` fills the field with `CLOUD_API_URL`, which is the case
`api.js` describes in its own comment: running this UI somewhere other than the
server it talks to.

The dialog footer goes away. Test, Save and the reset belong to the panel that
owns them, not to every tab.

The `Mode: Development (proxied)` line is dropped. The API base above it already
says what is being talked to, and one line is easier to trust than two that can
disagree.

## Tokens

Kept as they are: the row-level revoke confirm, the reveal panel and its warning
that the token will not be shown again, the create form's Name field, and the
scope switches with their `write ⊃ propose ⊃ read` implication. The prototype's
change 8 asks for a Name field, which already exists.

Added, from data the API already returns and the UI currently discards:

- **A grants line**, through `summariseScopes`. `db.list_tokens` returns
  `scopes`; nothing renders it.
- **Expiry**, when `expires_at` is not null. A token that quietly stops working
  is a bad surprise.

The metadata line moves off `font-mono`. It reads as a sentence, not a scope
string, which is the point the prototype's change 9 makes about Connected apps.
`ConnectedApps.jsx` already states its grants in plain language and is not mono,
so change 9 needs nothing there.

**Not built: the masked secret per row.** The prototype's change 8 shows one.
`db.list_tokens` returns `id, label, created_at, last_used_at, expires_at,
scopes`, and its docstring says "Never the hash". There is nothing to mask.
Recorded rather than dropped quietly.

## Connected apps, and Data

Behaviour unchanged. `AppsPanel` takes over the `listConnectedApps` fetch, the
loading and error states, and the revoke toast that `ConnectedApps` depends on
rethrowing. `DataPanel` takes export, import and import mode as they stand.

Both moves are structural. Their tests should pass against the new files with
only the import changed.

## Testing

`settingsTabs.js` and `lib/scopes.js` are pure, so they get table tests: every
tab against both credential states, `defaultTab` for each, and
`summariseScopes` over the four rows above including `read + write`.

`SettingsDialog.test.jsx` covers what the shell owns: which tabs render, which
are disabled without a credential, the default tab in each state, and that the
tab row exposes `role="tab"`.

One test file per panel. The 13 existing tests are redistributed, not deleted:
the 3 getting-started tests move to `AccountPanel.test.jsx`, and the 10 in
`ConnectionSettings.test.jsx` split across Account, Server and Token by what
each asserts.

`App.test.jsx:9` has a comment about `ConnectionSettings` rendering
unconditionally while hidden. The rename touches it.

| Provable | Not provable |
|---|---|
| The gating rule, both states, every tab | that five tabs fit the dialog |
| `summariseScopes`, including `read + write` | that the Server panel reads as leading with this instance |
| The Server panel shows the API base actually in use | whether Sign out should be red |
| Grants and expiry render from `listTokens` | |
| Sign out clears the session and the config | |
| Export and import still work from `DataPanel` | |

## Out of scope

- **5b's screens.** `WelcomeAuth`, `InviteGate`, `ResetPassword`, `AuthShell`
  and `Consent` keep their current behaviour. The one exception is `Consent`'s
  import of `lib/scopes.js`, ruled in above.
- **The masked token secret.** No data exists for it.
- **Backend changes.** None. Every field this slice adds is already returned.
- **`AddEmailBanner`.** It opens this dialog and is unaffected by the rename,
  since it only calls `onOpenSettings`.
- **Reshaped.** Not adopted, carried from phase 2.

## Files touched

Created:

```
frontend/src/components/settings/SettingsDialog.jsx
frontend/src/components/settings/AccountPanel.jsx
frontend/src/components/settings/ServerPanel.jsx
frontend/src/components/settings/TokenPanel.jsx
frontend/src/components/settings/AppsPanel.jsx
frontend/src/components/settings/DataPanel.jsx
frontend/src/components/settings/settingsTabs.js
frontend/src/lib/scopes.js
```

Plus one test file each for the eight above.

Modified:

```
frontend/src/App.jsx                              three render sites, one import
frontend/src/components/ConnectedApps.jsx         imports lib/scopes.js
frontend/src/components/Consent.jsx               imports lib/scopes.js
frontend/src/components/ui/segmented-control.jsx  header comment
frontend/src/App.test.jsx                         one comment
```

Deleted:

```
frontend/src/components/ConnectionSettings.jsx              replaced
frontend/src/components/ConnectionSettings.test.jsx         redistributed
frontend/src/components/ConnectionSettings.onboarding.test.jsx  redistributed
```
