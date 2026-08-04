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
| Hero | A framed product mockup as the visual anchor: the real editor, populated with a dummy persona. Copy carries repetition and portability. |
| Display face | Stack Sans Notch (Koto, variable 200–700, Google Fonts). |
| Gradients | GRADIENTOOL output, palette-locked, in three fixed roles. |
| Features | One bento grid, absorbing Scoped reads and Proposals as large tiles. Each tile carries one or two explanatory sentences. |
| Mockup frame | Magic UI `safari`, chrome recoloured to the warm neutrals. |
| Component source | Magic UI registry where it fits, adapted to MyGist tokens. |

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

## The demo persona

Every product object on the page shows one fictional character, used
consistently so the page reads as a single coherent account rather than a set of
unrelated screenshots.

> **Maya Ellis** — 23, Manchester. Marketing assistant, six months out of an
> English and Media degree.
> Writes: British English, no exclamation marks, never the word "delve".
> Uses: three assistants a day, for drafts, research and meeting notes.
> Goal: move into brand strategy within two years.
> Learns: examples first, theory later.
> In the review queue: *"Maya now owns the monthly newsletter"*, proposed by an
> assistant with a quote from her, awaiting approval.

Deliberately not a developer. The page is written for AI power users rather than
people who would read the Dockerfile, and a staff engineer with a Terraform
stack quietly contradicts that. Someone a couple of years out of university,
running three assistants a day for writing and research, is who actually feels
the repetition the hero describes.

She is not the project owner and not a real person. She supplies content for the
persona card, the scope selector, the proposal card, the export view and every
bento tile — and her tone rules make the scope demo legible at a glance, which a
list of Go conventions would not.

Mockups are built in Figma from the running application, not imagined. The plan
must include a step to run the app and work from what is actually on screen,
because a demo that shows software which does not exist is the fastest way to
lose someone at signup.

### Reuse in the docs

`docs-site` declares seventeen screenshots through its `Screenshot` component
and none have been taken; each renders a labelled placeholder instead. The same
Maya mockups can fill those placeholders. Producing them is out of scope here,
but the Figma frames should be built at a size and fidelity that allows it, and
the captions already written in the docs are a usable shot list.

## Magic UI

Magic UI is a shadcn-compatible registry, which suits the existing preference
for adapting registry components over hand-rolling them.

| Component | Job |
|---|---|
| `bento-grid` | The features section |
| `safari` | The product mockup frame |
| `animated-beam` | Hero: persona card out to the client chips |
| `blur-fade` | Section entrances |
| `noise-texture` | Grain layer, alongside the GRADIENTOOL stills |

`bento-grid` ships as TSX with `rounded-xl` (12px), hardcoded `neutral-*` text
colours, its own box-shadows and a dependency on `@radix-ui/react-icons`.
Adapting it means: radius to 24px, text to `foreground` and `muted-foreground`,
shadows to the `sm` and `lift` steps, and icons from `lucide-react` to match the
rest of the app. Its hover behaviour (icon scales down, text lifts, CTA fades up)
runs at 300ms, which sits exactly on the motion ceiling and is kept.

`safari` renders macOS chrome in its own grey. It is recoloured to the warm
neutrals so it does not fight the 24–32px warm containers around it.

The per-tile `href` and `cta` props go unused. A landing page with one action
should not offer six competing ones.

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
7. Bento tile — adapted from `bento-grid`, 24px radius, tinted fill, gradient tile cap. Variants: 1-col and 2-col
8. Step card — numbered
9. Pull-quote

**Product objects** — these do the selling and get the most attention. All are
drawn from the running MyGist UI rather than invented for the page.

10. Product mockup — `safari` frame, chrome recoloured, holding the editor with Maya's persona open. The hero anchor
11. Persona card — the editor's own card, extracted for use outside the frame. Concentric radii, 24px outer and 16px inner rows
12. Client chip — pill. Contents pending the client-list answer below
13. Scope selector — echoes the real `segmented-control.jsx`; minimal / professional / personal / learning / full
14. Proposal card — reasoning, quote from Maya, approve and reject
15. Export view — readable JSON with a Download button

## Page structure

Sections alternate grounds so the page does not read as one long white scroll.

| # | Section | Ground | Job |
|---|---|---|---|
| 1 | Hero | Paper + indigo gradient field | Framed product mockup, waitlist capture |
| 2 | Works with | Paper, quiet | Credibility |
| 3 | How it works | Clay tint | Three steps, the spine |
| 4 | What it does | Paper | Bento grid, seven tiles. Density and life |
| 5 | Your data | Ink, full-bleed | Portability and passivity, told on dark |
| 6 | Closing CTA | Indigo gradient | Second waitlist capture |
| 7 | Footer | Ink | — |

Section 5 is the only full dark break, and it is where the grain reads best.

Scoped reads and Proposals were previously full-width narrative beats. They are
now the two 2-col tiles inside the bento. With every tile carrying one or two
explanatory sentences, the tiles do the work those sections were doing, and the
page gets its density from one rich grid instead of four scrolling beats.

### Bento layout

Three columns, three rows, every row summing to three.

