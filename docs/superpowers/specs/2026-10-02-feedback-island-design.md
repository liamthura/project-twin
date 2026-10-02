# Feedback island

**Date:** 2026-10-02
**Status:** Design agreed in chat; spec awaiting review
Release target **0.4.0**.

## Problem

Someone using MyGist has no way to say something broke, or that they'd like
something, without leaving the app and finding an address. Error tracking is
deferred, so a report from the person is the only way a failure reaches the
owner at all. Today an error toast says "Failed to save" and the only people
who know are the one who saw it and nobody else.

## Decisions already made

| Question | Decision |
|---|---|
| Where a report lands | Saved in Postgres **and** emailed to the owner through Resend |
| What the form asks | Kind (Problem, Idea, Something else), a message, an optional screenshot |
| How a screenshot gets in | Attached or pasted; the browser shrinks and re-encodes it. No page capture |
| Where the screenshot is kept | In the report's row (`bytea`), deleted with the account |
| Where it lives in the UI | A floating island, bottom right, signed-in screens only |
| Who it is | Attached by the server from the session. The form never asks |
| Error toasts | Every destructive toast gets a Report action that opens the island, prefilled |
| How the owner reads them | The email, plus `backend/scripts/feedback.py` (no admin UI) |

## Design

### 1. The island

A rounded pill, icon and label, fixed to the bottom right.

- **Label:** `MessageSquare` icon and "Feedback". Labelled, not icon-only: a
  speech bubble alone does not say what it does.
- **Position:** `right: calc(1rem + env(safe-area-inset-right))`,
  `bottom: calc(1rem + env(safe-area-inset-bottom))`. `z-30`: above the
  header (`z-20`), below dialogs (`z-50`) and driver.js, so a dialog or tour
  always covers it. Toasts are bottom left (`components/ui/toaster.jsx`), so
  the two never meet. Hidden in print.
- **Where it shows:** every signed-in screen. The editor, Review, Settings,
  and onboarding, because Connect is where people get stuck. It is rendered by
  `App.jsx` in both the main shell and the onboarding branch, and nowhere that
  renders `WelcomeAuth`, the landing page or the invite gate.
- **Review's selection bar.** The bar (`ProposalsPanel.jsx`, sticky
  `bottom-4`) puts Approve and Reject where the island sits. The bar gets
  `data-selection-bar`, and one CSS rule lifts the island above it:
  `body:has([data-selection-bar]) .feedback-island { bottom: calc(5.5rem + env(safe-area-inset-bottom)) }`.
  No JavaScript.
- **The end of a page.** `#main-content` and the onboarding column get
  `pb-24`, so the last field or button on any page scrolls clear of it.

### 2. Opening it

- Radix Popover (`components/ui/popover.jsx`), the pill as its trigger,
  `side="top" align="end"`. It brings Esc, outside click, focus moved in and
  focus returned to the pill on close.
- The panel grows from the pill's corner: `origin-bottom-right` with the
  popover's existing fade and zoom, and the pill hidden (`invisible`) while it
  is open, so the panel reads as the island opening. `motion-reduce:animate-none`.
- **Size:** `w-[380px]` on desktop; `w-[calc(100vw-2rem)]` on phones;
  `max-h-[calc(100dvh-6rem)]` with its own scroll.
- **Focus** goes to the message box on open.
- **Draft:** state lives in the island, which stays mounted while signed in.
  Closing keeps what was typed and the screenshot; a successful send clears
  them. A reload or sign-out loses them.
- **Phones and the on-screen keyboard.** Browser tests cannot raise an iOS
  keyboard. If on a real iPhone the keyboard covers Send, the phone version
  opens the same form in the app's Dialog instead. Recorded as a check for the
  owner, not built up front.

### 3. The form

```
┌──────────────────────────────────────┐
│ Send feedback                     ✕  │
│                                      │
│ [ Problem | Idea | Something else ]  │
│                                      │
│ What happened?                       │
│ ┌──────────────────────────────────┐ │
│ │ What you did, what you expected, │ │
│ │ and what happened instead.       │ │
│ └──────────────────────────────────┘ │
│ [▣ Add a screenshot]  or paste one   │
│                                      │
│ Sent with this report: ...           │
│ Replies go to sam@example.com.       │
│                              [Send]  │
└──────────────────────────────────────┘
```

