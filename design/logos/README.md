# Logos

Marks used on the landing page: the MyGist wordmark lockup in the nav and footer,
and a client mark inside each hero chip.

| File | Source | Used in |
|---|---|---|
| `mygist.svg` | copy of `frontend/public/logo.svg` | nav, footer, mobile nav |
| `claude.svg` | `cdn.simpleicons.org/claude` | hero chip, Consent bento visual |
| `raycast.svg` | `cdn.simpleicons.org/raycast` | hero chip |
| `notion.svg` | `cdn.simpleicons.org/notion` | hero chip |

## Two marks are still missing

`worldvectorlogo.com` — the source the owner asked for — sits behind Cloudflare
bot protection and returns **403 to every automated request**, search pages
included. Simple Icons covers three of the five clients but not these:

| Wanted | Why it isn't here |
|---|---|
| **OpenAI / Codex** | pulled from Simple Icons over a trademark request; `cdn.simpleicons.org/openai` 404s |
| **Hermes** (Nous Research) | never indexed by Simple Icons |

Both are **dashed monogram placeholders** in Figma right now, named
`Logo / Codex — PLACEHOLDER` and `Logo / Hermes — PLACEHOLDER`. They read as
obviously provisional rather than as finished marks, so nothing ships looking
wrong by accident.

To finish them: download both from worldvectorlogo into this folder as
`openai.svg` and `hermes.svg`, then replace the contents of those two Figma
components. Every chip that uses them updates automatically — the chip's `icon`
is a nested instance, so a swap at the component is enough.

## Note on the chip icons

`Client chip` carries a `showIcon` boolean. The "anything with MCP connectors"
chip sets it to `false`, since that one names no brand.

The icon slot is a nested instance swapped per chip rather than an
`INSTANCE_SWAP` component property. That was the first attempt and it failed —
`addComponentProperty` rejects the key of an unpublished local component, and
this library isn't published. If the file is ever published, the property is
worth revisiting.

## Trademark

These are third-party marks used nominatively, to say which clients MyGist
works with. That is normally fine for compatibility claims, but it is not a
licence — check each brand's guidelines before the page goes live, and keep the
marks unmodified apart from size.
