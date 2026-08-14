# Settings slice (5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1172-line `ConnectionSettings.jsx` with a five-tab settings dialog built from one focused panel per tab, and put the OAuth scope constants in one place.

**Architecture:** Extract one panel at a time out of `ConnectionSettings.jsx`, with the old dialog rendering each new panel as it appears. The suite stays green and the app stays shippable at every commit. The last task swaps the shell for `SettingsDialog`, which owns the tab row and the gating rule, and deletes the old file.

**Tech Stack:** React 18, Vite, Tailwind 3, shadcn/Radix (`Dialog`, `Tabs`, `Switch`), Vitest + Testing Library, lucide-react icons.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-settings-slice-design.md` (commit `4421ca6`).
- Umbrella: `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md`. Every merge leaves the app shippable and the suite green.
- Reshaped is **not** adopted. shadcn/Radix/Tailwind only. `input-otp` stays.
- All prose, comments and UI copy follow `/Users/khantthura/.claude/skills/no-ai-slop/SKILL.md`. Simple, and do not overstate.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Motion uses the four tokens only: `duration-fast|medium|slow|scroll`, `ease-decelerate|accelerate|standard|emphasized`.
- No backend changes. Every field added is already returned by `db.list_tokens`.
- Fast test loop: `cd frontend && npx vitest run --project unit <file>`. Pre-merge check: `cd frontend && npm test` (adds the Storybook browser project).
- Do not touch or break `main`'s working config.

---

### Task 1: One scopes module

**Files:**
- Create: `frontend/src/lib/scopes.js`
- Create: `frontend/src/lib/scopes.test.js`
- Modify: `frontend/src/components/ConnectionSettings.jsx:56-62`
- Modify: `frontend/src/components/ConnectedApps.jsx:42-54`
- Modify: `frontend/src/components/Consent.jsx:46-55`
- Modify: `frontend/src/components/ProposalsPanel.jsx:15-17`

**Interfaces:**
- Produces: `READ`, `PROPOSE`, `WRITE`, `PERSONA_SCOPES` (array of the three), `SCOPE_LABELS` (array of `[scope, label]` pairs for propose and write only), `summariseScopes(scopes) → string`.

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/scopes.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  READ, PROPOSE, WRITE, PERSONA_SCOPES, SCOPE_LABELS, summariseScopes,
} from "./scopes.js";

describe("the wire values", () => {
  it("are what auth/src/oauth.js stores", () => {
    // These are checked by the auth service, not displayed. A typo here is a
    // grant that silently does nothing.
    expect(READ).toBe("persona:read");
    expect(PROPOSE).toBe("persona:propose");
    expect(WRITE).toBe("persona:write");
    expect(PERSONA_SCOPES).toEqual(["persona:read", "persona:propose", "persona:write"]);
  });
});

describe("SCOPE_LABELS", () => {
  it("has a row for propose and write, and not for read", () => {
    // Read is the floor for every grant, so a caller lists it unconditionally
    // rather than checking for it.
    expect(SCOPE_LABELS).toEqual([
      ["persona:propose", "Suggest changes for your approval"],
      ["persona:write", "Change your persona directly"],
    ]);
  });
});

describe("summariseScopes", () => {
  it.each([
    [["persona:read"], "Read only"],
    [["persona:read", "persona:propose"], "Read and propose"],
    [["persona:read", "persona:propose", "persona:write"], "Read, propose and change directly"],
    // Possible through POST /api/auth/tokens directly, which does not enforce
    // the implication the mint form does. Reporting this as the full three
    // would claim a permission the token does not carry.
    [["persona:read", "persona:write"], "Read and change directly"],
  ])("%s -> %s", (scopes, expected) => {
    expect(summariseScopes(scopes)).toBe(expected);
  });

  it("says nothing rather than guessing, for an empty or missing list", () => {
    expect(summariseScopes([])).toBe("No access");
    expect(summariseScopes(undefined)).toBe("No access");
  });

  it("ignores a scope it does not know", () => {
    // offline_access and openid ride along on an OAuth grant. They are the
    // client's business, not something to describe to the reader here.
    expect(summariseScopes(["persona:read", "offline_access"])).toBe("Read only");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/lib/scopes.test.js`
Expected: FAIL, cannot resolve `./scopes.js`.

- [ ] **Step 3: Write the module**

`frontend/src/lib/scopes.js`:

