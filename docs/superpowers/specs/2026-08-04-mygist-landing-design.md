# MyGist landing page — design system and marketing page

Date: 2026-08-04
Status: approved, ready for planning
Deliverable: Figma design system + landing page prototype. No code target chosen yet.

## Goal

A marketing landing page for MyGist, aimed at people who already use several AI
assistants and are tired of re-introducing themselves to each one. The page
captures waitlist emails while the product is invite-only.

Ahead of the page, a design system that both the marketing surface and the
existing app can draw from, so the two never drift.

## Decisions taken

| Question | Decision |
|---|---|
| Audience | AI power users on the hosted instance. Pain-first, not protocol-first. Developers get one nod, in the data section. |
| Primary CTA | Waitlist email capture, inline on the page. Signup is invite-gated. |
| Ship target | Figma only for now. Code target (Vite SPA / docs-site / separate app) deferred. |
| Design system shape | One system, no modes. Single palette, type ramp, radius and space scale. App sits at the quiet end, marketing at the expressive end. |
| Hero | Persona card as the visual anchor. Copy carries repetition and portability. |
| Display face | Stack Sans Notch (Koto, variable 200–700, Google Fonts). |
| Gradients | GRADIENTOOL output, palette-locked, in three fixed roles. |

## Aesthetic direction

Playful Editorial, as defined in the owner's persona. The governing split is
energy on the way in, quiet once someone is working. A landing page is entirely
"on the way in", so it takes the full-strength treatment: pill controls,
container radii at 16–32px, a floating detached nav pill, the page framed in a
large-radius container, frosted glass on fixed elements only.

One tension to hold. Stack Sans Notch is crafted but cool and screen-native, so
it does not carry the "warm, tactile, a little handmade" quality on its own.
Warmth therefore comes from three other places: the Clay and Moss tints get more
surface area than a single-accent system would give them, radii sit at the top
of the scale, and the gradient grain supplies the tactile layer. Type carries the
edge; colour, shape and grain carry the warmth.

## Foundations

### Palette

The app's existing semantic tokens in `frontend/src/globals.css` are unchanged.
This adds a brand layer beneath them. Two new hues only, both warm enough to sit
with the stone neutrals and far enough from indigo not to compete with a CTA.

| Role | Light | Dark | Use |
|---|---|---|---|
| Paper | `60 9% 98%` | `60 3% 7%` | Page ground (existing `--background`) |
| Ink | `24 10% 10%` | `60 5% 96%` | Text (existing `--foreground`) |
| Indigo | `228 69% 55%` | `228 94% 67%` | Primary, CTAs, the mark (existing, untouched) |
| Clay | `18 74% 60%` | `18 66% 62%` | New. Section tint, illustration |
| Moss | `158 34% 40%` | `158 30% 52%` | New. Section tint, illustration |

Clay and Moss appear as large flat section tints and as illustration fills.
Neither is ever used for body text, which keeps contrast testing to a small,
enumerable set of pairs. Status colours (`success`, `warning`, `destructive`)
stay semantic and out of the decorative palette.

Tints, used as section grounds:

| Tint | Light | Dark |
|---|---|---|
| Indigo | `223 100% 96%` (existing `--accent`) | `227 22% 20%` (existing dark `--accent`) |
| Clay | `18 74% 94%` | `18 30% 18%` |
| Moss | `158 34% 94%` | `158 22% 16%` |

The indigo tint reuses the app's existing `--accent` rather than introducing a
parallel value.

Every foreground/background pair in use is checked against WCAG AA by
measurement, not by eye.

### Type

Three families, split by role rather than by taste.

- **Stack Sans Notch** — display only, 40px and above. Weights 500–600.
- **Geist** — UI and body. Already loaded.
- **Geist Mono** — eyebrows, labels, code. Already loaded.

The 40px floor is a hard rule. The notched cuts are the entire character of the
face, and below roughly 40px they stop reading, leaving a geometric sans too
close to Geist to hold hierarchy.

At 72px the notches carry the headline on their own, so display weight stays at
500–600 rather than 700.

Ramp: `13 · 14 · 16 · 18 · 20 · 28 · 40 · 56 · 72`

### Scales

One continuous set. No mode switching.

```
radius   4 · 6 · 8 (app default) · 12 · 16 · 24 · 32 · 9999 (pill)
space    4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 80 · 120 · 160
```

Nested radii are concentric: a 24px container holds 16px children.

