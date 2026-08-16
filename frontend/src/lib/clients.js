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