```js
/**
 * The three OAuth scopes MyGist defines, and how to say them in English.
 *
 * These were declared four times before this file existed -- in
 * ConnectionSettings, ConnectedApps, Consent and ProposalsPanel -- each with a
 * comment saying it had to match the others exactly, and one of those comments
 * naming only two of the other three. The values are checked by the auth
 * service rather than displayed, so a copy that drifted would produce a grant
 * that authenticates and then does nothing.
 *
 * Must match auth/src/oauth.js.
 */
export const READ = "persona:read";
export const PROPOSE = "persona:propose";
export const WRITE = "persona:write";

export const PERSONA_SCOPES = [READ, PROPOSE, WRITE];

/**
 * One row each, in the order a grant widens.
 *
 * No row for read: it is the floor for every grant, and both screens that use
 * this list it unconditionally rather than checking for it.
 */
export const SCOPE_LABELS = [
  [PROPOSE, "Suggest changes for your approval"],
  [WRITE, "Change your persona directly"],
];

/**
 * The same grant as one short line, for a token row with no space for three.
 *
 * Built from the scopes actually present, not from the widest one found. A
 * token minted through the settings dialog always satisfies
 * write > propose > read, but POST /api/auth/tokens does not enforce that, so
 * read + write is a real shape and must not be reported as all three.
 */
export function summariseScopes(scopes) {
  const held = new Set(scopes || []);
  if (!held.has(READ)) return "No access";
  const propose = held.has(PROPOSE);
  const write = held.has(WRITE);
  if (propose && write) return "Read, propose and change directly";
  if (write) return "Read and change directly";
  if (propose) return "Read and propose";
  return "Read only";
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd frontend && npx vitest run --project unit src/lib/scopes.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Point all four consumers at it**

In `ConnectionSettings.jsx`, delete lines 56-62 (the comment and the three
constants) and add to the imports:

```js
import { READ, PROPOSE, WRITE } from "@/lib/scopes.js";
```

In `ConnectedApps.jsx`, delete lines 42-54 (the comment, three constants and
`SCOPE_LABELS`) and add:

```js
import { SCOPE_LABELS } from "@/lib/scopes.js";
```

In `Consent.jsx`, delete lines 46-55 (the comment, three constants and
`PERSONA_SCOPES`) and add:

```js
import { READ, PROPOSE, WRITE, PERSONA_SCOPES } from "@/lib/scopes.js";
```

In `ProposalsPanel.jsx`, delete lines 15-17 (the comment and `PROPOSE`) and add:

```js
import { PROPOSE } from "@/lib/scopes.js";
```

- [ ] **Step 6: Run every affected suite**

Run: `cd frontend && npx vitest run --project unit src/lib/scopes.test.js src/components/ConnectedApps.test.jsx src/components/Consent.test.jsx src/components/ProposalsPanel.test.jsx src/components/ConnectionSettings.test.jsx`
Expected: PASS. Nothing renders differently, so no test should need changing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/scopes.js frontend/src/lib/scopes.test.js \
  frontend/src/components/ConnectionSettings.jsx \
  frontend/src/components/ConnectedApps.jsx \
  frontend/src/components/Consent.jsx \
  frontend/src/components/ProposalsPanel.jsx
git commit -m "$(cat <<'EOF'
refactor(scopes): one declaration of the three persona scopes, not four

Each of the four copies carried a comment saying it must match the others
exactly, and one of them named only two of the other three. The values are
checked by the auth service rather than displayed, so a drifted copy is a grant
that authenticates and then does nothing.

summariseScopes builds its line from the scopes present rather than the widest
one found: POST /api/auth/tokens does not enforce write > propose > read, so
read + write is a real shape.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The tab vocabulary

**Files:**
- Create: `frontend/src/components/settings/settingsTabs.js`
- Create: `frontend/src/components/settings/settingsTabs.test.js`

**Interfaces:**
- Produces: `SETTINGS_TABS` (array of `{ id, label, needsCredential }`), `isTabAvailable(id, isSignedIn) → boolean`, `defaultTab(isSignedIn) → "account" | "server"`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/settings/settingsTabs.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, isTabAvailable, defaultTab } from "./settingsTabs.js";

describe("the tabs", () => {
  it("are the prototype's four, plus Data", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual([
      "account", "server", "tokens", "apps", "data",
    ]);
  });

  it("labels Connected apps in full", () => {
    // The dialog is widened so this does not have to be shortened to "Apps".
    expect(SETTINGS_TABS.find((t) => t.id === "apps").label).toBe("Connected apps");
  });
});

describe("what a signed-out reader can reach", () => {
  it("is Server, and only Server", () => {
    // Server is where you say which instance to talk to and paste a token, so
    // it is the one panel that has to work without a credential.
    const open = SETTINGS_TABS.filter((t) => isTabAvailable(t.id, false)).map((t) => t.id);
    expect(open).toEqual(["server"]);
  });

  it.each(["account", "tokens", "apps", "data"])("closes %s", (id) => {
    expect(isTabAvailable(id, false)).toBe(false);
  });
});

describe("what a signed-in reader can reach", () => {
  it.each(SETTINGS_TABS.map((t) => t.id))("opens %s", (id) => {
    expect(isTabAvailable(id, true)).toBe(true);
  });
});

describe("defaultTab", () => {
  it("is Account with a credential", () => {
    expect(defaultTab(true)).toBe("account");
  });

  it("is Server without one, since it is the only one that would render", () => {
    expect(defaultTab(false)).toBe("server");
  });

  it("never names a tab the same call would then close", () => {
    for (const signedIn of [true, false]) {
      expect(isTabAvailable(defaultTab(signedIn), signedIn)).toBe(true);
    }
  });
});

describe("an id that is not a tab", () => {
  it("is not available in either state", () => {
    expect(isTabAvailable("nonsense", true)).toBe(false);
    expect(isTabAvailable("nonsense", false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/settings/settingsTabs.test.js`
Expected: FAIL, cannot resolve `./settingsTabs.js`.

- [ ] **Step 3: Write the module**

`frontend/src/components/settings/settingsTabs.js`:

```js
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd frontend && npx vitest run --project unit src/components/settings/settingsTabs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/settingsTabs.js \
  frontend/src/components/settings/settingsTabs.test.js
git commit -m "$(cat <<'EOF'
feat(settings): the tab vocabulary, with the gating rule inverted

The old dialog disabled every tab but `connection`, because that was the panel
holding server configuration. It held account identity too, which is why it
could not be split. With those separated, Server becomes the only tab that
means anything without a credential.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: DataPanel

**Files:**
- Create: `frontend/src/components/settings/DataPanel.jsx`
- Create: `frontend/src/components/settings/DataPanel.test.jsx`
- Modify: `frontend/src/components/ConnectionSettings.jsx` — remove the data tab's body and its four state hooks and two handlers; render `<DataPanel />`

**Interfaces:**
- Consumes: `exportData()`, `importData(file, mode)` from `@/lib/api.js`; `useToast` from `@/components/ui/use-toast`.
- Produces: `export function DataPanel()`. No props. It owns its own toasts and its own `importMode` state.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/settings/DataPanel.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    exportData: vi.fn(async () => ({ filename: "mygist-backup.zip" })),
    importData: vi.fn(async () => ({ imported_files: ["profile.json"] })),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { exportData, importData } from "@/lib/api.js";
import { DataPanel } from "./DataPanel";

beforeEach(() => vi.clearAllMocks());

describe("DataPanel", () => {
  it("exports on click", async () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportData).toHaveBeenCalled());
  });

  it("imports the chosen file in the chosen mode", async () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));

    const file = new File(["zip"], "backup.zip", { type: "application/zip" });
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });

    await waitFor(() => expect(importData).toHaveBeenCalledWith(file, "merge"));
  });

  it("defaults to replace, and says what it does", () => {
    render(<DataPanel />);
    expect(screen.getByText(/Replace overwrites/i)).toBeInTheDocument();
  });

  it("describes merge once merge is chosen", () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    expect(screen.getByText(/Merge combines/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/settings/DataPanel.test.jsx`
Expected: FAIL, cannot resolve `./DataPanel`.

- [ ] **Step 3: Write the panel**

Move the body of `ConnectionSettings.jsx`'s `activeTab === "data"` block
(lines 976-1061), the `exporting` / `importing` / `importMode` state, and the
`handleExport` / `handleImport` handlers (lines 460-504) into
`frontend/src/components/settings/DataPanel.jsx` unchanged, with three edits:

1. Replace `document.getElementById("import-file").click()` with a ref. Two
   dialogs on one page would otherwise both answer to that id.
2. Add `data-testid="import-file"` to the hidden input, so the test can reach
   an input that has no accessible name.
3. Keep `e.target.value = ""` in the `finally`. Choosing the same file twice in
   a row fires no change event otherwise.

Header comment:

```jsx
/**
 * Export and import, as a tab of their own.
 *
 * The prototype has no Data tab and never designed either operation -- the word
 * backup appears in it once, as the name of an example token. Both work today,
 * so this keeps them rather than folding them into Account, which would
 * otherwise hold email, password, sign out, two preferences, export and import.
 */
```

- [ ] **Step 4: Render it from the old dialog**

In `ConnectionSettings.jsx`, replace the whole `activeTab === "data"` block with:

```jsx
{activeTab === "data" && <DataPanel />}
```

and add `import { DataPanel } from "@/components/settings/DataPanel";`. Delete
the now-unused `exporting`, `importing`, `importMode` state, the two handlers,
the `setImportMode("replace")` line in the reset effect, and the `Download` /
`Upload` icon imports.

- [ ] **Step 5: Run both suites**

