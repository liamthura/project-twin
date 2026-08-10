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

export const HERO = {
  eyebrow: "Portable context for AI",
  headline: "Explain yourself once.",
  body: "Every new chat starts from nothing. You explain your role again, your stack again, how you like answers written. MyGist keeps all of that in one place and hands it to whichever assistant you open.",
  cta: "Join the waitlist",
  emailPlaceholder: "you@email.com",
  note: "Invite-only while it's small. One email when your invite lands.",
  signIn: { prefix: "Already have a code?", label: "Sign in." },
};

/**
 * Clients named in the README as speaking MCP. Chips, in the hero.
 *
 * `mark` says whether a logo file exists in public/landing/logos/. Simple Icons
 * does not carry OpenAI (pulled over a trademark request) or Hermes, and
 * worldvectorlogo -- the source the owner asked for -- returns 403 to every
 * automated request. Those two are name-only rather than an invented glyph.
 */
export const CLIENTS = [
  { name: "Claude", slug: "claude", mark: true },
  { name: "Codex", slug: "codex", mark: false },
  { name: "Raycast", slug: "raycast", mark: true },
  { name: "Notion AI", slug: "notion", mark: true },
  { name: "Hermes", slug: "hermes", mark: false },
];

export const STEPS = {
  eyebrow: "How it works",
  headline: "Three steps.",
  sub: "After that, every chat starts with you already in it.",
  items: [
    {
      title: "Write your gist.",
      body: "Your role, your stack, how you want answers written. Structured JSON, editable by hand or in the web UI.",
    },
    {
      title: "Connect a client.",
      body: "Paste one URL. Clients that speak OAuth get a consent screen where you pick what they may do. Anything without a browser uses a scoped token.",
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
  tiles: [
    {
      id: "scoped-reads",
      span: 2,
      title: "Scoped reads",
      body: "An assistant asks for a named scope and gets that slice, nothing else. Ask for minimal and it's a name and a role. Ask for professional and it's your tone rules and what you're in the middle of.",
      source: "backend/server.py:2813",
    },
    {
      id: "search",
      span: 1,
      title: "Search",
      body: "Ask for one thing, get one thing. MyGist returns ranked snippets first and fetches the whole entry only when something needs it, so a long persona never floods the conversation.",
      source: "backend/search_index.py",
    },
    {
      id: "sections",
      span: 1,
      title: "Your sections",
      body: "The ten sections are where you start. Adding an eleventh is one declarative file, so your gist can hold whatever you actually keep track of.",
      source: "backend/section_packs/*/manifest.json",
    },
    {
      id: "proposals",
      span: 2,
      title: "Proposals",
      body: "Nothing lands until you say so. When an assistant notices something durable about you, it proposes the change with its reasoning and a quote from you. Approve it, edit it, or reject it for good.",
      source: "backend/scopes.py",
    },
    {
      id: "consent",
      span: 1,
      title: "Consent",
      body: "Connecting a client takes one URL. On the consent screen you decide whether it can only read, suggest changes for you to approve, or write to your gist directly.",
      source: "frontend/src/components/Consent.jsx",
    },
    {
      id: "skills",
      span: 1,
      title: "Skills",
      body: "Four short guides ship with MyGist, covering how to read a gist and what's worth proposing. Same behaviour whichever client you happen to be in.",
      source: "skills/*/SKILL.md",
    },
    {
      id: "self-host",
      span: 1,
      title: "Run it yourself",
      body: "One Docker image serves the editor, the API and the MCP endpoint. Point it at your own Postgres if you would rather nobody else hosted it.",
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
 * The first question in each group ships open, so three answers are readable
 * without a click and the disclosure pattern is still obvious.
 */
export const FAQ = {
  eyebrow: "FAQ",
  headline: "Questions people actually ask.",
  sub: "The nine that come up most. The rest are in the docs.",
  groups: [
    {
      label: "Before you connect",
      items: [
        {
          q: "Which AI clients does this work with?",
          a: "Anything that speaks MCP: Claude, Codex, Raycast, Notion AI, Hermes. A client that speaks OAuth connects with nothing but the URL, through a consent screen. Anything without a browser uses a scoped token instead.",
        },
        {
          q: "How is this different from my client's built-in memory?",
          a: "Built-in memory lives inside one product. Move tools, and it does not come with you. MyGist is a database you control, reachable by anything that speaks MCP. It is also structured rather than a pile of notes, which is what lets a client ask for a slice instead of everything.",
        },
        {
          q: "Can I use it from more than one client?",
          a: "Yes. Issue a token each and point them at the same URL. They share one persona with no sync step, because there is only one copy.",
        },
      ],
    },
    {
      label: "What it can see and change",
      items: [
        {
          q: "Does MyGist read my conversations?",
          a: "No. MCP tools only run when a client calls them. MyGist never sees a message a client did not explicitly send it, and there is no background process watching anything.",
        },
        {
          q: "Can an assistant change my gist without asking?",
          a: "Only if you let it. A connection gets one of three levels: read only, suggest changes for you to approve, or write directly. Suggestions sit in your review queue until you say yes.",
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
          a: "In a Postgres database, as JSON — one row per section, per account. Self-host and that database is yours. On the hosted instance it sits on my server, and you can export all of it whenever you want.",
        },
        {
          q: "Can I get everything back out?",
          a: "Yes, all of it: Account → Data → Export, or ask your assistant for get_raw.",
        },
        {
          q: "Can I run it myself?",
          a: "Yes. One Docker image serves the web UI, the REST API, the MCP endpoint and the documentation. Point it at your own Postgres and nobody else is hosting your data.",
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
};

export const FOOTER = {
  blurb:
    "Portable context for AI. Write yourself down once and stop doing it again.",
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
      label: "Legal",
      links: [
        { label: "Privacy", href: null },
        { label: "Terms", href: null },
      ],
    },
  ],
};
