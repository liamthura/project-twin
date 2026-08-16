# Screenshots

Drop PNGs here and reference them from MDX as `/screenshots/<name>.png` via the
`<Screenshot src="..." />` component. The component adds the site's basePath, so
write the path as it sits in `public/`. Any `<Screenshot>` without a `src`
renders a labelled placeholder, so the outstanding shots are visible in the
built site.

## What is here

Every shot is the real editor, captured with Playwright against a preview
running from `scripts/local-preview.sh`, signed in as a demo account holding a
made-up persona. Light theme, 2× device pixel ratio, and 1280×800 for the
desktop views.

| File | Shows |
|---|---|
| `welcome-signup.png` | The unauthenticated sign-up screen |
| `editor-overview.png` | Profile, nothing expanded — the editor at a glance |
| `profile-section.png` | Profile, with a work experience entry open |
| `editor-section-open.png` | Goals: one section, one list of entries |
| `editor-entry-expanded.png` | A project row open: detail fields, tags, nested lists |
| `editor-phone.png` | The editor at 390×844, section dropdown collapsed |
| `learning-log-entry.png` | A learning log entry open |
| `sections-manager.png` | The Sections manager, one opt-in section off |
| `settings-tokens.png` | Settings → Tokens: the list and the create form |
| `settings-tokens-new.png` | The one look at a new token's secret |
| `settings-data.png` | Settings → Data: export, import, import mode |

## The conversation figures

`chat-*.png` are **illustrations, not screenshots**, and are wired up with
`<Screenshot illustration>` so the caption says so. No chat client ships with
this project, and faking one client's chrome would be both misleading and
somebody else's trademark, so the frame is drawn — deliberately plain, with no
window furniture and no product name.

Tool calls render the way real clients render them: collapsed to one row with
the tool name, a query chip and a check, request and result tucked behind a
disclosure. Two figures show a call opened, because in those two the payload is
the lesson — an empty persona, and the shape of a write. The rest stay shut,
which is what a reader would actually see.

What is inside the frame is real. Every call and every result was captured from
`/mcp` on a running preview, over JSON-RPC, against the same demo persona: the
`✅ Added domain: Rust` line is what the server returned. Only the assistant's
prose is written, and it is held to one rule — it says nothing the tool call
above it did not return. That rule is load-bearing: `minimal` scope does not
include `organisation`, so the assistant says "a marketing assistant in
Manchester" rather than naming the studio.

| File | Shows |
|---|---|
| `chat-assistant-answering.png` | `get_context` behind a planning question |
| `chat-what-it-knows.png` | "What do you know about me?" against a filled persona |
| `chat-fresh-account.png` | The same question against an empty one |
| `chat-several-writes.png` | Five `persona_modify` calls in one turn |
| `chat-write-confirmed.png` | One write, with its confirmation |
| `chat-search-and-fetch.png` | `search_context`, then `get_entity` |

To redo them, re-run the capture against a preview rather than editing the PNGs:
the point of the exercise is that the payloads are not invented.
