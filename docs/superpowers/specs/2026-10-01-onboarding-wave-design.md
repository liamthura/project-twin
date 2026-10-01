# Onboarding wave

**Date:** 2026-10-01
**Status:** Design agreed in chat; spec awaiting review
**Source:** `.impeccable/critique/2026-10-01T19-52-31Z__components-onboarding-onboardingflow-jsx-eb4ec059.md`
(24/40, three P1s). Release target **0.3.0**.

## Problem

MyGist's idea is that an assistant suggests and you approve. The first run
never gets there. It ends on a Profile form, so the moment that proves the
product (your first suggestion in Review, with its reason, approved) happens
outside it, 6 to 10 minutes and two app switches later, if at all. The manual
path never reaches it.

On the way:

- Connect asks three questions on one screen (which assistant, how to connect
  it, who fills it in): 11 actions, no filled button, the strongest action
  below the fold at 390 and 1440.
- Connect loads once and never checks again, so an assistant that signs in
  from another window goes unseen until a reload.
- The token path is a trap. Once a token exists, the sign-in picker is gone
  from Connect, from the card, and was never in Settings.
- Status claims are untrue: an unused token is ticked, the card's step 3 can
  never be ticked, choosing the assistant path moves the card backwards,
  "Show getting started" wipes progress, and Complete counts the
  `British English` default as something you saved.
- Nothing confirms itself (no "Saved", a silent "Add this"), and only one
  step animates.

## Decisions already made

From the critique questions and the design review (2026-10-01):

1. Onboarding ends on **your first approval**, in Review. The manual path ends
   on your persona with a short tour.
2. Connect **splits into three screens**.
3. driver.js is used in **all four** places: first suggestion, editor tour,
   point-of-use hints, Connect.
4. Scope is **all five issues plus the minors**, with a full copy pass in
   house style.
5. Screens use **the assistant you chose**. Nothing is preselected; "Claude
   Code" in this document is only an example. "Something else" reads as
   "your assistant".
6. The live status is served by **`GET /api/watchtower`**, which is
   `/api/usage` renamed and extended, not a second endpoint.

Assumptions stated in the design and not overruled: no ChatGPT row until its
steps are verified (the rule that keeps Notion AI `unlisted`); the brand mark
is out of scope.

## Design

### 1. The flow

Two paths through one three-part progress bar: **Connect · Fill in · Review**.

```
assistant ──► connect ──► handover ──► Review (first-suggestion guide)
    │                        │
    └──► about-you ◄─────────┘  ("I'll type it myself")
             │
             └──► complete ──► Profile (editor tour)
```

| Step (route) | Phase | Holds |
|---|---|---|
| `assistant` | Connect | Which assistant do you use? Seven rows, two quiet links |
| `connect` | Connect | The chosen assistant's steps, full width, and the live status line |
| `handover` | Fill in | The prompt, then the live status: connected, reading, suggestions waiting |
| `about-you` | Fill in | Basics and how you like answers, with a Saved mark |
| `complete` | Review | What you added, two optional extras, the way in |

- **Step 1.** One sentence, then one row per installable client plus
  **Something else**. Choosing a row moves on; the rows are a list of choices,
  not an accordion. Under the list: *I'll type it myself* (to `about-you`)
  and *Skip for now* (to Profile). On a touch device narrower than `sm`, one
  more line: most assistants connect from a computer.
- **Step 2.** The chosen client's `InstallCard`, full width with no box inside
  a box, then the status line. **Continue** is filled once watchtower reports
  a connection; *Continue without waiting* is always there.
- **Step 3.** **Copy prompt** is the filled button. After copying, the status
  line follows the assistant; when suggestions arrive the button becomes
  **Review N suggestions**, which opens `#/review` and starts the
  first-suggestion guide. Quiet links: *I'd rather type it myself*,
  *Finish later*.
- **The manual path.** About you, then Complete, then Profile, where the
  editor tour starts once.
- **The chosen assistant** is held by the flow and in `sessionStorage`
  (`mygist_onboarding_client`), so a reload keeps it. `connect` or `handover`
  with nothing chosen goes to `assistant`.
- **Old links.** `welcome` goes to `assistant`; `how-you-like` goes to
  `about-you`. `DEFAULT_ONBOARDING_STEP` becomes `assistant`.
- **The progress bar** maps steps to phases, and its fill slides. On the
  manual path the Connect segment stays muted.
- **Stored step statuses go.** The card works "basics done" out from the
  fields (section 3), so nothing reads `steps` any more and the flow stops
  writing it. The server keeps accepting the key, so an old client's write is
  harmless.