Run: `cd frontend && npx vitest run --project unit src/components/settings/DataPanel.test.jsx src/components/ConnectionSettings.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/DataPanel.jsx \
  frontend/src/components/settings/DataPanel.test.jsx \
  frontend/src/components/ConnectionSettings.jsx
git commit -m "$(cat <<'EOF'
refactor(settings): export and import move to their own panel

Behaviour unchanged. The hidden file input swaps getElementById for a ref: two
dialogs on one page would both have answered to that id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: AppsPanel

**Files:**
- Create: `frontend/src/components/settings/AppsPanel.jsx`
- Create: `frontend/src/components/settings/AppsPanel.test.jsx`
- Modify: `frontend/src/components/ConnectionSettings.jsx` — remove the apps tab's body, its three state hooks, `loadApps`, its effect and `handleRevokeApp`; render `<AppsPanel isOpen={activeTab === "apps"} />`

**Interfaces:**
- Consumes: `listConnectedApps()`, `revokeConnectedApp(id)` from `@/lib/api.js`; `ConnectedApps` default export from `@/components/ConnectedApps`.
- Produces: `export function AppsPanel({ isOpen })`. Fetches when `isOpen` becomes true. Must rethrow from its revoke handler, which is what keeps `ConnectedApps`'s confirm row open on failure.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/settings/AppsPanel.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listConnectedApps: vi.fn(async () => [
      { id: "g1", clientName: "Claude Desktop", scopes: ["persona:read", "persona:propose"] },
    ]),
    revokeConnectedApp: vi.fn(async () => {}),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { listConnectedApps, revokeConnectedApp } from "@/lib/api.js";
import { AppsPanel } from "./AppsPanel";

beforeEach(() => vi.clearAllMocks());

describe("AppsPanel", () => {
  it("fetches nothing while its tab is closed", () => {
    render(<AppsPanel isOpen={false} />);
    expect(listConnectedApps).not.toHaveBeenCalled();
  });

  it("lists the grants once opened", async () => {
    render(<AppsPanel isOpen />);
    expect(await screen.findByText("Claude Desktop")).toBeInTheDocument();
  });

  it("shows the failure rather than an empty list", async () => {
    listConnectedApps.mockRejectedValueOnce(new Error("Service unavailable"));
    render(<AppsPanel isOpen />);
    expect(await screen.findByText(/Service unavailable/)).toBeInTheDocument();
  });

  it("revokes, then reloads", async () => {
    render(<AppsPanel isOpen />);
    await screen.findByText("Claude Desktop");

    fireEvent.click(screen.getByRole("button", { name: /revoke access/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke access$/i }));

    await waitFor(() => expect(revokeConnectedApp).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(listConnectedApps).toHaveBeenCalledTimes(2));
  });

  it("rethrows a failed revoke, so the confirm row stays open", async () => {
    revokeConnectedApp.mockRejectedValueOnce(new Error("nope"));
    render(<AppsPanel isOpen />);
    await screen.findByText("Claude Desktop");

    fireEvent.click(screen.getByRole("button", { name: /revoke access/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke access$/i }));

    // ConnectedApps keeps its row in confirm mode by NOT clearing state when
    // onRevoke rejects. Swallowing the error here would collapse the row as
    // though the revoke had worked.
    await waitFor(() => expect(revokeConnectedApp).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/settings/AppsPanel.test.jsx`
Expected: FAIL, cannot resolve `./AppsPanel`.

- [ ] **Step 3: Write the panel**

Move `ConnectionSettings.jsx`'s `appsList` / `appsLoading` / `appsError` state,
`loadApps` (244-255), its effect (257-262), `handleRevokeApp` (264-285) and the
`activeTab === "apps"` body (957-974) into
`frontend/src/components/settings/AppsPanel.jsx`. The effect's condition becomes
`if (isOpen) loadApps();`.

Header comment:

```jsx
/**
 * Connected apps: the fetch, the loading and error states, and the revoke.
 *
 * ConnectedApps.jsx is presentational and takes `grants` and `onRevoke` as
 * props. This is the half that talks to the network.
 *
 * The revoke handler rethrows. ConnectedApps keeps a row in confirm mode by
 * not clearing its own state when `onRevoke` rejects, so swallowing the error
 * here would collapse the row as though the revoke had gone through.
 */
```

- [ ] **Step 4: Render it from the old dialog**

```jsx
{activeTab === "apps" && <AppsPanel isOpen={activeTab === "apps"} />}
```

Delete the moved state, handler, effect and the `ConnectedApps` import from
`ConnectionSettings.jsx`.

- [ ] **Step 5: Run the suites**

