# Onboarding rework and per-client install - design

Date: 2026-08-16
Status: approved 2026-08-16. Revised the same day, after reading the registry
sources, to drop `animated-beam` and `border-beam`. See "Two components dropped
on inspection".
Supersedes nothing. Builds on:
`docs/superpowers/specs/2026-08-14-onboarding-slice-design.md` (the flow this
extends), and the `connect` step added after it.

## What this is

Two things, one screen apart:

1. The five-step onboarding flow gets a design pass across all of it.
2. `Connect` gets a per-client install card so that pointing a client at MyGist
   over OAuth stops being "copy this URL and go find the right setting".

Scope was set by the owner on 2026-08-16: the whole five-step flow, install
buttons first with a paste-into-agent prompt behind them, seven clients minus
Notion AI.

## What exists today

`frontend/src/components/onboarding/` holds `StepWelcome`, `StepConnect`,
`StepAboutYou`, `StepHowYouLike`, `StepComplete`, driven by `OnboardingFlow.jsx`.

`StepConnect.jsx` already does the hard parts correctly and none of them are
being thrown away:

- It reads `instance.mcp_oauth` and recommends OAuth only where the instance
  actually mounts the discovery routes. An instance without `AUTH_MCP_RESOURCE`
  sends a client to a 404, and the screen already knows not to do that.
- It falls back to a scoped bearer token, minted at `persona:propose` only.
- It ends in the who-fills-it-in fork, gated on `connection.canPropose`, because
  `mcp_scopes.py` hides tools rather than failing them and a read-only
  connection would silently do nothing with the autofill prompt.

What it does not do is tell anyone **where** to paste the URL. It gives four
generic numbered steps naming Claude only, and every other client is left to the
docs site. That is the friction this fixes.

## The finding that shapes the install work

Of the six clients in scope, **exactly one has a real deeplink.**

| Client | How you actually install it | Card kind |
|---|---|---|
| Cursor | `cursor://` deeplink with a base64 config | deeplink |
| Claude Code | `claude mcp add` | command |
| Codex | `codex mcp add` then `codex mcp login` | command |
| Hermes | `hermes mcp add --auth oauth` | command |
| Claude Desktop / claude.ai | Settings, Connectors, Add custom connector | steps |
| Raycast | MCP Settings, Install Server, HTTP transport, Sign In | steps |

So the card must not present six identical "Install" buttons. The primary action
is different per kind, and pretending otherwise produces five buttons that do
not do what the sixth one does.

Notion AI is **out of scope for a card**. It is named on the landing page as a
client that speaks MCP, and the hosted Notion MCP server at `mcp.notion.com` is
well documented, but nothing confirmed that Notion AI accepts an arbitrary
custom MCP server as a client. It falls to the "my client isn't listed"
fallback. Adding a card later is one roster entry.

## The client roster

New file, `frontend/src/lib/clients.js`, exporting one array:

```js
{ id, name, slug, mark, kind, install(mcpUrl) }
```

`kind` is one of `"deeplink" | "command" | "steps"`. `install()` returns the
shape that kind needs: a URL string, an array of command strings, or an array of
step strings.

`frontend/src/landing/content.js` keeps its own `CLIENTS` array for the hero
chips. Only `mark` derives from the roster, via the shared `hasMark()`; names
and slugs stay hand-typed in both files, because the two lists answer
different questions. The hero chips name every client that speaks MCP,
Notion AI included. The roster names every client this screen has install
steps for, which Notion AI is deliberately not in. Collapsing them into one
list would either put a card-less chip through the install-card code path or
drop Notion AI from the hero section, and neither is what shipped. What did
move out of the landing file is `mark`: it used to be a boolean typed by hand
per chip, and now comes from `hasMark()` in `lib/clients.js`, so a logo landing
in `public/landing/logos/` only has to be recorded once. The real drift risk
left is a slug appearing in one list and not the other; `clients.test.js`
asserts both directions.

The two missing marks stay missing. `design/logos/README.md` records why
(`openai.svg` pulled from Simple Icons over a trademark request, Hermes never
indexed) and the roster's `mark: false` keeps those two name-only, exactly as the
hero chips already handle it. Do not invent glyphs.

### The command strings

Pure functions of `mcpUrl()`, which is `${serverBase()}/mcp`:

```
claude   claude mcp add --transport http mygist <url>
codex    codex mcp add mygist --url <url>
         codex mcp login mygist
hermes   hermes mcp add mygist --url <url> --auth oauth
cursor   cursor://anysphere.cursor-deeplink/mcp/install
           ?name=mygist&config=<base64 of {"type":"http","url":"<url>"}>
```

Codex is deliberately two lines. `codex mcp add` registers the server;
`codex mcp login` runs the OAuth flow. Showing only the first leaves someone
with a registered server that 401s and no idea why.

