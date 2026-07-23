# Modular Section Packs, First-Class Goals, and New Sections — Design

**Date:** 2026-07-23
**Status:** Draft for review
**Prototype:** Figma → MyGist file, frames adjacent to node 19-63

## Problem

Three connected problems, in priority order:

1. **Goals are buried and half-broken.** `profile.goals_and_careers` is a
   registered id-list with no write path (no `ENTITY_SCHEMA` entity targets
   it — acknowledged at `server.py:3234`), and `career_aspirations` is a bare
   string list with no status, dates, or links. Goals deserve first-class
   presence across scopes, not a corner of profile.
2. **Sections are hardcoded.** Adding a section today means editing
   `sections.py`, `ENTITY_SCHEMA` in `server.py`, `persona_store.DEFAULTS`,
   and hand-writing a React editor. That blocks both our own roadmap
   (media, timeline, routines, setup, places) and any community contribution.
3. **Cross-cutting gaps.** No provenance (user vs AI-captured), no freshness
   surfaced in reads, no sensitivity levels, no generic entity-to-entity
   links, no staleness handling for `top_of_mind`.

## Goals

- Promote goals to a first-class, cross-scope section.
- Restructure section definitions into self-contained, togglable
  **Section Packs** — a plugin-like format others can contribute to.
- Ship the previously agreed cross-cutting upgrades (provenance, freshness,
  sensitivity, relations, staleness) as core capabilities every pack inherits.
- Ship five new packs (media, timeline, routines, setup, places) as proof of
  the format.

## Non-Goals

- Runtime installation of third-party packs from a remote registry
  (marketplace *UI* is designed for, backend distribution is future work).
- Arbitrary third-party Python execution. v1 packs are declarative;
  hooks remain core-authored.
- Migrating existing bespoke React editors to the generic renderer
  (they stay; the generic renderer is for new packs).

---

## Part 1 — Section Pack architecture

### Approaches considered

- **A. Pure declarative manifests (JSON).** Safest and easiest to
  contribute; cannot express custom behaviors (advisories, capture
  heuristics beyond keywords).
- **B. Python plugin classes.** Full power; but arbitrary code from
  contributors is a trust and review burden, and overkill for what
  sections actually vary in (fields, enums, scopes, UI hints).
- **C. Hybrid (chosen).** Declarative `manifest.json` is the contract and
  the only thing community packs need. Optional `hooks.py` (core-reviewed,
  in-repo only for v1) for advanced behavior. Loader validates manifests
  against a published meta-schema.

Rationale: everything the current seven sections differ in is already
data-shaped (defaults, id-lists, entity fields, enums, scope fields). C keeps
contribution as easy as A without closing the door B opens.

### Pack layout

```
backend/section_packs/
  media/
    manifest.json     # required — the whole contract
    hooks.py          # optional, core-authored (advisories, capture refiners)
  goals/
    manifest.json
  ...
```

### Manifest format (meta-schema published as JSON Schema)

```json
{
  "key": "media",
  "version": "1.0.0",
  "title": "Media & Reading",
  "description": "Books, podcasts, shows, games — queue, in progress, finished.",
  "icon": "book-open",
  "core": false,
  "defaults": { "items": [] },
  "id_lists": [["items", "media"]],
  "scope_contributions": { "personal": ["items"] },
  "entities": {
    "media_item": {
      "actions": ["add", "update", "remove"],
      "required": ["title"],
      "optional": ["kind", "status", "rating", "url", "notes", "tags"],
      "valid_values": {
        "kind": ["book", "article", "podcast", "show", "film", "game", "video", "music"],
        "status": ["want", "in_progress", "finished", "dropped"]
      },
      "identifier": "title",
      "list": "items"
    }
  },
  "capture_triggers": ["reading", "watched", "listening to", "finished playing"],
  "ui": {
    "items": {
      "title_field": "title",
      "badges": ["kind", "status"],
      "detail_fields": ["rating", "url", "notes", "tags"]
    }
  }
}
```

### Loader (`section_packs.py`, new)

At startup:

1. Scan `backend/section_packs/*/manifest.json`.
2. Validate each against the meta-schema (jsonschema). Invalid pack →
   log warning, skip pack, server still boots.
