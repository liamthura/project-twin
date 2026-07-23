# Modular Section Packs and First-Class Goals — Design (lean v2)

**Date:** 2026-07-23 (revised same day after scope review)
**Status:** Draft for review
**Prototype:** Figma → MyGist file, page "Section Packs (design plan)"
(prototype shows some v1 ideas since cut — milestone bars, overdue strips,
version chips; treat those as decoration, not scope)

## Guiding principle

MyGist is a **context provider**, not a tracker. Every feature must either
(a) improve what an LLM can know about the person per token spent, or
(b) reduce the cost of maintaining that knowledge. Anything that manages
work rather than describes the person is out of scope.

## Problems being solved

1. **Goals are buried and half-broken.** `profile.goals_and_careers` is
   registered but has no write path (acknowledged at `server.py:3234`);
   `career_aspirations` is a bare string list. What a person is working
   toward is among the highest-value context per token — it deserves a
   section, not a corner of profile.
2. **Sections are hardcoded in four places** (`sections.py`,
   `ENTITY_SCHEMA`, `persona_store.DEFAULTS`, a bespoke React editor),
   which blocks cheap additions and outside contribution.

## Non-Goals (explicit cuts from v1 of this spec)

- Goal milestones/progress tracking — task management, not context.
- Generic entity relations / `resolve_related` — hybrid search already
  connects related entries semantically; no graph layer.
- Sensitivity/visibility levels — speculative; revisit on real need.
- `review_stale` tool — surfacing `updated_at` covers it.
- Scope-filter DSL in manifests — one consumer (goals) bakes its own rule.
- Marketplace/versioning chrome, CI pipelines, remote pack installation.
- timeline / routines / setup / places packs — deferred to a "when wanted"
  list; the pack format makes each a later one-manifest job.

---

## Part 1 — Section Packs

Each section becomes one directory with one declarative file:

```
backend/section_packs/<key>/manifest.json
```

Manifest fields (validated against a published JSON meta-schema at boot):

```json
{
  "key": "media",
  "title": "Media",
  "description": "Books, podcasts, shows, games",
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
  "capture_triggers": ["reading", "watched", "listening to"],
  "ui": { "items": { "title_field": "title", "badges": ["kind", "status"] } }
}
```

Optional `hooks.py` (core-authored only, e.g. goals' "active only in
scopes" rule). Community packs are manifest-only.

**Loader** (`section_packs.py`): scan, validate, enforce invariants
(unique keys/entity names/id-prefixes; entity lists exist in defaults;
scope names valid), then merge into the existing `SECTION_REGISTRY`,
`ENTITY_SCHEMA`, and `persona_store.DEFAULTS` — downstream code unchanged.
Invalid pack → warn and skip; never a boot failure. Entity-name collision
between two packs → fail fast (packaging bug).

The seven existing sections are retro-fitted as core packs with **zero
behavior change**, guarded by a golden test: registry + entity schema
snapshots identical before/after.

**Toggling:** already built (`settings_store.disabled_sections`,
`enabled_sections()`). The Sections screen stays a toggle list; it gains
title/description/core from manifests and lists new packs. Disabled packs
stay out of scopes, search, schema digests, and capture suggestions
(all already keyed off `enabled_sections()` — add tests). New packs
default off. Contribution docs: one page — copy template pack, boot
validates it, open a PR.

**Frontend:** `GenericSectionEditor.jsx` renders any pack's lists from
`manifest.ui` (title + badge chips + detail fields, add/edit/remove via
the existing write API). Existing bespoke editors stay and take
precedence; the generic editor is only for packs without one.

## Part 2 — Goals

New core-adjacent pack `goals` (default **on**), one entity:

```
goal:
  required: title
  optional: type, status, target_date, why, notes
  valid_values:
    type:   [career, learning, personal, health, financial, creative]
    status: [active, achieved, paused, dropped]   (default: active)
  identifier: title
```

**Scope presence** (the point of the promotion), via a small goals hook —
no generic filter mechanism:

| Scope                           | Contribution                        |
| ------------------------------- | ----------------------------------- |
| minimal                         | titles of active goals (stubs, ≤5)  |
| professional/personal/learning  | active goals in full                |
| `goals` (free, section scope)   | everything incl. achieved/dropped   |

Non-active goals never spend scope tokens except in the `goals` scope.

**Migration:** `career_aspirations` strings and `goals_and_careers` items
→ `goal {title, type: career}`; idempotent; the two profile lists are
removed from defaults and scope fields. `career_aspiration` remains as a
write alias that creates a `goal(type=career)` and returns an advisory
naming the new entity. README scope-token table re-measured.

## Part 3 — Freshness (minimal)

- Unify on the per-entry change time already maintained for the search
  index; expose `updated_at` in `get_entity` results and `detail="titles"`
  stubs. Not in scope payloads (token cost).
- `top_of_mind` entries older than 30 days: reads append one advisory
  line (existing advisory pattern). No new tools, no auto-delete.

## Part 4 — Media pack

First add-on pack, manifest above, default off. Proves loader, generic
editor, capture triggers, and search indexing end-to-end. Further pack
ideas (timeline, routines, setup, places) live in the README roadmap as
one-liners; each is a later single-manifest addition if demand shows up.

## Storage / data flow

No Postgres schema changes: packs are `file_type` rows like any section.
Search indexing is already generic over `id_lists`. Export/import covers
enabled packs; importing data for a disabled pack auto-enables it (noted
in the response).

## Error handling

- Invalid manifest → skip + warning at boot.
- Write to a disabled pack's entity → error naming the pack and how to
  enable it.
- Migration idempotent (skips already-migrated goals).

## Testing

- Meta-schema validation tests for every shipped manifest + invariant
  mutation tests.
- Golden registry/entity-schema snapshot across the retrofit.
- Goals migration round-trip on fixture personas.
- Scope-token regression: measure minimal/professional/personal/learning
  before/after goals (guard the context-provider budget).

## Phasing

1. **Pack loader + retrofit** — pure refactor, golden-tested.
2. **Goals pack + migration + alias** — the user-visible headline.
3. **Media pack + GenericSectionEditor** — proves the format end-to-end.
4. **Freshness touches** — `updated_at` surfacing + top_of_mind advisory.

Each independently shippable, in order.