- **Kind:** the app's segmented control (`components/ui/segmented-control.jsx`),
  starting on Problem.
- **Message:** a textarea, 1 to 5,000 characters. Its label and placeholder
  follow the kind (copy in section 7). Send is disabled while it is empty.
- **Screenshot:**
  - "Add a screenshot" opens a file picker (`accept="image/*"`). Pasting an
    image into the message box does the same; pasted text still pastes.
  - The browser decodes it (`createImageBitmap`), scales the long edge to at
    most 2000 px, and re-encodes to JPEG at 0.9 on a canvas. Re-encoding drops
    EXIF, which is where a phone photo keeps its location. If the result is over
    2 MB it tries 0.7 once, then refuses.
  - A thumbnail with a Remove button replaces the button. One screenshot per
    report; adding another replaces it.
  - Under it, the privacy note. It is shown only once a screenshot is attached.
- **What's attached** is said in one line, always visible.
- **Replies:** a line that names the address replies go to, or says there is
  none and links to Settings → Account (`onOpenSettings("account")`). The
  address is the session's email; a placeholder (`isPlaceholderEmail`,
  `@mygist.invalid`) counts as none.
- **Sending:** the button reads "Sending…" and the form is read-only until the
  answer. Success closes the panel, clears the draft, and shows a toast. Failure
  keeps the panel open with everything in it and an error line above Send.

### 4. Report from an error toast

