/**
 * The email renderer. The golden files are the contract with backend/emails:
 * render.py must produce them byte for byte, so a preview from
 * scripts/emails.py is what this service actually sends.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadOverrides, renderEmail } from "./render.js";

const golden = (name, ext) => readFileSync(new URL(`./golden/${name}.${ext}`, import.meta.url), "utf8");
// Shared with backend/emails/golden, and the sample values scripts/emails.py previews with.
const { origin: ORIGIN, values: FIXTURES } = JSON.parse(golden("fixtures", "json"));

for (const name of Object.keys(FIXTURES)) {
  test(`${name} matches its golden files`, () => {
    const out = renderEmail(name, FIXTURES[name], {}, ORIGIN);
    assert.equal(out.html, golden(name, "html"));
    assert.equal(out.text, golden(name, "txt"));
  });
}

test("placeholder values are escaped and bold in HTML, plain in text", () => {
  const out = renderEmail("reset", { username: '<b>"sam" & co</b>', url: "https://x.example/?a=1&b=2" }, {}, ORIGIN);
  assert.ok(out.html.includes("<b>&lt;b&gt;&quot;sam&quot; &amp; co&lt;/b&gt;</b>"));
  assert.ok(out.html.includes('href="https://x.example/?a=1&amp;b=2"'));
  assert.ok(out.text.includes('<b>"sam" & co</b>'));
  assert.ok(!out.html.includes("{username}"));
});

test("an edit replaces the default, and copy itself is escaped", () => {
  const out = renderEmail("reset", FIXTURES.reset, { heading: "New <password>" }, ORIGIN);
  assert.ok(out.html.includes("New &lt;password&gt;"));
  assert.ok(out.text.startsWith("New <password>\n"));
});

test("an optional line with no value is left out", () => {
  const { expires, uses, ...rest } = FIXTURES.invite;
  const out = renderEmail("invite", rest, {}, ORIGIN);
  assert.ok(!out.text.includes("stops working"));
  assert.ok(!out.text.includes("good for"));
  assert.ok(out.text.includes("7KQ2-MXH4"));
});

test("a required slot with no value renders empty, never the raw placeholder", () => {
  const out = renderEmail("reset", { url: FIXTURES.reset.url }, {}, ORIGIN);
  assert.ok(!out.html.includes("{username}"));
  assert.ok(!out.text.includes("{username}"));
});

test("loadOverrides maps the rows, and a failed read means the defaults", async () => {
  const pool = { query: async () => ({ rows: [{ slot: "heading", value: "Hi" }] }) };
  assert.deepEqual(await loadOverrides(pool, "reset"), { heading: "Hi" });
  const broken = { query: async () => { throw new Error("down"); } };
  assert.deepEqual(await loadOverrides(broken, "reset"), {});
});

test("an optional line without its value is left out, even when edited", () => {
  const { expires, uses, ...rest } = FIXTURES.invite;
  const out = renderEmail("invite", rest, { expires: "It expires soon.", uses: "Share it." }, ORIGIN);
  assert.ok(!out.text.includes("expires soon") && !out.text.includes("Share it"));
});
