# Profile: MCP scalar-field editing + collapsible experience items — Design

**Date:** 2026-07-10
**Status:** Approved by user (pre-implementation)
**Scope:** Two small pre-Phase-3 improvements to the profile section.

## Problem

1. `persona_modify` cannot edit the profile's top-level scalar fields (`name`,
   `preferred_name`, `current_role`, `organisation`, `location`, `nationality`,
   `bio`). `ENTITY_SCHEMA["profile"]` only covers list entities (email, link,
   language, work_experience, education, career_aspiration, ...), so an AI
   client has no way to update e.g. the bio without a raw file write.
2. In the frontend ProfileEditor, work experience and education items render as
   always-expanded multi-field forms, which makes the section long and hard to
   scan. Projects items already solve this with a per-item collapse pattern.

## Decisions

- Backend fix follows the existing `preferences.communication_default`
  precedent: an update-only singleton entity with no identifier.
- Collapse applies to **work experience and education items only**. Goals
  (2 fields) and languages (1 row) stay as-is — collapsing them adds clicks
  without saving space. (User-confirmed.)
- Empty-string clearing of scalar fields is **not** supported: falsy values are
  ignored, matching the `communication_default` convention.

## Part 1 — Backend: `basic_info` entity (`backend/server.py`)

### Schema

Add to `ENTITY_SCHEMA["profile"]`:

```python
"basic_info": {"actions": ["update"], "required": [],
               "optional": ["name", "preferred_name", "current_role", "organisation",
                            "location", "nationality", "bio"],
               "identifier": None,
               "description": "Update-only singleton for top-level profile fields"}
```

The `get_schema` example-generation machinery (`_digest_entry` /
`_build_examples`) already handles identifier-less update-only singletons
(proven by `communication_default`), so examples come free.

### Handler

Add `elif entity == "basic_info":` to `execute_modify`, modeled on the
`communication_default` handler (server.py:1857):

- Load `profile.json`.
- For each of the 7 known fields, `if data.get(field): profile[field] = data[field]`
  and record `field=value` for the response.
- If nothing was updated, return
  `❌ basic_info update requires at least one of: name, preferred_name, ...`.
- Otherwise `save_json("profile.json", profile)` and return
  `✅ Updated profile: name=..., bio=...`.
- Any action other than `update` returns an error (schema validation already
  blocks this upstream; the handler guard is belt-and-braces, same as
  `communication_default`).

### Capture thresholds

Add `"basic_info": {"auto": 0.90, "ask": 0.70}` to `ENTITY_THRESHOLDS` —
identity fields deserve a higher bar before auto-capture than other entities.

### Usage

```
persona_modify(action="update", entity="basic_info", data={"bio": "...", "location": "..."})
```

Partial update: only the fields present in `data` change; all others are
untouched.

### Tests

- `backend/tests/test_get_schema.py`: `basic_info` appears under `profile` with
  `actions == ["update"]` and the 7 optional fields; an `update` example is
  generated.
- Handler tests: update one field → only that field changes; update several →
  all change; empty/unknown-only `data` → ❌ error; non-update action → ❌.

## Part 2 — Frontend: collapsible items (`frontend/src/App.jsx`, ProfileEditor)

Mirror the Projects per-item pattern (`expandedProjects`, App.jsx:3517):

- New state in ProfileEditor: `expandedWorkExp` and `expandedEducation`,
  objects keyed by item index, default `{}` (all collapsed).
- Each work-experience / education item is wrapped in the Projects-style shell:
  - Clickable header row: `ChevronDown` (rotated −90° when collapsed), title,
    badges, delete button (moved into the header).
  - Work title: `role` — `company` (fallback "Untitled"); badges: `period`,
    `N highlights` when > 0.
  - Education title: `institution` (fallback "Untitled Institution") with a
    `degree in field` subtitle — preserves the pre-existing header content;
    badges: `start_year–end_year`, `N courses`, `N highlights` when > 0.
  - The existing edit form renders only when expanded — form internals are
    unchanged.
- Adding a new item sets its index to expanded so the user can type
  immediately.
- Purely presentational: no changes to data shape, `update(...)` handlers, or
  autosave.

### Verification

Playwright against the dev server: screenshot the profile section with items
collapsed, expand one work-experience and one education item, confirm the form
renders and the chevron/badges behave; add an item and confirm it opens
expanded.

## Out of scope

- Goals and languages item collapse.
- `persona_batch`, capture engine, other sections.
- Clearing scalar fields to empty via MCP.
- Any Phase 3 (learning log) work.