Run: `cd frontend && npx vitest run --project unit src/components/settings/AppsPanel.test.jsx src/components/ConnectedApps.test.jsx src/components/ConnectionSettings.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/AppsPanel.jsx \
  frontend/src/components/settings/AppsPanel.test.jsx \
  frontend/src/components/ConnectionSettings.jsx
git commit -m "$(cat <<'EOF'
refactor(settings): connected apps get the panel that owns their fetch

Behaviour unchanged, including the rethrow from the revoke handler. That is what
keeps a row in confirm mode when the revoke fails, and it had no test before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: TokenPanel, with the grants line

**Files:**
- Create: `frontend/src/components/settings/TokenPanel.jsx`
- Create: `frontend/src/components/settings/TokenPanel.test.jsx`
- Modify: `frontend/src/components/ConnectionSettings.jsx` — remove the tokens tab entirely; render `<TokenPanel isOpen={activeTab === "tokens"} />`

**Interfaces:**
- Consumes: `listTokens()`, `createToken(label, scopes)`, `revokeToken(id)` from `@/lib/api.js`; `summariseScopes`, `READ`, `PROPOSE`, `WRITE` from `@/lib/scopes.js`.
- Produces: `export function TokenPanel({ isOpen })`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/settings/TokenPanel.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listTokens: vi.fn(async () => []),
    createToken: vi.fn(async () => ({ id: "t1", label: "mcp", token: "mg_secret" })),
    revokeToken: vi.fn(async () => {}),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { listTokens, createToken, revokeToken } from "@/lib/api.js";
import { TokenPanel } from "./TokenPanel";

beforeEach(() => vi.clearAllMocks());

describe("TokenPanel", () => {
  it("fetches nothing while its tab is closed", () => {
    render(<TokenPanel isOpen={false} />);
    expect(listTokens).not.toHaveBeenCalled();
  });

  it("says so when there are none", async () => {
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/No tokens yet/i)).toBeInTheDocument();
  });
});

describe("what a token row says", () => {
  beforeEach(() => {
    listTokens.mockResolvedValue([
      {
        id: "t1",
        label: "Laptop CLI",
        created_at: "2026-08-01T10:00:00Z",
        last_used_at: "2026-08-12T09:00:00Z",
        expires_at: null,
        scopes: ["persona:read", "persona:propose"],
      },
    ]);
  });

  it("states the grant in plain language", async () => {
    // scopes is already returned by db.list_tokens and was thrown away.
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/Read and propose/)).toBeInTheDocument();
  });

  it("gives the dates, and does not set them in mono", async () => {
    // The prototype's change 9 makes this point about Connected apps: a
    // sentence is not a scope string.
    render(<TokenPanel isOpen />);
    const line = await screen.findByText(/created 2026-08-01/);
    expect(line.textContent).toMatch(/last used 2026-08-12/);
    expect(line.className).not.toMatch(/font-mono/);
  });

  it("says never, for a token no client has used", async () => {
    listTokens.mockResolvedValue([
      { id: "t2", label: "unused", created_at: "2026-08-01T10:00:00Z",
        last_used_at: null, expires_at: null, scopes: ["persona:read"] },
    ]);
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/last used never/)).toBeInTheDocument();
  });

  it("names the expiry when there is one", async () => {
    listTokens.mockResolvedValue([
      { id: "t3", label: "temporary", created_at: "2026-08-01T10:00:00Z",
        last_used_at: null, expires_at: "2026-09-01T10:00:00Z",
        scopes: ["persona:read"] },
    ]);
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/expires 2026-09-01/)).toBeInTheDocument();
  });

  it("says nothing about expiry for a token that does not expire", async () => {
    render(<TokenPanel isOpen />);
    await screen.findByText("Laptop CLI");
    expect(screen.queryByText(/expires/i)).not.toBeInTheDocument();
  });
});

describe("minting one", () => {
  it("passes exactly the toggled scopes to createToken", async () => {
    render(<TokenPanel isOpen />);
    await waitFor(() => expect(listTokens).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText(/Change your persona directly/i));
    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

    await waitFor(() => expect(createToken).toHaveBeenCalled());
    const [label, scopes] = createToken.mock.calls[0];
    expect(label).toBe("mcp");
    expect(scopes).toEqual(["persona:read", "persona:propose"]);
  });

  it("shows the secret once, and warns that it will not come back", async () => {
    render(<TokenPanel isOpen />);
    await waitFor(() => expect(listTokens).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

    expect(await screen.findByText("mg_secret")).toBeInTheDocument();
    expect(screen.getByText(/won.t be shown again/i)).toBeInTheDocument();
  });
});

describe("revoking one", () => {
  beforeEach(() => {
    listTokens.mockResolvedValue([
      { id: "t1", label: "Laptop CLI", created_at: "2026-08-01T10:00:00Z",
        last_used_at: null, expires_at: null, scopes: ["persona:read"] },
    ]);
  });

  it("asks first, then revokes and reloads", async () => {
    render(<TokenPanel isOpen />);
    await screen.findByText("Laptop CLI");

    fireEvent.click(screen.getByRole("button", { name: /revoke token/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    await waitFor(() => expect(revokeToken).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(listTokens).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/settings/TokenPanel.test.jsx`
Expected: FAIL, cannot resolve `./TokenPanel`.

- [ ] **Step 3: Write the panel**

Move from `ConnectionSettings.jsx`: the token state (135-149), `loadTokens`
(224-235) and its effect (237-242), `onTokenWriteChange` /
`onTokenProposeChange` (291-299), `handleGenerateToken` (405-421),
`handleCopyRevealedToken` (423-432), `handleDoneReveal` (434-440),
`handleRevoke` (442-458), `formatDate` (71-76), the `activeTab === "tokens"`
body (794-955) and `TokenScopeRow` (1098-1116).

Then change three things:

1. The metadata line loses `font-mono` and gains the grant and the expiry:

```jsx
<div className="min-w-0 space-y-1">
  <p className="truncate text-sm font-medium">{t.label}</p>
  <p className="text-xs text-muted-foreground">{summariseScopes(t.scopes)}</p>
  <p className="text-xs text-muted-foreground">
    created {formatDate(t.created_at) || "unknown"} &middot;{" "}
    last used {formatDate(t.last_used_at) || "never"}
    {formatDate(t.expires_at) && <> &middot; expires {formatDate(t.expires_at)}</>}
  </p>
</div>
```

2. The effect's condition becomes `if (isOpen) loadTokens();`.

3. The scope constants come from `@/lib/scopes.js` rather than being redeclared.

Header comment:

```jsx
/**
 * API tokens: the list, the create form, and the one look at the secret.
 *
 * Two things were already being returned by db.list_tokens and thrown away:
 * `scopes`, which is the grant, and `expires_at`. A token that quietly stops
 * working is a bad surprise, and a list that does not say what each token can
 * do cannot be audited.
 *
 * The prototype shows a masked secret per row. There is nothing to mask:
 * db.list_tokens returns id, label, created_at, last_used_at, expires_at and
 * scopes, and its docstring says "Never the hash".
 *
 * The scope switches keep write > propose > read true whatever gets clicked.
 * Read has no switch because it is the floor for every token, not a choice.
 */
```

- [ ] **Step 4: Render it from the old dialog**

```jsx
{activeTab === "tokens" && <TokenPanel isOpen={activeTab === "tokens"} />}
```

Delete everything moved, plus the `Copy` / `Trash2` / `Check` icon imports if
nothing else in the file still uses them.

- [ ] **Step 5: Run the suites**

Run: `cd frontend && npx vitest run --project unit src/components/settings/TokenPanel.test.jsx src/components/ConnectionSettings.test.jsx`
Expected: `TokenPanel` PASS. `ConnectionSettings.test.jsx` FAILS one test — "passes exactly the toggled scopes to createToken", which reaches the tokens tab through the old dialog. Delete that test from `ConnectionSettings.test.jsx`; `TokenPanel.test.jsx` now covers it and covers more.

- [ ] **Step 6: Re-run and commit**

Run: `cd frontend && npx vitest run --project unit src/components/settings/TokenPanel.test.jsx src/components/ConnectionSettings.test.jsx`
Expected: PASS.

