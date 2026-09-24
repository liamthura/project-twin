/**
 * The settings dialog's tabs, and where an older tab id now lives.
 *
 * Three, down from six: Tokens and Connected apps were two tabs doing one job
 * and are now Connections; History moved next to the section it restores;
 * Server moved under Data as Advanced, since it is set once if ever.
 *
 * Signed out, the dialog shows the Server panel alone -- the one thing it can
 * do without a credential -- so every tab here needs one.
 *
 * Pure, so the rules are testable without rendering a dialog.
 */
export const SETTINGS_TABS = [
  { id: "account", label: "Account" },
  { id: "connections", label: "Connections" },
  { id: "data", label: "Data" },
];

// Ids callers still pass: Wave 1's "Review access" links name "tokens" and
// "apps", and the load-error screen asks for "server".
const MOVED = { tokens: "connections", apps: "connections", server: "data", history: "account" };

export function defaultTab() {
  return "account";
}

/** Which tab a requested id opens, and whether Data's Advanced section (the
 *  Server panel) should start expanded. Unknown ids open the default. */
export function resolveTab(id) {
  const tab = MOVED[id] || id;
  const known = SETTINGS_TABS.some((t) => t.id === tab);
  return { tab: known ? tab : defaultTab(), advanced: id === "server" };
}