```
row 1   [ Scoped reads      2col ] [ Search        1col ]
row 2   [ Your sections 1col ] [ Proposals         2col ]
row 3   [ Consent 1col ] [ Skills 1col ] [ Run it yourself 1col ]
```

The two 2-col tiles carry live-looking product UI in their `background` slot:
the scope selector in one, the proposal card in the other. The five 1-col tiles
carry an icon and copy only, so the grid has a clear rhythm of heavy and light
rather than seven tiles all shouting.

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
> *Visual: the editor in a recoloured `safari` frame, Maya's persona open, sitting
> on the indigo gradient field. Thin beams run from the frame out to the client
> chips.*
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
> Claude Desktop · Claude Code · anything that speaks MCP
>
> One URL. Any client that speaks MCP picks it up.

Named clients are limited to the two that `docs-site/content/docs/use/clients.mdx`
documents with their own setup sections. Earlier drafts of this spec listed
Cursor, ChatGPT and Notion AI, none of which appear anywhere in the docs. See
Open questions: the client list needs the owner's answer before the section can
be designed, because two logos and an "anything else" is a thinner row than the
section was drawn for.

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

### 4 · What it does (bento)

> `WHAT IT DOES`
>
> ## Everything your assistants can ask for.

**Scoped reads** — 2col, scope selector in the background slot

> Every client sees only the slice you allow. A work assistant asks for
> `professional` and gets your tone rules and what you're working on; ask for
> `minimal` and it's a name and a role.

**Search** — 1col

> Ask for one thing, get one thing. MyGist returns ranked snippets first and
> fetches the full entry only when it is actually needed, so a long persona never
> floods the conversation.

**Your sections** — 1col

> The ten sections are a starting point, not a cage. Adding one is a single
> declarative file, so your gist can hold whatever you actually keep track of.

**Proposals** — 2col, proposal card in the background slot

> Nothing lands until you say so. When an assistant notices something durable
> about you, it proposes the change with its reasoning and a quote from you.
> Approve it, edit it, or reject it for good.

**Consent** — 1col

> Connecting a client takes one URL. You get a consent screen where you choose
> what it may read, and whether it may write anything at all.

**Skills** — 1col

> Four short guides ship with MyGist, telling assistants how to read a persona
> and what is worth proposing. Your experience does not change depending on which
> app you happened to open.

**Run it yourself** — 1col

> One Docker image serves the editor, the API and the MCP endpoint. Point it at
> your own Postgres if you would rather nobody else hosted it.

The Scoped reads tile deliberately does not promise that a scope excludes other
sections. An earlier draft claimed a `professional` read "never sees the personal
sections", which overstates what the scope config guarantees.

### 5 · Your data

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

### 6 · Closing

> ## Stop starting from nothing.
>
> Leave your email and we'll send an invite when a slot opens.

## Figma build order

1. Variables — colour, type, radius, space, motion, with light and dark modes
2. Type specimen frame — Stack Sans Notch at 72 / 56 / 40, both hero headline options
3. Gradient assets — generated palette-locked from GRADIENTOOL, exported as stills: edge strip, hero field, three tile caps, plus a dark variant of each
4. Run the app and capture the real editor, so the mockups are built from what exists rather than from memory
5. Core components — shell, actions, content, bento tile
6. Product objects — persona card, client chip, scope selector, proposal card, export view, all populated with Maya
7. Product mockup — `safari` frame recoloured, editor inside
8. Page assembly at 1440 desktop
9. Mobile at 390, where the bento collapses to one column
10. Prototype — waitlist states, then the hero motion beat

Steps 2 and 3 come early on purpose. Both are judged by eye, and both change
everything downstream if they land badly. Step 4 comes before any product object
is drawn, for the same reason.

## Out of scope

- Choosing a code target, and any implementation of it
- The waitlist backend endpoint and storage
- Pricing, testimonials, or a blog
- Changes to the existing app or docs site
- Any change to the app's current semantic tokens

## Success criteria

- A Figma file whose variables could be exported as CSS custom properties without renaming anything
- Landing page at 1440 and 390, all seven sections
- Bento grid at seven tiles, each with one or two explanatory sentences, and a one-column mobile collapse
- Waitlist field prototyped through all five states
- Every text-on-background pair in the file measured against WCAG AA
- Gradient assets present in light and dark, generated only from the five brand colours
- Every product object populated with Maya, consistently, with no placeholder text left in
- Nothing shown in a product object that MyGist does not actually do, verified against the running app rather than the docs

## Open questions

- **Which clients can be named.** The docs document Claude Desktop and Claude Code only. The hero promises context in "any assistant you open" and the audience is people juggling several, so a two-name row undersells the promise or oversells the docs, depending on which is out of date. Needs the owner's answer on what has actually been tested before section 2 and the hero beam are designed. Affects the client chip, the "Works with" row, and how many endpoints the `animated-beam` fans out to.
- Hero headline: "Write yourself down once." or "Explain yourself once." Decide from the Figma specimen.
- Stack Sans Notch carries Koto's notch signature from the Stack Overflow identity. Free and legal to use, and not yet widely deployed, but a reader who knows the rebrand may make the association. Accepted knowingly.
- Whether the gradient strips eventually ship as static exports or a live canvas. Deferred with the code target.
