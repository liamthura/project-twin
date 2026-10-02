# Email templates

**Date:** 2026-10-02
**Status:** Design agreed in chat (visual companion: direction C3, "slim band"); spec awaiting review
Release target **0.4.2** (ships with the unreleased editor-tour step on `feat/feedback-tour`).

## Problem

MyGist's four emails to people are plain text written inline in code. They do
not look like MyGist, three carry em dashes against house style, and changing a
word means a deploy.

## Decisions already made

| Question | Decision |
|---|---|
| Which emails | Confirm email, reset password, approve email change (auth service) and the invite (backend). The owner's feedback email stays plain text. |
| Look | C3: a slim blue band with the white mark and "MyGist", a white card, the heading in the body, a full-width button, a hairline before the "didn't ask" note, the host in the footer. Light and dark. |
| Sharing across two services | One layout file and one copy deck, present in both `auth/src/emails/` and `backend/emails/`, kept identical by a test (the auth image builds from `auth/` only). |
| Template tool | None. Hand-written table HTML; React Email at design time later if a long email (a digest) arrives. |
| Changing copy | Without a deploy: overrides in a database table, defaults in the deck, edited with `backend/scripts/emails.py`. |

## Design

### 1. Files

```
auth/src/emails/layout.html   C3 page, plus named blocks (detail, link, code, line, note)
auth/src/emails/copy.json     every email's default slots, its placeholders, its optional slots
auth/src/emails/render.js     renderEmail, loadOverrides, composeEmail
auth/src/emails/golden/       the four emails rendered from fixture values, .html and .txt
backend/emails/layout.html    identical
backend/emails/copy.json      identical
backend/emails/render.py      render, overrides, compose
backend/emails/golden/        identical
```

### 2. The layout

- Table-based, 520px max, inline styles as the base, a `<style>` block with
  `@media (prefers-color-scheme: dark)` overrides keyed on classes, and
  `<meta name="color-scheme" content="light dark">`. Colours are the app's:
  band and button `#3d5ddb` (dark `#3550c4` / `#4f6ef0`), ink `#1c1a18`, muted
  `#706b66`, hairline `#e7e5e3`, page `#ececea` (dark `#121211`, card `#1c1b1a`).
- The mark is a PNG, `{origin}/landing/email-mark.png` (Gmail and Outlook show
  no SVG), with "MyGist" as text beside it so nothing is lost with images off.
  It lives in `frontend/public/landing/`, which the backend already serves.
- A hidden preheader carries the intro, so the inbox line reads as a sentence.
- Slots the renderer fills, each `{{name}}`: subject, preheader, mark, heading,
  intro, button, url, detail, code, note, footer.

### 3. The copy deck and its rules

Each email has `slots` (subject, heading, intro, button, detail, fallback,
note; the invite has expires and uses instead of fallback), `placeholders` it
may use, and `optional` slots.

- Copy is plain text, always escaped. A `{placeholder}` value is bold in HTML,
  plain in text.
- An optional slot whose placeholder has no value is left out (the invite's
  expiry and use count).
- Links, codes and the footer are values from code, never copy, so no edit can
  break or redirect a link.
- The text version: heading, intro, `button: url`, detail, code, optional
  lines, note, then `--` and the footer.

Default copy (house style, every claim checked):

| Email | Heading | Intro | Button | Detail | Note |
|---|---|---|---|---|---|
| verify | Confirm your email | Confirm {email} for {username}. Then, if you ever forget your password, a reset can reach you here. | Confirm email | Works for the next hour. | Didn't add this address to MyGist? Ignore this email. Nothing changes unless the link is opened. |
| reset | Reset your password | Someone asked to reset the password for {username}. If it was you, choose a new one. | Choose a new password | Works once, for the next hour. | Didn't ask for this? Ignore this email. Your password still works and nothing has changed. |
| change | Approve the new address | {username} asked to move from this address to {newEmail}. Approve it, then confirm from the new address, and the change is made. | Approve the change | Works for the next hour. | Didn't ask for this? Someone is signed in to your account, because only they can ask. Ignore this email so nothing changes, then change your password in Settings → Account. |
| invite | You're invited | You asked for an invite, so here it is. Explain yourself once, and every assistant you connect reads the same persona. | Create your account | The button fills the code in. To type it by hand: | MyGist is invite-only while it is small. Thanks for waiting. |

Fallback (not the invite): "Or paste this into your browser:". Invite
optional lines: "It stops working on {expires}." and "It is good for {uses}
accounts." Subjects are unchanged from today.

Sources: an hour is Better Auth's default for both token kinds
(`resetPasswordTokenExpiresIn || 3600`, `createEmailVerificationToken(..., expiresIn = 3600)`),
not overridden in `auth/src/auth.js`; changing email needs a session
(`update-user.mjs` reads `ctx.context.session`); approving sends a verification
to the new address before the change (`email-verification.mjs`,
`change-email-confirmation`); Settings → Account has Change password
(`AccountPanel.jsx`).

### 4. Changing copy without a deploy

- **Migration 0013 `email_copy`:** `email text, slot text, value text not null,
  updated_at timestamptz default now(), primary key (email, slot)`. Empty means
  every default.
- **Read at send time** by both services (`public.email_copy`), so an edit
  applies to the next email. A failed read logs and sends the defaults.
- **`backend/scripts/emails.py`**, run where the database is:
  `(no args)` lists emails and slots with edits marked; `show NAME`;
  `set NAME SLOT TEXT`; `unset NAME SLOT`; `preview NAME [--out DIR]` writes
  `NAME.html` and `NAME.txt` from sample values; `send-test NAME ADDRESS` sends
  them through Resend with "[Test] " on the subject.
- **`set` checks:** the email and slot exist; every placeholder is on the
  email's list; not empty; at most 1,000 characters. An em dash prints a
  warning and is still saved.

### 5. Sending

- Auth: `sendVerificationEmail`, `sendResetPassword`, `sendChangeEmailConfirmation`
  call `composeEmail(pool, name, values, baseURL)` and send `subject`, `text`,
  `html` through the existing mailer. `username` falls back to the account's
  name, then its email.
- Backend: `mailer.send_email` gains `html`; `access.py`'s invite sends the
  rendered invite. The feedback email is unchanged.

## Testing

- JS and Python renderers each match the golden files for all four emails; the
  golden files, layout and deck are identical across the two folders.
- Escaping (a `<script>` username), bold placeholders, an override replacing a
  default, optional lines left out, a failed override read still rendering.
- CLI: each `set` refusal, `unset`, `show`, `preview` writing both files,
  `send-test` calling the mailer with the test subject.
- Existing invite tests (code and link in the email, expiry stated) still pass
  against the new rendering.
- By hand: previews screenshotted light and dark; after release, `send-test`
  to a real Gmail and Outlook inbox.

## Out of scope

- Editing the layout without a deploy; an admin screen; per-instance branding.
- The feedback email.
- Localisation.
