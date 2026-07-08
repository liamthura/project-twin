# Per-User Section Enable/Disable — Design Spec (Phase 2)

**Date:** 2026-07-08
**Status:** Approved design, pending implementation plan
**Builds on:** the section registry (`backend/sections.py`) shipped in Phase 1. Each section is a self-contained `SectionSpec`; this feature filters which sections a user's AI surface sees.

## Goal

Let each user disable individual persona sections so they are hidden from the entire MCP/AI surface (context loading, raw reads, schema, writes) and from the frontend's main tabs — while the data is preserved and the section can be re-enabled. Controlled per-user, toggled from the frontend, persisted in Postgres.

## Scope of "toggleable"

- **Always-on (never disableable):** `profile`, `preferences`, `learning_log`. Always loaded, always visible.
- **Toggleable (default ON — opt-out):** `knowledge`, `projects`, `lifestyle`, `circle`.

The always-on set is a single declaration in the registry: `sections.ALWAYS_ON_SECTIONS = frozenset({"profile", "preferences", "learning_log"})`. "Toggleable" is *derived* (`set(SECTION_REGISTRY) − ALWAYS_ON_SECTIONS`) — no second hardcoded list, so a new registry section is automatically toggleable.

## Storage — a per-user settings blob

Per-user settings live as a **jsonb blob in the existing `persona_data` table under a reserved `file_type = '_settings'`** (the underscore distinguishes it from registry sections). Blob shape, extensible for future plugin/user config:

```json
{ "disabled_sections": ["knowledge", "circle"] }
```

We store the **disabled** set (not enabled), so the opt-out default is an empty/absent blob and newly-added registry sections are enabled for everyone automatically.

- No schema migration — reuses the existing `(user_id, file_type, data jsonb)` table.
- Kept out of the registry: `VALID_FILES` / `persona_store.get_all` / export/import iterate registry sections only, so `_settings` never leaks into persona content, `get_context`, or backups.
- Accessors (thin, registry-independent — do NOT route through `persona_store.load/save`, which validate against `VALID_FILES`):
  - `settings_store.get_settings(user_id) -> dict` — returns `{}` when absent.
  - `settings_store.set_settings(user_id, dict) -> None` — upserts the `_settings` row.
  - `settings_store.get_disabled_sections() -> set[str]` / `set_disabled_sections(list[str])` — convenience over the blob, scoped to the current user via `db.current_user_id`.

## The single enforcement helper

One source of truth every surface consults:

```python
# in server.py (or sections.py helper), reads the current user's disabled set
def enabled_sections() -> set[str]:
    """Registry sections visible to the current user: all sections minus their
    disabled set, with always-on sections force-included."""
    disabled = settings_store.get_disabled_sections() - sections.ALWAYS_ON_SECTIONS
    return set(sections.SECTION_REGISTRY) - disabled
```

`ALWAYS_ON_SECTIONS` is subtracted from `disabled` defensively so a stale/hand-edited blob can never disable a core section.

## Enforcement per surface

| Surface | Behavior when a section is disabled |
|---|---|
| `get_context` / section scopes | section excluded from the returned context; a global scope simply omits its fields. A **section scope naming a disabled section** (`get_context(scope="circle")` when circle is off) returns an error: `"Section 'circle' is disabled."` |
| `get_raw` | excluded from `"all"`; `get_raw(file=<disabled>)` → `"❌ Section '<x>' is disabled. Enable it in settings."` |
| `get_schema` | that section's entities are omitted from the digest and from file/entity lookups, so the LLM does not learn about disabled entities |
| `persona_modify` / `persona_batch` | a write whose entity belongs to a disabled section is **rejected**: `"❌ Section '<x>' is disabled; enable it in settings to modify it."` (belt-and-suspenders — schema already hides it) |
| Frontend | the disabled section's **tab is hidden**; a Settings panel toggles sections |

