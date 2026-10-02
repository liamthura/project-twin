# Email templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The four emails people get render as C3 HTML plus text from one layout and one copy deck, with copy editable without a deploy.

**Architecture:** `layout.html` + `copy.json` exist in `auth/src/emails/` and `backend/emails/` (identical, tested). `render.js` and `render.py` implement the same rules and both match shared golden files. Overrides come from `public.email_copy` at send time; `backend/scripts/emails.py` edits them.

**Spec:** `docs/superpowers/specs/2026-10-02-email-templates-design.md`

## Global Constraints

- No new dependencies. Copy in house style, no em dashes in defaults.
- Copy is plain text, escaped with exactly `& < > "` (both languages, so output matches byte for byte).
- Links, codes and the footer never come from copy.
- A failed override read sends the defaults.
- Release 0.5.0: `frontend/package.json` + lockfile and `backend/main.py` together.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A username or address with `<`, `&` or `"` must come out escaped in HTML and unchanged in text.
2. An override that drops a placeholder, or a copy edit with only spaces, must not produce a broken email (`set` refuses empty; a missing value in a required slot renders empty, never `{name}`).
3. The Python and JS renderers must produce identical HTML for the same input (golden files).
4. The database being unreachable must not block a reset email.
5. The invite still carries the code and link in its text version (existing tests).

## Interfaces

- JS `renderEmail(name, values, overrides = {}, origin = "") -> { subject, html, text }`; `loadOverrides(pool, name) -> Promise<object>` (never throws); `composeEmail(pool, name, values, origin) -> Promise<{ subject, html, text }>`.
- Python `emails.render.render(name, values, overrides=None, origin="") -> dict(subject, html, text)`; `overrides(name) -> dict` (never raises); `compose(name, values, origin="") -> dict`; `DECK` (the parsed copy.json).
- Values: `url` always; `username`, `email`, `newEmail` per email; invite `code`, `expires` (formatted date string), `uses` (string, only when > 1).

---

### Task 1: Layout, deck, JS renderer, golden files

**Files:** create `auth/src/emails/{layout.html,copy.json,render.js,render.test.js,golden/*}`.

- [ ] Write `render.test.js` first: golden match for verify, reset, change, invite (fixture values below); escaping; bold placeholder; override replaces a default; optional lines left out without `expires`/`uses`; `loadOverrides` maps rows and returns `{}` when the pool throws.
- [ ] Run `cd auth && node --test src/emails/render.test.js`; expect failure (no module).
- [ ] Write `layout.html` (C3; blocks `<!-- block NAME -->…<!-- end -->` for detail, link, code, line, note), `copy.json` (the spec's table), `render.js`.
- [ ] Generate golden files once from `renderEmail` with the fixtures, read them, then run the test: pass.
- [ ] Fixtures: origin `https://mygist.example.com`; verify `{username:"sam", email:"sam@example.com", url:"https://mygist.example.com/auth/verify-email?token=T"}`; reset `{username:"sam", url:".../auth/reset-password/T"}`; change `{username:"sam", newEmail:"sam@new.example", url:".../auth/verify-email?token=T"}`; invite `{code:"7KQ2-MXH4", url:".../app/?invite=7KQ2-MXH4", expires:"1 November 2026", uses:"3"}`.
- [ ] Commit `feat: email layout, copy deck and renderer`.

### Task 2: Python renderer, identical files

**Files:** create `backend/emails/{__init__.py,layout.html,copy.json,render.py,golden/*}` (copies), `backend/tests/test_emails.py`.

- [ ] Test first: identical files across the two folders; Python render matches the golden files; escaping; `overrides()` returns `{}` when `db.get_pool` raises.
- [ ] Run, see it fail; write `render.py`; pass.
- [ ] Commit `feat: the same renderer for the backend`.

### Task 3: Overrides table, sending

**Files:** `backend/migrations/versions/0013_email_copy.py`; `auth/src/auth.js` (three senders); `backend/mailer.py` (`html`); `backend/scripts/access.py` (invite); tests: `test_emails.py` (override read from the table), `test_mailer.py` (html in payload), `test_access_waitlist.py` (invite tests on the new shape).

- [ ] Tests first; run; fail.
- [ ] Migration, wiring; `cd auth && npm test`, backend tests for emails, mailer, access, migrations; pass.
- [ ] Commit `feat: emails send as HTML and read copy edits from the database`.

### Task 4: `scripts/emails.py`

**Files:** create `backend/scripts/emails.py`, `backend/tests/test_emails_cli.py`.

- [ ] Tests first: list marks edits; `show`; `set` refuses unknown email, unknown slot, unknown placeholder, empty, over 1,000; warns on an em dash and saves; `unset`; `preview` writes `.html` and `.txt`; `send-test` calls the mailer with "[Test] " and html.
- [ ] Run; fail; write; pass. Commit `feat: scripts/emails.py edits email copy without a deploy`.

### Task 5: Mark, docs, version

- [ ] `frontend/public/landing/email-mark.png`: the white mark, 40px, transparent, rendered with Playwright from `design/logos/mygist.svg`.
- [ ] Docs: `run/self-hosting.mdx` gains "Email copy" (the command, the table, the defaults); changelog `0.5.0` (emails, tour step). Docs build + links.
- [ ] Version 0.5.0. Commit.

### Task 6: Verification

- [ ] Full backend and frontend suites, `cd auth && npm test`.
- [ ] Local preview: `/landing/email-mark.png` is 200; `emails.py preview` for all four, screenshotted light and dark (Playwright `colorScheme`); a `set` then `preview` shows the edit; a reset on the preview logs the new text.
- [ ] Final review by a fresh reviewer; fix Critical/Important with tests.