3. Enforce invariants: unique `key`, unique entity names across all packs,
   unique id-prefixes, every `entities[*].list` exists in `defaults`,
   scope names ∈ known global scopes.
4. Merge into the existing runtime structures — `SECTION_REGISTRY`,
   `ENTITY_SCHEMA`, `persona_store.DEFAULTS` — so **downstream code does not
   change**. `sections.py` keeps its API; its hardcoded dict becomes the
   product of the loader.

The seven existing sections are retro-fitted into pack format
(`core: true` for profile/preferences/learning_log per `ALWAYS_ON_SECTIONS`)
with **zero behavior change** — same keys, same defaults, same context
fields. Golden test: registry snapshot before/after refactor is identical.

### Toggling / "installed packs"

Already 90% built: `settings_store.disabled_sections` + `enabled_sections()`.
Changes:

- `GET /api/sections` gains manifest metadata (title, description, icon,
  version, core) so the UI can render a proper Sections manager instead of
  bare checkboxes.
- Disabled pack ⇒ excluded from scopes, search, schema digest, capture
  suggestions (all already keyed off `enabled_sections()` — verify + test).
- New packs default **off** for existing users, **on** choice during
  onboarding later. Core packs remain force-on.

### Frontend: generic section renderer

New `GenericSectionEditor.jsx` driven by `manifest.ui`: renders each id-list
as cards (title field + badge chips + detail fields), add/edit/remove via
existing `/api` write path. New packs get a usable editor for free; bespoke
editors (Profile, Lifestyle, …) remain and take precedence when present.

### Contribution story

`docs/CONTRIBUTING-PACKS.md`: copy a template pack, edit `manifest.json`,
run `python scripts/validate_pack.py section_packs/yourpack`, open a PR.
CI validates manifests against the meta-schema.

---

## Part 2 — Goals: first-class section pack

New pack `goals` (replaces both `profile.career_aspirations` and the dormant
`profile.goals_and_careers`).

### Entities

```
goal:
  required: title
  optional: type, status, target_date, why, milestones, related, notes
  valid_values:
    type:   [career, learning, personal, health, financial, creative]
    status: [active, achieved, paused, dropped]   (default: active)
  identifier: title

goal_milestone:                      # parent-keyed, like work_highlight
  required: [goal_title, milestone]
  optional: [done]
  identifier: milestone, parent: goal_title
```

### Scope presence (the "bigger presence" requirement)

| Scope        | What goals contributes                          |
| ------------ | ----------------------------------------------- |
| minimal      | titles of active goals (stub form, ≤5)          |
| professional | active career + learning goals, full            |
| personal     | active personal / health / creative goals, full |
| learning     | active learning goals, full                     |
| `goals`      | everything (free — section keys are scopes)     |

Scope filtering by `type` is a pack-level need the manifest expresses via
`scope_contributions` entries of the form
`{"list": "goals", "filter": {"type": ["career", "learning"]}, "status": ["active"]}` —
a small, generic extension of context-field selection (any pack can use it).

### Migration & back-compat

- One-off migration (extends existing migrate script): each
  `career_aspirations` string and each `goals_and_careers` item →
  `goal {title, type: career, status: active, source: migrated}`.
- `career_aspiration` entity stays as a **write alias**: adds route to a
  `goal` with `type: career` (server-side rewrite + advisory naming the new
  entity). Reads of profile no longer include the two removed lists.
- `profile.context_fields` drops `career_aspirations`; scope budgets
  re-measured in README table.

### Goal linkage

`project`, `current_learning`, and `learning_entry` gain optional
`related_goals` (goal ids or titles, resolved to ids on save) — implemented
via the generic relations mechanism in Part 3, goals is just the first user.

---

## Part 3 — Cross-cutting core upgrades

All implemented in core (`persona_store` / read paths), inherited by every
pack automatically.

### 3.1 Provenance & freshness

Every id-carrying entry gets `_meta: {source, created_at, updated_at}`;
`source ∈ {user, ai, migrated}` (writes via MCP tools → `ai`, via web UI →
`user`). Reads: `_meta` is **excluded** from scope payloads by default
(token cost), included in `get_entity` and `get_raw`. `search_context`
already tracks per-entry change times — unify on `_meta.updated_at`.