### 2. `GET /api/watchtower`

`/api/usage` renamed, with three additions. `/api/usage` answers as a
deprecated alias for one release, because `run/troubleshooting.mdx` told
self-hosters to curl it.

```json
{
  "activity": [ { "client": "claude-code 2.0.14", "method": "tools/call",
                  "tool": "get_context", "calls": 3,
                  "first_seen": "…", "last_seen": "…" } ],
  "connection": { "state": "connected", "name": "Claude Code",
                  "kind": "grant", "can_propose": true, "total": 1 },
  "assistant": { "called": true, "read": true, "suggested": false,
                 "last_seen": "…" },
  "pending": { "entity": 0, "note": 0, "total": 0 }
}
```

- **`activity`** is unchanged: the rows `mcp_activity.usage` returns today.
- **`connection.state`** is `none` (no grant and no token, whatever the
  activity table holds, since its rows outlive a revoked token), `waiting` (a
  grant or token exists and no activity row does), or `connected` (a grant or
  token exists and so does an activity row). This replaces the client-side
  `connectionStatus.js`, which could not tell a grant's call from the web
  app's own traffic. `mcp_activity` can, because only MCP requests reach it.
- **`connection.name`**: the newest grant's registered client name
  (`better_auth."oauthClient".name` through `"oauthConsent"`), else the newest
  token's label, else the newest activity label without its version. Names are
  shown as stored; the frontend capitalises the first letter of a token label.
- **`connection.kind`** says which Settings group manages it (`grant` or
  `token`), for "change its access" links.
- **`connection.can_propose`**: any grant or token carrying `persona:propose`
  or `persona:write` (the rule in `scopes.py`).
- **`assistant`**: `called` is any activity row; `read` is a `tools/call` of
  `get_context`, `search_context`, `get_entity` or `get_raw`; `suggested` is a
  `tools/call` of `propose_update`.
- **`pending`** is `proposals_store.pending_counts()`. Like the count endpoint
  it marks nothing seen.
- Scoped to the caller's account like every other read. Grants are read with
  the same text-id cast `db.delete_account` uses.

**The frontend hook.** `useWatchtower({ active })` in `lib/watchtower.js`
polls every 3 s while `active` and the tab is visible, slows to every 10 s after
2 minutes, and stops when `active` turns false. The Getting started card and
Review's empty state fetch it once rather than polling. All three read
`connection` from it, so they cannot disagree.

### 3. Honest status

- **Connected means a call was seen** (section 2). Waiting shows a clock icon,
  never a tick.
- **The Getting started card** has three steps and an optional line:

  | Step | Ticked when | Action |
  |---|---|---|
  | Connect an assistant | `connection.state === "connected"` | **Connect** to `assistant`; *Waiting for …* with a clock while waiting |
  | Fill in the basics | any `about-you` field holds a value you typed (not a manifest default) | **Fill in** to `about-you`; **Edit** once done |
  | Get a first suggestion | `assistant.suggested` | **Copy prompt**, with the paste hint (section 4); *N waiting* links to Review |
  | *Add an email (optional)* | the account has an email | **Add email**, the banner's action |

  While the card shows on Profile, `AddEmailBanner` hides there, so Profile
  has one banner and not two. Everywhere else the banner is unchanged.
- **"Show getting started"** sets `dismissed: false` and leaves everything
  else alone.
- **Complete counts only what you typed.** A value equal to the pack's
  manifest default (`defaults` in the manifest; `British English` for
  `communication.default.locale`) is not counted.
- **Names start with a capital letter** wherever a sentence opens with one
  ("My assistant is set up…").
- **The locale** in About you starts from the browser's language
  (`navigator.language`, as an English name through `Intl.DisplayNames`)
  while the stored value is still the manifest default. It is shown in the
  field and written when you press Continue, so a value you saw and kept is
  saved, and one you never saw is not.

### 4. Guidance with driver.js

`driver.js` 1.8.0, MIT, no dependencies, about 7 KB gzipped plus 1 KB of CSS.
Its popover is a `role="dialog"` with `aria-labelledby`, it traps Tab between
the popover and the highlighted element, restores focus when it closes, and
takes Escape and the arrow keys. It ignores `prefers-reduced-motion`, so the
wrapper does that.

**One wrapper, `lib/guide.js`:**

- `startTour(key, steps)` and `showHint(key, step)`. Each runs only if `key`
  is not in `onboarding.seen`, and adds it when it closes, however it closes.
- Steps whose element is missing are dropped, and a tour with none left does
  not start. Elements are found by `data-guide="…"` attributes, never by
  class names or text.
