# Copy Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the user-facing copy on the landing page, the docs site and the READMEs so it reads as though a person wrote it, without losing a single technical claim.

**Architecture:** Three independent slices, three branches, three PRs. Slice 1 is the landing page (~700 words, all in one copy deck). Slice 2 is 21 docs pages. Slice 3 is the READMEs plus the stale-skills defect the README survey uncovered. Each slice has a mechanical gate that fails loudly, so "did the copy break something" is never answered by reading.

**Tech Stack:** Plain strings in `frontend/src/landing/content.js`; MDX under `docs-site/content/docs/`; Markdown at the repo root. Vitest for the landing, `next build` + `check-links.mjs` for the docs, pytest for slice 3.

## Global Constraints

Every task's requirements implicitly include this section. Full reasoning in `docs/superpowers/specs/2026-08-14-copy-rewrite-design.md`.

- **Rhetorical contrast out, substantive negation stays.** Delete the negative half. If nothing is lost, it was rhythm and goes. If a reader could now get it wrong, it was a warning and stays. `--recreate is not enough on its own`, `Nothing reads your messages in the background` and `broken, not degraded` all stay.
- **Headings are noun phrases.** No editorial, no sentences, no em dashes, no promise about how useful the section is.
- **Em dashes:** zero in `content.js`; zero in any heading or frontmatter `description`; at most two per docs page body.
- **Bold lead-ins:** a run of parallel bold points becomes real `###` headings or a table. A single bold gloss sitting under its own heading just loses the bold. Bold survives for UI labels (`Account → API tokens`), a term's first definition, and one-word emphasis inside a callout.
- **No dramatic fragments, colon reveals, or faux-insight openers.**
- **Every technical claim survives verbatim.** No file path, number, tool name, environment variable, flag or caveat is lost. No `source:` field in `content.js` is touched. A sentence may get shorter; it may not get vaguer. Where reading better would cost a concrete detail, the detail wins and the sentence stays long.
- **British English, second person, present tense.**
- **Copy strings in `content.js` render as plain text** (`{tile.body}`, `{item.a}` in `Bento.jsx:47` and `Faq.jsx:110`). No backticks, no markdown, no HTML entities.
- **Do not run `npx prettier`.** No prettier config exists in this repo; it reformats untouched code. `WelcomeAuth.jsx` lost 63 lines to this two days ago.
- **Do not modify the `overrides` block in `frontend/package.json`.**
- **Before pushing any slice:** `git diff main...<branch> | grep -nEi '(mg_[A-Za-z0-9_-]{20,}|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|secret\s*=)'`
- Commit messages end `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. PR bodies end `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

# Slice 1 — Landing page

Branch: `copy/landing-rewrite` (already created; the spec is committed on it).

## File Structure

- Modify: `frontend/src/landing/content.js` — the whole copy deck. Every landing string except three.
- Modify: `frontend/src/landing/Hero.jsx:132` — the one inline string, `"One URL. Any client that speaks MCP picks it up."`
- Leave alone: `Nav.jsx` (`Docs`, `Sign in`, `Join the waitlist`, `Join` — all correct), `WaitlistForm.jsx` (three status messages, two of them regex-asserted in tests and all three already plain).
- Leave alone: every code comment. They carry the same patterns and no reader outside the repository sees them; touching them buries the prose diff.

### Task 1: Rewrite the copy deck

**Files:**
- Modify: `frontend/src/landing/content.js`
- Test: `frontend/src/landing/Landing.test.jsx`, `frontend/src/landing/gate.test.jsx` (both existing; no new tests)

**Interfaces:**
- Consumes: nothing.
- Produces: the exported shapes are unchanged — `HERO`, `CLIENTS`, `STEPS`, `BENTO`, `FAQ`, `CLOSING`, `FOOTER`, with every key and every `source`/`span`/`id`/`slug`/`mark`/`href` field identical. Only string values change. No consumer needs editing.

- [ ] **Step 1: Run the landing tests first, to know they pass before anything moves**

```bash
cd frontend && npm test -- --project unit --run src/landing
```

Expected: PASS. If anything fails now, stop and find out why before editing copy — a pre-existing failure attributed to this slice wastes the gate.

- [ ] **Step 2: `HERO` — no change except confirming it**

`eyebrow`, `headline`, `body`, `cta`, `emailPlaceholder`, `note` and `signIn` all stay exactly as they are. The headline is three words, sentence case, ends in a full stop, and is hardcoded in `gate.test.jsx:46,55,71`. It is already the target voice; changing it would cost three test edits for nothing.

- [ ] **Step 3: `STEPS` — tighten step one, keep the headline**

`STEPS.headline` stays `"Three steps."` Every section headline on this page ends in a full stop, so the stop is the page's punctuation system rather than a drama beat.

