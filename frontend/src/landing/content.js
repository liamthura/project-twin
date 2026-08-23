/**
 * The landing page's copy deck.
 *
 * Kept as data rather than inlined in JSX because every line here is sourced,
 * and a source is easier to keep honest next to the string it justifies. The
 * design spec records the rule that produced this file:
 *
 *   > This is the third time on this branch that plausible-looking product UI
 *   > has been drawn from imagination rather than from the repository.
 *   > The rule: a bento visual cites a file.
 *
 * The same rule applies to prose. Nothing here describes behaviour that is not
 * in the repository, and the `source` fields say where to check.
 */
import { hasMark } from "@/lib/clients.js";

export const HERO = {
  eyebrow: "Portable context for AI",
  headline: "Explain yourself once.",
  body: "Every new chat starts from nothing. You explain your role again, your stack again, how you like answers written. MyGist keeps all of that in one place and hands it to whichever assistant you open.",
  cta: "Join the waitlist",
  emailPlaceholder: "you@email.com",
  note: "Invite-only while it's small. One email when your invite lands.",
  signIn: { prefix: "Already have a code?", label: "Sign in." },
  /**
   * The caption under the client chips, moved out of Hero.jsx so it sits with
   * the rest of the copy deck.
   *
   * MCP is defined here because this is where the page first uses it, and for
   * three builds it was never defined at all -- it appeared as the payoff line
   * under the hero's proof, to an audience that is half people who have never
   * heard of it. Twelve words costs the developer half of the audience nothing
   * and stops the other half deciding they are in the wrong place.
   */
  clientsCaption: "One URL. Any assistant that speaks MCP picks it up.",
  clientsNote:
    "MCP is the open standard AI clients use to plug into outside tools.",
};

/**
 * Clients named in the README as speaking MCP. Chips, in the hero.
 *
 * `mark` says whether a logo file exists in public/landing/logos/, and comes
 * from `lib/clients.js` rather than from a boolean typed here. The install
 * roster needs the same fact, and two copies of it drift the day a missing
 * logo finally lands: `design/logos/README.md` names two that are still
 * outstanding.
 *
 * This list is deliberately NOT the install roster. It answers "who speaks
 * MCP", which includes Notion AI, and the roster answers "who do we have
 * install steps for", which does not.
 */
export const CLIENTS = [
  { name: "Claude", slug: "claude", mark: hasMark("claude") },
  { name: "Codex", slug: "codex", mark: hasMark("codex") },
  { name: "Cursor", slug: "cursor", mark: hasMark("cursor") },
  { name: "Raycast", slug: "raycast", mark: hasMark("raycast") },
  { name: "Notion AI", slug: "notion", mark: hasMark("notion") },
  { name: "Hermes", slug: "hermes", mark: hasMark("hermes") },
];

export const STEPS = {
  eyebrow: "How it works",
  headline: "Three steps.",
  sub: "After that, every chat starts with you already in it.",
  items: [
    {
      title: "Write your gist.",
      // Not "edit it by hand", which was the old wording: to someone who has
      // never seen the product that means editing JSON, and it reads as
      // harder rather than as more flexible. Both real doors, named plainly.
      body: "Your role, your stack, how you want answers written. Type it into the web editor, or tell an assistant and approve what it suggests.",
    },
    {
      title: "Connect a client.",
      // Was: "Paste one URL. Clients that speak OAuth get a consent screen
      // where you pick what they may do. Anything without a browser uses a
      // scoped token." Three unfamiliar terms in one thirty-word sentence, in
      // the section whose entire job is making this sound easy. The three
      // choices named here are the real ones, verbatim from Consent.jsx; OAuth
      // and scoped tokens still live in the FAQ, which is where the person who
      // wants them looks.
      body: "Paste one URL into your assistant's settings. It asks what it may do — read your gist, suggest changes for your approval, or change it directly — and you choose.",
    },
    {
      title: "It travels.",
      body: "Open something else tomorrow and it already knows the same things.",
    },
  ],
};