These are the only strings in the feature with a correctness answer rather than
a taste answer, so they get unit tests: the base64 payload decodes to the right
JSON, and each command carries the live `mcpUrl()` rather than a hardcoded host.

## The Connect screen

Order top to bottom:

1. Heading and the one-line explanation. Kept.
2. **Client picker.** Single column of rows: mark, name, and a quiet label
   naming the action kind. One row expands at a time.
3. **Install card**, inline in the expanded row.
4. "My client isn't listed" - reveals the paste-into-agent prompt and the raw
   `mcpUrl()`.
5. "My client can't sign in" - the existing token path, unchanged.
6. The who-fills-it-in fork. Unchanged, still gated on `connection.canPropose`.

A single column, not a grid. Three identical feature cards in a row is on the
owner's banned-signatures list, and six would be worse.

The whole of 2 to 4 renders only when `instance.mcp_oauth` is true. When it is
false the screen falls to the token path as its only path, which is what
`StepConnect` does today and must keep doing.

### Card kinds

**deeplink** - a labelled button, "Add to Cursor", plus the raw deeplink behind a
copy control for anyone whose browser will not hand off a custom scheme.

**command** - a Magic UI `Terminal` showing the real command, with a Copy
control. Terminal is chosen over a styled `<pre>` because the owner's aesthetic
notes call for real product chrome and specifically ban "fake UI assembled from
styled divs". A terminal is the chrome this command genuinely lives in.

**steps** - the existing numbered `Steps` component, per-client rather than
generic, plus the URL copy row.

Every kind keeps the existing `DocsLink` to `/use/clients/`, which holds the
per-client detail no card can.

### Copy

All new user-facing strings go through the `house-style` skill before they land.
That was an explicit owner instruction on 2026-08-16 and it covers the
paste-into-agent prompt in particular, which is the longest new string in the
feature.

## The other four steps

**Welcome.** Unchanged. See "Three components dropped on inspection" below:
`WelcomeVisual` already is the beam diagram, and does it better than the
component that was going to replace it.

**About you** and **How you like.** Structure unchanged. Two changes only:
`blur-fade` entrances at the motion budget below, and the "let your assistant do
it" escape made reachable here rather than only on Connect. Someone who starts
typing and regrets it currently has to go back a step to find the offer.

