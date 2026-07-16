# Password Sign-in, Token Management, and Account Modal Redesign

**Date:** 2026-07-16
**Status:** Approved by user (design discussed in conversation)

## Problem

The only credential is a single opaque API token: humans can't remember it,
losing it loses the account, and every signup needs a "save this token!"
ceremony. The connection modal has also accreted into one long form
(connection + token + register + backup) with a dev-grade Backup section.

## Decisions (user-approved)

- **Humans sign in with username + password; tokens become named, revocable
  machine credentials** for MCP/AI clients (option 1 of the alternatives).
- Multiple tokens per user (a `tokens` table); the existing single token
  migrates transparently and keeps working.
- Password recovery without email: any valid token signs you in ("Use an
  access token instead"), then set a new password.
- The connection modal becomes a tabbed account dialog (Connection, API
  tokens, Data) in the Ledger visual language; Backup & Restore is redesigned
  inside the Data tab.
- Out of scope: email/reset infra, OAuth, passkeys, new rate limiting.

## Part 1 — Backend

### Schema (db.py, ensure_schema)

- `create table if not exists tokens (id uuid primary key default
  gen_random_uuid(), user_id uuid not null references users(id), token_hash
  text unique not null, label text not null default 'token', created_at
  timestamptz default now(), last_used_at timestamptz)`.
- `alter table users add column if not exists password_hash text` (nullable:
  legacy and script-created accounts have none).
- **Startup migration**: for every `users` row whose `token_hash` is not yet
  in `tokens`, insert it with label `'legacy'`. Idempotent (`on conflict do
  nothing`). `users.token_hash` stays in place but is no longer read.

### Auth core (db.py)

- `resolve_token(token)` now looks up `tokens` by hash, updates
  `tokens.last_used_at` and `users.last_seen_at`, returns `{id, username}`.
- Passwords hashed with **bcrypt** (new dependency `bcrypt`); tokens keep
  sha256 (high-entropy secrets, fine).
- Helpers: `create_token(user_id, label) -> plaintext` (returned once),
  `list_tokens(user_id)` (id, label, created_at, last_used_at — never the
  hash), `revoke_token(user_id, token_id)`, `set_password(user_id, password)`,
  `verify_password(username, password) -> user | None`.

### Endpoints (main.py)

- `POST /api/auth/register` — body gains optional `password`; when present it
  is bcrypt-hashed. Response unchanged `{user_id, username, token}` (the
  initial token is created in `tokens` with label `'web'`). Bare-username
  registration (scripts) still works.
- `POST /api/auth/login` (public) — `{username, password}` → verify → create
  token labeled `'web'` → `{user_id, username, token}`. 401 on bad
  credentials; 401 with detail "password sign-in not set up for this account"
  when `password_hash` is null.
- `POST /api/auth/set-password` (authed) — `{password, current_password?}`.
  If the user already has a password, `current_password` must verify;
  legacy/no-password accounts may set one without it. Min length 8.
- `GET /api/auth/tokens` (authed) — list (id, label, created_at,
  last_used_at).
- `POST /api/auth/tokens` (authed) — `{label}` → `{id, label, token}`
  (plaintext shown once).
- `DELETE /api/auth/tokens/{id}` (authed) — revoke own token (404 if not
  yours). Revoking the token used for the current request is allowed.
- `POST /api/auth/rotate` is **removed** (superseded by token management).
- Middleware public list gains `/api/auth/login`.

### Tests

Register with password → login works; login wrong password → 401; login on
passwordless account → 401 with the specific detail; set-password (legacy
without current, normal requires current, wrong current → 403/401); token
CRUD (create/list/revoke; revoked token stops resolving; can't revoke another
user's token); startup migration (user with only users.token_hash resolves
after `ensure_schema`); register without password still works.

## Part 2 — Frontend: welcome page becomes sign-in

- Welcome layout (logo, heading) stays; below it a real auth form:
  - **Sign in** (default): username, password, primary "Sign in".
  - **Create account** toggle: username, password, confirm password, primary
    "Create account". Client-side check that passwords match, min 8 chars.
  - Errors inline under the form (quiet destructive text), not toasts.
  - Small footer links: "Use an access token instead" (opens the account
    dialog on the Connection tab with the manual token field) and
    "Server: Cloud" disclosure that reveals the Cloud/Self-hosted segmented
    control + URL input for self-hosters (defaults to cloud URL; the chosen
    URL is used by sign-in/sign-up requests and saved with the config).
- On success both paths `saveConfig({serverUrl, token})` and enter the app —
  no token ceremony at signup anymore.
- `api.js` gains: `loginAccount(serverUrl, username, password)`,
  `registerAccount(serverUrl, username, password)` (updated),
  `setPassword(newPassword, currentPassword?)`, `listTokens()`,
  `createToken(label)`, `revokeToken(id)` — all going through the existing
  `api()`/explicit-URL patterns.

## Part 3 — Frontend: tabbed account dialog (ConnectionSettings)

Dialog title becomes **"Account & Connection"** with a segmented tab row
(same segmented style as Cloud/Self-hosted): **Connection · API tokens ·
Data**. Ledger rules throughout: panels + hairlines, 8px radius, quiet
toasts, no green/red tinted blurbs (replace the existing green/red result
boxes with tokened equivalents: `bg-accent text-accent-foreground` for
success, `text-destructive` for errors).

### Connection tab
- Signed-in banner: user icon, "Signed in as {username}", quiet **Sign out**
  button (clears config, returns to welcome; no server-side revoke in v1).
- Connection type segmented + self-hosted URL (existing behavior).
- Manual token field only when NOT signed in (the recovery path), with the
  existing show/hide.
- **Change password** disclosure: current password (hidden for accounts
  without one), new password, confirm; calls set-password; success toast.
- Test connection + Save stay in the footer for this tab.

### API tokens tab
- Intro line: "Tokens let AI clients (Claude, MCP) access your MyGist."
- Token list: rows with label, `created` date, `last used` (relative or
  date), revoke (trash icon + confirm dialog). Mono for dates. Empty state
  one-liner.
- "Generate token" with a label input (default "mcp"); on success show the
  secret once using the existing reveal ceremony (mono panel, Copy with
  Copied feedback, "won't be shown again" callout).

### Data tab (Backup & Restore redesign)
- Two flat rows in one panel, divider-separated, each: title + one-line
  description left, action right:
  - **Export backup** — "Download everything as a zip." → button "Export".
  - **Import backup** — "Restore from a backup zip. A safety backup is made
    first." → button "Choose file".
- Import mode as a segmented control (Replace · Merge) with one line
  explaining the selected mode, replacing the raw `<select>`.
- Progress states on the buttons (spinner) and results via the quiet toast
  system instead of inline colored boxes.

### Migration UX for existing users
- Existing token users: welcome page → "Use an access token instead" → save →
  signed in; Connection tab shows "Set a password" (change-password
  disclosure with no current-password field) so next time they can sign in
  normally.

## Verification

Backend suite green. Playwright E2E on the test-db: sign up → app loads with
no token ceremony; sign out → welcome; sign in (wrong password error, right
password works); legacy path (register bare token via API, "use an access
token instead", then set password, sign out, password sign-in works);
API-tokens tab (generate → secret shown once + copy; appears in list; revoke
→ token stops working); Data tab renders both rows and export triggers a
download; both themes screenshots.