"Disabled" = **hidden, never deleted.** The `persona_data` rows stay; re-enabling restores tab + MCP visibility immediately.

To map an entity → its section, reuse the registry: an entity belongs to the section whose `SectionSpec` declares it (the write schema in `ENTITY_SCHEMA` is keyed by file/section, so `persona_modify` can resolve `entity → section` and check membership in `enabled_sections()`).

## Boundary: MCP filtered, REST admin plane not

The **AI surface (MCP tools)** and the **frontend's tab rendering** hide disabled sections. The existing **REST data endpoints (`/api/files`, `/api/all`) stay unfiltered** — they are the *owner's* control plane, needed to re-enable and edit. This is deliberate: the AI's view is filtered; the user's own admin view is complete.

## API (frontend ↔ backend)

- `GET /api/settings` → `{ "disabled_sections": [...], "toggleable": [...], "always_on": [...] }` (the latter two derived from the registry, so the frontend renders toggles without hardcoding section names).
- `PUT /api/settings` → body `{ "disabled_sections": [...] }`. Validates every key is a **real, toggleable** section; rejects unknown keys and any always-on section (`profile`/`preferences`/`learning_log`) with `400`. Persists via `set_disabled_sections`.

Both endpoints run under the existing auth middleware (scoped to `db.current_user_id`).

## Frontend (control surface)

- A **Settings panel** (new tab or gear affordance) that fetches `GET /api/settings` and renders an on/off switch per toggleable section; always-on sections are either omitted or shown locked-on. Toggling issues `PUT /api/settings` and updates local state.
- The main tab bar renders only enabled toggleable sections (+ the always-on tabs). Disabled sections' tabs disappear; flipping a switch back on restores the tab and its (preserved) data.
- Section labels/icons for the settings list come from a small frontend map; no backend content needed beyond the section keys from `GET /api/settings`.

## Testing strategy

- **Settings store:** get returns `{}` when absent; set/get round-trips; `_settings` is invisible to `persona_store.get_all`/`VALID_FILES`.
- **enabled_sections:** default = all sections; disabling a toggleable one removes it; disabling an always-on one (via a hand-crafted blob) has NO effect.
- **Per-surface enforcement** (one test each): `get_context` omits a disabled section and errors on a disabled section-scope; `get_raw(file=disabled)` and `get_raw("all")` exclude it; `get_schema` omits its entities; `persona_modify`/`batch` reject a disabled-section write; always-on sections are never affected by any disable.
- **API:** `GET` returns the three lists; `PUT` persists; `PUT` rejects an always-on key and an unknown key with `400`.
- **Frontend:** settings panel toggles a section and the tab hides/shows; disabled data survives a round-trip.

## Rough work breakdown (for the plan)

Backend: (1) `ALWAYS_ON_SECTIONS` + `enabled_sections()` helper; (2) `settings_store` (accessors + `_settings` isolation); (3) settings API (`GET`/`PUT` + validation); (4)–(7) enforce in `get_context`, `get_raw`, `get_schema`, `persona_modify`/`batch`. Frontend: (8) settings panel + tab filtering. Each task TDD'd; the enforcement tasks are independent per surface and gated by the same `enabled_sections()` helper.

## Non-goals (deferred)

- `learning_log` toggling + its frontend view/CRUD → Phase 3.
- Filtering the REST admin endpoints (`/api/all`, export) — intentionally unfiltered.
- Plugin packaging — the `_settings` blob is *shaped* to accommodate future plugin config, but no plugin system is built here.

## Exit criteria

- A user can disable `knowledge`/`projects`/`lifestyle`/`circle` from the frontend; the choice persists in the `_settings` blob.
- Disabled sections vanish from `get_context`, `get_raw`, `get_schema`, and are write-rejected by `persona_modify`; always-on sections are unaffected.
- The disabled section's tab is hidden in the frontend; data is preserved and re-enabling restores it.
- All new tests green; Phase 1's suite stays green.