```bash
git add frontend/src/components/settings/TokenPanel.jsx \
  frontend/src/components/settings/TokenPanel.test.jsx \
  frontend/src/components/ConnectionSettings.jsx \
  frontend/src/components/ConnectionSettings.test.jsx
git commit -m "$(cat <<'EOF'
feat(settings): a token row says what the token can do, and when it expires

db.list_tokens has always returned scopes and expires_at. The UI rendered
neither, so a list of tokens could not be audited and an expiry arrived as a
surprise. The metadata line also comes off Geist Mono: it reads as a sentence,
not a scope string.

Not built: the prototype's masked secret. db.list_tokens says "Never the hash",
so there is nothing to mask.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: ServerPanel, leading with this instance

**Files:**
- Create: `frontend/src/components/settings/ServerPanel.jsx`
- Create: `frontend/src/components/settings/ServerPanel.test.jsx`
- Modify: `frontend/src/components/ConnectionSettings.jsx` — remove the connection-type toggle, server URL, token field, test result, current-config block and the whole `DialogFooter`; render `<ServerPanel ... />` in the connection tab

**Interfaces:**
- Consumes: `CLOUD_API_URL`, `getConfig`, `saveConfig`, `clearConfig`, `testConnection`, `whoami`, `getApiBase` from `@/lib/api.js`; `signOut` from `@/lib/session.js`.
- Produces: `export function ServerPanel({ isSignedIn, onConnectionChange, onClose })`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/settings/ServerPanel.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getConfig: vi.fn(() => null),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    getApiBase: vi.fn(() => "/api"),
    testConnection: vi.fn(async () => ({})),
    whoami: vi.fn(async () => ({ username: "Liam" })),
  };
});

vi.mock("@/lib/session.js", () => ({ signOut: vi.fn(async () => {}) }));

import {
  getConfig, saveConfig, clearConfig, getApiBase, testConnection,
} from "@/lib/api.js";
import { signOut } from "@/lib/session.js";
import { ServerPanel } from "./ServerPanel";

const open = (props = {}) =>
  render(
    <ServerPanel
      isSignedIn
      onConnectionChange={props.onConnectionChange || vi.fn()}
      onClose={props.onClose || vi.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  getConfig.mockReturnValue(null);
  getApiBase.mockReturnValue("/api");
});

describe("with no saved config", () => {
  it("leads with the instance that served the page, not with Cloud", () => {
    // The bug this replaces: the old panel selected Cloud whenever there was
    // no config, while getApiBase() returned /api. It then printed
    // "Current API: /api" two panels below, contradicting its own chip.
    open();
    expect(screen.getByText(/This instance/i)).toBeInTheDocument();
    expect(screen.getByText("/api")).toBeInTheDocument();
  });

  it("keeps the custom-server fields out of the way until asked for", () => {
    open();
    expect(screen.queryByLabelText(/Server URL/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    expect(screen.getByLabelText(/Server URL/i)).toBeInTheDocument();
  });
});

describe("with a saved custom server", () => {
  it("opens in the custom state, with the URL filled", () => {
    getConfig.mockReturnValue({ serverUrl: "https://example.test/api" });
    getApiBase.mockReturnValue("https://example.test/api");
    open();
    expect(screen.getByLabelText(/Server URL/i)).toHaveValue("https://example.test/api");
  });

  it("offers a way back, and says that it signs you out", () => {
    // handleReset has always called signOut. "Reset to Default" never said so.
    getConfig.mockReturnValue({ serverUrl: "https://example.test/api" });
    open();
    expect(screen.getByText(/signs you out/i)).toBeInTheDocument();
  });

  it("clears the config and signs out when reset", async () => {
    getConfig.mockReturnValue({ serverUrl: "https://example.test/api" });
    const onConnectionChange = vi.fn();
    open({ onConnectionChange });

    fireEvent.click(screen.getByRole("button", { name: /reset to this instance/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(clearConfig).toHaveBeenCalled();
    expect(onConnectionChange).toHaveBeenCalled();
  });
});

describe("the cloud preset", () => {
  it("fills the field, for a UI running away from its server", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.click(screen.getByRole("button", { name: /MyGist Cloud/i }));
    expect(screen.getByLabelText(/Server URL/i)).toHaveValue(
      "https://mygist.thuradev.qzz.io/api",
    );
  });
});

describe("testing and saving", () => {
  it("reports who the server says you are", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.change(screen.getByLabelText(/Server URL/i), {
      target: { value: "https://example.test/api" },
    });
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/Connected as Liam/)).toBeInTheDocument();
  });

  it("refuses to test an empty URL rather than testing the wrong one", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/Server URL is required/i)).toBeInTheDocument();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("saves the URL and closes", () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.change(screen.getByLabelText(/Server URL/i), {
      target: { value: "https://example.test/api" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(saveConfig).toHaveBeenCalledWith({
      serverUrl: "https://example.test/api",
      token: "",
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the manual token field", () => {
  it("is offered when there is no credential", () => {
    open({ isSignedIn: false });
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    expect(screen.getByLabelText(/API token/i)).toBeInTheDocument();
  });

  it("is not offered when there is one", () => {
    open({ isSignedIn: true });
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    expect(screen.queryByLabelText(/API token/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/settings/ServerPanel.test.jsx`
Expected: FAIL, cannot resolve `./ServerPanel`.

- [ ] **Step 3: Write the panel**

`frontend/src/components/settings/ServerPanel.jsx`. The state and handlers move
from `ConnectionSettings.jsx` (`serverUrl`, `selfHostedUrl`, `token`, `testing`,
`testResult`, `showToken`; `handleTest` 316-344, `handleSave` 346-354,
`handleReset` 356-365), with the cloud/self-hosted segmented control replaced by
a two-state panel.

The default state is derived, not stored:

```js
// A saved serverUrl means someone deliberately pointed this UI elsewhere.
// Anything else -- no config at all -- means the origin that served this page,
// which is what getApiBase() already returns.
const [custom, setCustom] = useState(() => !!getConfig()?.serverUrl);
```

Copy for the default state:

```jsx
<div className="space-y-1 rounded-lg border p-3">
  <p className="text-sm font-medium">This instance</p>
  <p className="break-all font-mono text-xs text-muted-foreground">{getApiBase()}</p>
</div>
<Button variant="link" className="h-auto p-0 text-xs" onClick={() => setCustom(true)}>
  Use a custom server
</Button>
```

Copy for the custom state, below the URL field:

```jsx
<p className="text-xs text-muted-foreground">
  Full URL to the MyGist API, including /api.
</p>
<Button variant="link" className="h-auto p-0 text-xs"
        onClick={() => handleUrlChange(CLOUD_API_URL)}>
  Use MyGist Cloud
</Button>
```

and the way back:

```jsx
<div className="border-t pt-3">
  <Button variant="outline" size="sm" onClick={handleReset}>
    Reset to this instance
  </Button>
  <p className="mt-1.5 text-xs text-muted-foreground">
    Clears the custom server and signs you out.
  </p>
</div>
```

Test and Save move here from the dialog footer, side by side above that block.

Header comment:

```jsx
/**
 * Which server this UI talks to.
 *
 * The prototype leads with MyGist Cloud. That reproduces a bug this code
 * already fixed once: the old panel selected Cloud whenever there was no saved
 * config, while getApiBase() with no config returns /api -- the origin that
 * served the page. On a self-hosted instance it therefore claimed to be talking
 * to the cloud while talking to itself, and printed the contradiction two
 * panels below. WelcomeAuth.jsx:88 documents the same mistake on the sign-up
 * path, where it sent self-hosters' registrations to a host their browser then
 * refused.
 *
 * So this leads with the instance that served the page. MyGist Cloud is what
 * that resolves to when the serving origin IS the cloud, and it stays available
 * as a preset for the case api.js describes: running this UI somewhere other
 * than the server it talks to.
 *
 * Reset signs you out, and says so. A token in the config belongs to the server
 * being left behind, and it has always been cleared -- "Reset to Default" just
 * never mentioned it.
 */
```

- [ ] **Step 4: Render it from the old dialog**

In `ConnectionSettings.jsx`, delete the connection-type toggle (628-649), the
server URL block (651-666), the token block (668-693), the test result (695-711),
the current-config block (713-722) and the entire `DialogFooter` (1063-1089).
Render at the end of the connection panel:

