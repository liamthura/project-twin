# Onboarding rework and per-client install - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the onboarding `Connect` step a per-client install card so pointing an AI client at MyGist over OAuth is one copy or one click, and give the rest of the five-step flow a matching design pass.

**Architecture:** One roster module (`lib/clients.js`) owns which clients exist and what installing means in each. Two presentation components (`ClientPicker`, `InstallCard`) read it. `StepConnect` orchestrates them and keeps every behaviour it already has: instance gating on `mcp_oauth`, the bearer-token fallback, and the who-fills-it-in fork. Four Magic UI components are vendored as JSX rather than installed.

**Tech Stack:** React 18, Vite, Tailwind 3, `motion` v13, Radix primitives, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-16-onboarding-install-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **React 18, not 19.** No `use()`, no `ref` as a plain prop, no React Compiler idioms.
- **Tailwind 3, not 4.** `max-h-100`, `bg-linear-to-*`, `border-(length:...)`, `mask-*` and `from-(--var)` are Tailwind 4 utilities and do not exist here. Use v3 equivalents or arbitrary values.
- **JSX, not TSX.** This app is not TypeScript. Strip every type annotation, interface and generic when vendoring.
- **Semantic colours only.** `hsl(var(--primary))`, `hsl(var(--muted-foreground))` and friends. Never a raw hex, never `text-black dark:text-white`. The full token list is in `frontend/src/globals.css`.
- **`motion/react` is the import path.** Matches `blur-fade.jsx`, the existing vendored component.
- **Every vendored component honours `prefers-reduced-motion`** via `useReducedMotion()` with an early return that renders plain markup, exactly as `blur-fade.jsx` does. Not a motion component with zeroed values.
- **British English in all user-facing copy.** No em dashes or en dashes anywhere in copy, headings or comments; regular hyphen only.
- **Banned copy patterns:** binary contrasts ("not X, it's Y"), colon reveals, throat-clearing, faux-insight setups, and the words listed in the `no-ai-slop` skill.
- **Banned design patterns** from the owner's aesthetics record: neon and outer glows, gradient text on headings, the purple-to-blue AI gradient, three identical cards in a row, decorative status dots where no real state exists, emoji as icons.
- **Motion budget:** press 120-180ms, state change 180-260ms, entrance 240ms ease-out, exit 180ms ease-in. Nothing over 300ms except ambient loops, which are exempt from the ceiling but not from reduced motion.
- **Comment style:** this codebase writes long explanatory headers saying *why*, not *what*. Match `StepConnect.jsx` and `WelcomeVisual.jsx`. A file with no header comment will look wrong here.
- **Run tests with** `npm test -- --project=unit <path>` from `frontend/`. Bare `npm test` also runs the Storybook browser project, which is slow and unrelated.

---

### Task 1: The client roster

**Files:**
- Create: `frontend/src/lib/clients.js`
- Test: `frontend/src/lib/clients.test.js`

**Interfaces:**
- Consumes: `mcpUrl()` from `@/lib/api.js` is passed in by callers; this module never imports it, so it stays a pure function of its argument and is testable without mocking the API.
- Produces:
  - `CLIENTS` - array of `{ id, name, slug, mark, kind, install }`
  - `INSTALLABLE_CLIENTS` - `CLIENTS` filtered to those with an install card
  - `hasMark(slug)` - boolean, whether `public/landing/logos/<slug>.svg` exists
  - `kind` is one of `"deeplink" | "command" | "steps" | "unlisted"`
  - `install(url)` returns a string for `deeplink`, an array of strings for `command` and `steps`, and `null` for `unlisted`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/clients.test.js`:

```js
import { describe, it, expect } from "vitest";
import { CLIENTS, INSTALLABLE_CLIENTS, hasMark } from "./clients.js";

const TEST_URL = "https://example.test/mcp";
const byId = (id) => CLIENTS.find((c) => c.id === id);

describe("the roster", () => {
  it("gives every client a kind the UI knows how to render", () => {
    const kinds = new Set(["deeplink", "command", "steps", "unlisted"]);
    for (const client of CLIENTS) {
      expect(kinds.has(client.kind), `${client.id} has kind ${client.kind}`).toBe(true);
    }
  });

  it("gives every client a unique id", () => {
    const ids = CLIENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps unlisted clients out of the picker", () => {
    // Notion AI is named on the landing page but has no confirmed path for
    // adding an arbitrary custom MCP server, so it must not get a card.
    expect(byId("notion")?.kind).toBe("unlisted");
    expect(INSTALLABLE_CLIENTS.map((c) => c.id)).not.toContain("notion");
  });

  it("reports which logo files actually exist", () => {
    // design/logos/README.md: Simple Icons dropped OpenAI over a trademark
    // request and never indexed Hermes, so those two are name-only.
    expect(hasMark("claude")).toBe(true);
    expect(hasMark("raycast")).toBe(true);
    expect(hasMark("notion")).toBe(true);
    expect(hasMark("codex")).toBe(false);
    expect(hasMark("hermes")).toBe(false);
  });
});

describe("command clients", () => {
  it("puts the live server address in the Claude Code command", () => {
    expect(byId("claude-code").install(TEST_URL)).toEqual([
      `claude mcp add --transport http mygist ${TEST_URL}`,
    ]);
  });

  it("gives Codex both lines, because add without login leaves a server that 401s", () => {
    expect(byId("codex").install(TEST_URL)).toEqual([
      `codex mcp add mygist --url ${TEST_URL}`,
      "codex mcp login mygist",
    ]);
  });

  it("asks Hermes for oauth explicitly", () => {
    expect(byId("hermes").install(TEST_URL)).toEqual([
      `hermes mcp add mygist --url ${TEST_URL} --auth oauth`,
    ]);
  });

  it("never hardcodes a host", () => {
    for (const client of INSTALLABLE_CLIENTS.filter((c) => c.kind === "command")) {
      expect(client.install(TEST_URL).join(" ")).toContain(TEST_URL);
    }
  });
});

describe("the Cursor deeplink", () => {
  it("carries a base64 config Cursor can read back", () => {
    const link = byId("cursor").install(TEST_URL);
    expect(link.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);

    const config = new URL(link).searchParams.get("config");
    expect(JSON.parse(atob(config))).toEqual({ type: "http", url: TEST_URL });
  });

  it("names the server so it is identifiable in Cursor's list", () => {
    const link = byId("cursor").install(TEST_URL);
    expect(new URL(link).searchParams.get("name")).toBe("mygist");
  });
});