/**
 * The bento. `span` matches the Figma grid: three columns, three rows, every
 * row summing to three.
 *
 * `source` is the file the tile's claim is checked against. A tile with no
 * source has not been checked -- that column exists because the first pass
 * invented all five of the 1-col visuals and every one was wrong.
 */
export const BENTO = {
  eyebrow: "What it does",
  headline: "Everything your assistants can ask for.",
  /**
   * Seven tiles at one weight, in one flat grid, served two audiences asking
   * opposite questions -- "is this safe" and "is this powerful" -- and made
   * the reader rank them. Two labelled groups of four and three, both within
   * the four-item chunk that scanning tolerates.
   *
   * `group` keys into GROUPS below. Row spans still sum to three within each
   * group, which is what keeps the grid intact: 2+1 and 2+1 in the first,
   * 1+1+1 in the second.
   */
  groups: [
    { key: "read", label: "What assistants can do with it" },
    { key: "extend", label: "What you can do with it" },
  ],
  /**
   * Every tile above names the file its claim was checked against, and until
   * now that was invisible to the reader. One page-level line rather than a
   * path under each tile: the discipline is worth showing, seven file paths on
   * a marketing page is not, and half the audience does not read paths.
   */
  sourcing:
    "Every claim on this page names the file it was checked against.",
  tiles: [
    {
      id: "scoped-reads",
      group: "read",
      span: 2,
      title: "Scoped reads",
      body: "An assistant asks for a named scope and gets that slice. Minimal is your name and role; professional adds your tone rules and what you're working on.",
      source: "backend/server.py:2813",
    },
    {
      id: "search",
      group: "read",
      span: 1,
      title: "Search",
      body: "MyGist returns ranked snippets first and fetches a whole entry only when one is needed, so a long persona never floods the conversation.",
      source: "backend/search_index.py",
    },
    {
      id: "sections",
      group: "extend",
      span: 1,
      title: "Your sections",
      body: "Ten sections to start with, and adding an eleventh is one declarative file, so your gist can hold whatever you keep track of.",
      source: "backend/section_packs/*/manifest.json",
    },
    {
      id: "proposals",
      group: "read",
      span: 2,
      title: "Proposals",
      body: "Nothing lands until you say so. An assistant that notices something durable proposes it, with its reasoning and a quote from you, and you approve, edit, or reject it for good.",
      source: "backend/scopes.py",
    },
    {
      id: "consent",
      group: "read",
      span: 1,
      title: "Consent",
      body: "Connecting takes one URL, and on the consent screen you choose whether a client can read, suggest changes for you to approve, or write directly.",
      source: "frontend/src/components/Consent.jsx",
    },
    {
      id: "skills",
      group: "extend",
      span: 1,
      title: "Skills",
      body: "Four short guides ship with MyGist, covering how to read a gist and what's worth proposing, so behaviour holds up whichever client you're in.",
      source: "skills/*/SKILL.md",
    },
    {
      id: "self-host",
      group: "extend",
      span: 1,
      title: "Run it yourself",
      body: "One Docker image serves the editor, the API and the MCP endpoint. Point it at your own Postgres and nobody else is hosting your data.",
      source: "README.md, Dockerfile",
    },
  ],
};

/**
 * Nine questions in three groups, built against the Checklist Design FAQ
 * checklist. Every answer is lifted from the repository: seven from
 * docs-site/content/docs/use/faq.mdx (the canonical FAQ, already grouped by
 * topic), the rest from README.md and Consent.jsx.
 *
 * Every question ships closed. An earlier cut opened the first of each group
 * so three answers were readable without a click; `Faq.jsx` records the
 * decision to change it, and `Landing.test.jsx` asserts all nine are shut.
 * This comment said the opposite for as long as both of those were true.
 */