Change one string:

```js
    {
      title: "Write your gist.",
      body: "Your role, your stack, how you want answers written. Edit it by hand or in the web UI.",
    },
```

(was: `"… how you want answers written. Structured JSON, editable by hand or in the web UI."` — a verbless fragment. "Structured JSON" is not lost; `BENTO` and the FAQ both still say the storage format.)

Steps two and three are unchanged.

- [ ] **Step 4: `BENTO` — one standing sentence per tile**

`eyebrow`, `headline`, and every `id`, `span` and `source` are untouched. The seven `body` strings become:

```js
      body: "An assistant asks for a named scope and gets that slice. Minimal is your name and role; professional adds your tone rules and what you're working on.",
      // scoped-reads. Was 3 sentences, 40 words. Both worked examples kept.

      body: "MyGist returns ranked snippets first and fetches a whole entry only when one is needed, so a long persona never floods the conversation.",
      // search. Drops the "Ask for one thing, get one thing" rhythm opener.

      body: "Ten sections to start with, and adding an eleventh is one declarative file, so your gist can hold whatever you keep track of.",
      // sections

      body: "Nothing lands until you say so. An assistant that notices something durable proposes it, with its reasoning and a quote from you, and you approve, edit, or reject it for good.",
      // proposals. The opener stays -- it is the strongest line on the page.

      body: "Connecting takes one URL, and on the consent screen you choose whether a client can read, suggest changes for you to approve, or write directly.",
      // consent

      body: "Four short guides ship with MyGist, covering how to read a gist and what's worth proposing, so behaviour holds up whichever client you're in.",
      // skills

      body: "One Docker image serves the editor, the API and the MCP endpoint. Point it at your own Postgres and nobody else is hosting your data.",
      // self-host. Second sentence now matches the FAQ's wording for the same fact.
```

- [ ] **Step 5: `FAQ` — headline, and the two-sentence cap**

```js
  headline: "Common questions.",
  sub: "The nine that come up most. The rest are in the docs.",
```