describe("steps clients", () => {
  it("gives every steps client something to follow", () => {
    for (const client of INSTALLABLE_CLIENTS.filter((c) => c.kind === "steps")) {
      const steps = client.install(TEST_URL);
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) expect(step.trim()).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/lib/clients.test.js`
Expected: FAIL, `Failed to resolve import "./clients.js"`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/clients.js`:

```js
/**
 * The clients MyGist can tell you how to install it in, and what installing
 * means in each one.
 *
 * `kind` is a fact about the client, not a presentation choice, and it is the
 * reason this file exists rather than a list of names somewhere in a component.
 * Of the clients MyGist names, exactly ONE has a real deeplink. Rendering six
 * identical "Install" buttons would promise the same gesture six times and
 * deliver it once.
 *
 *   deeplink   registers a URL scheme that accepts a server config. Cursor.
 *   command    ships a CLI that adds a server. Claude Code, Codex, Hermes.
 *   steps      neither, so the reader opens a settings screen themselves.
 *   unlisted   named on the landing page, no install card here.
 *
 * Notion AI is `unlisted` deliberately. It is well documented as an MCP
 * SERVER, at mcp.notion.com, and nothing found in August 2026 confirmed that
 * Notion AI accepts an arbitrary custom MCP server as a CLIENT. Guessed steps
 * are worse than no steps: they send someone hunting for a setting that may not
 * exist. Moving it to `steps` is a one-line change once somebody checks.
 *
 * `install` takes the server address rather than reading it, so every command
 * string is a pure function of its argument and the tests need no API mock.
 */

/**
 * Slugs with a logo file in `public/landing/logos/`.
 *
 * Kept here rather than in the roster entries because `landing/content.js`
 * needs the same fact for its hero chips, and two copies of "does this mark
 * exist" is exactly the pair that drifts when a logo finally lands.
 *
 * Why two are missing is recorded in `design/logos/README.md`: Simple Icons
 * pulled OpenAI over a trademark request and never indexed Hermes, and the
 * source their owners point at returns 403 to automated requests. Those two
 * render name-only rather than as an invented glyph.
 */
const LOGO_SLUGS = new Set(["claude", "raycast", "notion"]);

export function hasMark(slug) {
  return LOGO_SLUGS.has(slug);
}

/**
 * Cursor's one-click install link.
 *
 * The config is the same shape as an entry in `mcp.json`, JSON-stringified and
 * base64-encoded. `btoa` throws on anything outside Latin-1, which cannot
 * happen here: the address comes from `mcpUrl()`, which builds on
 * `window.location.origin`, and a browser has already punycoded an
 * international hostname by the time it appears there.
 */
function cursorDeeplink(url) {
  const config = btoa(JSON.stringify({ type: "http", url }));
  return (
    "cursor://anysphere.cursor-deeplink/mcp/install" +
    `?name=mygist&config=${encodeURIComponent(config)}`
  );
}

export const CLIENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    slug: "claude",
    mark: hasMark("claude"),
    kind: "command",
    install: (url) => [`claude mcp add --transport http mygist ${url}`],
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    slug: "claude",
    mark: hasMark("claude"),
    kind: "steps",
    install: () => [
      "Open Settings, then Connectors.",
      "Choose Add custom connector.",
      "Paste the address below and save it.",
      "Claude opens MyGist and asks you to sign in. Approve the connection, and keep the permission to suggest changes.",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    slug: "cursor",
    mark: hasMark("cursor"),
    kind: "deeplink",
    install: cursorDeeplink,
  },
  {
    id: "codex",
    name: "Codex",
    slug: "codex",
    mark: hasMark("codex"),
    kind: "command",
    // Two lines, and both are needed. `add` registers the server; `login` runs
    // the OAuth flow. Showing only the first leaves someone with a registered
    // server that answers 401 and nothing on screen explaining why.
    install: (url) => [`codex mcp add mygist --url ${url}`, "codex mcp login mygist"],
  },
  {
    id: "hermes",
    name: "Hermes",
    slug: "hermes",
    mark: hasMark("hermes"),
    kind: "command",
    install: (url) => [`hermes mcp add mygist --url ${url} --auth oauth`],
  },
  {
    id: "raycast",
    name: "Raycast",
    slug: "raycast",
    mark: hasMark("raycast"),
    kind: "steps",
    install: () => [
      "Open Raycast Settings, then MCP.",
      "Choose Install Server, and pick the HTTP transport.",
      "Paste the address below and name it MyGist.",
      "Choose Sign In. Raycast registers itself and opens MyGist for you to approve.",
    ],
  },
  {
    id: "notion",
    name: "Notion AI",
    slug: "notion",
    mark: hasMark("notion"),
    kind: "unlisted",
    install: () => null,
  },
];

export const INSTALLABLE_CLIENTS = CLIENTS.filter((c) => c.kind !== "unlisted");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --project=unit src/lib/clients.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/clients.js frontend/src/lib/clients.test.js
git commit -m "feat(onboarding): a roster of clients and what installing means in each"
```

---

### Task 2: Vendor Terminal, chrome only

**Files:**
- Create: `frontend/src/components/ui/terminal.jsx`
- Test: `frontend/src/components/ui/terminal.test.jsx`

**Interfaces:**
- Produces: `<Terminal title>{children}</Terminal>` and `<AnimatedSpan delay>{children}</AnimatedSpan>`. `title` renders in the title bar; children are mono lines.

**Why this is trimmed rather than copied:** the registry component's headline feature is `TypingAnimation`, which reveals text one character at a time on a `setInterval`. That is wrong for a command someone came to copy, because the text is incomplete and unselectable while it types. The registry version also draws three coloured dots as a fake macOS title bar, and "decorative status dots where no real state exists" is on the owner's banned list. The title bar carries the client's name instead, which is information the card wants anyway.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/terminal.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Terminal, AnimatedSpan } from "./terminal.jsx";

describe("Terminal", () => {
  it("shows its lines in full straight away", () => {
    // The registry component types character by character. A command someone
    // came here to copy must be complete and selectable on first paint.
    render(
      <Terminal title="Claude Code">
        <AnimatedSpan>claude mcp add --transport http mygist https://example.test/mcp</AnimatedSpan>
      </Terminal>,
    );
    expect(
      screen.getByText("claude mcp add --transport http mygist https://example.test/mcp"),
    ).toBeInTheDocument();
  });

  it("names the client in the title bar", () => {
    render(
      <Terminal title="Codex">
        <AnimatedSpan>codex mcp add mygist</AnimatedSpan>
      </Terminal>,
    );
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("draws no decorative traffic lights", () => {
    // Banned pattern: status dots where no real state exists.
    const { container } = render(
      <Terminal title="Codex">
        <AnimatedSpan>codex mcp add mygist</AnimatedSpan>
      </Terminal>,
    );
    expect(container.querySelector(".bg-red-500")).toBeNull();
    expect(container.querySelector(".bg-yellow-500")).toBeNull();
    expect(container.querySelector(".bg-green-500")).toBeNull();
  });

  it("uses no Tailwind 4 utilities", () => {
    // max-h-100 and bg-linear-to-* exist in v4 only. This project is on v3, and
    // a v4 class fails silently as an unknown class rather than loudly.
    const { container } = render(
      <Terminal title="Codex">
        <AnimatedSpan>codex mcp add mygist</AnimatedSpan>
      </Terminal>,
    );
    expect(container.innerHTML).not.toMatch(/\bmax-h-100\b/);
    expect(container.innerHTML).not.toMatch(/\bbg-linear-to-/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/components/ui/terminal.test.jsx`
Expected: FAIL, `Failed to resolve import "./terminal.jsx"`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/ui/terminal.jsx`:

```jsx
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Magic UI's `terminal`, adapted, and adapted hard.
 *
 * Three changes from the registry version, all load-bearing:
 *
 *   `TypingAnimation` is gone entirely, not imported and left uncalled. It
 *   reveals a string one character at a time on a setInterval, which is a fine
 *   effect for a hero and the wrong one for a command someone came here to
 *   copy: mid-animation the text is incomplete, and a triple-click selects
 *   whatever had arrived by then. The card exists to hand over a command, so
 *   the command is complete on first paint.
 *
 *   The three coloured dots are gone. They are a drawing of a macOS title bar,
 *   and "decorative status dots where no real state exists" is on the design
 *   ban list. The bar carries the client's name instead, which is something the
 *   reader actually needs to know while three cards are on screen.
 *
 *   `max-h-100` was a Tailwind 4 utility and does not exist on this project's
 *   v3. It is `max-h-[25rem]`, which is what v4 resolves it to.
 *
 * What is kept is the chrome: a bordered box with a title bar and a mono body.
 * The design record asks for real product chrome over "fake UI assembled from
 * styled divs", and a terminal is the chrome these commands genuinely live in.
 */

/**
 * One line. Fades in on mount, and only on mount.
 *
 * The registry version drives this from an in-view observer and a sequence
 * context so lines appear one after another. Both are gone with the typing: a
 * card that is already open should show its command now, and the entrance is
 * the flow's standard 240ms rather than a staged reveal.
 */
export function AnimatedSpan({ children, delay = 0, className, ...props }) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div className={cn("grid text-xs font-normal tracking-tight", className)} {...props}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut", delay: delay / 1000 }}
      className={cn("grid text-xs font-normal tracking-tight", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function Terminal({ children, title, className }) {
  return (
    <div
      className={cn(
        "z-0 max-h-[25rem] w-full overflow-hidden rounded-lg border border-border bg-muted/40",
        className,
      )}
    >
      {title && (
        <div className="border-b border-border px-3 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
        </div>
      )}
      <pre className="overflow-x-auto p-3">
        <code className="grid gap-y-1 font-mono">{children}</code>
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --project=unit src/components/ui/terminal.test.jsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/terminal.jsx frontend/src/components/ui/terminal.test.jsx
git commit -m "feat(ui): vendor Magic UI Terminal as chrome, without the typing"
```

---

### Task 3: Vendor MagicCard

**Files:**
- Create: `frontend/src/components/ui/magic-card.jsx`
- Test: `frontend/src/components/ui/magic-card.test.jsx`

**Interfaces:**
- Produces: `<MagicCard className>{children}</MagicCard>`. A spotlight follows the pointer across the card and fades the border in on hover.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/magic-card.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MagicCard } from "./magic-card.jsx";

describe("MagicCard", () => {
  it("renders its children", () => {
    render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("carries no raw hex colours", () => {
    // The registry defaults are #9E7AFF to #FE8BBB, which is the purple-to-pink
    // AI gradient on the design ban list. Every colour here comes from a token.
    const { container } = render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("survives a pointer move without a theme provider", () => {
    // The registry version imports next-themes, which this app does not use.
    // Only its orb mode needed the theme, and orb mode is not vendored.
    const { container } = render(
      <MagicCard>
        <p>Claude Code</p>
      </MagicCard>,
    );
    const card = container.firstChild;
    expect(() => {
      card.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/components/ui/magic-card.test.jsx`
Expected: FAIL, `Failed to resolve import "./magic-card.jsx"`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/ui/magic-card.jsx`:

```jsx
import { useCallback, useEffect } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Magic UI's `magic-card`, adapted.
 *
 * Four changes from the registry version:
 *
 *   `next-themes` is gone, along with the whole `mode="orb"` branch that
 *   needed it. This app switches themes with a class on <html>, not that
 *   library, and the gradient mode never read the theme in the first place.
 *
 *   The default palette was #9E7AFF to #FE8BBB. That is the purple-to-pink
 *   gradient the design record names as the single most recognisable AI-slop
 *   signature. Both ends are semantic tokens now, and the spotlight is a muted
 *   tint rather than a saturated one.
 *
 *   `var(--color-background)` and `var(--color-border)` are Tailwind 4 theme
 *   variables. This project's equivalents are `hsl(var(--background))` and
 *   `hsl(var(--border))`.
 *
 *   It honours `prefers-reduced-motion`, returning a plain bordered box. A
 *   spotlight chasing the cursor is precisely the drifting effect someone who
 *   set that flag asked not to have.
 */
const SPOTLIGHT_SIZE = 200;

export function MagicCard({ children, className }) {
  const reduced = useReducedMotion();

  // Started off-card, so nothing is lit until the pointer actually arrives.
  const mouseX = useMotionValue(-SPOTLIGHT_SIZE);
  const mouseY = useMotionValue(-SPOTLIGHT_SIZE);

  const reset = useCallback(() => {
    mouseX.set(-SPOTLIGHT_SIZE);
    mouseY.set(-SPOTLIGHT_SIZE);
  }, [mouseX, mouseY]);

  const handlePointerMove = useCallback(
    (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  // A pointer that leaves the window never fires pointerleave on the card.
  // blur alone is not enough: switching to another tab fires visibilitychange
  // but not blur, because the window keeps OS focus. So the spotlight would
  // stay frozen at the last pointer position until a genuine pointer event
  // recalculates it. Both listeners reset the spotlight when focus is lost.
  //
  // Note the two different targets. `blur` is a window event; `visibilitychange`
  // is dispatched at the document. Registering the second one on window happens
  // to work through bubbling, but a test written against it dispatches at window
  // too and then proves nothing about the path a browser actually takes.
  useEffect(() => {
    const clear = () => reset();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clear();
      }
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reset]);

  const border = useMotionTemplate`
    linear-gradient(hsl(var(--background)) 0 0) padding-box,
    radial-gradient(${SPOTLIGHT_SIZE}px circle at ${mouseX}px ${mouseY}px,
      hsl(var(--primary) / 0.5),
      hsl(var(--border)) 100%
    ) border-box
  `;

  const spotlight = useMotionTemplate`
    radial-gradient(${SPOTLIGHT_SIZE}px circle at ${mouseX}px ${mouseY}px,
      hsl(var(--muted-foreground) / 0.12),
      transparent 100%
    )
  `;

  if (reduced) {
    return (
      <div className={cn("relative overflow-hidden rounded-lg border", className)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={cn(
        "group relative isolate overflow-hidden rounded-lg border border-transparent",
        className,
      )}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      style={{ background: border }}
    >
      <div className="absolute inset-px z-20 rounded-[inherit] bg-background" />
      <motion.div
        className="pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: spotlight }}
      />
      <div className="relative z-40">{children}</div>
    </motion.div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --project=unit src/components/ui/magic-card.test.jsx`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/magic-card.jsx frontend/src/components/ui/magic-card.test.jsx
git commit -m "feat(ui): vendor Magic UI MagicCard, retinted off the AI gradient"
```

---

### Task 4: The install card

**Files:**
- Create: `frontend/src/components/onboarding/InstallCard.jsx`
- Test: `frontend/src/components/onboarding/InstallCard.test.jsx`

**Interfaces:**
- Consumes: `CLIENTS` entries from Task 1 (`{ id, name, kind, install }`), `Terminal` and `AnimatedSpan` from Task 2.
- Produces: `<InstallCard client={client} url={string} />`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/InstallCard.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CLIENTS } from "@/lib/clients.js";
import { InstallCard } from "./InstallCard.jsx";

const TEST_URL = "https://example.test/mcp";
const client = (id) => CLIENTS.find((c) => c.id === id);

describe("InstallCard, a command client", () => {
  it("shows the command in full", async () => {
    render(<InstallCard client={client("claude-code")} url={TEST_URL} />);
    expect(
      await screen.findByText(`claude mcp add --transport http mygist ${TEST_URL}`),
    ).toBeInTheDocument();
  });

  it("shows both of Codex's lines", async () => {
    render(<InstallCard client={client("codex")} url={TEST_URL} />);
    expect(await screen.findByText(`codex mcp add mygist --url ${TEST_URL}`)).toBeInTheDocument();
    expect(screen.getByText("codex mcp login mygist")).toBeInTheDocument();
  });

  it("copies every line at once, newline separated", async () => {
    const user = userEvent.setup();
    render(<InstallCard client={client("codex")} url={TEST_URL} />);

    await user.click(screen.getByRole("button", { name: /copy command/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `codex mcp add mygist --url ${TEST_URL}\ncodex mcp login mygist`,
    );
  });
});

describe("InstallCard, a deeplink client", () => {
  it("offers a labelled button that opens the client", () => {
    render(<InstallCard client={client("cursor")} url={TEST_URL} />);

    const link = screen.getByRole("link", { name: /add to cursor/i });
    expect(link.getAttribute("href")).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/,
    );
  });

  it("still offers the raw link, for a browser that will not hand off the scheme", async () => {
    const user = userEvent.setup();
    render(<InstallCard client={client("cursor")} url={TEST_URL} />);

    await user.click(screen.getByRole("button", { name: /copy link/i }));
    await expect(navigator.clipboard.readText()).resolves.toMatch(/^cursor:\/\//);
  });
});

describe("InstallCard, a steps client", () => {
  it("numbers the steps and shows the address to paste", () => {
    render(<InstallCard client={client("claude-desktop")} url={TEST_URL} />);

    expect(screen.getByText(/add custom connector/i)).toBeInTheDocument();
    expect(screen.getByText(TEST_URL)).toBeInTheDocument();
  });

  it("offers the address for copying", async () => {
    const user = userEvent.setup();
    render(<InstallCard client={client("raycast")} url={TEST_URL} />);

    await user.click(screen.getByRole("button", { name: /copy server address/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(TEST_URL);
  });
});

describe("InstallCard", () => {
  it("renders nothing for a client with no install path", () => {
    // `unlisted` reaches here only through a bug, and rendering an empty card
    // would look like a card that failed to load.
    const { container } = render(<InstallCard client={client("notion")} url={TEST_URL} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/InstallCard.test.jsx`
Expected: FAIL, `Failed to resolve import "./InstallCard.jsx"`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/onboarding/InstallCard.jsx`:

```jsx
/**
 * How to install MyGist in one named client.
 *
 * Three kinds, because installing genuinely is three different gestures and
 * only one of them is a click. See `lib/clients.js` for why `kind` lives in the
 * roster rather than here.
 *
 * The copy control is the point of the whole card. Everything else on screen is
 * context for the one string someone came to take away, so each kind ends in
 * something copyable: the command, the deeplink, or the address.
 */
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AnimatedSpan, Terminal } from "@/components/ui/terminal";

function CopyButton({ value, label, children, variant = "outline" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      size="sm"
      className="shrink-0"
      aria-label={label}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {children && <span className="ml-1.5">{copied ? "Copied" : children}</span>}
    </Button>
  );
}

/**
 * The server address, shown and copyable.
 *
 * `<output>` rather than a read-only input: it is a value the page produced,
 * not a field anyone edits, and `select-all` makes a click take the whole
 * string rather than a word of it.
 */
function AddressRow({ id, url }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Server address</Label>
      <div className="flex gap-2">
        <output
          id={id}
          className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs"
        >
          {url}
        </output>
        <CopyButton value={url} label="Copy server address" />
      </div>
    </div>
  );
}

function Steps({ items }) {
  return (
    <ol className="space-y-2 text-sm">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {i + 1}
          </span>
          <span className="leading-relaxed text-muted-foreground">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallCard({ client, url }) {
  const payload = client.install(url);
  if (!payload) return null;

  if (client.kind === "deeplink") {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          This opens {client.name} and adds MyGist for you. Sign in when it asks,
          and keep the permission to suggest changes.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <a href={payload}>
              Add to {client.name}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
          {/* Some browsers refuse to hand a custom scheme to an application
              without a user gesture they recognise, and say nothing when they
              do. The raw link is the way out of that. */}
          <CopyButton value={payload} label="Copy link" variant="ghost">
            Copy link
          </CopyButton>
        </div>
      </div>
    );
  }

  if (client.kind === "command") {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Run this, then sign in when {client.name} opens MyGist in your browser.
        </p>
        <Terminal title={client.name}>
          {payload.map((line, i) => (
            <AnimatedSpan key={line} delay={i * 60} className="text-foreground">
              {line}
            </AnimatedSpan>
          ))}
        </Terminal>
        {/* One copy for every line. Two buttons on a two-line command reads as
            a choice, and there is no case for taking only half of it. */}
        <CopyButton value={payload.join("\n")} label="Copy command">
          Copy command
        </CopyButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Steps items={payload} />
      <AddressRow id={`install-address-${client.id}`} url={url} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/InstallCard.test.jsx`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/InstallCard.jsx frontend/src/components/onboarding/InstallCard.test.jsx
git commit -m "feat(onboarding): an install card per client kind"
```

---

### Task 5: The client picker

**Files:**
- Create: `frontend/src/components/onboarding/ClientPicker.jsx`
- Test: `frontend/src/components/onboarding/ClientPicker.test.jsx`

**Interfaces:**
- Consumes: `INSTALLABLE_CLIENTS` from Task 1, `MagicCard` from Task 3.
- Produces: `<ClientPicker clients={array} selectedId={string|null} onSelect={(id) => void} renderExpanded={(client) => node} />`

**Layout:** a single column of rows, never a grid. Three identical cards in a row is on the ban list and six would be worse. One row is expanded at a time, and the expanded row holds the install card.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/ClientPicker.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";
import { ClientPicker } from "./ClientPicker.jsx";

const renderPicker = (props = {}) =>
  render(
    <ClientPicker
      clients={INSTALLABLE_CLIENTS}
      selectedId={null}
      onSelect={vi.fn()}
      renderExpanded={(client) => <p>install {client.id}</p>}
      {...props}
    />,
  );

describe("ClientPicker", () => {
  it("lists every installable client", () => {
    renderPicker();
    for (const client of INSTALLABLE_CLIENTS) {
      expect(screen.getByRole("button", { name: new RegExp(client.name, "i") })).toBeInTheDocument();
    }
  });

  it("reports which one was chosen", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker({ onSelect });

    await user.click(screen.getByRole("button", { name: /claude code/i }));
    expect(onSelect).toHaveBeenCalledWith("claude-code");
  });

  it("expands only the chosen row", () => {
    renderPicker({ selectedId: "cursor" });

    expect(screen.getByText("install cursor")).toBeInTheDocument();
    expect(screen.queryByText("install codex")).not.toBeInTheDocument();
  });

  it("closes a row that is clicked while open", async () => {
    // Selecting the open row again is the only way back to a closed list, and a
    // row that will not close reads as broken.
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker({ selectedId: "cursor", onSelect });

    await user.click(screen.getByRole("button", { name: /cursor/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("says which row is open, for a screen reader", () => {
    renderPicker({ selectedId: "cursor" });

    expect(screen.getByRole("button", { name: /cursor/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /codex/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("stacks in one column rather than a grid", () => {
    // Three identical cards in a row is a named AI-slop signature, and six
    // would be worse. This pins the layout so a later tidy-up cannot quietly
    // reintroduce it.
    const { container } = render(
      <ClientPicker
        clients={INSTALLABLE_CLIENTS}
        selectedId={null}
        onSelect={vi.fn()}
        renderExpanded={() => null}
      />,
    );
    expect(container.querySelector('[class*="grid-cols-"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/ClientPicker.test.jsx`
Expected: FAIL, `Failed to resolve import "./ClientPicker.jsx"`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/onboarding/ClientPicker.jsx`:

```jsx
/**
 * Which client are you connecting.
 *
 * A single column, and that is a rule rather than a preference: three identical
 * cards in a row is one of the named AI-slop signatures in the design record,
 * and six of them would be a worse version of the same thing. A list also
 * scales without reflowing, which matters because the roster grows.
 *
 * One row open at a time. Two open cards put two server addresses and two copy
 * buttons on screen at once, and there is no reading of that which helps.
 *
 * `renderExpanded` rather than importing InstallCard directly: the picker knows
 * about rows and selection, and nothing about what installing involves. That
 * keeps the two testable apart, and the picker reusable from Settings later.
 */
import { ChevronDown } from "lucide-react";

import { MagicCard } from "@/components/ui/magic-card";
import { cn } from "@/lib/utils";

// What the row promises the action will be. Named for the reader rather than
// for the roster: "deeplink" is our word, "One click" is theirs.
const ACTION_LABEL = {
  deeplink: "One click",
  command: "One command",
  steps: "A few steps",
};

function Mark({ client }) {
  if (!client.mark) {
    // No logo file for this one. `design/logos/README.md` records why, and an
    // invented glyph would be worse than an initial.
    return (
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[10px] font-semibold text-muted-foreground"
      >
        {client.name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={`/landing/logos/${client.slug}.svg`}
      alt=""
      aria-hidden="true"
      className="h-6 w-6 shrink-0"
    />
  );
}

export function ClientPicker({ clients, selectedId, onSelect, renderExpanded }) {
  return (
    <ul className="space-y-2">
      {clients.map((client) => {
        const open = client.id === selectedId;
        return (
          <li key={client.id}>
            <MagicCard>
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-3 py-3 text-left"
                onClick={() => onSelect(open ? null : client.id)}
              >
                <Mark client={client} />
                <span className="flex-1 text-sm font-medium">{client.name}</span>
                <span className="text-xs text-muted-foreground">
                  {ACTION_LABEL[client.kind]}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open && (
                <div className="border-t px-3 py-4">{renderExpanded(client)}</div>
              )}
            </MagicCard>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/ClientPicker.test.jsx`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/ClientPicker.jsx frontend/src/components/onboarding/ClientPicker.test.jsx
git commit -m "feat(onboarding): a one-column client picker"
```

---

### Task 6: The paste-into-agent prompt

**Files:**
- Create: `frontend/src/components/onboarding/installPrompt.js`
- Test: `frontend/src/components/onboarding/installPrompt.test.js`

**Interfaces:**
- Produces: `installPrompt(url)` returning a string.

This is the fallback for a client with no card. It is a function rather than a constant because the address changes per instance, which is the one thing `AUTOFILL_PROMPT` in the sibling file did not need.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/installPrompt.test.js`:

```js
import { describe, it, expect } from "vitest";
import { installPrompt } from "./installPrompt.js";

const TEST_URL = "https://example.test/mcp";

describe("installPrompt", () => {
  it("carries the live address rather than a placeholder", () => {
    expect(installPrompt(TEST_URL)).toContain(TEST_URL);
  });

  it("names the transport, because a client that guesses stdio fails silently", () => {
    expect(installPrompt(TEST_URL)).toMatch(/http/i);
  });

  it("says there is no token, so nothing goes hunting for one", () => {
    expect(installPrompt(TEST_URL)).toMatch(/oauth/i);
  });

  it("asks for the permission the review queue depends on", () => {
    expect(installPrompt(TEST_URL)).toMatch(/suggest/i);
  });

  it("uses no dashes as punctuation", () => {
    // House style: regular hyphens only, and none standing in for a comma.
    expect(installPrompt(TEST_URL)).not.toMatch(/[–—]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/installPrompt.test.js`
Expected: FAIL, `Failed to resolve import "./installPrompt.js"`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/onboarding/installPrompt.js`:

```js
/**
 * What someone pastes into a client that has no install card.
 *
 * The fallback under the picker, and the reason the picker can stay short: a
 * roster of six covers most readers, and this covers the rest without anybody
 * maintaining a seventh set of steps for a client they have never opened.
 *
 * Addressed to the agent rather than to the reader, because the reader is about
 * to hand it over verbatim. Every line is an instruction it can act on.
 *
 * Three things are stated that a client gets wrong when left to guess. The
 * transport, because a client that assumes stdio will try to run the URL as a
 * command. That there is no token, because the alternative is an agent asking
 * for a key that does not exist. And the propose permission, because the review
 * queue is the whole design and a read-only connection never reaches it.
 *
 * A function, not a constant like `AUTOFILL_PROMPT` beside it. That one is the
 * same words on every instance; this one carries an address that is not.
 */
export function installPrompt(url) {
  return (
    `Add an MCP server named mygist at ${url}, over HTTP. ` +
    "It signs clients in with OAuth, so there is no token to paste. " +
    "Open the sign-in link it gives you, approve the connection, and keep the " +
    "permission to suggest changes. " +
    "If you cannot add it yourself, tell me where that setting lives in this client."
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/installPrompt.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/installPrompt.js frontend/src/components/onboarding/installPrompt.test.js
git commit -m "feat(onboarding): the prompt for a client with no card"
```

---

### Task 7: Rewrite StepConnect around the picker

**Files:**
- Modify: `frontend/src/components/onboarding/StepConnect.jsx`
- Modify: `frontend/src/components/onboarding/StepConnect.test.jsx`

**Interfaces:**
- Consumes: `INSTALLABLE_CLIENTS` (Task 1), `InstallCard` (Task 4), `ClientPicker` (Task 5), `installPrompt` (Task 6).
- Produces: no API change. `<StepConnect onDelegate onFillManually />` as today.

**What must not change.** These three are the behaviours the existing tests pin, and every one of them exists because getting it wrong fails silently:

1. The install section renders only when `instance.mcp_oauth` is true. `oauth_metadata.register()` mounts no discovery routes without `AUTH_MCP_RESOURCE`, so recommending sign-in on an instance without it sends someone to a 404.
2. The token path stays, minting at `FIRST_TOKEN_SCOPES = ["persona:propose"]`.
3. The who-fills-it-in fork stays gated on `connection.canPropose`, because `mcp_scopes.py` hides out-of-scope tools rather than failing them, so the autofill prompt pasted into a read-only connection does nothing at all with no error anywhere.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/onboarding/StepConnect.test.jsx`, replace the `describe("StepConnect, where clients can sign in", ...)` block with:

```jsx
describe("StepConnect, where clients can sign in", () => {
  beforeEach(() => {
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: true });
  });

  it("offers a client to pick rather than generic instructions", async () => {
    renderStep();

    expect(await screen.findByRole("button", { name: /claude code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cursor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /raycast/i })).toBeInTheDocument();
    // The key path is reachable, but it is not what the screen leads with.
    expect(screen.queryByRole("button", { name: /create a key/i })).not.toBeInTheDocument();
  });

  it("shows the command once a command client is picked", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /claude code/i }));
    expect(
      screen.getByText("claude mcp add --transport http mygist https://example.test/mcp"),
    ).toBeInTheDocument();
  });

  it("shows the deeplink once Cursor is picked", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /cursor/i }));
    expect(screen.getByRole("link", { name: /add to cursor/i })).toBeInTheDocument();
  });

  it("offers a prompt for a client that is not on the list", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /isn't listed/i }));
    await user.click(screen.getByRole("button", { name: /copy prompt for my client/i }));
    await expect(navigator.clipboard.readText()).resolves.toContain(
      "https://example.test/mcp",
    );
  });

  it("keeps the key path for a client that cannot sign in", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /can't sign in/i }));
    expect(screen.getByRole("button", { name: /create a key/i })).toBeInTheDocument();
  });

  it("stops offering a connection once one exists", async () => {
    // Instructions for a job already done are noise.
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:propose"] },
    ]);
    renderStep();

    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claude code/i })).not.toBeInTheDocument();
  });
});
```

Then in `describe("StepConnect, where clients cannot sign in", ...)`, replace the first test's `queryByText(/recommended/i)` assertion and the second's:

```jsx
describe("StepConnect, where clients cannot sign in", () => {
  it("leads with the key and says why", async () => {
    renderStep();

    expect(
      await screen.findByText(/does not offer sign-in for clients/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a key/i })).toBeInTheDocument();
    // No picker at all: every card on it tells someone to sign in, and this
    // instance mounts no discovery routes for them to sign in against.
    expect(screen.queryByRole("button", { name: /claude code/i })).not.toBeInTheDocument();
  });

  it("shows no picker when the instance cannot be reached", async () => {
    // getInstance falls back to mcp_oauth: false. Recommending sign-in on an
    // instance that mounts no discovery routes sends someone into a 404.
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: false });
    renderStep();

    await screen.findByRole("button", { name: /create a key/i });
    expect(screen.queryByRole("button", { name: /claude code/i })).not.toBeInTheDocument();
  });
});
```

In `describe("StepConnect, the documentation link", ...)`, the first test asserts the OAuth anchor. Keep it, and change its trigger from `findByText(/recommended/i)` to waiting on the picker:

```jsx
  it("points at the OAuth section when a client can sign in", async () => {
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: true });
    renderStep();

    await screen.findByRole("button", { name: /claude code/i });
    const link = screen.getAllByRole("link", { name: /need help connecting/i })[0];
    expect(link).toHaveAttribute(
      "href",
      `${window.location.origin}/docs/use/clients/#connecting-over-oauth`,
    );
  });
```

Leave every other test in the file unchanged. They pin the token path, the scopes, the fork and the docs link, none of which this task touches.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/StepConnect.test.jsx`
Expected: FAIL. The new picker assertions cannot find "Claude Code"; the old `recommended` badge is still what renders.

- [ ] **Step 3: Rewrite the OAuth half of StepConnect**

In `frontend/src/components/onboarding/StepConnect.jsx`:

Add to the imports:

```jsx
import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";

import { ClientPicker } from "./ClientPicker";
import { InstallCard } from "./InstallCard";
import { installPrompt } from "./installPrompt";
```

Add two pieces of state beside the existing ones:

```jsx
const [picked, setPicked] = useState(null);
const [showPrompt, setShowPrompt] = useState(false);
const [installCopied, setInstallCopied] = useState(false);
```

Replace the whole `{recommendOauth && (...)}` block with:

```jsx
{recommendOauth && (
  <div className="space-y-4">
    <div className="space-y-1">
      <p className="text-sm font-medium">Add MyGist to your client</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Your client sends you here to sign in, so there is no key to copy or
        keep safe. You can see it by name and disconnect it whenever you like.
      </p>
    </div>

    <ClientPicker
      clients={INSTALLABLE_CLIENTS}
      selectedId={picked}
      onSelect={setPicked}
      renderExpanded={(client) => <InstallCard client={client} url={address} />}
    />

    {/* The escape hatch, and the reason the roster can stay short. Closed by
        default: it is the answer for a minority, and open it would compete
        with the six rows that are the answer for everyone else. */}
    {!showPrompt ? (
      <button
        type="button"
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={() => setShowPrompt(true)}
      >
        My client isn't listed
      </button>
    ) : (
      <div className="space-y-3 rounded-lg border p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Paste this into your client and it can add MyGist itself.
        </p>
        <p className="rounded-md border bg-muted/50 p-3 text-xs leading-relaxed">
          {installPrompt(address)}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            navigator.clipboard?.writeText(installPrompt(address));
            setInstallCopied(true);
          }}
        >
          {installCopied ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Copy className="mr-1.5 h-4 w-4" />
          )}
          {installCopied ? "Copied" : "Copy prompt for my client"}
        </Button>
      </div>
    )}

    <DocsLink path="/use/clients/#connecting-over-oauth">
      Need help connecting?
    </DocsLink>
  </div>
)}
```

Delete the now-unused `CopyRow` call for `onboarding-mcp-url` inside that block, but keep the `CopyRow` component itself: the token path below still uses it for both rows.

Update the file's header comment. The paragraph beginning "The fork at the end is the point of the whole screen" stays. Add above it:

```
 * The client picker replaced four generic numbered steps that named Claude and
 * left every other client to the docs site. `lib/clients.js` explains why the
 * card's primary action differs per client: of the six, exactly one has a real
 * deeplink, and six identical Install buttons would promise the same gesture
 * six times and deliver it once.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/StepConnect.test.jsx`
Expected: PASS, all tests including the untouched token, scope, fork and docs-link cases.

- [ ] **Step 5: Run the whole unit project, to catch anything downstream**

Run: `cd frontend && npm test -- --project=unit`
Expected: PASS. `App.onboarding.test.jsx` and `GettingStartedCard.test.jsx` both touch this flow.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/onboarding/StepConnect.jsx frontend/src/components/onboarding/StepConnect.test.jsx
git commit -m "feat(onboarding): pick your client, get the install for it"
```

---

### Task 8: One source of truth for which logos exist

**Files:**
- Modify: `frontend/src/landing/content.js:26-41`
- Test: `frontend/src/landing/Landing.test.jsx` (existing, must stay green)

The landing hero chips carry a `mark` boolean saying whether a logo file exists, and so does the roster. That fact belongs in one place, and it is the one that changes: a logo landing later means editing both files, and nobody will remember the second.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/landing/Landing.test.jsx`:

```jsx
import { hasMark } from "@/lib/clients.js";
import { CLIENTS as HERO_CLIENTS } from "./content.js";

describe("the hero chips", () => {
  it("takes which marks exist from the roster rather than a second copy", () => {
    for (const chip of HERO_CLIENTS) {
      expect(chip.mark, `${chip.slug} chip`).toBe(hasMark(chip.slug));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/landing/Landing.test.jsx`
Expected: PASS by coincidence, because the two hardcoded lists currently agree. That is the point: this test is a tripwire for the day they stop agreeing, and it must be wired to the shared function before it can do that job. Verify it is real by temporarily flipping `LOGO_SLUGS` in `clients.js` to drop `raycast` and re-running: it must FAIL. Put it back.

- [ ] **Step 3: Wire content.js to the roster**

In `frontend/src/landing/content.js`, add the import and rewrite `CLIENTS`:

```js
import { hasMark } from "@/lib/clients.js";

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
```

Cursor is new to the chips and correct to add: it speaks MCP, and it is now the one client with a one-click install.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- --project=unit src/landing/`
Expected: PASS. If `Landing.test.jsx` asserts a chip count, update the expected number from 5 to 6.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/landing/content.js frontend/src/landing/Landing.test.jsx
git commit -m "refactor(landing): take which logos exist from the client roster"
```

---

### Task 9: Vendor NumberTicker and Confetti

**Files:**
- Create: `frontend/src/components/ui/number-ticker.jsx`
- Create: `frontend/src/components/ui/confetti.jsx`
- Test: `frontend/src/components/ui/number-ticker.test.jsx`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `<NumberTicker value={number} />` and `<Confetti />`

- [ ] **Step 1: Add the dependency**

Run: `cd frontend && npm install canvas-confetti@^1.9.3`

`@types/canvas-confetti` from the registry is not installed. This app is not TypeScript.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/ui/number-ticker.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { NumberTicker } from "./number-ticker.jsx";

describe("NumberTicker", () => {
  it("ends on the value it was given", async () => {
    render(<NumberTicker value={7} />);
    expect(await screen.findByText("7")).toBeInTheDocument();
  });

  it("takes its colour from the theme rather than hardcoding black", () => {
    // The registry version is `text-black dark:text-white`, which ignores every
    // token in globals.css and breaks the moment a surface is not the canvas.
    const { container } = render(<NumberTicker value={3} />);
    expect(container.innerHTML).not.toMatch(/\btext-black\b/);
    expect(container.innerHTML).not.toMatch(/\bdark:text-white\b/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- --project=unit src/components/ui/number-ticker.test.jsx`
Expected: FAIL, `Failed to resolve import "./number-ticker.jsx"`

- [ ] **Step 4: Write both components**

Create `frontend/src/components/ui/number-ticker.jsx`:

```jsx
import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Magic UI's `number-ticker`, adapted.
 *
 * Three changes from the registry version. It is JSX. Its colour comes from
 * `text-foreground` rather than `text-black dark:text-white`, which ignored
 * every token in globals.css and would have been wrong on any surface that is
 * not the page canvas. And it formats with `en-GB`, matching the rest of the
 * app.
 *
 * Reduced motion prints the number and stops. A count-up is decoration on a
 * value that is correct before the animation starts.
 */
export function NumberTicker({ value, startValue = 0, delay = 0, className, ...props }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(startValue);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  useEffect(() => {
    if (reduced || !isInView) return undefined;
    const timer = setTimeout(() => motionValue.set(value), delay * 1000);
    return () => clearTimeout(timer);
  }, [motionValue, isInView, delay, value, reduced]);

  useEffect(() => {
    if (reduced) return undefined;
    return springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = Intl.NumberFormat("en-GB").format(Math.round(latest));
      }
    });
  }, [springValue, reduced]);

  return (
    <span
      ref={ref}
      className={cn("inline-block tabular-nums text-foreground", className)}
      {...props}
    >
      {reduced ? Intl.NumberFormat("en-GB").format(value) : startValue}
    </span>
  );
}
```

Create `frontend/src/components/ui/confetti.jsx`:

```jsx
import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import confetti from "canvas-confetti";

import { cn } from "@/lib/utils";

/**
 * Magic UI's `confetti`, adapted.
 *
 * Changes from the registry version: JSX, `ConfettiButton` dropped since
 * nothing here fires confetti from a button and it pulled an import of Button
 * for no reason, and the imperative handle dropped with it. What is left is a
 * canvas that fires once when it mounts.
 *
 * Reduced motion renders no canvas at all. Not a canvas that stays empty: the
 * component's entire output is motion, so there is nothing left to draw.
 *
 * `pointer-events-none` and a fixed full-viewport box, so it cannot intercept a
 * click on the button underneath it. That is the failure mode a celebration
 * layer has, and it is silent.
 */
export function Confetti({ className, options }) {
  const canvasRef = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !canvasRef.current) return undefined;

    const fire = confetti.create(canvasRef.current, { resize: true, useWorker: true });
    fire({
      particleCount: 70,
      spread: 68,
      startVelocity: 34,
      origin: { y: 0.6 },
      ...options,
    });

    return () => fire.reset();
    // Once per mount. `options` is deliberately not a dependency: a caller
    // passing an object literal would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("pointer-events-none fixed inset-0 z-50 h-full w-full", className)}
    />
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- --project=unit src/components/ui/number-ticker.test.jsx`
Expected: PASS, 2 tests

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/number-ticker.jsx frontend/src/components/ui/confetti.jsx frontend/src/components/ui/number-ticker.test.jsx frontend/package.json frontend/package-lock.json
git commit -m "feat(ui): vendor Magic UI NumberTicker and Confetti"
```

---

### Task 10: The arrival on Complete

**Files:**
- Modify: `frontend/src/components/onboarding/StepComplete.jsx:63-81`
- Modify: `frontend/src/components/onboarding/StepComplete.test.jsx`

**Interfaces:**
- Consumes: `Confetti` and `NumberTicker` from Task 9.
- Produces: no API change.

This also fixes a live copy bug. `${saved} things saved` renders "1 things saved" whenever exactly one field was filled in, which is a common outcome of a flow that lets you skip everything else.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/onboarding/StepComplete.test.jsx`. Put the mock at the top of the file, above any import of the component:

```jsx
// canvas-confetti calls getContext("2d"), which jsdom does not implement. The
// mock keeps every StepComplete test off that path; whether confetti fired is
// asserted through this spy rather than through the canvas.
const confettiCreateMock = vi.hoisted(() => vi.fn(() => Object.assign(vi.fn(), { reset: vi.fn() })));
vi.mock("canvas-confetti", () => ({
  default: Object.assign(vi.fn(), { create: confettiCreateMock }),
}));
```

Then the new cases:

```jsx
describe("StepComplete, the arrival", () => {
  it("counts one saved field as one thing, not '1 things'", () => {
    render(
      <StepComplete
        data={{ profile: { name: "Liam" } }}
        onAdd={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 thing saved/)).toBeInTheDocument();
    expect(screen.queryByText(/1 things saved/)).not.toBeInTheDocument();
  });

  it("still pluralises more than one", () => {
    render(
      <StepComplete
        data={{ profile: { name: "Liam", current_role: "Specialist" } }}
        onAdd={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText(/things saved/)).toBeInTheDocument();
  });

  it("celebrates arriving with something saved", () => {
    render(
      <StepComplete
        data={{ profile: { name: "Liam" } }}
        onAdd={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(confettiCreateMock).toHaveBeenCalled();
  });

  it("does not celebrate an empty persona", () => {
    // Nothing was saved. Confetti over that is a party for a job not done, and
    // the copy beside it already says as much.
    confettiCreateMock.mockClear();
    render(<StepComplete data={{}} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(confettiCreateMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/StepComplete.test.jsx`
Expected: FAIL. "1 things saved" is what renders, and nothing calls confetti.

- [ ] **Step 3: Write the implementation**

In `frontend/src/components/onboarding/StepComplete.jsx`, add to the imports:

```jsx
import { Confetti } from "@/components/ui/confetti";
import { NumberTicker } from "@/components/ui/number-ticker";
```

Replace the heading block, lines 67 to 81, with:

```jsx
    <div className="space-y-8">
      {/* Only when something was actually saved. Confetti over an empty
          persona celebrates a job not done, and the sentence underneath it
          says so in the same breath. */}
      {saved > 0 && <Confetti />}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <h1 className="text-2xl font-semibold tracking-tight">
            That's the basics
          </h1>
        </div>
        {saved > 0 ? (
          <p className="text-muted-foreground">
            <NumberTicker value={saved} className="font-medium" />{" "}
            {saved === 1 ? "thing" : "things"} saved. Everything is editable
            later, and an assistant can fill in the rest.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Nothing saved yet, which is fine. You can fill this in whenever, or
            let an assistant do it.
          </p>
        )}
      </div>
```

The empty-persona sentence loses its em dash on the way past, which the house style bans outright.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/StepComplete.test.jsx`
Expected: PASS, including the existing cases for the two one-line adds and the done button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/StepComplete.jsx frontend/src/components/onboarding/StepComplete.test.jsx
git commit -m "feat(onboarding): land on Complete, and count one thing as one"
```

---

### Task 11: Entrances, and the way out of typing

**Files:**
- Modify: `frontend/src/components/onboarding/StepAboutYou.jsx`
- Modify: `frontend/src/components/onboarding/StepHowYouLike.jsx`
- Modify: `frontend/src/components/onboarding/OnboardingFlow.jsx:186-227`
- Modify: `frontend/src/components/onboarding/steps.test.jsx`

**Interfaces:**
- Consumes: `BlurFade` from `@/components/ui/blur-fade`.
- Produces: `StepAboutYou` and `StepHowYouLike` gain one prop, `onDelegate`, a function taking no arguments.

Welcome offers "you don't have to type any of it" and Connect honours it. Two screens later, someone who has started typing and changed their mind has no way back to that offer except the Back button twice. This adds the offer where the regret happens.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/onboarding/steps.test.jsx`:

```jsx
describe("the field steps offer the way out of typing", () => {
  it("offers it on About you", async () => {
    const onDelegate = vi.fn();
    const user = userEvent.setup();
    render(
      <StepAboutYou packs={[]} data={{}} onChange={vi.fn()} onDelegate={onDelegate} />,
    );

    await user.click(screen.getByRole("button", { name: /let my assistant fill this in/i }));
    expect(onDelegate).toHaveBeenCalled();
  });

  it("offers it on How you like", async () => {
    const onDelegate = vi.fn();
    const user = userEvent.setup();
    render(
      <StepHowYouLike packs={[]} data={{}} onChange={vi.fn()} onDelegate={onDelegate} />,
    );

    await user.click(screen.getByRole("button", { name: /let my assistant fill this in/i }));
    expect(onDelegate).toHaveBeenCalled();
  });

  it("stays out of the way when there is nowhere to go", () => {
    // No handler means the flow did not wire one, and a button that does
    // nothing is worse than no button.
    render(<StepAboutYou packs={[]} data={{}} onChange={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /let my assistant fill this in/i }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/steps.test.jsx`
Expected: FAIL, no such button.

- [ ] **Step 3: Add the offer to both steps**

In each of `StepAboutYou.jsx` and `StepHowYouLike.jsx`, accept `onDelegate` in the props and add this as the last child of the outermost element:

```jsx
{/* Welcome promised this and Connect delivered it, two screens ago. Someone
    who starts typing and regrets it should not have to walk backwards to
    find the offer again. A quiet link, not a button: it competes with
    Continue, and Continue is the expected move here. */}
{onDelegate && (
  <button
    type="button"
    className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
    onClick={onDelegate}
  >
    Let my assistant fill this in instead
  </button>
)}
```

Wrap each step's existing content in `<BlurFade>`, adding the import:

```jsx
import { BlurFade } from "@/components/ui/blur-fade";
```

`BlurFade` already handles `prefers-reduced-motion` with a plain `<div>` early return, so nothing further is needed for the motion budget.

- [ ] **Step 4: Wire the handler in OnboardingFlow**

In `frontend/src/components/onboarding/OnboardingFlow.jsx`, pass the prop to both steps:

```jsx
{current === "about-you" && (
  <StepAboutYou
    packs={packs}
    data={data.profile || {}}
    onChange={(next) => write("profile", next)}
    onDelegate={() => go("connect")}
  />
)}

{current === "how-you-like" && (
  <StepHowYouLike
    packs={packs}
    data={data.preferences || {}}
    onChange={(next) => write("preferences", next)}
    onDelegate={() => go("connect")}
  />
)}
```

`go` already flushes pending writes before navigating, so anything typed before changing course is saved rather than lost.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- --project=unit src/components/onboarding/`
Expected: PASS, the whole onboarding directory.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/onboarding/StepAboutYou.jsx frontend/src/components/onboarding/StepHowYouLike.jsx frontend/src/components/onboarding/OnboardingFlow.jsx frontend/src/components/onboarding/steps.test.jsx
git commit -m "feat(onboarding): offer the assistant on the field steps too"
```

---

### Task 12: Full verification

**Files:** none changed unless something fails.

- [ ] **Step 1: Run the whole unit suite**

Run: `cd frontend && npm test -- --project=unit`
Expected: PASS, every file.

- [ ] **Step 2: Check the build, which catches what jsdom cannot**

Run: `cd frontend && npm run build`
Expected: exit 0. A Tailwind 4 class does not fail a test, because jsdom never computes styles. It shows up here or not at all.

- [ ] **Step 3: Grep the built bundle for banned patterns**

Run from `frontend/`:

```bash
grep -rlE '[–—]' dist/assets/*.js && echo "FAIL: dash found" || echo "ok: no en or em dashes"
grep -rlE '#(9E7AFF|FE8BBB|ffaa40|9c40ff)' dist/assets/*.js && echo "FAIL: registry gradient survived" || echo "ok: no registry hex"
grep -rl 'next-themes' dist/assets/*.js && echo "FAIL: next-themes pulled in" || echo "ok"
```

Expected: three `ok` lines. The house style requires grepping the built artefact rather than the source, because a source-level scan has missed a dash before.

- [ ] **Step 4: Check the flow by hand**

Run: `cd frontend && npm run dev`, then open `#/onboarding/welcome` and walk all five steps. Confirm:
- the picker lists six clients, one column
- Cursor shows a button, Claude Code shows a terminal, Raycast shows steps
- "My client isn't listed" reveals a prompt carrying this instance's address
- Complete fires confetti once and the count reads correctly at 1
- with reduced motion on in the OS, no confetti, no spotlight, and the terminal still shows its command in full

- [ ] **Step 5: Commit anything the checks turned up**

```bash
git add -A
git commit -m "fix(onboarding): verification pass"
```

---

## Self-review

**Spec coverage.** Roster with the four kinds, Task 1. Cursor deeplink encoding, Task 1. Picker as one column, Task 5. Three card kinds, Task 4. Paste-into-agent fallback, Task 6. `mcp_oauth` gating and the token path preserved, Task 7. Landing derivation, Task 8, narrowed from the spec's "CLIENTS derived from the roster" to "the `mark` fact derived from the roster", because the two lists answer different questions and forcing one to derive from the other needed a mapping layer that earned nothing. Notion AI unlisted, Task 1. Terminal without typing, Task 2. MagicCard without next-themes, Task 3. Confetti and NumberTicker, Task 9. Complete's arrival, Task 10. Entrances and the delegate escape, Task 11. `animated-beam` and `border-beam` appear nowhere, per the spec's revision.

**Type consistency.** `install(url)` returns a string for `deeplink` and an array for `command` and `steps`; `InstallCard` branches on `client.kind` before touching the return in Task 4, and never treats one shape as the other. `hasMark(slug)` is used with the same signature in Tasks 1 and 8. `onDelegate` takes no arguments in Tasks 11's tests and its wiring. `ClientPicker`'s `onSelect` receives an id or `null`, and Task 7's `setPicked` accepts both.

**Known gap, stated rather than hidden.** The four `steps` and `command` strings are transcribed from vendor documentation as of August 2026, not executed against the real clients. Task 12 Step 4 walks the flow but cannot verify that Raycast's settings screen still says "Install Server". Those five strings are the part of this plan most likely to age, and they are all in one file for that reason.
