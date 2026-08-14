/**
 * The settings dialog's tabs, and who can see them.
 *
 * The gating rule is the reverse of the one it replaces. The old dialog
 * disabled every tab but `connection`, because `connection` was the panel
 * holding server configuration -- and it held account identity too, which is
 * why it could not be split. Once those are separate tabs, Server is the only
 * one that means anything without a credential: it is where you say which
 * instance to talk to, and where a token is pasted.
 *
 * Pure, so the rule is testable without rendering a dialog.
 */
export const SETTINGS_TABS = [
  { id: "account", label: "Account", needsCredential: true },
  { id: "server", label: "Server", needsCredential: false },
  { id: "tokens", label: "Tokens", needsCredential: true },
  { id: "apps", label: "Connected apps", needsCredential: true },
  { id: "data", label: "Data", needsCredential: true },
];

export function isTabAvailable(id, isSignedIn) {
  const tab = SETTINGS_TABS.find((t) => t.id === id);
  if (!tab) return false;
  return isSignedIn || !tab.needsCredential;
}

export function defaultTab(isSignedIn) {
  return isSignedIn ? "account" : "server";
}
