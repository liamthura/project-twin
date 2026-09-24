/**
 * The settings page's tabs, and where an older tab id now lives.
 *
 * Settings is a page at #/settings/<tab>, not a dialog: four tabs of forms,
 * lists and switches had outgrown a modal. Tokens and Connected apps are one
 * Connections tab; the server moved under Data as Advanced.
 *
 * Pure, so the rules are testable without rendering anything.
 */
export const SETTINGS_TABS = [
  { id: "account", label: "Account" },
  { id: "connections", label: "Connections" },
  { id: "sections", label: "Sections" },
  { id: "data", label: "Data" },
];

// Ids callers still pass: Wave 1's "Review access" links name "tokens" and
// "apps", and anything older may still ask for "server" or "history".
const MOVED = { tokens: "connections", apps: "connections", server: "data", history: "account" };

export function defaultTab() {
  return "account";
}

/** The tab a requested id opens. Unknown ids, and none, open the default. */
export function resolveTab(id) {
  const tab = MOVED[id] || id;
  return SETTINGS_TABS.some((t) => t.id === tab) ? tab : defaultTab();
}