```jsx
<ServerPanel
  isSignedIn={isSignedIn}
  onConnectionChange={onConnectionChange}
  onClose={onClose}
/>
```

Delete the moved state and handlers, `handleSelfHostedUrlChange`, `selectCloud`,
`selectSelfHosted`, and the `Wifi` / `Globe` / `Server` / `Key` icon imports that
nothing else uses.

- [ ] **Step 5: Run the suites**

Run: `cd frontend && npx vitest run --project unit src/components/settings/ServerPanel.test.jsx src/components/ConnectionSettings.test.jsx src/App.test.jsx`
Expected: PASS. `App.test.jsx` renders the dialog hidden, so it exercises the import graph.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/ServerPanel.jsx \
  frontend/src/components/settings/ServerPanel.test.jsx \
  frontend/src/components/ConnectionSettings.jsx
git commit -m "$(cat <<'EOF'
fix(settings): the server panel names the instance it is actually talking to

The old panel selected Cloud whenever there was no saved config, while
getApiBase() returns /api in that case -- so a self-hosted instance claimed to
be talking to the cloud while talking to itself, and printed the contradiction
two panels below. WelcomeAuth documents fixing the same mistake on sign-up.

Reset now says that it signs you out. It always did.

Test, Save and Reset move out of the dialog footer into the panel that owns
them, so they stop appearing above tabs they have nothing to do with.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: AccountPanel

**Files:**
- Create: `frontend/src/components/settings/AccountPanel.jsx`
- Create: `frontend/src/components/settings/AccountPanel.test.jsx`
- Modify: `frontend/src/components/ConnectionSettings.jsx` — the connection panel becomes `<AccountPanel />` then `<ServerPanel />`

**Interfaces:**
- Consumes: `setPassword` from `@/lib/api.js`; `signOut` from `@/lib/session.js`; `getOnboarding`, `saveOnboarding` from `@/lib/onboarding.js`; `EmailSettings`.
- Produces: `export function AccountPanel({ isOpen, username, isAutosaveEnabled, onAutosaveChange, disabledSections, onSignedOut })`. `onSignedOut` is called after `signOut()` succeeds, so the dialog can close and `App` can reload.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/settings/AccountPanel.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setPassword: vi.fn(async () => ({})), clearConfig: vi.fn() };
});

vi.mock("@/lib/session.js", () => ({
  signOut: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
  isPlaceholderEmail: vi.fn(() => false),
}));

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: vi.fn(async () => ({ dismissed: false, steps: {} })),
  saveOnboarding: vi.fn(async () => {}),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { setPassword } from "@/lib/api.js";
import { signOut } from "@/lib/session.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import { AccountPanel } from "./AccountPanel";

const open = (props = {}) =>
  render(
    <AccountPanel
      isOpen
      username="Liam"
      isAutosaveEnabled
      onAutosaveChange={vi.fn()}
      disabledSections={[]}
      onSignedOut={vi.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  getOnboarding.mockResolvedValue({ dismissed: false, steps: {} });
});

describe("who you are", () => {
  it("names the account", () => {
    open();
    expect(screen.getByText(/Liam/)).toBeInTheDocument();
  });

  it("signs out through the service, not by clearing localStorage", async () => {
    // The session cookie is HttpOnly. Clearing storage alone would look signed
    // out and sign you back in on reload.
    const onSignedOut = vi.fn();
    open({ onSignedOut });
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(onSignedOut).toHaveBeenCalled();
  });
});

describe("the auto-save preference", () => {
  it("shows the switch on, when saving as you type is enabled", () => {
    open({ isAutosaveEnabled: true });
    expect(screen.getByRole("switch", { name: "Auto-save" })).toBeChecked();
  });

  it("shows the switch off, when it is not", () => {
    open({ isAutosaveEnabled: false });
    expect(screen.getByRole("switch", { name: "Auto-save" })).not.toBeChecked();
  });

  it("reports a change upward rather than holding the state itself", () => {
    // App owns it. A dialog that is closed most of the time must not be the
    // source of truth for how the app saves.
    const onAutosaveChange = vi.fn();
    open({ onAutosaveChange });
    fireEvent.click(screen.getByRole("switch", { name: "Auto-save" }));
    expect(onAutosaveChange).toHaveBeenCalledWith(false);
  });

  it("says what happens rather than naming the mechanism", () => {
    open();
    expect(screen.getByText(/Save as you type/i)).toBeInTheDocument();
    expect(screen.getByText(/Save now button/i)).toBeInTheDocument();
  });

  it("defaults to on when the prop is absent", () => {
    render(
      <AccountPanel isOpen username="Liam" disabledSections={[]} onSignedOut={vi.fn()} />,
    );
    expect(screen.getByRole("switch", { name: "Auto-save" })).toBeChecked();
  });
});

