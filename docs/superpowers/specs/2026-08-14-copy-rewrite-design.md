# Copy rewrite: landing page, docs site, README — design

Date: 2026-08-14
Status: approved, not yet implemented

## Why

The copy across all three surfaces was written carefully and reads well in
places. It is also full of a specific, repeating set of tics that mark it as
machine-drafted, and the owner named the worst one directly: *"no 'not this,
that' kind of ai slop"*.

The reference points are the owner's, not invented here. For marketing copy,
[zeron.sh](https://zeron.sh) and [paseo.sh](https://paseo.sh): short, concrete,
second person, no agency vocabulary. For documentation,
[Django](https://docs.djangoproject.com/en/6.1/) and
[Terraform](https://developer.hashicorp.com/terraform/docs): headings that name
the thing, prose that explains it, no editorial.

## What is actually wrong

Worth stating plainly, because the usual diagnosis does not apply and acting on
it would waste the pass. A scan for the standard markers found **zero** banned
words (`delve`, `leverage`, `robust`, `seamless`, `unlock`, and the rest) and
**zero** empty phrases (`it's worth noting`, `when it comes to`, `at its core`).
`content.js` even carries a `source:` field per claim, so nothing on the landing
page describes behaviour that is not in the repository.

The problems are narrower and all structural:

| Pattern | Sites | Worst offenders |
|---|---|---|
| Rhetorical contrast (`X, not Y`, `rather than a`) | 31, ~20 in prose | `use/sections.mdx`, `run/pack-reference.mdx`, `Hero.jsx` |
| Em dashes | 209 across 21 docs pages | `use/clients.mdx` (25), `run/self-hosting.mdx` (19) |
| Bold lead-in paragraphs | 38 | `use/sections.mdx` (11), `run/index.mdx` (5) |
| Editorialised headings | ~15 | `The honest limitation`, `Two things that stop the queue rotting` |
| Dramatic fragments | scattered | "Not everything. A slice.", "Two small calls instead of one large one." |
| Faux-insight openers | 3 | `use/capture.mdx:6`, `use/concepts.mdx:6` |

## The rules

### 1. Rhetorical contrast goes; substantive negation stays

This is the distinction that decides whether the pass improves the docs or
damages them, so it comes first.

A contrast is **rhetorical** when the negated half is a straw man carried for
rhythm. Nobody thought a persona was a profile page, so this sentence spends a
clause denying something the reader never believed:

> It is not a document or a profile page. It is structured data — one JSON blob
> per section, per account, in Postgres.

A negation is **substantive** when the thing being denied is what the reader
would otherwise assume, and the denial is the information. These stay, untouched:

> `--recreate` is not enough on its own. Restart the server too.

> Nothing reads your messages in the background.

> Anything still configured against `mygist-api` is broken, not degraded.

The test: delete the negative half. If nothing is lost, it was rhythm. If a
reader could now get it wrong, it was a warning.

### 2. Headings name the thing

Noun phrases. No editorial, no sentences, no em dashes, no promises about how
useful the section will be. This is the Django and Terraform convention, and
about fifteen headings break it.

| Now | Becomes |
|---|---|
| The honest limitation | Limits |
| Two things that stop the queue rotting | Duplicates and rejections |
| The two surfaces | Inbox and observations |
| Inbox — things with a known home | Inbox |
| Observations — things with no home yet | Observations |
| The contract you did not write | The generated contract |
| What you just got | What the pack provides |
| Guards you will meet | Guards |
| Where the authority is | Source of authority |
| pgvector, and life without it | pgvector |
| Design decisions worth knowing up front | Design decisions |
| Making it nicer | Refining the section |
| Not everything is a list | Sections that are not lists |
| Ask the schema, don't guess | Discovering the schema |
| Using a token instead | Connecting with a token |
| `--recreate` is not enough on its own. Restart the server too. | Restart the server after `--recreate` |
| What it will not do | When the tools run |
| The two gotchas | Backfill caveats |
| What it is, in one screen | What it is |
| Keeping this page true | Keeping this page current |

`The contract you did not write` (`section-packs.mdx:375`) becomes *generated*
rather than *derived* on purpose: `pack-reference.mdx:467` already owns
`## The derived contract`, and giving two pages the same anchor for two different
sections would be a trap for whoever links to one of them next.

Headings that read as editorial but are load-bearing stay: `An invalid pack stops
the server` is the behaviour, `mygist-api.thuradev.qzz.io is retired` is the fact,
`Keep entries small` is the instruction. The plan carries the complete per-page
list; this table is the set worth arguing about.

**Renaming a heading changes its anchor slug.** Twenty cross-page links depend on
those slugs, and three of the renames above break one:

| Renamed heading | Inbound links to fix |
|---|---|
| `pgvector, and life without it` → `pgvector` | `run/search-index.mdx:101`, `run/troubleshooting.mdx:210`, `use/faq.mdx:46` |
| `Guards you will meet` → `Guards` | `run/troubleshooting.mdx:273` |
| `Using a token instead` → `Connecting with a token` | `run/troubleshooting.mdx:157` |

`docs-site/scripts/check-links.mjs` exists for this. Its docstring names "heading
anchors that drift when a heading is reworded" as one of two failures it was
written to catch, and CI's `docs` job runs it after `next build`. Every heading
rename is verified by that script before the branch is pushed, not by inspection.

### 3. Em dash budget

Zero on the landing page. Zero in any heading or frontmatter `description`. At
most two per docs page body, and only where a dash genuinely beats a colon, a
comma or a full stop.

209 is not a style; it is a default. Most become colons (a definition follows) or
full stops (a second sentence was hiding).

### 4. Bold lead-ins

A bold sentence that opens a paragraph and is then explained is a heading
wearing a disguise. Two different cases, and they resolve differently:

- **A run of parallel points** — `run/index.mdx`'s five design decisions,
  `run/development.mdx`'s five conventions, `capture.mdx`'s two queue rules.
  These become real `###` headings or a table. They are already structured; the
  bold is standing in for markup.
- **A single gloss under its own heading** — `sections.mdx` has eleven, one per
  section, each a one-line summary sitting directly under `## Profile`,
  `## Goals` and so on. That parallel rhythm is deliberate and stays. Only the
  bold goes, because the heading above it already provides the emphasis.

Bold survives for UI labels (`Account → API tokens`), a term's first definition,
and one-word emphasis inside a callout.

### 5. No dramatic fragments, colon reveals, or faux-insight openers

- "Not everything. A slice." folds back into its sentence.
- "The practical middle ground:" loses the label.
- "This is the page that surprises people, so it comes with the blunt version
  first" is deleted; the warning callout below it already is the blunt version.

`STEPS.headline` — "Three steps." — was on this list and comes off it. Every
section headline on the landing page ends in a full stop (`Everything your
assistants can ask for.`, `Stop starting from nothing.`), so the stop is the
page's punctuation system rather than a drama beat, and removing one would read
as a typo. Two words is terse in the register zeron.sh uses, and the subhead
carries the meaning.

### 6. Every technical claim survives verbatim

No file path, number, tool name, environment variable, or caveat is lost. No
`source:` citation in `content.js` is touched. A sentence may get shorter; it may
not get vaguer. Where a rewrite would require dropping a concrete detail to read
better, the detail wins and the sentence stays long.

British English, second person, present tense throughout — already the case, and
recorded so it holds.

### 7. Landing only

- **One sentence per bento tile that could stand alone.** A second sentence only
  if it carries a concrete example or a number. Tiles currently run three
  sentences and about forty words; zeron.sh runs one.
- **FAQ answers capped at two sentences.** Currently up to four.

## Depth per surface

Ruled by the owner: the two reference pages get a **targeted pattern pass**, not
a voice rewrite.

| Surface | Words | Treatment |
|---|---|---|
| `frontend/src/landing/content.js` + 3 inline strings | ~700 | Full rewrite |
| 19 narrative docs pages | ~17,100 | Full rewrite |
| `run/pack-reference.mdx`, `run/section-packs.mdx` | ~8,200 | Patterns only: headings, em dashes, contrasts, bold lead-ins. Prose, code blocks, tables and manifest keys untouched. |
| `README.md` | 503 | Full rewrite |
| `skills/README.md` | 329 | Full rewrite, and it moves (below) |

The two reference pages are 32% of the docs corpus and are where a reworded
sentence can drift from what the code enforces. A manifest key's description is
a contract, not copy.

## A defect found while surveying the README

Not a copy problem, but it decides what the README is allowed to say.

**There are two tracked copies of all four agent skills, and they have
diverged.** `skills/mygist*/SKILL.md` at the repo root holds the pre-rewrite
versions from before PR #74 (65, 71, 74, 81 lines). `backend/skills/mygist*/SKILL.md`
holds the rewritten ones (105, 99, 132, 149 lines).

`backend/skills/` is canonical: the `Dockerfile` ships it via `COPY backend/ .`,
`skill_resources.py` serves it at `skill://mygist/<name>/SKILL.md`, and the
owner's `~/.claude/skills/mygist*` are symlinks into it.

Two consequences:

1. `README.md:47` links readers to `skills/` — the stale copy. Rewriting that
   sentence without fixing the path would only make a wrong claim read better.
2. `backend/tests/test_skills_match_the_tools.py:16` resolves `SKILLS_DIR` to the
   repo root `skills/`. The test whose docstring says "a skill naming a retired
   tool is worse than no skill, because an agent will believe it" is guarding the
   copy that never ships. The four skills that actually reach agents have no such
   guard.

The fix, ruled in by the owner:

- Delete `skills/mygist/`, `skills/mygist-reading/`, `skills/mygist-writing/`,
  `skills/mygist-capture/`.
- Move `skills/README.md` to `backend/skills/README.md`, correcting its `cp`
  paths to `backend/skills/mygist*`.
- Repoint `SKILLS_DIR` in `test_skills_match_the_tools.py` to `backend/skills`,
  so the guard covers what ships. The four rewritten skills are longer and say
  more, so this is the first time they are checked at all.
- Point `README.md`'s skills bullet at `backend/skills/`.

## Slicing

Three branches, three PRs.

| PR | Contents | Why separate |
|---|---|---|
| 1 | Landing page copy | ~700 words, reviewable in one screen. Approving the voice here sets the standard the docs pass applies. |
| 2 | 21 docs pages | The bulk. Nothing but prose and headings. |
| 3 | `README.md`, `skills/README.md` move, skills deletion, test repoint | Deletes tracked files and changes a test. Bundling a functional change into a 25,000-word prose diff would hide it. |

## Verification

Not inspection. Each slice has a gate that fails loudly.

**Landing.** `cd frontend && npm test -- --project unit`. Two copy strings are
hardcoded in tests rather than read from `content.js`:
`"Explain yourself once."` (`gate.test.jsx:46,55,71`) and the `/you're on the
list/i` and `/something went wrong/i` regexes (`Landing.test.jsx:121,137`). The
FAQ tests read `FAQ.groups[…].items[…].q` and `.a` from `content.js`, so FAQ
rewrites are covered automatically.

The hero headline stays `"Explain yourself once."` — it already matches the
target voice (three words, sentence case, full stop), so no test changes are
needed. If that ever changes, the test changes in the same commit.

**Docs.** `cd docs-site && npm run build && npm run check:links`. This is the
heading-anchor gate. `next` is installed locally, so it runs without CI.

**README slice.** `cd backend && python -m pytest tests/test_skills_match_the_tools.py -q`
after repointing `SKILLS_DIR`. If the rewritten skills name a tool that does not
exist, this is the run that finds out — and it has never been run against them.
Then the full backend suite, because deleting `skills/` could be referenced from
somewhere the grep missed.

**Every slice.** Before pushing, scan the range for secret-shaped strings:

```bash
git diff main...<branch> | grep -nEi '(mg_[A-Za-z0-9_-]{20,}|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|secret\s*=)'
```

## Out of scope

- **Code comments and docstrings.** Many carry the same patterns —
  `Hero.jsx`'s comments use `rather than a` three times. They are not copy, no
  reader outside the repository sees them, and touching them would bury the
  prose diff. `Landing.jsx`, `primitives.jsx` and `gate.test.jsx` appear in the
  contrast scan for this reason only.
- **`backend/skills/*/SKILL.md` prose.** Rewritten one day ago in PR #74 against
  a different brief (agent triggering, not human reading), and published at
  `skill://`. Re-editing them now would undo deliberate work.
- **`design/logos/README.md`, `design/gradients/README.md`.** Internal notes to
  self about asset provenance. Nine em dashes between them, and no audience.
- **`docs/CONTRIBUTING-PACKS.md`** (29,624 bytes). Superseded in practice by
  `run/section-packs.mdx` and `run/pack-reference.mdx`, and still linked from
  `README.md:45`. Whether it should be deleted rather than rewritten is a
  separate question, and guessing at it here would be scope creep.
- **The MCP `instructions` string** and `mcp_prompts.py` text. Both written for
  agents, both capped and test-enforced.
- **`frontend/src/landing/mini.jsx`** mock content. It depicts persona data in a
  product screenshot, so it is sample data rather than prose.

## Risks

- **Over-applying rule 1 is the way this goes wrong.** Docs legitimately tell
  people what will not happen. Rule 1's delete-the-negative-half test exists
  because a mechanical sweep for "not" would strip real warnings, and
  `troubleshooting.mdx` is nothing but warnings.
- **Heading renames break anchors silently.** They render fine and 404 on click.
  `check:links` is the only thing standing between a rename and a dead link, so
  it runs before every docs push rather than at the end.
- **A shorter sentence can be a vaguer one.** Rule 6 is the counterweight, and
  the reference-page ruling exists because that risk is highest exactly where
  the prose is describing a contract.
- **`test_skills_match_the_tools.py` has never run against the rewritten
  skills.** Repointing it may fail on first run. That would be the guard doing
  its job, and fixing whatever it finds belongs in PR 3.