### 3.2 Sensitivity

Optional `visibility: normal | sensitive` on any entry (default normal).
Sensitive entries are excluded from `get_context` scope payloads unless
`include_sensitive=true`; always visible in the web UI (badge + filter);
`search_context` returns them only with the same flag. Token-level
visibility ceilings are future work, noted not designed.

### 3.3 Generic relations

Optional `related: [id, ...]` on any entry, validated to existing ids on
save (unknown id → advisory, saved anyway — links may be typed before their
target). `get_entity` gains `resolve_related=true` to inline
`{id, title}` stubs for one hop. This mechanism carries goal↔project↔learning
links (Part 2) with zero goal-specific code.

### 3.4 Staleness & review

- `top_of_mind` items older than 30 days: reads append a one-line advisory
  ("3 top-of-mind items are >30 days old — review?"), matching the existing
  duplicate-advisory pattern. No auto-delete.
- New tool `review_stale(days=180, sections=None)`: returns oldest-untouched
  entries (id, title, updated_at) across enabled sections, capped at 25 —
  the "is this still true?" workflow. Also surfaces `active` goals whose
  `target_date` has passed.

---

## Part 4 — New section packs (v1 set)

Each is one manifest, default-off, personal-scope unless noted. Sketches
(full field lists finalized per-pack at implementation):

| Pack       | Key entities                                                                                                       | Scopes               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `media`    | `media_item` (title, kind, status, rating, url, notes, tags)                                                        | personal             |
| `timeline` | `life_event` (title, date, category: move/work/education/personal/health/milestone, details)                        | personal, full       |
| `routines` | `routine` (name, cadence, time_window, kind: class/work/fitness/social/other); `availability` (update-only singleton) | personal, minimal(titles) |
| `setup`    | `gear` (name, category: computer/phone/peripheral/software/subscription/home, details, since)                       | professional, personal |
| `places`   | `place` (name, relation: lived/visited/wishlist/frequent, period, notes); `travel_prefs` (singleton)                | personal             |

Ship order: **media first** (highest conversational value, exercises every
manifest feature), then timeline, routines, setup, places.

---

## Data flow / storage

No schema changes to Postgres: packs are new `file_type` rows in
`persona_data`, exactly like existing sections. Search indexing is already
generic over `id_lists`. Export/import includes enabled packs' file types;
import of a pack the user has disabled auto-enables it (with response note).

## Error handling

- Invalid manifest → pack skipped at boot with warning; never a crash.
- Write to a disabled pack's entity → error naming the pack and how to
  enable it (Sections manager / `enable_sections` setting).
- Entity name collisions across packs → boot-time error listing both packs
  (fail fast; this is a packaging bug, not user data).
- Migration is idempotent (skips goals already carrying `source: migrated`).

## Testing

- Meta-schema validation tests (every shipped manifest validates; mutation
  tests for each invariant).
- Golden registry snapshot: pre-refactor `SECTION_REGISTRY`/`ENTITY_SCHEMA`
  == post-refactor loader output for the seven core packs.
- Goals migration round-trip on fixture personas.
- Scope-budget regression: token counts per scope before/after goals move.
- Generic renderer smoke test via existing frontend test setup, if any;
  otherwise manual checklist in the PR.

## Phasing

1. **Pack loader + retrofit** (pure refactor, golden-tested, no user-visible change)
2. **Goals pack + migration + aliases** (user-visible headline)
3. **Cross-cutting core**: `_meta`, sensitivity, relations, staleness advisories, `review_stale`
4. **New packs**: media → timeline → routines → setup → places
5. **Sections manager UI** (marketplace-style toggle screen) + generic renderer + contribution docs

Each phase is independently shippable in that order; 3 and 4 can swap if
goals linkage is deferred.

## Open questions (non-blocking, decide at implementation)

- Whether `goal_milestone.done` flips `goal.status` suggestions ("all
  milestones done — mark achieved?") — advisory only, cheap to add.
- Whether `minimal` scope includes routines titles by default or only via
  explicit opt-in (token budget measurement will decide).
