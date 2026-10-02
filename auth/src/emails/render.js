/**
 * The emails people get, as HTML and text, from one layout and one copy deck.
 *
 * layout.html and copy.json are also in backend/emails, which renders the
 * invite with render.py by the same rules; the golden files hold the two to
 * the same output. Copy is plain text and always escaped. A {placeholder}'s
 * value is bold in HTML. Links, codes and the footer come from the caller,
 * never from copy, so no edit can break or redirect a link.
 *
 * Edits live in public.email_copy (backend/scripts/emails.py) and are read at
 * send time, so a change applies to the next email without a deploy.
 */
import { readFileSync } from "node:fs";

const DECK = JSON.parse(readFileSync(new URL("./copy.json", import.meta.url), "utf8"));
const SOURCE = readFileSync(new URL("./layout.html", import.meta.url), "utf8");
const BLOCK = /<!-- block (\w+) -->\n([\s\S]*?)<!-- end -->\n/g;
const BLOCKS = Object.fromEntries([...SOURCE.matchAll(BLOCK)].map(([, name, body]) => [name, body]));
const PAGE = SOURCE.replace(BLOCK, "");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (template, map) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => map[key] ?? "");

// One slot's words with its placeholders filled; null when the slot is absent,
// or optional and missing a value.
function words(entry, overrides, slot, values, html) {
  const raw = overrides[slot] ?? entry.slots[slot];
  if (raw == null) return null;
  let missing = false;
  const out = raw
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return html ? esc(part) : part;
      const value = values[m[1]];
      if (value == null || value === "") {
        missing = true;
        return "";
      }
      return html ? `<b>${esc(value)}</b>` : String(value);
    })
    .join("");
  return missing && entry.optional.includes(slot) ? null : out;
}

export function renderEmail(name, values, overrides = {}, origin = "") {
  const entry = DECK[name];
  const w = (slot, html = true) => words(entry, overrides, slot, values, html);
  const footer = origin ? `MyGist · ${new URL(origin).host}` : "MyGist";
  const url = esc(values.url);
  const detail = [w("detail"), w("fallback")].filter(Boolean).join(" ");
  const lines = entry.optional.map((slot) => w(slot)).filter(Boolean);
  const html = fill(PAGE, {
    subject: esc(w("subject", false)),
    preheader: esc(w("intro", false)),
    mark: esc(`${origin}/landing/email-mark.png`),
    heading: w("heading"),
    intro: w("intro"),
    button: w("button"),
    url,
    detail: (detail ? fill(BLOCKS.detail, { detail }) : "") + (w("fallback") ? fill(BLOCKS.link, { url }) : ""),
    code: values.code
      ? fill(BLOCKS.code, { code: esc(values.code) }) + lines.map((line) => fill(BLOCKS.line, { line })).join("")
      : "",
    note: w("note") ? fill(BLOCKS.note, { note: w("note") }) : "",
    footer: esc(footer),
  });
  const text = [
    w("heading", false),
    w("intro", false),
    `${w("button", false)}: ${values.url}`,
    w("detail", false),
    values.code || null,
    ...entry.optional.map((slot) => w(slot, false)),
    w("note", false),
    `--\n${footer}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject: w("subject", false), html, text: `${text}\n` };
}

/** This email's edited slots. A failed read is the defaults, never a lost email. */
export async function loadOverrides(pool, name) {
  try {
    const { rows } = await pool.query("select slot, value from public.email_copy where email = $1", [name]);
    return Object.fromEntries(rows.map((r) => [r.slot, r.value]));
  } catch (err) {
    console.warn(`[email] could not read email_copy for ${name}, sending the defaults: ${err.message}`);
    return {};
  }
}

export async function composeEmail(pool, name, values, origin) {
  return renderEmail(name, values, await loadOverrides(pool, name), origin);
}