(was `"Questions people actually ask."` — `actually` is an empty adverb, and the line implies other people's questions are fake.)

Every `q` is unchanged. Five `a` strings change:

```js
// Which AI clients does this work with?
a: "Anything that speaks MCP: Claude, Codex, Raycast, Notion AI, Hermes. Clients that speak OAuth connect with nothing but the URL, through a consent screen; anything without a browser uses a scoped token.",

// How is this different from my client's built-in memory?
a: "Built-in memory lives inside one product and stays there when you move tools. MyGist is a Postgres database you control, reachable by anything that speaks MCP, and structured enough that a client can ask for one slice of it.",

// Can I use it from more than one client?
a: "Yes. Issue a token each, point them at the same URL, and they share one persona with no sync step, because there is only one copy.",

// Does MyGist read my conversations?
a: "No. MCP tools only run when a client calls them, so MyGist never sees a message a client did not send it and there is no background process watching anything.",

// Can an assistant change my gist without asking?
a: "Only if you let it: a connection gets read-only, suggest-for-approval, or write-directly. Anything suggested sits in your review queue until you say yes.",

// Where does my data actually live?
a: "In a Postgres database, as JSON: one row per section, per account. Self-host and that database is yours; on the hosted instance it sits on my server, and you can export all of it whenever you want.",

// Can I run it myself?
a: "Yes. One Docker image serves the web UI, the REST API, the MCP endpoint and the documentation, and you point it at your own Postgres so nobody else is hosting your data.",
```

Two answers are already one or two sentences and do not change: *"Can other users on the same server see my persona?"* and *"Can I get everything back out?"*

`FAQ.contact` is unchanged. "Two ways out, the quicker one first." is plain and true.

The em dash in the *"Where does my data actually live?"* answer becomes a colon. That is the only em dash in the file, so `content.js` reaches zero.

- [ ] **Step 6: `FOOTER` — tighten the blurb**

```js
  blurb: "Portable context for AI. Write yourself down once.",
```

(was `"… Write yourself down once and stop doing it again."` — the trailing clause restates the first half, and the shorter version now echoes the hero headline.)

`status` and every `groups` entry, including the three deliberate `href: null` links, are unchanged.

- [ ] **Step 7: Verify no em dashes and no banned patterns survive**

```bash
cd frontend/src/landing && grep -c '—' content.js
```

Expected: `0`

```bash
grep -nE '(, not a |rather than a |is not [a-z]+, it|not just .* but )' content.js
```

Expected: one hit only, on line 149's *code comment* (`sourced from … rather than a …`). If a hit lands inside a quoted string value, it is not done.

- [ ] **Step 8: Run the landing tests**

```bash
cd frontend && npm test -- --project unit --run src/landing
```

Expected: PASS, with no test file edited. The FAQ tests read `FAQ.groups[…].items[…].q` and `.a` straight from `content.js` (`Landing.test.jsx:36,51,59,73`), so rewritten answers are asserted automatically. `gate.test.jsx`'s hardcoded `"Explain yourself once."` still matches because step 2 left it alone.

- [ ] **Step 9: Read the rendered page, not the diff**

```bash
cd frontend && npm run dev
```

Open the landing page. Check the seven bento tiles do not overflow their cards at the `md` breakpoint — three of the seven got shorter and one (`proposals`) got slightly longer, and `span: 1` tiles are the tight ones. Fix by shortening the copy, never by changing a `span`.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/landing/content.js
git commit -m "$(cat <<'EOF'
copy(landing): one standing sentence per tile, two per answer

The bento ran three sentences and about forty words a tile where zeron.sh
runs one, and the third sentence was usually restatement. Every worked
example survives -- minimal and professional are still both spelled out,
the Docker image still lists all three surfaces it serves.

"Questions people actually ask." implied the other ones were fake.

The single em dash in the file becomes a colon, so content.js is at zero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

### Task 2: The one inline landing string

**Files:**
- Modify: `frontend/src/landing/Hero.jsx:131-133`

- [ ] **Step 1: Read the current string in context**

```bash
sed -n '128,136p' frontend/src/landing/Hero.jsx
```

It reads `"One URL. Any client that speaks MCP picks it up."`

- [ ] **Step 2: Decide, and record the decision**

This string stays. Two short sentences, second person, concrete, no contrast, no dash. It is already what the rest of the slice is aiming at. Task 2 exists so that "was the inline copy checked?" has an answer other than silence.

- [ ] **Step 3: Confirm nothing else inline was missed**

```bash
cd frontend/src/landing
grep -nE '"[A-Z][a-z][^"]{12,}"' Hero.jsx Bento.jsx HowItWorks.jsx Faq.jsx Closing.jsx Footer.jsx Nav.jsx WaitlistForm.jsx \
  | grep -vE 'className|href|url|import|from|aria-|role=|type=|/landing/'
```

Expected: the three `WaitlistForm.jsx` status messages, `Nav.jsx`'s labels, `Hero.jsx`'s chip line, and `Nav.jsx`'s `"MyGist home"` screen-reader text. Nothing else. If a prose string appears that is not on that list, it was missed and belongs in Task 1's pass.

### Task 3: Ship slice 1

- [ ] **Step 1: Full unit suite, not just the landing**

```bash
cd frontend && npm test -- --project unit
```

Expected: PASS, except the one known flake — `App.test.jsx > App: the rail says when something is waiting > shows the pending count as a number on Review`. Re-run to confirm any failure is that one and not new.

- [ ] **Step 2: Secret scan**

```bash
git diff main...copy/landing-rewrite | grep -nEi '(mg_[A-Za-z0-9_-]{20,}|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|secret\s*=)'
```

Expected: no output.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin copy/landing-rewrite
gh pr create --title "copy(landing): rewrite the copy deck against the no-slop rules" --body "$(cat <<'EOF'
First of three slices. Spec: `docs/superpowers/specs/2026-08-14-copy-rewrite-design.md`.

The usual diagnosis did not apply — a scan found zero banned words and zero
filler phrases. What was there instead: three-sentence bento tiles where one
sentence would stand, four-sentence FAQ answers, and one em dash.

Every worked example and every `source:` citation survives. No test file was
edited: the FAQ tests read the answers straight out of `content.js`, so the
rewritten copy is asserted by the tests that already existed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Slice 2 — Docs site

Branch: `copy/docs-rewrite`, cut from `main` **after** slice 1 merges.

## File Structure

21 MDX files under `docs-site/content/docs/`. Nineteen get a full rewrite; `run/pack-reference.mdx` and `run/section-packs.mdx` get a patterns-only pass, by the owner's ruling — they are 32% of the corpus and are where a reworded sentence can drift from what the code enforces.

No `.tsx`, `meta.json`, or component file is touched. If a rewrite seems to need one, stop: it means the copy change grew into a layout change.

### Task 4: Set up the gate before writing anything

**Files:**
- Read: `docs-site/scripts/check-links.mjs`

- [ ] **Step 1: Prove the gate runs and passes on unmodified content**

```bash
cd docs-site && npm run build && npm run check:links
```

Expected: build succeeds, `check:links` reports no broken links. This is the baseline. A rename that breaks an anchor renders fine and 404s on click, so this command is the only thing that catches it — and it has to be known-green before it means anything.

- [ ] **Step 2: Record the current anchor inventory**

```bash
grep -rnoE '\]\(/[a-z/-]*#[a-z0-9-]+\)' content/docs | sort > /tmp/anchors-before.txt
wc -l /tmp/anchors-before.txt
```

Expected: 20 lines. Three of these point at headings this slice renames.

### Task 5: The three anchor-breaking renames, done together

**Files:**
- Modify: `docs-site/content/docs/run/database.mdx` (heading), `run/search-index.mdx:101`, `run/troubleshooting.mdx:210`, `use/faq.mdx:46` (inbound links)
- Modify: `docs-site/content/docs/run/section-packs.mdx` (heading), `run/troubleshooting.mdx:273` (inbound link)
- Modify: `docs-site/content/docs/use/clients.mdx` (heading), `run/troubleshooting.mdx:157` (inbound link)

Done as one task, before the prose work, because a rename and its inbound links must land in the same commit or the gate is red for reasons unrelated to whatever comes next.

- [ ] **Step 1: `pgvector, and life without it` → `pgvector`**

In `run/database.mdx`, change `## pgvector, and life without it` to `## pgvector`. Then fix all three inbound links, which currently read `](/run/database#pgvector-and-life-without-it)`:

```bash
cd docs-site/content/docs
grep -rln 'pgvector-and-life-without-it' . | xargs sed -i '' 's|#pgvector-and-life-without-it|#pgvector|g'
grep -rn 'pgvector-and-life-without-it' . && echo "STILL PRESENT" || echo "clean"
```

Expected: `clean`

- [ ] **Step 2: `Guards you will meet` → `Guards`**

In `run/section-packs.mdx`, change `## Guards you will meet` to `## Guards`.

```bash
sed -i '' 's|#guards-you-will-meet|#guards|g' run/troubleshooting.mdx
grep -rn 'guards-you-will-meet' . && echo "STILL PRESENT" || echo "clean"
```

- [ ] **Step 3: `Using a token instead` → `Connecting with a token`**

In `use/clients.mdx`, change `## Using a token instead` to `## Connecting with a token`.

```bash
sed -i '' 's|#using-a-token-instead|#connecting-with-a-token|g' run/troubleshooting.mdx
grep -rn 'using-a-token-instead' . && echo "STILL PRESENT" || echo "clean"
```

- [ ] **Step 4: Run the gate**

```bash
cd docs-site && npm run build && npm run check:links
```

Expected: PASS. If `check:links` reports a dead anchor, the slug guess was wrong — read the reported href and match the heading's actual generated slug rather than assuming the rule.

- [ ] **Step 5: Commit**

```bash
git add docs-site/content/docs
git commit -m "$(cat <<'EOF'
docs: three heading renames, with their inbound anchors

Renamed and relinked in one commit because an anchor that drifts renders
fine and 404s on click. check-links.mjs was written for exactly this and
is green.

"pgvector, and life without it" had three inbound links, which is the one
that would have hurt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

### Task 6: The `use/` half — nine full rewrites

**Files:** `docs-site/content/docs/index.mdx`, `use/index.mdx`, `use/concepts.mdx`, `use/quick-start.mdx`, `use/capture.mdx`, `use/reading.mdx`, `use/writing.mdx`, `use/relations.mdx`, `use/editor.mdx`

One commit per page. Rewrite the prose; leave every code block, every `<Callout>`/`<Step>`/`<Cards>` structure, every table's data, and every link target untouched.

The scans already found what is on each page. Fix these, plus anything the global rules catch on a read-through:

| Page | Em dashes | Bold lead-ins | Named defects |
|---|---|---|---|
| `index.mdx` | 5 | 3 (`Your data lives…`, `Nothing happens…`, `Assistants read a slice, not the lot`) | Headings `What it is, in one screen` → `What it is`, `Two ways to edit` → `Editing your persona`. Contrast at `:65` (`taste, not a watchlist`) — **substantive, stays**. `and neither is the "real" one` → rhetorical, goes. |
| `use/index.mdx` | 3 | 0 | Heading `What it will not do` → `When the tools run`. Fragments: `Not everything. A slice.` and `Two small calls instead of one large one.` both fold into their sentences. |
| `use/concepts.mdx` | 8 | 0 | Opener `:6` (`Ten minutes here saves a lot of confusion later.`) → cut the puffery, keep the "four words" framing. Contrast `:12` (`It is not a document or a profile page.`) → the spec's worked example. |
| `use/quick-start.mdx` | 8 | 0 | `That is the whole point.` at `:195` → state what the reader just saw instead. |
| `use/capture.mdx` | 13 | 3 | The worst page. Opener `:6` deleted. Headings: `The two surfaces` → `Inbox and observations`, `Inbox — things with a known home` → `Inbox`, `Observations — things with no home yet` → `Observations`, `Two things that stop the queue rotting` → `Duplicates and rejections`, `The honest limitation` → `Limits`, `What to do at the end of a good conversation` → `At the end of a conversation`. Colon reveal `The practical middle ground:` deleted. Contrasts at `:47`, `:83`, `:97`, `:112` all rhetorical. The `**Nothing reads your messages in the background.**` callout **stays bold and stays negative** — substantive. |
| `use/reading.mdx` | 10 | 0 | Contrast `:122`. |
| `use/writing.mdx` | 7 | 0 | Heading `Ask the schema, don't guess` → `Discovering the schema`. Contrast `:84`. |
| `use/relations.mdx` | 5 | 0 | Nothing named; em dashes and a read-through. |
| `use/editor.mdx` | 6 | 1 | Headings `What only the editor does` / `What only the AI tools do` → `Editor-only actions` / `Tool-only actions`. Contrast `:54`. |

- [ ] **Step 1: For each page, rewrite it, then check it against the rules**

Work one page at a time. After each, run:

```bash
cd docs-site/content/docs
f=use/capture.mdx   # the page just edited
echo "em dashes: $(grep -c '—' $f)"          # must be <= 2
grep -nE '^\*\*[^*]+\.\*\*' $f               # must be empty, or a callout's first line
grep -nE '^#{2,3} ' $f                       # headings must be noun phrases
```

- [ ] **Step 2: Commit each page separately**

```bash
git add docs-site/content/docs/use/capture.mdx
git commit -m "docs(capture): headings name the thing, and the queue rules become headings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Per-page commits, so a bad rewrite is one `git revert` rather than an unpick.

- [ ] **Step 3: Gate, once, after all nine**

```bash
cd docs-site && npm run build && npm run check:links
```

Expected: PASS.

### Task 7: `use/sections.mdx`, `use/clients.mdx`, `use/faq.mdx`

**Files:** the three largest `use/` pages. Split from Task 6 because each needs its own decision.

| Page | Em dashes | Named defects |
|---|---|---|
| `use/sections.mdx` | 18, the second-worst | **11 bold lead-ins that mostly stay.** One per section, each a one-line gloss directly under `## Profile`, `## Goals` and so on. That parallel rhythm is deliberate — only the `**` goes, because the heading above already carries the emphasis. Contrasts at `:15` (`a context provider, not a task tracker` — **substantive**, it corrects a real misconception), `:142`, `:175`. |
| `use/clients.mdx` | 25, the worst page in the repo | Heading already renamed in Task 5. No bold lead-ins. This is purely an em dash pass plus a read-through; most dashes here introduce a definition and become colons. |
| `use/faq.mdx` | 9 | Contrasts at `:147`, `:182`. Cross-check every answer against the rewritten landing FAQ from slice 1 — seven of the nine landing answers were lifted from this file, and they must not now disagree. |

- [ ] **Step 1: Rewrite the three, one commit each, same per-page checks as Task 6 Step 1**

- [ ] **Step 2: Cross-check the FAQ against the landing page**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
grep -n 'a:' frontend/src/landing/content.js | head -20
grep -nE '^(A|Yes|No|Only|In a)' docs-site/content/docs/use/faq.mdx
```

Read both. Where the landing and the docs answer the same question, they may be worded differently but must not state different facts.

- [ ] **Step 3: Gate**

```bash
cd docs-site && npm run build && npm run check:links
```

### Task 8: The `run/` half — six full rewrites

**Files:** `run/index.mdx`, `run/self-hosting.mdx`, `run/database.mdx`, `run/search-index.mdx`, `run/development.mdx`, `run/infrastructure.mdx`, `run/troubleshooting.mdx`

| Page | Em dashes | Bold lead-ins | Named defects |
|---|---|---|---|
| `run/index.mdx` | 6 | 5 | Heading `Design decisions worth knowing up front` → `Design decisions`. The five bold points under it become `###` headings — they are a run of parallel named decisions, which is the case where bold is standing in for markup. Contrast `:74`. `It is not skipped with a warning.` at `:91` — **substantive, stays.** |
| `run/self-hosting.mdx` | 19 | 3 | The three bold points under `## Reverse proxies` are parallel instructions → `###` headings. `Do not strip or rewrite /mcp` stays imperative and negative; it is an instruction, not rhythm. |
| `run/database.mdx` | 9 | 1 | Heading renamed in Task 5. `**The width must match your embedding model's output.**` is a single gloss → drop the bold. |
| `run/search-index.mdx` | 6 | 0 | Headings `The two gotchas` → `Backfill caveats`, and `--recreate is not enough on its own. Restart the server too.` → `Restart the server after --recreate`. **Check for inbound anchors on the second one before renaming** — the scan found none, but re-run the grep. Contrast `:75`. |
| `run/development.mdx` | 13 | 5 | The five bold points under `## Conventions worth knowing` → `###` headings, and the heading itself → `Conventions`. |
| `run/infrastructure.mdx` | 4 | 3 | Heading `Keeping this page true` → `Keeping this page current`. Contrasts `:51` and `:107`. `Anything still configured against mygist-api is broken, not degraded.` — **substantive, stays**; so does the `mygist-api.thuradev.qzz.io is retired` heading, which is the fact. |
| `run/troubleshooting.mdx` | 14 | 1 | **Highest risk page in the slice.** It is nothing but statements about what fails and what will not happen. Apply the delete-the-negative-half test to every single negation here and expect most of them to stay. Its headings are already symptom-shaped (`The server will not start`, `A client cannot see the tools`) and are correct as they are — they name the symptom a reader is searching for. |

- [ ] **Step 1: Before renaming in `search-index.mdx`, re-check for inbound anchors**

```bash
cd docs-site/content/docs
grep -rn 'recreate-is-not-enough\|#the-two-gotchas\|#conventions-worth-knowing\|#design-decisions-worth\|#keeping-this-page-true\|#what-only-the' .
```

Expected: no output. If there is any, it goes in the same commit as the rename.

- [ ] **Step 2: Rewrite the seven, one commit each, same per-page checks**

- [ ] **Step 3: Gate**

```bash
cd docs-site && npm run build && npm run check:links
```

### Task 9: The two reference pages — patterns only

**Files:** `docs-site/content/docs/run/section-packs.mdx`, `docs-site/content/docs/run/pack-reference.mdx`

Explicitly **not** a voice rewrite. Change headings, em dashes, rhetorical contrasts and bold lead-ins. Do not touch explanatory prose, code blocks, tables, manifest key descriptions, or the worked example's steps. A manifest key's description is a contract.

| Page | Em dashes | Renames |
|---|---|---|
| `run/section-packs.mdx` | 18 | `The contract you did not write` → `The generated contract` (**not** "derived" — `pack-reference.mdx:467` already owns `## The derived contract`, and two pages sharing an anchor for two different sections is a trap). `What you just got` → `What the pack provides`. `Making it nicer` → `Refining the section`. `Not everything is a list` → `Sections that are not lists`. `Guards you will meet` → `Guards` (done in Task 5). Keep: `The one rule`, `An invalid pack stops the server` (2 inbound anchors, and it is the behaviour), `Keep entries small`, `Checklist before opening a PR`. |
| `run/pack-reference.mdx` | 2 | `Where the authority is` → `Source of authority`. Keep every backticked key heading exactly as it is. Four contrasts, all `rather than a` — check each individually; in a reference page describing why a key works one way, several will be substantive. |

- [ ] **Step 1: Check for inbound anchors on the four new renames**

```bash
cd docs-site/content/docs
grep -rn '#the-contract-you-did-not-write\|#what-you-just-got\|#making-it-nicer\|#not-everything-is-a-list\|#where-the-authority-is' .
```

Expected: no output.

- [ ] **Step 2: Apply the pattern pass to both pages**

- [ ] **Step 3: Verify the prose was not rewritten**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git diff --stat docs-site/content/docs/run/section-packs.mdx docs-site/content/docs/run/pack-reference.mdx
```

Expected: roughly 40-60 changed lines across the two, not 400. A large diff here means the pass drifted into a rewrite, which the owner ruled against.

- [ ] **Step 4: Gate and commit**

```bash
cd docs-site && npm run build && npm run check:links
```

### Task 10: Ship slice 2

- [ ] **Step 1: Whole-corpus verification**

```bash
cd docs-site/content/docs
echo "=== pages still over 2 em dashes ==="
for f in $(find . -name '*.mdx'); do n=$(grep -c '—' $f); [ "$n" -gt 2 ] && echo "$f: $n"; done
echo "=== em dashes in headings or descriptions (must be none) ==="
grep -rnE '^(#{1,3} |description: ).*—' .
echo "=== bold lead-ins outside callouts ==="
grep -rnE '^\*\*[^*]+\.\*\*' .
```

Every remaining hit must be a decision, not an oversight. Report the list rather than silently leaving it.

- [ ] **Step 2: Final gate**

```bash
cd docs-site && npm run build && npm run check:links
```

- [ ] **Step 3: Confirm the anchor inventory did not shrink**

```bash
cd docs-site/content/docs
grep -rnoE '\]\(/[a-z/-]*#[a-z0-9-]+\)' . | wc -l
```

Expected: 20. A lower number means a link was dropped rather than updated.

- [ ] **Step 4: Secret scan, push, open the PR**

### Task 11: Rebuild the app preview and read the docs as a reader

- [ ] **Step 1: Build the preview**

```bash
docker compose -f backend/docker-compose.yml start
./scripts/local-preview.sh
```

Wait with an until-loop, not `sleep`:

```bash
until docker logs mygist-preview 2>&1 | grep -q "Ready:"; do sleep 5; done
```

- [ ] **Step 2: Read `/docs` in a browser**

The docs are a static export copied into the image, so this is the only way to see what a reader sees. Check the pages with the most structural change: `use/capture.mdx` (six heading renames), `run/index.mdx` and `run/development.mdx` (bold points promoted to `###`, which changes the sidebar's table of contents), and `use/sections.mdx` (eleven glosses lost their bold — confirm the eleven sections still read as a parallel series and not as a wall).

- [ ] **Step 3: Stop the preview with `stop`, never `down`**

```bash
./scripts/local-preview.sh --stop
docker compose -f backend/docker-compose.yml stop
```

`down` removes the `backend_default` network and `local-preview.sh` errors out without it.

---

# Slice 3 — READMEs, and the stale-skills defect

Branch: `copy/readme-rewrite`, cut from `main` after slice 2 merges.

This slice deletes tracked files and changes a test. It is separate from slice 2 so a functional change is not buried in a 25,000-word prose diff.

## File Structure

- Delete: `skills/mygist/SKILL.md`, `skills/mygist-reading/SKILL.md`, `skills/mygist-writing/SKILL.md`, `skills/mygist-capture/SKILL.md` — pre-rewrite duplicates of `backend/skills/`, diverged at PR #74 (65/71/74/81 lines against 105/99/132/149).
- Move: `skills/README.md` → `backend/skills/README.md`, with corrected `cp` paths, then rewritten.
- Modify: `backend/tests/test_skills_match_the_tools.py:16` — repoint `SKILLS_DIR`.
- Modify: `README.md` — full rewrite, including the `skills/` link at `:47`.

### Task 12: Repoint the guard, and find out what it says

Done **first**, before any deletion, so the test's verdict on the rewritten skills is known while both copies still exist.

**Files:**
- Modify: `backend/tests/test_skills_match_the_tools.py`

- [ ] **Step 1: Run the test as it stands, against the stale copies**

```bash
cd backend && python -m pytest tests/test_skills_match_the_tools.py -q
```

Expected: PASS. This is the baseline, and it is passing for the wrong files.

- [ ] **Step 2: Repoint `SKILLS_DIR`**

`backend/tests/test_skills_match_the_tools.py:16` currently reads:

```python
SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"
```

Replace with:

```python
# backend/skills, not the repo root's skills/ -- the root copy diverged at
# PR #74 and is deleted in this commit. This directory is what the Dockerfile
# ships and what skill_resources.py serves at skill://mygist/<name>/SKILL.md,
# so it is the only copy an agent can actually read.
SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
```

- [ ] **Step 3: Run it against the shipped skills, for the first time ever**

```bash
cd backend && python -m pytest tests/test_skills_match_the_tools.py -q -v
```

The four rewritten skills are longer and name more tools, so this may fail. **A failure here is the guard working.** If it fails, read what it found: a skill naming a tool that does not exist is a real defect in shipped content and fixing it belongs in this commit. Do not weaken the test to make it pass.

- [ ] **Step 4: Update the test's docstring reference**

Line 3 says `skills/README.md promises these are versioned…`. The file moves in Task 13, so this becomes `backend/skills/README.md`.

- [ ] **Step 5: Delete the stale copies**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git rm -r skills/mygist skills/mygist-reading skills/mygist-writing skills/mygist-capture
```

- [ ] **Step 6: Confirm nothing references the deleted path**

```bash
grep -rn '\bskills/mygist' --include='*.py' --include='*.md' --include='*.mdx' \
  --include='*.yml' --include='*.json' --include='Dockerfile' . 2>/dev/null \
  | grep -vE 'node_modules|venv|\.git/|backend/skills|\.claude|docs/superpowers'
```

Expected: no output, other than the `README.md` line fixed in Task 14.

- [ ] **Step 7: Full backend suite**

```bash
cd backend && python -m pytest -q
```

Expected: PASS. The deletion could be referenced from somewhere the grep missed, and this is what finds out.

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(tests): point the skills guard at the skills that actually ship

SKILLS_DIR resolved to the repo root's skills/, which has held pre-rewrite
copies since PR #74 moved the real ones to backend/skills/. So the test whose
docstring says "a skill naming a retired tool is worse than no skill, because
an agent will believe it" was guarding four files that no agent can reach.

The root copies are deleted rather than kept in sync. backend/skills/ is what
the Dockerfile ships and what skill_resources.py serves over skill://, and two
copies of the same four files had already diverged by 40 to 68 lines each.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

### Task 13: `backend/skills/README.md`

**Files:**
- Create: `backend/skills/README.md` (moved from `skills/README.md`)

- [ ] **Step 1: Move it**

```bash
git mv skills/README.md backend/skills/README.md
```

`skills/` is now empty and git stops tracking it automatically.

- [ ] **Step 2: Fix the install paths, which are now wrong**

The `cp` commands currently read `cp -r skills/mygist* …`. From the repository root the source is now `backend/skills/mygist*`:

```bash
# Claude Code, for one project
mkdir -p .claude/skills && cp -r backend/skills/mygist* .claude/skills/

# Claude Code, everywhere
mkdir -p ~/.claude/skills && cp -r backend/skills/mygist* ~/.claude/skills/
```

The link at line 27 to `mygist/SKILL.md` is relative and still resolves; the table's four relative links likewise.

- [ ] **Step 3: Rewrite the prose**

Two bold lead-ins under `## What belongs in a skill, and what does not` (`The tool docstrings are the contract.`, `Skills carry the judgement a docstring cannot.`) are a run of parallel points → `###` headings, and the section heading itself loses `, and what does not`. Four em dashes, down to at most two. `## Keeping them honest` → `## Versioning`.

Add one thing the file does not currently say and now should: these are served over MCP at `skill://mygist/<name>/SKILL.md`, so a client that cannot copy files can read them from a running server. That shipped in PR #74 and the README predates it.

- [ ] **Step 4: Commit**

### Task 14: `README.md`

**Files:**
- Modify: `README.md`

Six em dashes, no bold lead-ins, and three things that are wrong or stale rather than merely slop.

- [ ] **Step 1: Fix the factual problems first**

1. `:47` links to `skills/` → `backend/skills/`.
2. `:45` links to `docs/CONTRIBUTING-PACKS.md`, 29,624 bytes, superseded in practice by `run/section-packs.mdx` and `run/pack-reference.mdx`. Point the bullet at the docs site instead. **Do not delete the file** — whether it should go is a separate decision and guessing at it here is scope creep. Note it in the PR body.
3. `:37` `**Proposals, not guesses.**` is a bullet label built on the exact pattern this whole piece of work is removing. → `**Proposals.**`

- [ ] **Step 2: Rewrite the prose**

- `:5` `Your portable personal context for AI — stop repeating yourself.` — em dash out.
- `:12-14` claims the README "duplicates nothing" from the docs site, which is close to true and worth keeping, but it is three sentences of meta-commentary about the README inside the README. One sentence.
- `:24-26` `Nothing is inferred behind your back: MCP tools are passive` — colon reveal; and `readable, exportable, and editable by hand` is fine and stays.
- `:30-49` the seven `## What it does` bullets each open with a bold label, which is a legitimate list convention and stays. Their bodies carry three `rather than` contrasts (`:31`, `:34`, `:48`) — apply the delete-the-negative-half test. `degrading to FTS-only rather than breaking` at `:34` is **substantive**: it tells an operator what happens without pgvector, which is the whole point of the clause.
- `:84` `TBD — currently private` — em dash out.

- [ ] **Step 3: Verify the em dash count and every link**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
echo "em dashes: $(grep -c '—' README.md)"    # target 0; it is 503 words
grep -oE '\]\([^)]+\)' README.md | tr -d '](' | while read -r l; do
  case "$l" in
    http*) printf "skip (external): %s\n" "$l" ;;
    *) [ -e "$l" ] && echo "ok   $l" || echo "DEAD $l" ;;
  esac
