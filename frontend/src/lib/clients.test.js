import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENTS, INSTALLABLE_CLIENTS, hasMark, LOGO_SLUGS } from "./clients.js";
import { CLIENTS as HERO_CHIPS } from "@/landing/content.js";

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

  it("keeps LOGO_SLUGS in step with public/landing/logos/, in both directions", () => {
    // A slug in LOGO_SLUGS with no file renders a broken image; a file with no
    // slug in LOGO_SLUGS renders a monogram over a real mark that sits unused.
    // Resolved relative to this file, not the working directory, so it holds
    // regardless of where the test runner is invoked from. Built from
    // fileURLToPath + path.join rather than `new URL(rel, import.meta.url)`:
    // Vite statically rewrites that exact pattern into a dev-server asset URL
    // (http://localhost:.../@fs/...), which is no longer a file:// URL that
    // node:fs can read.
    const here = dirname(fileURLToPath(import.meta.url));
    const logosDir = join(here, "../../public/landing/logos");
    const files = readdirSync(logosDir)
      .filter((name) => name.endsWith(".svg"))
      .map((name) => name.replace(/\.svg$/, ""));

    for (const slug of LOGO_SLUGS) {
      expect(files, `${slug} is in LOGO_SLUGS`).toContain(slug);
    }
    for (const file of files) {
      expect(LOGO_SLUGS.has(file), `${file}.svg exists on disk`).toBe(true);
    }
  });

  it("keeps hero-chip slugs and roster slugs in step, in both directions", () => {
    // Names and slugs are still hand-typed in each list on purpose -- they
    // answer different questions, "who speaks MCP" vs. "who has install
    // steps" -- but a slug naming a client the other list has never heard of
    // is the one real drift risk left once `mark` derives from here.
    const rosterSlugs = new Set(CLIENTS.map((c) => c.slug));
    const heroSlugs = new Set(HERO_CHIPS.map((c) => c.slug));
    for (const slug of heroSlugs) expect(rosterSlugs.has(slug), slug).toBe(true);
    for (const slug of rosterSlugs) expect(heroSlugs.has(slug), slug).toBe(true);
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