- `animate: false` and `smoothScroll: false` under reduced motion.
- `popoverClass: "mygist-guide"`, styled in `globals.css` from the app's
  tokens: card surface, border, radius, our button styles and focus ring.
  Progress reads "1 of 4". Buttons: **Next**, **Back**, **Done**, and a close
  button labelled "Close guide".
- On a phone the popover goes `side: "bottom"`, and the editor tour uses the
  section menu instead of the rail.

**Where it appears.**

| Key | Trigger | Shape | Points at |
|---|---|---|---|
| `guide:first-suggestion` | Review renders a suggestion row and the key is unseen (also on arrival from `handover`) | 2-step tour | the first row's **Approve**, then **Edit before approving** and **Reject** |
| `guide:editor` | first Profile visit after `complete`, or **Show me around** in the account menu (always runs) | 4-step tour | sections, a field with the header's Saved mark, **History**, **Search** |
| `hint:promote` | the first observation row renders | hint | its **Promote** button |
| `hint:first-app` | Settings → Connections lists its first app | hint | that app's row |
| `hint:paste-prompt` | **Copy prompt** on the card is pressed | hint | the copied button |
| `guide:token` | a token is created in step 2 | 1-step spotlight | the token row and its **Copy** |

**`onboarding.seen`** is stored on the server next to `dismissed`, so a second
device does not replay anything. `settings_store` accepts a list of up to 32
strings matching `^[a-z0-9:-]{1,48}$`, deduplicated, and repairs anything else
to `[]` on read, as it already does for `steps`. No list of allowed keys is
mirrored on the server: the pattern is the contract.

### 5. Motion

- Steps cross-fade with a 12 px rise over 200 ms, through `motion`
  (`AnimatePresence mode="wait"`), already a dependency. `BlurFade` leaves
  About you, so there is one mechanism.
- The progress fill slides (`transform: scaleX`, 300 ms, `ease-standard`).
- The status line and the Saved mark fade between states.
- **Confetti moves** from Complete to your **first ever approval**, once
  (`moment:first-approval` in `seen`). That is the peak the flow now ends on.
- Nothing moves under reduced motion: `useReducedMotion` sets durations to 0
  and drops the transforms; confetti does not fire.

### 6. Copy

Rules for this pass: plain British English, second person, present tense; no
em dashes; headings are short, sentence case, no full stop, as the app's
headings already are; body copy is one or two sentences. One word for the
thing: **assistant**. "Client" survives only where it names the assistant's
own settings. Sentences move from 12 px to 14 px, with `max-w-prose`.

`{name}` is the assistant you chose, or "your assistant" for Something else.
Each line names the file its claim is checked against.

#### Sign-in and sign-up (`WelcomeAuth.jsx`, `COPY`)

| Where | Copy | Source |
|---|---|---|
| sign-in description | Explain yourself once. Every assistant you connect reads the same persona. | PRODUCT.md hero line; `server.py` `get_context` |
| sign-up description | One persona for every assistant you use. Assistants suggest additions for you to approve. | `server.py` `propose_update` |

#### Step 1: `assistant`

| Where | Copy | Source |
|---|---|---|
| h1 | Which assistant do you use? | |
| lede | Connect it once, and it can read your persona and suggest what to add for you to approve. | `FIRST_TOKEN_SCOPES`; `scopes.js` `SCOPE_LABELS` |
| row effort | One click · One command · A few steps | `clients.js` `kind` |
| last row | Something else · Paste a prompt, or use a token | `installPrompt.js`; token path |
| links | I'll type it myself · Skip for now | |
| phone line | Most assistants connect from a computer. Open {host} there, or type the basics here for now. | `clients.js` (every client is desktop or terminal) |

#### Step 2: `connect`

| Where | Copy | Source |
|---|---|---|
| h1 | Connect {name} | |
| deeplink lede | This opens {name} and adds MyGist. Sign in when it asks, and keep the permission to suggest changes. | `InstallCard.jsx` |
| command lede | Run this in a terminal. {name} then opens MyGist in your browser for you to sign in. | `clients.js` `install` |
| status, waiting | Waiting for {name} to connect… | watchtower `connection.state` |
| status, connected | {name} is connected. | watchtower |
| status, read-only | {name} is connected, but it can only read. Reconnect it and keep "Suggest changes for your approval" ticked. | `scopes.js` `SCOPE_LABELS` |
| primary | Continue | |
| quiet | Continue without waiting · Need help connecting {name}? | `docsUrl("/use/clients/…")` |

**Something else** (same step):