`components/ui/use-toast.js`'s `toast()` gives every `variant: "destructive"`
toast that has no `action` of its own a Report action. All 14 destructive
toasts in the app are failures ("Failed to save", "Restore failed", "That did
not go through"), so this is one change, not fourteen.

Report closes the toast and opens the island with Problem chosen and the
message prefilled as:

```
The app said: "Failed to save. Could not reach the server."

```

with the cursor on the blank line below. The toast and the island talk through
a `CustomEvent` (`mygist:feedback`) on `window`, so the toast module does not
import React state from App.

### 5. `POST /api/feedback`

Signed in, like every `/api/*` route (the middleware already resolves the
user into `db.current_user_id`). JSON body:

```json
{
  "kind": "problem",
  "message": "…",
  "context": {
    "page": "#/review",
    "version": "0.4.0",
    "commit": "84883aa",
    "browser": "Mozilla/5.0 …",
    "screen": "1280×800"
  },
  "screenshot": "<base64 JPEG, optional>"
}
```

- **Validation** (`backend/feedback_store.py`), each a 400 with a plain
  message:
  - `kind` one of `problem`, `idea`, `other`.
  - `message` stripped, 1 to 5,000 characters.
  - `context`: only the five keys above are kept, each a string cut to 500
    characters. Unknown keys are dropped, not rejected.
  - `screenshot`: valid base64, at most 2 MiB decoded, and its first bytes say
    PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`) or WebP
    (`RIFF....WEBP`). The type is read from the bytes, never from a field the
    client sends.
- **Limit:** 10 reports per account in the last hour, counted from the table.
  The 11th is a 429. This keeps a stuck retry loop from filling the owner's
  inbox, and needs no new infrastructure.
- **Save**, then **reply 200** with `{"id": N}`.
- **Email** after the response, as a FastAPI `BackgroundTasks` job, so the
  person never waits on Resend. A failed send is logged with the report's id
  and nothing else: the report is saved, and `feedback.py` lists it.

### 6. Storage and the email

**Migration `0012_feedback`:**

```sql
create table feedback (
    id          bigserial primary key,
    user_id     uuid not null references users(id) on delete cascade,
    kind        text not null check (kind in ('problem', 'idea', 'other')),
    message     text not null,
    context     jsonb not null default '{}',
    screenshot  bytea,
    screenshot_type text,
    created_at  timestamptz not null default now(),
    handled_at  timestamptz
);
create index feedback_user_created on feedback (user_id, created_at desc);
```

`on delete cascade` from `users` is what deletes a person's reports and
screenshots with their account: `db.delete_account` deletes the `users` row,
and every other table that cascades from it goes too. No change to
`delete_account`.

Who sent it is not copied into the row. The username and email are read from
`users` and `better_auth."user"` when the email is built and when the script
lists reports, so the row holds the account id and nothing else about the
person.

**The mailer.** `send_email` moves out of `backend/scripts/access.py` into
`backend/mailer.py`, keeping its browser-like User-Agent (Cloudflare bans
`Python-urllib`) and its "print instead of send when unset" behaviour. It
gains `reply_to` and `attachments` (`[{"filename", "content"}]`, base64, as
Resend's API takes them). `access.py` imports it from there.

**The email to the owner:**

- **To:** `FEEDBACK_TO`, a new environment variable on the API app. Unset, the
  email is logged instead, the same as `RESEND_API_KEY` or `EMAIL_FROM` unset.
  Staging and local preview log; production needs `FEEDBACK_TO` set.
- **Reply-To:** the account's email, unless it is a placeholder: it ends in
  `@mygist.invalid`, the `PLACEHOLDER_DOMAIN` of `frontend/src/lib/session.js`,
  mirrored as a constant in `feedback_store.py`.
- **Subject:** `[MyGist] Problem: {first line of the message, 60 characters}`.
- **Body** (plain text):

```
{message}

From: {username} ({email, or "no recovery email"})
Page: #/review
Version: 0.4.0 (84883aa)
Browser: Mozilla/5.0 …
Screen: 1280×800

Report 42. Mark it handled with:
python scripts/feedback.py done 42
```

- **Attachment:** `feedback-42.jpg` (or `.png`/`.webp`, from the bytes),
  when there is a screenshot.

### 7. Copy

Plain British English, no em dashes. Every claim is checked against the code
named in `source`.

| Where | Copy | source |
|---|---|---|
| Island | Feedback | |
| Panel title | Send feedback | |
| Close button (aria-label) | Close feedback | |
| Kind group (sr-only label) | Kind of feedback | |
| Kind options | Problem · Idea · Something else | `feedback_store.KINDS` |
| Message label, Problem | What happened? | |
| Message placeholder, Problem | What you did, what you expected, and what happened instead. | |
| Message label, Idea | What's your idea? | |
| Message placeholder, Idea | What it would let you do. | |
| Message label, Something else | What's on your mind? | |
| Screenshot button | Add a screenshot | |
| Screenshot hint | or paste one into the box | paste handler |
| Thumbnail alt | Your screenshot | |
| Remove button | Remove | aria-label "Remove screenshot" |
| Screenshot note | A screenshot shows everything on your screen, so crop out anything you'd rather not send. | |
| What's attached | Sent with this report: your username, the page you're on, the MyGist version, and your browser and screen size. Nothing from your persona is included. | `FeedbackIsland` context, `feedback_store.CONTEXT_KEYS` |
| Replies, with email | Replies go to {email}. | session email, Reply-To |
| Replies, without | There's no recovery email on your account, so there's nowhere to send a reply. Add one | link to Settings → Account |
| Send | Send / Sending… | |
| Success toast | Thanks. Your feedback is in. | |
| Error, network or 5xx | Couldn't send. Your message is still here, so try again. | |
| Error, 429 | That's 10 reports in the last hour. Try again later. | `feedback_store.HOURLY_LIMIT` |
| Error, image too big | That image is too large, even after shrinking. Try cropping it. | 2 MiB |
| Error, image unreadable | That image couldn't be read. Try a PNG or JPEG. | `createImageBitmap` rejects |
| Toast action | Report | `use-toast.js` |
| Prefill | The app said: "{title}. {description}" | |

### 8. `backend/scripts/feedback.py`

Same gate as `access.py`: it runs where `DATABASE_URL` is, which is the
authorisation model.

```
python scripts/feedback.py              # open reports, newest first
python scripts/feedback.py --all        # handled ones too
python scripts/feedback.py show 42      # one report in full; writes feedback-42.jpg if it has one
python scripts/feedback.py done 42      # mark handled
```

The list is a table: id, when, kind, username, first line, drawn with
`table()` imported from `scripts/access.py`.

## Files

| File | Change |
|---|---|
| `backend/migrations/versions/0012_feedback.py` | New table |
| `backend/feedback_store.py` | New: `KINDS`, `CONTEXT_KEYS`, `HOURLY_LIMIT`, `validate`, `save`, `recent_count`, `sender`, `list_reports`, `get_report`, `mark_handled` |
| `backend/mailer.py` | New: `send_email(to, subject, text, reply_to=None, attachments=None) -> bool`, moved from `access.py` |
| `backend/scripts/access.py` | Imports `send_email` from `mailer` |
| `backend/scripts/feedback.py` | New CLI |
| `backend/main.py` | `FeedbackRequest`, `POST /api/feedback`, version 0.4.0 |
| `backend/tests/test_feedback.py` | New |
| `frontend/src/lib/feedback.js` | New: `sendFeedback`, `shrinkImage`, `openFeedback(prefill)`, `FEEDBACK_EVENT` |
| `frontend/src/components/FeedbackIsland.jsx` | New, with its test |
| `frontend/src/components/ui/use-toast.js` | Report action on destructive toasts |
| `frontend/src/components/ProposalsPanel.jsx` | `data-selection-bar` on the bar |
| `frontend/src/App.jsx` | Render the island in the shell and onboarding; `pb-24` |
| `frontend/src/components/onboarding/OnboardingFlow.jsx` | `pb-24` on the column |
| `frontend/src/styles/globals.css` | The `:has()` lift |
| `frontend/package.json`, lockfile | 0.4.0 |
| `backend/.env.example` | `FEEDBACK_TO`, and the `RESEND_API_KEY` and `EMAIL_FROM` the API now reads |
| `docs-site/content/docs/run/troubleshooting.mdx` | "Reporting a problem": the island, what it sends |
| `docs-site/content/docs/changelog.mdx` | 0.4.0 |

## Testing

**Backend** (`test_feedback.py`, against the test database):

- A valid report is saved with the account's id and returns its id.
- Rejected with 400: an unknown kind; an empty or whitespace message; 5,001
  characters; bad base64; a 2 MiB + 1 byte image; a PNG-named file whose bytes
  are text.
- Unknown context keys are dropped and long values cut to 500.
- The 11th report in an hour is a 429; one from another account still goes.
- `delete_account` removes the account's reports.
- The email: Reply-To is the real email and absent for a placeholder; the
  attachment's extension follows the bytes; a mailer that raises still leaves
  a 200 and a saved row; with `FEEDBACK_TO` unset nothing is sent.
- `mailer.send_email` sends `reply_to` and `attachments` in Resend's shape;
  `access.py`'s invite still sends.
- `feedback.py`: list hides handled reports, `--all` shows them, `done` sets
  `handled_at`, `show` writes the image.

**Frontend** (Vitest):

- The island renders for a signed-in user and opens and closes; Esc keeps the
  draft; a successful send clears it.
- The label and placeholder follow the kind.
- Attach and paste each produce a thumbnail; Remove clears it; pasting text
  does not attach anything.
- `shrinkImage` scales to 2000 px and outputs JPEG (canvas mocked).
- The reply line names a real email and links to Account for a placeholder.
- A 429 and a network failure each keep the message and show their line.
- A destructive toast without an action gets Report; one with its own action
  keeps it; Report opens the island prefilled.

**Walkthrough** on the local preview (`scripts/local-preview.sh`), throwaway
account deleted after:

- Desktop 1280 and phone 390: the island, open, attach, send, the row in the
  database, the logged email.
- Review with items selected: the island sits above the bar.
- Onboarding Connect: the island does not cover Continue at the end of the page.
- A forced save failure: the toast's Report opens a prefilled island.
- The built bundle carries the copy and no em dashes.

## Out of scope

- A page where people see their past reports or a status.
- Replying from inside the app.
- An admin screen.
- Capturing the page automatically.
- Including reports in the data export. A report is written to the owner, not
  part of the persona.
- Feedback from signed-out visitors.
