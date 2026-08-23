# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: power-productivity AI users.** People who live in AI assistants all
day and are tired of re-establishing who they are at the start of every chat.
Confirmed as the centre of gravity, spanning two situations:

- **Anyone who uses AI assistants daily**, technical or not. They meet MyGist
  through a client they already use, and may never open Postgres, a token page,
  or a terminal. Everything essential must be reachable through the web editor
  and the assistant itself.
- **Developers using AI coding clients** (Claude Code, Codex, Cursor, Raycast).
  They re-explain their stack, their role, and how they want answers written.
  Comfortable with scoped tokens, `.mcp.json`, and self-hosting.

**Secondary: operators self-hosting for themselves.** The `/run` docs audience —
one person running their own instance, looking after the database, the search
index, and section packs. Their surfaces are documentation and settings, not
marketing.

Hosting an instance *for other people* is not a confirmed audience. Multi-account
isolation exists in the product, but no operator-of-a-community persona has been
established; do not design for it without asking.

## Product Purpose

MyGist stores a person's durable context once — role, stack, projects, how they
like answers written — and serves it to any AI client that speaks
[MCP](https://modelcontextprotocol.io), so the context travels between tools
instead of living inside one vendor's memory.

Success right now is **growing the invite-only beta**: waitlist → invite → a
person who actually keeps their persona current. Design work should optimise for
activation and retention inside a small cohort, not for converting cold traffic
at scale. Public sign-up is not the current goal.

## Positioning

The persona is the user's own structured JSON in their own Postgres — readable,
exportable, editable by hand, by the web editor, or by an assistant, all writing
to the same place. A vendor's built-in memory cannot truthfully claim any of
that: it is not portable across clients, not inspectable as data, and not
something you can host yourself.

The second differentiator is that nothing is inferred behind the user's back.
MCP tools are passive and run only when a client calls them; agents *propose*
durable changes with their reasoning and a quote, and nothing reaches the persona
until the user approves. Rejected proposals are never raised again.

## Operating Context

- The product is met from inside another tool. A client connects via OAuth
  (consent screen, chosen scopes) or a scoped bearer token for anything without a
  browser. Named MCP clients: Claude, Codex, Cursor, Raycast, Notion AI, Hermes.
- Two editing paths converge on one store: talk to the assistant, or open the web
  editor. Neither is the "real" one.
- Assistants read a *scope* (`minimal`, `professional`, …) with topic filters and
  a titles-only mode, then `search_context` → `get_entity` when they need
  something specific. A persona is expected to grow for years without every
  conversation paying for it.
- Ten persona sections: Profile, Goals, Knowledge, Preferences, Projects,
  Lifestyle, Circle, Learning log, plus optional Media and Aesthetics.
- One Docker image serves the web UI at `/`, REST at `/api`, MCP at `/mcp`, docs
  at `/docs`. Sign-in runs in a second container.
- Four Markdown skills in `backend/skills/` teach agents how to read, write, and
  propose; a running server serves them over MCP at `skill://mygist/<name>/`.

## Capabilities and Constraints

- **Invite-only gate and waitlist — fixed.** The user confirmed this as a product
  fact design work may not change without asking. While the gate exists, the
  landing page's job is the waitlist, not sign-up.
- Scoped reads, lean retrieval (Postgres full-text plus optional pgvector,
  degrading to FTS-only rather than breaking), structured writes against a
  published entity vocabulary (`get_schema`) with duplicate advisories, and a
  proposal queue with approve/reject.
- A new persona section is one declarative manifest (`backend/section_packs/`) —
  no backend or frontend code.
- Every read and write is scoped to the account behind the credential.
- Data leaves the server in exactly two cases: to the user's AI client when it
  asks, and to an embedding provider when the instance is configured with one
  (self-hosted instances can use a local embedding server or none).
- Persona history, revert, staleness, provenance, and an unattended sweep exist
  (commit `78b0b1c`); search hits report their age.
- Stack: Python backend, React 18 + Vite + Tailwind 3 + Radix web app, Next.js
  docs site (Fumadocs), Postgres with optional pgvector, Docker.
- **Not marked immovable, but true today:** passive MCP, own-Postgres ownership,
  and "docs site is the single source of truth" were offered as fixed constraints
  and *not* pinned. Treat them as current product truth to preserve by default,
  but they are open to change by decision rather than by drift.
- Licence is undecided ("TBD, currently private"). Do not state one.
- Roadmap, not built: better auto-triggering, conversation history for pattern
  detection, data versioning. Do not design as if these exist.

## Brand Commitments

- Name: **MyGist**. Formerly "Project Twin" / "Persona MCP" — the old names are
  history, not aliases to surface.
- Voice: plain British English, concrete, no marketing register. Hero line:
  "Explain yourself once."
- **Every user-facing claim cites a file.** `frontend/src/landing/content.js`
  records the rule explicitly: a bento visual and its prose must name the source
  it is checked against, because three earlier passes drew plausible product UI
  from imagination. This is a working constraint on copy and mock content, not a
  style preference.
- Marks live in `design/logos/` (`mygist.svg`, plus client marks); two named
  clients still have no logo file, and `lib/clients.js` is the single source for
  whether a mark exists.

## Evidence on Hand

- Real product screenshots: `docs-site/public/screenshots/` (18 shots — editor,
  chat transcripts, settings, tokens, sign-up, phone) and `design/screens/`.
  These came from a seeded demo account, so they are real UI, not mockups.
- Published docs site: <https://mygist.thuradev.qzz.io/docs>, split `/use` and
  `/run`, 21 MDX pages.
- Contrast audits and generated gradient assets under `design/`.
- Test suites: backend pytest, frontend Vitest + Storybook, per-component tests.
- **No customers, testimonials, usage numbers, press, pricing, or funding
  exist.** The product is invite-only and private. Never fabricate any of these,
  and never imply scale the waitlist does not have.

## Product Principles

1. **The persona travels.** Any decision that makes context portable across
   clients beats one that makes it richer inside a single client.
2. **Nothing lands without the user.** Agents propose; the user approves. Speed
   never comes from removing the approval step.
3. **Two doors, one room.** Assistant and web editor stay equal paths to the same
   data; neither becomes the second-class one.
4. **The data is legible and leaveable.** Readable JSON, export, delete. A design
   that obscures where the data is, or makes leaving harder, is wrong.
5. **Claims cite sources.** UI copy and demo content describe behaviour that
   exists in the repository, and can name the file that proves it.

## Accessibility & Inclusion

No formal standard is being certified against. Contrast and keyboard behaviour
are handled deliberately — `design/app-contrast-audit.md` and
`design/app-contrast.mjs` exist and stay useful — but their findings are
advisory rather than a shipping gate. No product-specific user need (screen
reader, low vision, reduced motion) has been established.
