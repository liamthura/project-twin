# README audit — what must not be ported as-is

**Date:** 2026-07-29
**For:** Phase 2 of
[`2026-07-26-single-container-and-docs-site-design.md`](../specs/2026-07-26-single-container-and-docs-site-design.md)

The design doc lists three content-accuracy fixes to carry in during the port
(Neon, URL examples, README shrinking). It was written on 2026-07-26. Waves 6–12
have landed since, and they changed the entity vocabulary more than any prior
run of work — so the port needs a bigger correction list than the spec knew
about.

Every claim below was checked against `server.ENTITY_SCHEMA` and the code, not
read for plausibility. **None of this is a bug in the app**: the app is right and
the README describes an older one.

---

## 1. Wrong in the entity table

`README.md:424-460`. It is labelled "a sampler" and ends "And more…", so
*omissions* are by design. These are not omissions — they are incorrect rows.

| Entity | README says | Actually | Landed |
|---|---|---|---|
| `domain` | fields `name, level, tags` | there is no `tags`; it is `level, notes, references` | — (never existed) |
| `project` | `description` among ordinary fields | `description` is **required** | wave 8 |
| `hobby` | `status (active/inactive)` | `active / inactive / **paused**` | wave 5 |
| `work_experience` | `role, company, type, period, highlights` | also `location`, `description`, `skills`; required is all four of role/company/type/period | waves 6–8 |
| `hobby_reference` | actions `add, remove` | `add, update, remove` | — |
| `like` / `dislike` | actions `add, remove` | `add, update, remove`, and `stance` is a declared field | wave 7 |
| `learning_entry` | actions `add, remove`, fields `topic, details, tags, source` | `add, update, remove`; also `key_decisions`, `followup_items`, `related_entries`, `new_topic`, `conversation_metadata`; `details` is **required** | — |
| `aesthetic` | `name, domain, stance, notes, references` | also `primary` | wave 6 |
| `goal` | `type (7 kinds + custom via "other")` | `custom_type` is its own field, settable on its own since wave 9 | wave 9 |

`domain.tags` is the one worth calling out: the README documents a field that
has never existed. It is the same class of defect the stored-key audit exists to
prevent, one layer up — a *documented* phantom rather than a declared one.

### Entities absent from the table that users cannot otherwise discover

Omission is allowed here, but these are capabilities with no other entry point
in the docs: `link` (gained `update` in wave 7), `stress_trigger` (**new** in
wave 8 — the key had a UI and no MCP path at all before it), `response_format`,
`work_skill`, `club`, `coursework`.

## 2. Wrong outside the table

- **`README.md:39` — "Packs are validated at boot (invalid packs are skipped
  with a warning)."** Invalidated by PR #35, merged *today*. Packs shipped in
  this repo now raise `PackError` and stop the process; warn-and-skip survives
  only for a pack directory the server does not own. This sentence is the
  behaviour the PR was written to remove.
- **Neon as the production database** — `README.md:31, 52, 64, 69, 476`.
  Production is self-hosted Postgres with pgvector on the Coolify VPS. Neon
  becomes one managed option among several. (Already on the spec's list; five
  call sites, not one.)
- **Roadmap: "Hobby status tracking (active/inactive)"** — three states since
  wave 5.
- **The `What's Inside` tree** omits `section_packs/`, `pack_loader.py`,
  `persona_store.py`, `settings_store.py`, `db.py`, and `docs-site/`. It lists
  five legacy `mygist_data/*.json` files against ten live sections.

## 3. Verified still correct — port unchanged

Checked so the port does not "fix" working text:

- The **MCP tools table** (`README.md:341-352`). All eight tools match the
  `@mcp.tool()` set exactly.
- The **embedding provider variables** and the FTS-only fallback.
- The **backfill `--recreate` gotcha** (`README.md:520-525`), including its
  knock-on effects on `days`, `updated_at` and the staleness advisory. This is
  the single most useful paragraph in the file and the spec is right to name it.
- **Default-off packs** — `media` and `aesthetics` are `default_enabled: false`,
  as described.

---

## 4. How this lands

The design doc has `README.md` shrinking to an overview plus a link to `/docs`,
so most of this text is *moving*, not being edited in place. Therefore:

1. Corrections are applied **as the MDX is written**, not to `README.md` first.
   Fixing prose that is about to be deleted is wasted work.
2. The handful of claims that survive into the shrunken README — the pack
   validation sentence, the Neon references, the tree — are fixed there
   directly, because they outlive the port.
3. **The entity table should not be ported at all.** `get_schema()` is the
   authoritative list, it is generated from the same manifests the app enforces,
   and the table has now been wrong three separate ways in one release cycle.
   The docs should teach `get_schema` and show two or three worked examples,
   not maintain a hand-copied duplicate of a machine-readable contract. That is
   the same "don't keep a second copy of the truth" argument that decided the
   stored-key audit in wave 8.