| Where | Copy | Source |
|---|---|---|
| h1 | Connect your assistant | |
| lede | If your assistant can add an MCP server, paste this into it and it sets MyGist up itself. | `installPrompt.js` |
| primary | Copy prompt | |
| disclosure | My assistant needs a token | |
| token steps | 1. Create a token. It can read your persona and suggest changes, and it cannot change anything without your approval. 2. In your assistant, add an MCP server with the address below. 3. Paste the token where it asks for one. Some assistants call it an API key. | `FIRST_TOKEN_SCOPES`; `StepConnect.jsx` today |
| token warning (title) | Copy the token now | |
| token warning (body) | It's shown once. If you lose it, create another in Settings → Connections. | `TokenPanel.jsx` |
| primary after token | I've copied it | |

**The Claude row.** Claude Desktop becomes **Claude**, because claude.ai and the
desktop app share an account's connectors. Its steps are corrected, since the
current "Open Settings, then Connectors" is out of date (source: Claude docs,
"Add a connector that isn't in the directory",
`https://claude.com/docs/connectors/custom/remote-mcp`, checked 2026-10-01):

1. In Claude, open Customize, then Connectors.
2. Choose Add custom connector, and paste the address below.
3. Choose Add. Claude opens MyGist for you to sign in. Approve it, and keep the permission to suggest changes.

Under the steps: "On a Team or Enterprise plan, an Owner adds it in
Organization settings, then Connectors. The Free plan allows one custom
connector." The row's `id` stays `claude-desktop` so stored picks and tests
keep working.

#### Step 3: `handover`

| Where | Copy | Source |
|---|---|---|
| h1 | Let {name} fill it in | |
| lede | Paste this into {name}, and it suggests what to add from what it knows about you. Nothing is saved until you approve it. | `autofillPrompt.js`; `proposals_store` |
| primary | Copy prompt → Review {n} suggestion(s) | |
| status, copied | Paste it into {name}. Suggestions appear here as they arrive. | |
| status, reading | {name} is reading your persona… | watchtower `assistant.read` |
| status, arrived | {n} suggestion(s) waiting. | watchtower `pending.total` |
| read-only | {name} can only read your persona, so it can't suggest anything. Reconnect it with permission to suggest, in Settings → Connections. | `mcp_scopes.py` hides unscoped tools |
| quiet | I'd rather type it myself · Finish later | |

**The prompt** (`AUTOFILL_PROMPT`) gains one sentence, third: "If you can see
the project I'm working in, include my stack and tools from it."

#### About you and Complete

| Where | Copy | Source |
|---|---|---|
| About you lede | Type what's useful and leave the rest. It saves as you go, and you can change all of it later. | `OnboardingFlow.jsx` `SAVE_DELAY_MS` |
| How you like answers | Every assistant you connect follows these. | `get_context` serves preferences |
| save mark | Saving… · Saved · Couldn't save. Retry | |
| link | Let my assistant fill this in instead | |
| Complete h1 | That's the basics | |
| Complete, some, connected | You've added {n} thing(s). {name} can read them now. | watchtower |
| Complete, some, not connected | You've added {n} thing(s). Connect an assistant and it can read them and suggest the rest. | |
| Complete, none | Nothing added yet. Fill it in whenever you like, or let an assistant do it. | |
| extras heading | Two more, if you like | |
| extras labels | What's on your mind at the moment? · A goal you're working towards | |
| added chip | Added to Top of mind · Added to Goals | |
| primary | Go to my persona | |

Nationality is not asked in onboarding; Profile still has the field.

#### Guides

| Key | Step | Title | Body | Source |
|---|---|---|---|---|
| first-suggestion | 1 | Approve to save it | Approving adds this to your persona. Until you do, nothing has changed. | `proposals_store`; `ProposalsPanel.jsx` |
| first-suggestion | 2 | Not quite right? | Edit it before approving, or reject it. A rejected suggestion is never raised again. | `InboxRow.jsx`; PRODUCT.md |
| editor | 1 | Your persona, by section | Profile, goals, projects and the rest. Turn sections on or off in Manage sections. | `Rail.jsx` |
| editor | 2 | Type to change anything | Changes save as you type, and the header says Saved when they're in. | `App.jsx` autosave |
| editor | 3 | Undo with History | Every change to a section is kept, and a restore can itself be undone. | `App.jsx` History dialog |
| editor | 4 | Find anything | Search your whole persona with ⌘K. | `Header.jsx` |
| promote | | Give it a home | An observation doesn't belong to a section yet. Promote it to file it as an entry you can edit. | `ProposalsPanel.jsx` |
| first-app | | What {name} can do | It can read your persona and {suggest changes for your approval / change it directly}. Disconnect it here whenever you like. | `scopes.js` |
| paste-prompt | | Paste it into {name} | Your assistant reads your persona and sends its suggestions to Review. | `autofillPrompt.js` |
| token | | Copy the token now | It's shown once. Paste it into your assistant before you continue. | `TokenPanel.jsx` |

