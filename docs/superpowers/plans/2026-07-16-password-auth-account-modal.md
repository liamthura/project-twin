# Password Auth + Account Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Username+password sign-in for humans, named revocable API tokens for machines, and a tabbed Ledger-styled account dialog with a redesigned Data (backup) tab.

**Architecture:** Backend grows a `tokens` table (existing single tokens migrate on startup, label `legacy`) and bcrypt `password_hash` on users, with login/set-password/token-CRUD endpoints; `resolve_token` moves to the tokens table. Frontend: the welcome page becomes a real sign-in/sign-up form (token path kept as recovery), and `ConnectionSettings.jsx` becomes a 3-tab dialog (Connection · API tokens · Data) reusing the segmented-control and token-reveal patterns already in the file.

**Tech Stack:** FastAPI + psycopg + bcrypt, pytest (docker test-db :5433), React/Tailwind shadcn tokens, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-16-password-auth-and-account-modal-design.md` — the spec is authoritative for all behavior; this plan adds file-level direction.

## Global Constraints

- Existing tokens must keep working with zero user action (startup migration, idempotent).
- Tokens: sha256 as today. Passwords: bcrypt only, min length 8 enforced server-side.
- `POST /api/auth/rotate` is removed; its test in `backend/tests/test_auth_routes.py` is replaced by token-management tests.
- Ledger visual rules in all new UI: tokened colors only (no green-500/red-500 tints — replace the existing result boxes you touch), 8px radius, segmented controls match the existing Cloud/Self-hosted one, results via the quiet toast system (`useToast`) where the spec says so.
- No em/en dashes in any UI copy (use commas or periods).
- Anchors by content; the repo is at commit 4b4b9de-ish (HEAD moves; locate by content).

---

### Task 1: Backend auth (TDD)

**Files:**
- Modify: `backend/db.py` (schema, migration, resolve_token, new helpers), `backend/main.py` (endpoints, middleware public list), `backend/requirements.txt` (+`bcrypt`)
- Modify: `backend/tests/test_auth_routes.py` (drop rotate test, adjust for tokens table if needed)
- Create: `backend/tests/test_auth_password.py`

**Interfaces (Produces):**
- db.py: `create_token(user_id, label) -> str`, `list_tokens(user_id) -> list[dict]`, `revoke_token(user_id, token_id) -> bool`, `set_password(user_id, password)`, `verify_password(username, password) -> dict | None`; `resolve_token` unchanged signature, now tokens-table-backed with `last_used_at` update.
- main.py: endpoints exactly per spec Part 1 (login public; set-password; GET/POST/DELETE `/api/auth/tokens[/{id}]`; register optional password; rotate deleted). Login/register tokens labeled `web`.
- Register response shape unchanged: `{user_id, username, token}`.

**Steps:**
- [ ] Write failing tests in `test_auth_password.py` covering every case in spec "Tests" (register+password→login; wrong password 401; passwordless login 401 with detail containing "not set up"; set-password legacy/normal/wrong-current; token create/list/revoke incl. revoked-token-stops-resolving and cross-user 404; migration: insert a user row with only `token_hash` directly via db, run `ensure_schema()`, assert the token resolves; bare register still works). Use the existing `client` fixture pattern from `test_auth_routes.py`.
- [ ] Remove the rotate test; run suite → new tests fail, rest pass.
- [ ] Implement schema + migration in `ensure_schema()` (idempotent: `insert into tokens (user_id, token_hash, label) select id, token_hash, 'legacy' from users where token_hash is not null on conflict (token_hash) do nothing`).
- [ ] Implement db helpers (bcrypt via `import bcrypt`; `bcrypt.hashpw/checkpw`) and endpoints; add `/api/auth/login` to the middleware public list; delete the rotate endpoint; `pip install bcrypt` in the venv and add to requirements.txt.
- [ ] Focused tests pass, then FULL suite (`python -m pytest tests/ -q`) — zero regressions (persona tests etc.).
- [ ] Commit: `feat: password sign-in and multi-token auth backend`

---

### Task 2: Frontend api helpers + welcome sign-in

**Files:**
- Modify: `frontend/src/lib/api.js`, `frontend/src/App.jsx` (welcome branch)

**Interfaces:**
- api.js adds: `loginAccount(serverUrl, username, password)` (explicit-URL fetch like `registerAccount`), `registerAccount(serverUrl, username, password)` (adds password to body), `setPassword(newPassword, currentPassword)` via `api()`, `listTokens()`, `createToken(label)`, `revokeToken(id)` via `api()`.
- App.jsx welcome branch per spec Part 2: sign-in default / create-account toggle / inline errors / "Use an access token instead" link opening the dialog / "Server: Cloud" disclosure revealing the segmented control + URL (reuse the same segmented classes as ConnectionSettings; keep `CLOUD_API_URL` in sync — export it from api.js and import it in both places to avoid duplication). On success `saveConfig({serverUrl, token})` then `loadAllData()`.
- Form specifics: labels above inputs, `type="password"`, submit on Enter (`<form onSubmit>`), disable submit while pending with spinner, min 8 chars + match check client-side for signup.

**Steps:**
- [ ] api.js changes (move `CLOUD_API_URL` here, export; ConnectionSettings imports it).
- [ ] Welcome branch rework in App.jsx (the `if (error && !getAuthToken())` block).
- [ ] `npm run build` green. Commit: `feat: password sign-in welcome page`

---

### Task 3: Tabbed account dialog + Data tab redesign

**Files:**
- Modify: `frontend/src/components/ConnectionSettings.jsx` (major rework), small App.jsx touch if the dialog needs `useToast` wiring (it should import `useToast` itself).

**Behavior:** spec Part 3 exactly. Key implementation notes:
- Tab state `activeTab: "connection" | "tokens" | "data"`, segmented row under the header (same classes as the Cloud/Self-hosted control). Dialog title "Account & Connection".
- Signed-in = `!!getConfig()?.token`; fetch `whoami()` on open for the username; Sign out button = `clearConfig()` + `onConnectionChange?.()` + `onClose()`.
- Connection tab: keep type segmented + URL + Test + Save; manual token input ONLY when not signed in; change-password disclosure (collapsible via local state; fields per spec; on success toast "Password updated" and collapse).
- API tokens tab: on open (or tab switch) `listTokens()`; rows flat with dividers (label 14 medium, `created`/`last used` in mono 12 secondary), trash icon with a confirm step (inline "Revoke?" confirm buttons are fine, or reuse window-level confirm dialog if simple); generate area: label input default "mcp" + "Generate token" primary; on success reuse the existing token-reveal ceremony (mono panel, Copy/Copied, warning callout) inline in the tab, with a "Done" button returning to the list. The old `mode === "created"` signup ceremony is removed (signup no longer shows tokens) but its JSX is repurposed for this reveal.
- Data tab: per spec, two divider rows (Export / Import), Replace·Merge segmented + one-line explanation of the selected mode, spinners on buttons, results as toasts (remove `backupResult` inline boxes).
- Remove the green/red `testResult` box styling in favor of tokened classes (keep inline placement for test results: `bg-accent text-accent-foreground` success, `border-destructive/40 text-destructive` failure).
- Keep Export/Import handlers and `testConnection`/`whoami` logic as-is otherwise.

**Steps:**
- [ ] Rework the component per above; delete dead register-mode UI (welcome page owns signup now) but KEEP the dialog usable for the not-signed-in token path (`initialMode` prop may be dropped if unused — check App.jsx call sites and clean both sides).
- [ ] `npm run build` green. Commit: `feat: tabbed account dialog with token management and data tab`

---

### Task 4: E2E verification (Playwright)

Per spec "Verification", against the docker test-db (bootstrap identical to previous runs; backend needs `bcrypt` installed in the venv). Cover: signup→app (no ceremony), sign out→welcome, sign in wrong/right password, legacy-token path + set password + password sign-in, token generate/copy/revoke (revoked token 401s via curl), Data tab render + export download event, dark-theme screenshot of welcome + dialog tabs. No source changes for taste; `fix:` commits only for real defects; kill own PIDs; leave docker.