### Elevation

Four steps, all tinted with Ink rather than black so they stay warm.

| Step | Value | Use |
|---|---|---|
| `none` | — | Flat tiles on tinted grounds |
| `sm` | `0 1px 2px ink/6%` | Resting cards |
| `lift` | `0 8px 24px ink/10%` | Card hover, persona card |
| `pop` | `0 12px 32px ink/14%` | Floating nav pill |

Frosted glass is reserved for the fixed nav pill.

### Motion

Taken verbatim from the persona definition.

- Press: 120–180ms
- State change: 180–260ms
- Entrance: 240ms ease-out
- Exit: 180ms ease-in
- Nothing over 300ms
- `prefers-reduced-motion` honoured throughout

### Gradient system

Source is GRADIENTOOL (`gradientool.com`), a canvas 2D generator using layered
linear and radial gradients with grain, plus contour treatments where the
"filled bands" fill produces the strip effect. Tool defaults observed: grain
0.52, seam 0.05, depth 0.55. No WebGL, so output is reproducible.

Three rules keep it a system element rather than decoration:

1. **Palette-locked.** Generated only from Paper, Ink, Indigo, Clay and Moss.
2. **Three fixed roles.** A 12px full-bleed **edge strip** along the top of the
   page frame, recoloured per section and acting as the signature element; a
   large soft **field** behind the hero persona card; and a **tile cap** across
   the top of feature tiles, coloured to its section.
3. **Never under text.** Strips are decorative. Any type over gradient sits on a
   solid or scrimmed surface.

For the Figma prototype these are exported stills, since Figma cannot run
canvas. Each needs a dark-mode variant generated alongside it. A live canvas
implementation stays open for whenever a code target is chosen.

## Components

Fourteen. Anything with an existing counterpart in `frontend/src/components/ui`
mirrors its variant names, so Code Connect is close to free later.

**Shell**
1. Page frame — whole page inside a 32px-radius container
2. Nav pill — floating, frosted, detached; carries Sign in at top right
3. Footer

**Actions**

4. Button — primary / secondary / ghost × sm 36 / md 44 / lg 56, pill radius, 140ms press
5. Waitlist field — input plus inline submit. States: idle, focus, submitting, success, error. The success state matters most; it is the last thing a converted visitor sees.

**Content**

6. Section header — mono eyebrow, display, body sub
7. Feature tile — 24px radius, tinted fill, gradient tile cap
8. Step card — numbered
9. Pull-quote

**Product objects** — these five do the selling and get the most attention. All
are drawn from real MyGist UI rather than invented for the page.

10. Persona card — hero anchor. Concentric radii, 24px outer and 16px inner rows
11. Client chip — Claude / ChatGPT / Cursor, pill
12. Scope selector — echoes the real `segmented-control.jsx`; minimal / professional / personal / learning / full
13. Proposal card — reasoning, quote from the user, approve and reject
14. Export view — readable JSON with a Download button

## Page structure

Sections alternate grounds so the page does not read as one long white scroll.

| # | Section | Ground | Job |
|---|---|---|---|
| 1 | Hero | Paper + indigo gradient field | Persona card anchor, waitlist capture |
| 2 | Works with | Paper, quiet | Credibility |
| 3 | How it works | Clay tint | Three steps, the spine |
| 4 | Scoped reads | Paper | You are not handing over everything |
| 5 | Proposals | Moss tint | The differentiator |
| 6 | Your data | Ink, full-bleed | Portability and passivity, told on dark |
| 7 | Closing CTA | Indigo gradient | Second waitlist capture |
| 8 | Footer | Ink | — |

Section 6 is the only full dark break, and it is where the grain reads best.

Sign-in appears twice, both quiet: as a small text link under the hero waitlist
field ("Already have a code? Sign in.") and at the top right of the nav pill.
Neither competes with the waitlist as the primary action.

### Hero motion beat

On load, three ghosted chat bubbles, each opening with the same self-introduction,
stack up and collapse into the persona card. Thin lines then draw outward to the
client chips. Repetition and portability in one gesture, 240ms entrance. It
resolves rather than looping. This is the most expensive thing on the page to
build well and should be prototyped last.

## Copy deck

Written pain-first. Phrasing is drawn from the project README and docs FAQ where
it already works, since that is the owner's own voice. British English, casual,
concise, no cheese.

### 1 · Hero