**Complete.** Confetti on arrival (owner's call, 2026-08-16), on the count of
what got saved, which `StepComplete` already computes as `saved`. A
`number-ticker` counted that value up on arrival and was pulled after
shipping; see "Three components dropped on inspection". Confetti fires once
per mount and not at all under `prefers-reduced-motion`.

## Three components dropped on inspection

All three were in the approved spec. `animated-beam` and `border-beam` were
dropped before landing, on reading the registry source; `number-ticker`
shipped and was then pulled once its animation was seen doing the wrong
thing on screen. The reasons are recorded here so nobody re-adds any of them.

**`animated-beam` is a downgrade on what Welcome already has.**
`WelcomeVisual.jsx` is already the diagram this was meant to introduce: three
sources, one hub, three clients, with current flowing along the connectors. It
animates `stroke-dashoffset` in CSS, so `globals.css`'s reduced-motion block
zeroes it for free, and the stroke never changes shape so nothing reflows. Its
header comment argues both choices explicitly. Magic UI's `animated-beam`
measures endpoints with refs and animates in JavaScript, so it would need its own
`prefers-reduced-motion` branch and would be the one thing still moving for a
reader who asked everything to stop. Swapping a better implementation for a
branded one is not a design pass.

**`border-beam` costs more than it returns.** It is written for Tailwind 4
throughout: `border-(length:--border-beam-width)`, `mask-[...]`,
`mask-intersect`, `[mask-clip:padding-box,border-box]`, `bg-linear-to-l`,
`from-(--color-from)`. None of those exist in Tailwind 3, and the mask in
particular does not have a clean v3 arbitrary-property equivalent. Its default
palette is `#ffaa40` to `#9c40ff`, which is the orange-to-purple AI gradient on
the banned-signatures list. All of that to decorate a card whose arrival moment
confetti is already carrying.

**`number-ticker` counted up to the wrong noun.** The noun ("thing"/"things")
is picked off the FINAL value, but the ticker walks the number up to it over
the entrance, so mid-animation frames read the wrong plural: "1 things saved"
was on screen for roughly 51ms measured at `saved=3`, and worse at smaller
counts -- a critically damped spring moves fastest through the early
integers, and small counts are nearly all this screen ever shows. That is the
same disagreement Complete exists to fix, made transient. Dropped rather than
patched, and it had no other consumer: `StepComplete` prints the count
directly instead.

The revised budget is `terminal`, `magic-card`, `confetti`, and the
already-vendored `blur-fade`.

## Magic UI components

Vendored as JSX into `frontend/src/components/ui/`, the way `blur-fade.jsx` and
`safari.jsx` already are. Not installed as a dependency.

`blur-fade.jsx` is the precedent and the pattern to copy. Its header records the
two changes every vendored file needs: JSX rather than TSX, and a
`useReducedMotion()` early return that renders a plain `<div>` instead of a
motion component with zeroed values.

| Component | Where | What has to change on the way in |
|---|---|---|
| `terminal` | command cards | chrome only, see below |
| `magic-card` | picker rows | drop `next-themes` and orb mode, retint |
| `confetti` | Complete | drop `ConfettiButton`, gate on reduced motion |
| `blur-fade` | step entrances | already vendored, no change |

`number-ticker` was vendored and then removed; see "Three components dropped on
inspection".

**Terminal ships without its typing animation.** The registry component's
headline feature is `TypingAnimation`, which reveals text one character at a
time on a `setInterval`. That is wrong for a command someone came here to copy:
the text is incomplete and unselectable while it types, and it delays the only
thing the card exists to hand over. What is worth having is the chrome, the
title bar and the mono body, which is exactly what the aesthetic notes mean by
real product chrome rather than "fake UI assembled from styled divs". So vendor
`Terminal` and `AnimatedSpan`, use `sequence={false}`, and leave
`TypingAnimation` out of the file entirely rather than importing and not calling
it.

Rejected outright, with the rule each one breaks:

- `neon-gradient-card`, and anything glowing: "neon and outer glows" is banned.
- `animated-gradient-text`, `dia-text-reveal`: "gradient text on large headings"
  is banned.
- `rainbow-button`, `shimmer-button`, `pulsating-button`: the design system wants
  labelled buttons carrying one semantic colour, not decorated ones.

Constraints on every vendored file: React 18 and Tailwind 3, JSX not TSX,
`hsl(var(--token))` semantic colours only, never a raw hex. Magic UI ships React
19 and Tailwind 4 idioms throughout and those get converted on the way in, not
patched afterwards. The known ones: `max-h-100` and `bg-linear-to-*` are v4-only
utilities, `var(--color-background)` is the v4 theme variable rather than this
project's `hsl(var(--background))`, and `magic-card` imports `next-themes`,
which this app does not use and does not need since only its orb mode reads the
theme.

### Motion budget

From the owner's stated values: press 120-180ms, state change 180-260ms,
entrance 240ms ease-out, exit 180ms ease-in, nothing over 300ms.

Ambient loops (`animated-beam`, `border-beam`) are exempt from the 300ms ceiling
because it governs response to input, not atmosphere. They are not exempt from
`prefers-reduced-motion`, which disables every beam and the confetti outright
rather than shortening them.

## Files

New:

- `frontend/src/lib/clients.js`
- `frontend/src/lib/clients.test.js`
- `frontend/src/components/onboarding/ClientPicker.jsx` (+ test)
- `frontend/src/components/onboarding/InstallCard.jsx` (+ test)
- `frontend/src/components/ui/terminal.jsx`
- `frontend/src/components/ui/magic-card.jsx`
- `frontend/src/components/ui/confetti.jsx`

Vendored and then removed: `frontend/src/components/ui/number-ticker.jsx`, see
"Three components dropped on inspection".

Changed:

- `frontend/src/components/onboarding/StepConnect.jsx` - picker and card replace
  the generic steps block. Token path, instance gating and the fork all stay.
- `frontend/src/components/onboarding/StepConnect.test.jsx` - rewritten.
- `frontend/src/components/onboarding/StepComplete.jsx` - the arrival treatment.
- `frontend/src/components/onboarding/StepAboutYou.jsx`,
  `StepHowYouLike.jsx` - entrances and the delegate escape.
- `frontend/src/landing/content.js` - `CLIENTS`' `mark` field derived from the
  roster via `hasMark()`; names and slugs stay hand-typed, see above.

Unchanged, and deliberately so: `WelcomeVisual.jsx`.

`confetti` pulls `canvas-confetti`, the one new runtime dependency in the
feature. Everything else is self-contained JSX over `motion`, which is already a
dependency. `canvas-confetti` calls `getContext("2d")`, which jsdom does not
implement, so every test that mounts `StepComplete` mocks the module.

## Testing

- `clients.js` gets unit tests on the strings: base64 decodes to the expected
  JSON, every command carries `mcpUrl()`, every roster entry has a valid `kind`.
- `ClientPicker` and `InstallCard` get render tests per kind.
- `StepConnect.test.jsx` keeps its existing assertions on the instance gating and
  the `canPropose` fork, which are the two behaviours a redesign could plausibly
  break without anyone noticing, and adds the picker.
- Motion is not asserted. `prefers-reduced-motion` handling is, because it is a
  branch rather than an animation.

## Open questions

None blocking. Notion AI's card is deferred rather than unresolved, and the two
missing logo marks are recorded in `design/logos/README.md` with the steps to
finish them.