done
```

Expected: no `DEAD` lines.

- [ ] **Step 4: Commit, secret scan, push, open the PR**

The PR body should name the `docs/CONTRIBUTING-PACKS.md` question explicitly as a decision left open, rather than leaving it for someone to find.

---

## Self-review notes

- **Spec coverage.** Every rule in the spec's §1-7 maps to a task: rules 1-6 are Global Constraints applied per page in Tasks 6-9 and 12-14; rule 7 is Task 1 steps 4-5. The heading-rename table maps to Tasks 5, 6, 8, 9, 13. The anchor risk maps to Task 5 and Task 10 step 3. The skills defect maps to Tasks 12-14. The depth ruling maps to Task 9 step 3's diff-size check.
- **The reference-page ruling needs a mechanical check, not good intentions.** That is why Task 9 step 3 checks `git diff --stat` against an expected magnitude. Without it, "patterns only" is a promise nobody can audit.
- **Task ordering is load-bearing twice.** Task 4 establishes a green gate before any content moves, so a later red is attributable. Task 12 runs the repointed test before the deletion, so the rewritten skills are judged while both copies still exist and the result is not confounded.
- **The riskiest page is `run/troubleshooting.mdx`**, and it is the one where the global rules are least applicable — a troubleshooting page is a list of things that will not work. Task 8's table says so explicitly rather than leaving a subagent to discover it.