The editor tour's step 4 shows "Ctrl K" off Apple platforms, as the header
already does. The account menu item is **Show me around**.

#### Card and settings

| Where | Copy |
|---|---|
| card title | Getting started · {n} of 3 |
| card steps | Connect an assistant · Fill in the basics · Get a first suggestion |
| card waiting | Waiting for {name}… |
| card email line | Add an email so you can reset your password |
| card dismiss label | Hide getting started |
| Connections button | Connect an assistant (opens `#/onboarding/assistant`) |

### 7. Minor fixes

- Ghost and link buttons line up with the column (no 16 px indent).
- Connect's text links get `tap-target`, so each is 44 px tall on touch.
- Clients without a mark get an icon by kind (a terminal for `command`, a
  window for `steps` and `deeplink`) instead of a 10 px letter in a box.
- Commands wrap (`break-all`) on a phone instead of scrolling sideways.
- `InstallCard`'s terminal box sits directly on the page, so no card holds a
  card.
- Onboarding saves show the Saved mark (section 6), with a retry line on
  failure in place of today's silent catch.

## Files

**Backend**

- `main.py`: `/api/watchtower`, and `/api/usage` as a deprecated alias.
- `mcp_activity.py`: a `summary(user_id)` beside `usage()` for `called`,
  `read`, `suggested` and the newest label.
- `db.py`: grants for one user (`oauthConsent` joined to `oauthClient`).
- `settings_store.py`: `onboarding.seen`.
- Tests: `test_watchtower.py` (none, waiting, connected by token and by grant,
  read, suggested, can_propose, pending, the alias); `seen` validation in the
  settings tests.

**Frontend**

- New: `lib/watchtower.js`, `lib/guide.js`, `components/onboarding/StepAssistant.jsx`,
  `components/onboarding/StepHandover.jsx`.
- Rewritten: `StepConnect.jsx` (one client, full width, status line, the
  Something else variant), `OnboardingFlow.jsx` (steps, phases, motion),
  `lib/onboardingSteps.js`, `GettingStartedCard.jsx`.
- Changed: `StepAboutYou.jsx`, `StepHowYouLike.jsx`, `StepComplete.jsx`,
  `ClientPicker.jsx` (choose rows, kind icons), `InstallCard.jsx`,
  `lib/clients.js` (the Claude row), `autofillPrompt.js`, `WelcomeAuth.jsx`
  (`COPY`), `ProposalsPanel.jsx` (guide, hint, confetti), `AppsPanel.jsx`
  (hint), `ConnectionsPanel.jsx` (button), `AccountPanel.jsx` (restore),
  `shell/Header.jsx` (Show me around), `App.jsx` (banner on Profile, tour
  start), `lib/onboarding.js` (`seen`), `globals.css` (`.mygist-guide`).
- Removed: `components/onboarding/connectionStatus.js` and its test, once
  nothing imports it.
- `package.json`: `driver.js` `^1.8.0`.

**Docs**

- `use/quick-start.mdx`: the new first run, with fresh screenshots.
- `use/clients.mdx`: the Claude row's corrected steps.
- `run/troubleshooting.mdx`: `/api/usage` becomes `/api/watchtower`.
- `changelog.mdx`: 0.3.0.

## Testing

- **Backend:** the watchtower states and the alias; `seen` accepts, dedupes,
  caps, and repairs.
- **Frontend unit:** step routing and retired steps; phases; the chosen
  assistant surviving a reload; each status line from a mocked watchtower;
  Complete's count ignoring defaults; the card's three ticks; restore keeping
  progress; `guide.js` running once, dropping missing elements, and turning
  animation off under reduced motion.
- **In the browser:** both paths walked at 1440×900 and 390×844 with a
  throwaway account, deleted afterwards. The live status checked by pointing
  a real MCP call at the preview (an `initialize`, a `get_context`, a
  `propose_update` with a token minted in-container), then the first
  suggestion guide and the first approval.
- **Detector:** `impeccable detect` once over the changed files, and the
  in-page detector over the onboarding screens.
- **Copy:** the house-style counts (em dashes, banned words, headings) on the
  built bundle, not the source.

## Out of scope

- A ChatGPT row, until its steps are verified from its own documentation.
- The brand mark.
- Per-grant call tracking. Watchtower answers "has any assistant called",
  which is what every screen here asks.