> `PORTABLE CONTEXT FOR AI`
>
> # Write yourself down once.
>
> Every new AI conversation starts from nothing. Your role, your stack, how you
> like answers written. MyGist stores that once and hands it to any assistant you
> open.
>
> `[ you@email.com ]` `[ Join the waitlist ]`
>
> Invite-only while it's small. One email when your invite lands.
>
> Already have a code? Sign in.

Alternative headline to mock alongside at 72px: **"Explain yourself once."** It
hits the repetition pain harder but flirts with the being-told-off reading. Pick
by eye.

### 2 · Works with

> `WORKS WITH`
>
> Claude · ChatGPT · Cursor · anything that speaks MCP
>
> One URL. Any client that speaks MCP picks it up.

### 3 · How it works

> `HOW IT WORKS`
>
> ## Three steps.
>
> After that, every chat starts with you already in it.
>
> **1. Write your gist.** What matters: your role, your stack, how you want
> answers written. Structured JSON, editable by hand or in the web UI.
>
> **2. Connect a client.** Paste one URL. Clients that speak OAuth get a consent
> screen where you choose what they may read. Anything without a browser uses a
> scoped token.
>
> **3. It travels.** Every new chat starts with your context already there.

### 4 · Scoped reads

> `SCOPE`
>
> ## Every client sees only the slice you allow.
>
> A coding assistant asks for `professional` and gets your stack and your
> conventions. Ask for `minimal` and it is a name and a role. Add topic filters,
> or hand back titles only.

Deliberately does not promise that a scope excludes other sections. The earlier
draft claimed a `professional` read "never sees the personal sections", which
overstates what the scope config guarantees.

### 5 · Proposals

> `PROPOSALS`
>
> ## Nothing lands until you say so.
>
> When an assistant notices something durable about you, it proposes the change
> with its reasoning and a quote from you. Approve it, edit it, or reject it.
> Reject once and it never comes up again.

### 6 · Your data

> `YOUR DATA`
>
> ## Plain JSON, exportable any time.
>
> One row per section, per account. View it, edit it, export it, delete it. There
> is no proprietary format to get stuck in.
>
> MyGist never reads your conversations. The MCP tools run only when a client
> calls them, and there is no background process watching anything.
>
> Hosted here, the database is ours, and you should trust us accordingly. If you'd
> rather it were literally yours, the same Docker image runs on your own server.

The third paragraph is set smaller than the first two rather than at equal
weight. It is not an ownership claim: on the hosted instance the database belongs
to whoever runs it, which the docs FAQ already states plainly. Printing the
awkward part is a conversion asset for an audience that arrived looking for an
alternative to vendor memory, and a visitor finds it in the FAQ regardless.

This section is also the only nod to developers on the page, via the self-host
line.

### 7 · Closing

> ## Stop starting from nothing.
>
> Leave your email and we'll send an invite when a slot opens.

## Figma build order

1. Variables — colour, type, radius, space, motion, with light and dark modes
2. Type specimen frame — Stack Sans Notch at 72 / 56 / 40, both hero headline options
3. Gradient assets — generated palette-locked from GRADIENTOOL, exported as stills: edge strip, hero field, three tile caps, plus a dark variant of each
4. Core components — shell, actions, content
5. Product objects — persona card, client chip, scope selector, proposal card, export view
6. Page assembly at 1440 desktop
7. Mobile at 390
8. Prototype — waitlist states, then the hero motion beat

Steps 2 and 3 come early on purpose. Both are judged by eye, and both change
everything downstream if they land badly.

## Out of scope

- Choosing a code target, and any implementation of it
- The waitlist backend endpoint and storage
- Pricing, testimonials, or a blog
- Changes to the existing app or docs site
- Any change to the app's current semantic tokens

## Success criteria

- A Figma file whose variables could be exported as CSS custom properties without renaming anything
- Landing page at 1440 and 390, all eight sections
- Waitlist field prototyped through all five states
- Every text-on-background pair in the file measured against WCAG AA
- Gradient assets present in light and dark, generated only from the five brand colours
- Nothing shown in a product object that MyGist does not actually do

## Open questions

- Hero headline: "Write yourself down once." or "Explain yourself once." Decide from the Figma specimen.
- Stack Sans Notch carries Koto's notch signature from the Stack Overflow identity. Free and legal to use, and not yet widely deployed, but a reader who knows the rebrand may make the association. Accepted knowingly.
- Whether the gradient strips eventually ship as static exports or a live canvas. Deferred with the code target.