describe("the getting-started restore", () => {
  it("is offered only once the card has been dismissed", async () => {
    getOnboarding.mockResolvedValue({ dismissed: true, steps: {} });
    open();
    expect(
      await screen.findByRole("button", { name: /show getting started/i }),
    ).toBeInTheDocument();
  });

  it("says nothing to someone whose card is already showing", async () => {
    open();
    await waitFor(() => expect(getOnboarding).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /show getting started/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the current disabled sections when restoring", async () => {
    // SettingsUpdate requires disabled_sections and writes what it is sent,
    // so [] here would re-enable every section the reader turned off.
    getOnboarding.mockResolvedValue({ dismissed: true, steps: {} });
    open({ disabledSections: ["media"] });

    fireEvent.click(await screen.findByRole("button", { name: /show getting started/i }));

    await waitFor(() =>
      expect(saveOnboarding).toHaveBeenCalledWith(
        { dismissed: false, steps: {} },
        ["media"],
      ),
    );
  });
});

describe("changing the password", () => {
  it("refuses a mismatch without a round trip", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "different1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses one shorter than eight characters", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("sends the current password when one was given", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    fireEvent.change(screen.getByLabelText(/Current password/i), {
      target: { value: "oldpassword" },
    });
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() =>
      expect(setPassword).toHaveBeenCalledWith("longenough1", "oldpassword"),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/settings/AccountPanel.test.jsx`
Expected: FAIL, cannot resolve `./AccountPanel`.

- [ ] **Step 3: Write the panel**

Move from `ConnectionSettings.jsx`: the signed-in row and Sign out (539-555),
`<EmailSettings />` (560), the auto-save block (562-587), the getting-started
block (589-626) with its `onboardingDismissed` state and effect (95-113), and the
change-password disclosure (724-790) with its state (127-132) and
`handleSetPassword` (377-403).

`handleSignOut` becomes:

```js
const handleSignOut = async () => {
  // The session cookie is HttpOnly, so only the service can revoke it.
  // Clearing localStorage alone would look signed out and sign you back in on
  // the next reload.
  await signOut();
  clearConfig();
  onSignedOut();
};
```

The getting-started effect keys on `isOpen` rather than the dialog's own
`isOpen`, so the panel asks when its tab is opened.

Header comment:

```jsx
/**
 * The account: who you are, how to reach you, your password, and two
 * preferences.
 *
 * The two preferences are slice 1's and slice 4's footholds. Both were put in
 * the old `connection` panel with a comment saying slice 5 would rebuild this
 * dialog with an Account tab and that inventing one early would prejudge it.
 * This is that tab.
 *
 * Neither preference is destructive. Auto-save changes when a write happens,
 * not whether one does, and restoring the getting-started card brings back a
 * card rather than data.
 */
```

- [ ] **Step 4: Render it from the old dialog**

The `activeTab === "connection"` panel becomes:

```jsx
{activeTab === "connection" && (
  <div className="space-y-4">
    {isSignedIn && (
      <AccountPanel
        isOpen
        username={signedInUsername}
        isAutosaveEnabled={isAutosaveEnabled}
        onAutosaveChange={onAutosaveChange}
        disabledSections={disabledSections}
        onSignedOut={() => {
          onConnectionChange?.();
          onClose();
        }}
      />
    )}
    <ServerPanel
      isSignedIn={isSignedIn}
      onConnectionChange={onConnectionChange}
      onClose={onClose}
    />
  </div>
)}
```

- [ ] **Step 5: Run the suites**

Run: `cd frontend && npx vitest run --project unit src/components/settings/AccountPanel.test.jsx src/components/ConnectionSettings.test.jsx src/components/ConnectionSettings.onboarding.test.jsx`
Expected: `AccountPanel` PASS. The five auto-save tests in
`ConnectionSettings.test.jsx` now fail, because that file renders without
`whoami` resolving and the block is behind `isSignedIn`. Delete those five and
the three in `ConnectionSettings.onboarding.test.jsx`; `AccountPanel.test.jsx`
covers all eight and adds the password cases, which had none.

- [ ] **Step 6: Delete the redundant file and re-run**

```bash
git rm frontend/src/components/ConnectionSettings.onboarding.test.jsx
```

Run: `cd frontend && npx vitest run --project unit src/components/settings/ src/components/ConnectionSettings.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/settings/AccountPanel.jsx \
  frontend/src/components/settings/AccountPanel.test.jsx \
  frontend/src/components/ConnectionSettings.jsx \
  frontend/src/components/ConnectionSettings.test.jsx
git commit -m "$(cat <<'EOF'
feat(settings): the account panel, where slice 1 and slice 4 said it would be

Both footholds carried a comment saying slice 5 would rebuild this dialog with
an Account tab and that inventing one early would prejudge it. This is that tab,
and the preferences move into it unchanged.

The change-password form had no tests. It has four now, including the two local
checks that were meant to save a round trip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: SettingsDialog, and the old file goes

**Files:**
- Create: `frontend/src/components/settings/SettingsDialog.jsx`
- Create: `frontend/src/components/settings/SettingsDialog.test.jsx`
- Delete: `frontend/src/components/ConnectionSettings.jsx`, `frontend/src/components/ConnectionSettings.test.jsx`
- Modify: `frontend/src/App.jsx:25,631,673,857`
- Modify: `frontend/src/App.test.jsx:9` (comment), `frontend/src/components/ui/segmented-control.jsx:1-2` (comment)

**Interfaces:**
- Consumes: `SETTINGS_TABS`, `isTabAvailable`, `defaultTab`; all five panels; `whoami` from `@/lib/api.js`.
- Produces: `export function SettingsDialog({ isOpen, onClose, onConnectionChange, isAutosaveEnabled, onAutosaveChange, disabledSections })`. Same props the old component took, minus nothing.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/settings/SettingsDialog.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    whoami: vi.fn(),
    getConfig: vi.fn(() => null),
    getApiBase: vi.fn(() => "/api"),
    listTokens: vi.fn(async () => []),
    listConnectedApps: vi.fn(async () => []),
  };
});

vi.mock("@/lib/session.js", () => ({
  signOut: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
  isPlaceholderEmail: vi.fn(() => false),
}));

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: vi.fn(async () => ({ dismissed: false, steps: {} })),
  saveOnboarding: vi.fn(async () => {}),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { whoami, listTokens, listConnectedApps } from "@/lib/api.js";
import { SettingsDialog } from "./SettingsDialog";

const open = () =>
  render(
    <SettingsDialog isOpen onClose={vi.fn()} onConnectionChange={vi.fn()} disabledSections={[]} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("signed in", () => {
  beforeEach(() => whoami.mockResolvedValue({ user_id: "u-1", username: "Liam" }));

  it("opens on Account", async () => {
    open();
    expect(await screen.findByText(/Liam/)).toBeInTheDocument();
  });

  it("offers all five tabs, enabled", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    for (const label of ["Account", "Server", "Tokens", "Connected apps", "Data"]) {
      expect(screen.getByRole("tab", { name: label })).toBeEnabled();
    }
  });

  it("does not fetch a panel until its tab is opened", async () => {
    // Radix TabsContent would mount all five and fire every fetch at once.
    // ProposalsPanel renders its panels itself for the same reason.
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(listTokens).not.toHaveBeenCalled();
    expect(listConnectedApps).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Tokens" }));
    await waitFor(() => expect(listTokens).toHaveBeenCalled());
    expect(listConnectedApps).not.toHaveBeenCalled();
  });
});

describe("signed out", () => {
  beforeEach(() => whoami.mockRejectedValue(new Error("Unauthorized")));

  it("opens on Server, which is the only tab that would render", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(await screen.findByText(/This instance/i)).toBeInTheDocument();
  });

  it("disables the four that need a credential", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    for (const label of ["Account", "Tokens", "Connected apps", "Data"]) {
      expect(screen.getByRole("tab", { name: label })).toBeDisabled();
    }
    expect(screen.getByRole("tab", { name: "Server" })).toBeEnabled();
  });

  it("offers no way to sign out, because there is nothing to sign out of", async () => {
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("treats a token the server rejects as signed out", async () => {
    localStorage.setItem(
      "mygist_config",
      JSON.stringify({ serverUrl: "/api", token: "revoked-token" }),
    );
    open();
    await waitFor(() => expect(whoami).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Account" })).toBeDisabled();
  });
});

describe("the tab row", () => {
  it("is a real tablist, not styled buttons", async () => {
    // The row it replaces was <button> elements with no role, so the app's main
    // settings surface had no tablist semantics and no arrow-key navigation.
    whoami.mockResolvedValue({ user_id: "u-1", username: "Liam" });
    open();
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/settings/SettingsDialog.test.jsx`
Expected: FAIL, cannot resolve `./SettingsDialog`.

- [ ] **Step 3: Write the dialog**

```jsx
/**
 * The settings dialog: which tab is up, and who is signed in.
 *
 * Everything else lives in one panel per tab. The component this replaces held
 * all five in 1172 lines with 10 tests.
 *
 * `whoami()` decides signed-in rather than localStorage. A Better Auth session
 * is an HttpOnly cookie JavaScript cannot see, so `!!config?.token` reported
 * signed out for everyone who signed in through it -- which hid the account
 * details, disabled most of the dialog, and left no way to sign out at all. It
 * also catches a token the server has stopped accepting, which the old check
 * called signed in.
 *
 * Panels render below the tab row rather than through `TabsContent`, matching
 * ProposalsPanel. Radix mounts every `TabsContent` it is given, which would
 * fire all five panels' fetches on open.
 */
import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { whoami } from "@/lib/api.js";
import { SETTINGS_TABS, isTabAvailable, defaultTab } from "./settingsTabs.js";
import { AccountPanel } from "./AccountPanel";
import { ServerPanel } from "./ServerPanel";
import { TokenPanel } from "./TokenPanel";
import { AppsPanel } from "./AppsPanel";
import { DataPanel } from "./DataPanel";

export function SettingsDialog({
  isOpen,
  onClose,
  onConnectionChange,
  isAutosaveEnabled = true,
  onAutosaveChange = () => {},
  disabledSections = [],
}) {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [username, setUsername] = useState(null);
  const [activeTab, setActiveTab] = useState(defaultTab(false));

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsSignedIn(false);
    setUsername(null);
    setActiveTab(defaultTab(false));
    whoami()
      .then((me) => {
        if (cancelled) return;
        setIsSignedIn(true);
        setUsername(me.username || "your account");
        setActiveTab(defaultTab(true));
      })
      .catch(() => {
        // Signed out is a state, not an error. Server is the tab that still
        // works, and it is already selected.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Your account, this server, and the clients connected to it.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                disabled={!isTabAvailable(tab.id, isSignedIn)}
                title={
                  isTabAvailable(tab.id, isSignedIn) ? undefined : "Sign in to reach this"
                }
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {activeTab === "account" && isSignedIn && (
          <AccountPanel
            isOpen
            username={username}
            isAutosaveEnabled={isAutosaveEnabled}
            onAutosaveChange={onAutosaveChange}
            disabledSections={disabledSections}
            onSignedOut={() => {
              onConnectionChange?.();
              onClose();
            }}
          />
        )}
        {activeTab === "server" && (
          <ServerPanel
            isSignedIn={isSignedIn}
            onConnectionChange={onConnectionChange}
            onClose={onClose}
          />
        )}
        {activeTab === "tokens" && isSignedIn && <TokenPanel isOpen />}
        {activeTab === "apps" && isSignedIn && <AppsPanel isOpen />}
        {activeTab === "data" && isSignedIn && <DataPanel />}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd frontend && npx vitest run --project unit src/components/settings/SettingsDialog.test.jsx`
Expected: PASS.

- [ ] **Step 5: Swap App.jsx and delete the old file**

In `App.jsx`, change the import at line 25 to:

```js
import { SettingsDialog } from "@/components/settings/SettingsDialog";
```

and rename the JSX at the three render sites (631, 673, 857) from
`<ConnectionSettings` to `<SettingsDialog`. Leave the `showConnectionSettings`
state name alone; renaming it touches ten more lines for no gain.

```bash
git rm frontend/src/components/ConnectionSettings.jsx \
  frontend/src/components/ConnectionSettings.test.jsx
```

Update the comment at `App.test.jsx:9` to name `SettingsDialog`, and the header
comment in `ui/segmented-control.jsx` so it no longer claims to style a tab row:

```js
// Segmented-control button classes, shared by the import-mode toggle in
// settings and the server toggle in WelcomeAuth. The settings tab row used
// these until it became a real Radix tablist.
```

- [ ] **Step 6: Run the whole frontend suite**

Run: `cd frontend && npm test`
Expected: PASS. `ConnectionStatus` leaves with its file; confirm nothing
imported it:

```bash
grep -rn "ConnectionStatus" frontend/src || echo "gone"
```

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "$(cat <<'EOF'
feat(settings): five tabs, one panel each, and ConnectionSettings goes

Account / Server / Tokens / Connected apps / Data, replacing a 1172-line
component that had 10 tests. Each panel is its own file with its own test file.

The tab row is a Radix tablist rather than styled buttons, so the app's main
settings surface gets tab semantics and arrow-key navigation. Panels render
below it rather than through TabsContent, matching ProposalsPanel: Radix mounts
every TabsContent it is given, which would fire all five fetches on open.

ConnectionStatus goes with the file. It polled /health every 30 seconds and had
no consumers -- slice 1 replaced it with the header's Disconnected badge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Verify against a running app

**Files:** none changed unless something is found.

- [ ] **Step 1: Both suites**

Run: `cd frontend && npm test`
Expected: PASS, and the file count is up by 8 over `main`.

Run: `cd backend && ./venv/bin/python -m pytest -q`
Expected: PASS. No backend file was touched, so this is a check that nothing
drifted.

- [ ] **Step 2: Confirm the utilities exist in the built CSS**

The browser finds what a green suite cannot. `sm:max-w-xl` is new to this file.

```bash
cd frontend && npm run build && grep -c "max-w-xl" dist/assets/*.css
```

Expected: at least 1.

- [ ] **Step 3: Rebuild the preview and walk the five tabs**

Rebuild the local preview from this branch, sign in, open the account button and
check each tab by hand:

| Check | Looking for |
|---|---|
| Account | the username, Sign out, email row, password disclosure, both preferences |
| Server | "This instance" and the real API base, not "Cloud" |
| Server → custom | URL field, Use MyGist Cloud, Test, Save, and the reset that mentions signing out |
| Tokens | the grant line in plain language, dates not in mono, no expiry line for a token without one |
| Connected apps | unchanged, with the 10-minute note |
| Data | export downloads, import accepts a zip |
| Signed out | only Server is enabled, and it opens there |
| Keyboard | left and right arrows move between tabs |

- [ ] **Step 4: Commit anything the walk-through found**

If the walk-through finds nothing, there is nothing to commit and this step is
skipped. If it finds something, fix it with a test that fails first.

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: the scopes module
and its four consumers to Task 1; the tab vocabulary and the inverted gating
rule to Tasks 2 and 8; Account to Task 7; Server, including the this-instance
correction and the footer move, to Task 6; Tokens, including the grants line,
expiry and the mono removal, to Task 5; Connected apps and Data to Tasks 4 and
3; the rename, the `Tabs` swap, the `ConnectionStatus` deletion and the two
comment edits to Task 8; the test redistribution across Tasks 5, 7 and 8.

**Not built, per the spec:** the masked token secret. Recorded in `TokenPanel`'s
header comment rather than dropped silently.

**Type consistency.** `isOpen` means "this panel's tab is open" in
`AccountPanel`, `AppsPanel` and `TokenPanel`, and `DataPanel` takes no props
because it fetches nothing. `summariseScopes` is defined in Task 1 and used in
Task 5 under the same name. `defaultTab` returns `"account"` or `"server"`,
which are ids in `SETTINGS_TABS`, asserted by the "never names a tab the same
call would then close" test.

**One deliberate inconsistency.** `App.jsx` keeps `showConnectionSettings` as a
state name after the component is renamed. Renaming it touches ten more lines
and changes nothing.