export const FAQ = {
  eyebrow: "FAQ",
  headline: "Common questions.",
  sub: "The nine that come up most. The rest are in the docs.",
  groups: [
    {
      label: "Before you connect",
      items: [
        {
          q: "Which AI clients does this work with?",
          a: "Anything that speaks MCP: Claude, Codex, Cursor, Raycast, Notion AI, Hermes. Clients that speak OAuth connect with nothing but the URL, through a consent screen; anything without a browser uses a scoped token.",
        },
        {
          q: "How is this different from my client's built-in memory?",
          a: "Built-in memory lives inside one product and stays there when you move tools. MyGist is a Postgres database you control, reachable by anything that speaks MCP, and structured enough that a client can ask for one slice of it.",
        },
        {
          q: "Can I use it from more than one client?",
          a: "Yes. Issue a token each, point them at the same URL, and they share one persona with no sync step, because there is only one copy.",
        },
      ],
    },
    {
      label: "What it can see and change",
      items: [
        {
          q: "Does MyGist read my conversations?",
          a: "No. MCP tools only run when a client calls them, so MyGist never sees a message a client did not send it and there is no background process watching anything.",
        },
        {
          q: "Can an assistant change my gist without asking?",
          a: "Only if you let it: a connection gets read-only, suggest-for-approval, or write-directly. Anything suggested sits in your review queue until you say yes.",
        },
        {
          q: "Can other users on the same server see my persona?",
          a: "No. Every read and write is scoped to the account behind the credential.",
        },
      ],
    },
    {
      label: "Where it lives",
      items: [
        {
          q: "Where does my data actually live?",
          a: "In a Postgres database, as JSON: one row per section, per account. Self-host and that database is yours; on the hosted instance it sits on my server, and you can export all of it whenever you want.",
        },
        {
          q: "Can I get everything back out?",
          a: "Yes, all of it: Account → Data → Export, or ask your assistant for get_raw.",
        },
        {
          q: "Can I run it myself?",
          a: "Yes. One Docker image serves the web UI, the REST API, the MCP endpoint and the documentation, and you point it at your own Postgres so nobody else is hosting your data.",
        },
      ],
    },
  ],
  /** Ordered easiest-first, per the checklist's contact-options rule. */
  contact: {
    title: "Still stuck?",
    sub: "Two ways out, the quicker one first.",
    options: [
      { label: "Send an email", href: "mailto:liam@thuradev.qzz.io", primary: true },
      { label: "Read the documentation", href: "/docs", primary: false },
    ],
  },
};

export const CLOSING = {
  headline: "Stop starting from nothing.",
  sub: "Leave your email and we'll send an invite when a slot opens.",
  cta: "Join the waitlist",
  /**
   * The hero carries an invite note and the closing CTA did not, so the page
   * asked a second time with strictly less reassurance than the first -- at
   * the point where a visitor has just read nine FAQ answers about what
   * happens to their data. Reassurance should increase toward the ask.
   */
  note: "One email when your invite lands, and nothing else.",
  /** Linked, not just named. Pointing at a privacy page from the one place a
   *  visitor is deciding whether to hand over an address, and then making them
   *  go and find it in the footer, is a dead end at the worst moment. */
  noteLink: { label: "What we store", href: "/docs/privacy" },
  /** Shown instead of a second field once the hero's form has been used. */
  done: "You're on the list. We'll email you when a slot opens.",
};

export const FOOTER = {
  blurb: "Portable context for AI. Write yourself down once.",
  status: "Invite-only while it's small.",
  groups: [
    {
      label: "Product",
      links: [
        { label: "How it works", href: "#how-it-works" },
        { label: "What it does", href: "#what-it-does" },
        { label: "FAQ", href: "#faq" },
        { label: "Docs", href: "/docs" },
      ],
    },
    {
      label: "Developers",
      links: [
        { label: "Self-host", href: "/docs/run" },
        // The repository is private ("License: TBD -- currently private" in
        // README.md), so this is deliberately not a github.com URL yet.
        { label: "GitHub", href: null },
      ],
    },
    {
      // Privacy has a real page now. Terms is gone rather than greyed out:
      // there is no paid product and no account to govern while the gate is
      // up, so a Terms link was advertising an absence rather than reserving
      // a slot -- and "Privacy" and "Terms" both dead, directly under an email
      // field, was the last thing a visitor saw.
      label: "Legal",
      links: [{ label: "Privacy", href: "/docs/privacy" }],
    },
  ],
};
