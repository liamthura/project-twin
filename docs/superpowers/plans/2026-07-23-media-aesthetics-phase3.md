# Media + Aesthetics Packs + Generic Editor (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the media and aesthetics packs as pure manifests (no bespoke server or UI code), enabled by two generic mechanisms: a schema-driven write handler in `execute_modify` and a manifest-driven `GenericSectionEditor` in the web UI (with tap-to-add suggestion chips). Plus real default-off support for add-on packs.

**Architecture:** Three backend mechanisms, then two manifests, then the frontend. (1) Manifests gain `default_enabled`; `settings_store.enabled_sections()` treats default-off packs as opt-in via a new `enabled_sections` settings list; `/api/settings` GET/PUT extended. (2) `execute_modify` gains a generic fallback branch driven entirely by `ENTITY_SCHEMA` (required/optional/valid_values/identifier + new per-entity `list` and `field_defaults`); `ADVISORY_ENTITIES` auto-augments for generic entities, so manifest-only packs get writes, validation, dedupe advisories, and search indexing with zero server edits. (3) The frontend generalizes its hardcoded section wiring: dynamic packs (goals, media, aesthetics — any enabled pack without a bespoke editor) render via `GenericSectionEditor` from the manifest `ui`+`entities` blocks now exposed in `/api/settings` packs.

**Tech Stack:** Python 3.11+ backend (no new deps), React 18 + Vite + Tailwind/shadcn frontend (no new deps).

## Global Constraints

- Spec Parts 1 & 4: `docs/superpowers/specs/2026-07-23-modular-section-packs-design.md`. No `_meta`/provenance/staleness work (that's Phase 4).
- Media entity `media_item`: required `title`; optional `kind, status, rating, url, notes, tags`; `kind ∈ {book, article, podcast, show, film, game, video, music}`; `status ∈ {want, in_progress, finished, dropped}`; identifier `title`; scope: personal. Aesthetics entity `aesthetic`: required `name`; optional `domain, stance, notes, references`; `domain ∈ {ui, graphic, typography, color, illustration, photography, fashion, interior, general}`; `stance ∈ {love, like, avoid}` defaulting to `like` via `field_defaults`; identifier `name`; scope: personal.
- Both packs `default_enabled: false`. Goals stays default-on. Default-off = enabled ONLY if the pack key is in the user's `enabled_sections` settings list. `ALWAYS_ON_SECTIONS` semantics unchanged.
- Generic write handler: valid_values violations are ERRORS (❌ naming the valid set) — the coercion behavior is goals-specific and stays in the goals branch. Duplicate identifier on add → `ℹ️ ... already exists`. Every generic top-level id-list entity gets duplicate advisories via the auto-augmented `ADVISORY_ENTITIES`.
- Meta-schema additions are all OPTIONAL fields — every existing manifest must validate unchanged: top-level `default_enabled` (boolean), entity-level `list` (string) and `field_defaults` (object of string→string). The `ui` block stays free-form (`"type": "object"`), so `suggestions`/`array_fields` need no schema change.
- Golden fixture: regenerated once in Task 2 (media+aesthetics added) — the only sanctioned fixture change; `test_registry_golden.py` never edited.
- Frontend: `npm run build` must pass; bespoke editors and their behavior untouched; `frontend/src/lib/sections.js` retired in favor of the API's `packs` metadata.
- Full suite green at the end of every task; tests pinning old shapes updated in-task (list every change in reports).
- Branch `feature/section-packs`; commit per task, exact messages, no Co-Authored-By; backend commands from `backend/` via `./venv/bin/python`; test DB running on localhost:5433. Never `git add` .agents/, .claude/, skills-lock.json. Never reset/rebase/checkout.

## File Structure

```
backend/
  section_packs/meta_schema.json       # MODIFIED (Task 1) — optional default_enabled / list / field_defaults
  section_packs/media/manifest.json    # NEW (Task 2)
  section_packs/aesthetics/manifest.json  # NEW (Task 2)
  section_packs/_template/manifest.json   # MODIFIED (Task 4) — show new fields
  sections.py                          # MODIFIED (Task 1) — DEFAULT_ENABLED, richer PACK_META
  settings_store.py                    # MODIFIED (Task 1) — enabled_sections opt-in model
  main.py                              # MODIFIED (Task 1) — GET/PUT /api/settings extensions
  server.py                            # MODIFIED (Task 2) — generic entity branch + advisory augmentation
  tests/
    fixtures/registry_golden.json      # REGENERATED (Task 2, sanctioned)
    test_default_off_packs.py          # NEW (Task 1)
    test_generic_entities.py           # NEW (Task 2)
frontend/src/
  components/GenericSectionEditor.jsx  # NEW (Task 3)
  App.jsx                              # MODIFIED (Task 3) — dynamic packs wiring
  lib/sections.js                      # DELETED (Task 3)
README.md, docs/CONTRIBUTING-PACKS.md, spec  # MODIFIED (Task 4)
```

---

### Task 1: Default-off packs — manifest flag, settings model, API

**Files:**
- Modify: `backend/section_packs/meta_schema.json` (add optional top-level `default_enabled`; entity-level `list`, `field_defaults`)
- Modify: `backend/sections.py` (DEFAULT_ENABLED map; PACK_META entries gain `default_enabled`, `ui`, `entities`)
- Modify: `backend/settings_store.py` (opt-in model)
- Modify: `backend/main.py` (GET packs entries gain the new fields; PUT accepts `enabled_sections`)
- Test: `backend/tests/test_default_off_packs.py` (new); update `backend/tests/test_settings_api.py` expectations

**Interfaces:**
- Produces: `sections.DEFAULT_ENABLED: dict[str, bool]`; `PACK_META[key]` gains `"default_enabled": bool, "ui": dict, "entities": dict`; `settings_store.get_enabled_optins() -> set[str]`, `settings_store.set_enabled_optins(keys: list[str])`; `enabled_sections()` honors the opt-in model; `PUT /api/settings` body gains optional `enabled_sections: list[str]`. Task 2's packs and Task 3's frontend consume all of these.

- [ ] **Step 1: Meta-schema additions**

In `backend/section_packs/meta_schema.json`: add to top-level `properties`:

```json
    "default_enabled": { "type": "boolean" }
```

and to `$defs.entity.properties`:

```json
        "list": { "type": "string" },
        "field_defaults": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        }
```

(Everything stays optional — `required` arrays unchanged.)

- [ ] **Step 2: Write failing tests**

`backend/tests/test_default_off_packs.py`:

```python
"""Default-off pack model: opt-in via settings.enabled_sections."""
from fastapi.testclient import TestClient

import main
import sections
import settings_store


def _client_and_auth():
    client = TestClient(main.app)
    r = client.post("/api/auth/register", json={"username": "defoff-test-user"})
    return client, {"Authorization": f"Bearer {r.json()['token']}"}


def test_default_enabled_map_covers_all_packs(clean_database):
    assert set(sections.DEFAULT_ENABLED) == set(sections.SECTION_REGISTRY)
    # Everything shipped so far defaults on.
    assert all(sections.DEFAULT_ENABLED.values())


def test_pack_meta_carries_ui_and_entities(clean_database):
    meta = sections.PACK_META["goals"]
    assert meta["default_enabled"] is True
    assert meta["ui"]["goals"]["title_field"] == "title"
    assert "goal" in meta["entities"]


def test_put_settings_accepts_enabled_sections(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings",
                   json={"disabled_sections": [], "enabled_sections": []},
                   headers=auth)
    assert r.status_code == 200
    body = client.get("/api/settings", headers=auth).json()
    assert body["enabled_sections"] == []


def test_put_rejects_unknown_enabled_section(clean_database):
    client, auth = _client_and_auth()
    r = client.put("/api/settings",
                   json={"disabled_sections": [], "enabled_sections": ["bogus"]},
                   headers=auth)
    assert r.status_code == 400


def test_default_off_pack_requires_opt_in(clean_database, monkeypatch):
    # Simulate a default-off pack without needing a real one yet (Task 2 adds them).
    monkeypatch.setitem(sections.DEFAULT_ENABLED, "circle", False)
    assert "circle" not in settings_store.enabled_sections()
    settings_store.set_enabled_optins(["circle"])
    assert "circle" in settings_store.enabled_sections()
```

- [ ] **Step 3: Run to verify failures**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_default_off_packs.py -v`
Expected: FAIL — `AttributeError: module 'sections' has no attribute 'DEFAULT_ENABLED'` etc.

- [ ] **Step 4: Implement**

(a) `backend/sections.py` — after `ALWAYS_ON_SECTIONS`, add and extend:

```python
# Packs marked default_enabled: false are opt-in (settings.enabled_sections).
DEFAULT_ENABLED = {key: m.get("default_enabled", True) for key, m in _MANIFESTS.items()}
```

and replace the `PACK_META` comprehension body with:

```python
PACK_META = {
    key: {
        "title": m["title"],
        "description": m["description"],
        "core": m["core"],
        "default_enabled": m.get("default_enabled", True),
        "ui": m.get("ui", {}),
        "entities": m["entities"],
    }
    for key, m in _MANIFESTS.items()
}
```

(b) `backend/settings_store.py` — add below `set_disabled_sections`:

```python
def get_enabled_optins() -> set[str]:
    """Default-off packs the user has explicitly enabled."""
    return set(get_settings().get("enabled_sections", []))


def set_enabled_optins(keys: list[str]) -> None:
    blob = get_settings()
    blob["enabled_sections"] = list(keys)
    set_settings(blob)
```

and replace `enabled_sections()`:

```python
def enabled_sections() -> set:
    """Registry sections visible to the current user. Core sections are always
    on; default-on packs are on unless disabled; default-off packs are on only
    if explicitly opted in."""
    disabled = get_disabled_sections() - sections.ALWAYS_ON_SECTIONS
    optins = get_enabled_optins()
    result = set()
    for key in sections.SECTION_REGISTRY:
        if key in sections.ALWAYS_ON_SECTIONS:
            result.add(key)
        elif not sections.DEFAULT_ENABLED.get(key, True):
            if key in optins:
                result.add(key)
        elif key not in disabled:
            result.add(key)
    return result
```

(c) `backend/main.py` — `SettingsUpdate` gains a field:

```python
class SettingsUpdate(BaseModel):
    disabled_sections: list[str]
    enabled_sections: list[str] = []
```

`get_settings` response adds `"enabled_sections": sorted(settings_store.get_enabled_optins())` and each packs entry adds the three PACK_META passthroughs:

```python
            {
                "key": key,
                "title": meta["title"],
                "description": meta["description"],
                "core": meta["core"],
                "default_enabled": meta["default_enabled"],
                "ui": meta["ui"],
                "entities": meta["entities"],
                "enabled": key in enabled,
            }
```

`update_settings` validates and persists both lists:

```python
@app.put("/api/settings")
async def update_settings(update: SettingsUpdate):
    requested = set(update.disabled_sections)
    invalid = requested - sections.toggleable_sections()
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot disable: {sorted(invalid)}. "
                   f"Toggleable: {sorted(sections.toggleable_sections())}",
        )
    default_off = {k for k, on in sections.DEFAULT_ENABLED.items() if not on}
    bad_optins = set(update.enabled_sections) - default_off
    if bad_optins:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot opt into: {sorted(bad_optins)}. "
                   f"Opt-in packs: {sorted(default_off)}",
        )
    settings_store.set_disabled_sections(sorted(requested))
    settings_store.set_enabled_optins(sorted(set(update.enabled_sections)))
    return {"status": "saved", "disabled_sections": sorted(requested),
            "enabled_sections": sorted(set(update.enabled_sections))}
```

- [ ] **Step 5: Run new tests, full suite; update pinned tests**

`test_settings_api.py`'s exact-dict assertion for the profile pack entry now needs the three new keys; existing PUT tests keep passing (`enabled_sections` defaults to `[]`). Update in-task.
Run: `./venv/bin/python -m pytest tests/ -q` → green.

- [ ] **Step 6: Commit**

```bash
git add backend/section_packs/meta_schema.json backend/sections.py backend/settings_store.py backend/main.py backend/tests/
git commit -m "feat: default-off pack model — manifest flag, opt-in settings, richer pack metadata API"
```

---

### Task 2: Generic entity write handler + media & aesthetics manifests

**Files:**
- Modify: `backend/server.py` (generic branch at the END of `execute_modify`'s entity chain, before the final unknown-entity return; `ADVISORY_ENTITIES` augmentation after its literal)
- Create: `backend/section_packs/media/manifest.json`, `backend/section_packs/aesthetics/manifest.json`
- Regenerate: `backend/tests/fixtures/registry_golden.json`
- Test: `backend/tests/test_generic_entities.py` (new); update registry/settings pinned tests for 2 new packs

**Interfaces:**
- Produces: any schema entity with a resolvable list and identifier is writable generically; `GENERIC_WRITE_EXCLUDED` not needed — bespoke branches simply come first in the elif chain. Packs `media` (position 55) and `aesthetics` (position 56), both default-off. Task 3 renders them.

- [ ] **Step 1: The two manifests**

`backend/section_packs/media/manifest.json`:

```json
{
  "key": "media",
  "title": "Media",
  "description": "Books, articles, podcasts, shows, and games — planned, in progress, and finished",
  "core": false,
  "position": 55,
  "default_enabled": false,
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
      "detail_fields": ["rating", "url", "notes", "tags"],
      "array_fields": ["tags"]
    }
  }
}
```

`backend/section_packs/aesthetics/manifest.json`:

```json
{
  "key": "aesthetics",
  "title": "Aesthetics",
  "description": "Visual styles, palettes, and influences you prefer or avoid",
  "core": false,
  "position": 56,
  "default_enabled": false,
  "defaults": { "styles": [] },
  "id_lists": [["styles", "aesthetic"]],
  "scope_contributions": { "personal": ["styles"] },
  "entities": {
    "aesthetic": {
      "actions": ["add", "update", "remove"],
      "required": ["name"],
      "optional": ["domain", "stance", "notes", "references"],
      "valid_values": {
        "domain": ["ui", "graphic", "typography", "color", "illustration", "photography", "fashion", "interior", "general"],
        "stance": ["love", "like", "avoid"]
      },
      "identifier": "name",
      "list": "styles",
      "field_defaults": { "stance": "like" }
    }
  },
  "capture_triggers": ["aesthetic", "design style", "vibe", "looks like", "color palette"],
  "ui": {
    "styles": {
      "title_field": "name",
      "badges": ["domain", "stance"],
      "detail_fields": ["notes", "references"],
      "array_fields": ["references"],
      "suggestions": {
        "name": ["Minimalist", "Maximalist", "Brutalist", "Pastel", "Monochrome",
                 "Retro-futurism", "Art deco", "Scandinavian", "Y2K", "Editorial",
                 "Hand-drawn", "Glassmorphism"]
      }
    }
  }
}
```

- [ ] **Step 2: Write failing tests**

`backend/tests/test_generic_entities.py`:

```python
"""Generic schema-driven write path for manifest-only pack entities."""
import server
import settings_store


def _enable(*keys):
    settings_store.set_enabled_optins(list(keys))


def test_media_add_with_validation(clean_database, as_user):
    _enable("media")
    msg = server.execute_modify("add", "media_item",
                                {"title": "Dune", "kind": "book", "status": "want", "tags": ["scifi"]})
    assert msg.startswith("✅")
    [item] = server.load_json("media.json")["items"]
    assert item["title"] == "Dune" and item["kind"] == "book" and item["tags"] == ["scifi"]


def test_media_invalid_enum_errors(clean_database, as_user):
    _enable("media")
    msg = server.execute_modify("add", "media_item", {"title": "X", "kind": "scroll"})
    assert msg.startswith("❌") and "book" in msg  # names the valid set


def test_media_duplicate_identifier(clean_database, as_user):
    _enable("media")
    server.execute_modify("add", "media_item", {"title": "Dune"})
    msg = server.execute_modify("add", "media_item", {"title": "Dune"})
    assert msg.startswith("ℹ️")


def test_media_update_and_remove(clean_database, as_user):
    _enable("media")
    server.execute_modify("add", "media_item", {"title": "Dune", "status": "want"})
    msg = server.execute_modify("update", "media_item", {"title": "Dune", "status": "finished", "rating": "5"})
    assert msg.startswith("✅")
    [item] = server.load_json("media.json")["items"]
    assert item["status"] == "finished" and item["rating"] == "5"
    assert server.execute_modify("remove", "media_item", {"title": "Dune"}).startswith("✅")
    assert server.load_json("media.json")["items"] == []


def test_aesthetic_field_defaults_apply(clean_database, as_user):
    _enable("aesthetics")
    msg = server.execute_modify("add", "aesthetic", {"name": "Minimalist", "domain": "ui"})
    assert msg.startswith("✅")
    [style] = server.load_json("aesthetics.json")["styles"]
    assert style["stance"] == "like"  # field_defaults
    assert style["domain"] == "ui"


def test_disabled_pack_blocks_generic_writes(clean_database, as_user):
    msg = server.execute_modify("add", "media_item", {"title": "Dune"})
    assert msg.startswith("❌") and "disabled" in msg.lower()


def test_generic_entities_get_dupe_advisory_mapping(clean_database):
    assert server.ADVISORY_ENTITIES["media_item"] == ("media", "items")
    assert server.ADVISORY_ENTITIES["aesthetic"] == ("aesthetics", "styles")


def test_unknown_entity_still_errors(clean_database, as_user):
    msg = server.execute_modify("add", "flying_carpet", {"name": "x"})
    assert msg.startswith("❌")
```

(Use the repo's real user fixture — `as_user` per the goals tests; adjust import/usage to match.)

- [ ] **Step 3: Run to verify failures**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_generic_entities.py -v`
Expected: enum/advisory/write tests FAIL (unknown entity error / KeyError); the disabled-pack test may already pass (guard exists) — note which.

- [ ] **Step 4: Implement the generic branch**

In `backend/server.py`, at the END of `execute_modify`'s entity elif chain (immediately before the function's final unknown-entity/unsupported-action return), add:

```python
    elif _generic_entity_spec(entity) is not None:
        section, list_key, espec = _generic_entity_spec(entity)
        blob = load_json(f"{section}.json")
        items = blob.setdefault(list_key, [])
        ident = espec["identifier"]
        value = get_field(data, ident, "name", "title")

        def _validate_enums(payload: dict):
            for f, allowed in espec.get("valid_values", {}).items():
                if f in payload and payload[f] not in allowed:
                    return f"❌ Invalid {f} '{payload[f]}'. Valid: {allowed}"
            return None

        fields = [f for f in espec["required"] + espec["optional"] if f != ident]

        if action == "add":
            if not value:
                return f"❌ {entity} requires '{ident}'"
            idx, _ = find_in_array(items, value, ident)
            if idx != -1:
                return f"ℹ️ {entity} '{value}' already exists"
            item = {ident: value}
            for f in fields:
                v = get_field(data, f)
                if v is not None:
                    item[f] = v
            for f, default in espec.get("field_defaults", {}).items():
                item.setdefault(f, default)
            missing = [f for f in espec["required"] if f not in item]
            if missing:
                return f"❌ {entity} requires {missing}"
            err = _validate_enums(item)
            if err:
                return err
            items.append(item)
            save_json(f"{section}.json", blob)
            return f"✅ Added {entity}: {value}"

        elif action == "update":
            idx, item = find_in_array(items, value or "", ident)
            if idx == -1:
                return f"❌ {entity} '{value}' not found"
            changes = {}
            for f in fields:
                v = get_field(data, f)
                if v is not None:
                    changes[f] = v
            err = _validate_enums(changes)
            if err:
                return err
            item.update(changes)
            new_ident = get_field(data, f"new_{ident}")
            if new_ident:
                item[ident] = new_ident
            save_json(f"{section}.json", blob)
            return f"✅ Updated {entity}: {item[ident]}"

        elif action == "remove":
            idx, _ = find_in_array(items, value or "", ident)
            if idx == -1:
                return f"❌ {entity} '{value}' not found"
            items.pop(idx)
            save_json(f"{section}.json", blob)
            return f"✅ Removed {entity}: {value}"
```

And add the helper just above `execute_modify`:

```python
def _generic_entity_spec(entity: str):
    """(section, list_key, entity_spec) for schema entities the generic write
    branch can handle: top-level id-list entities with an identifier, no
    parent, and a resolvable list (explicit `list` field, or the section's
    sole id_list). Bespoke elif branches always win — this is only consulted
    for entities none of them claimed."""
    section = _section_for_entity(entity)
    if section is None:
        return None
    espec = ENTITY_SCHEMA[section][entity]
    if espec.get("parent") or not espec.get("identifier"):
        return None
    list_key = espec.get("list")
    if not list_key:
        id_lists = sections.SECTION_REGISTRY[section].id_lists
        if len(id_lists) != 1:
            return None
        list_key = id_lists[0][0]
    if not any(lk == list_key for lk, _ in sections.SECTION_REGISTRY[section].id_lists):
        return None
    return section, list_key, espec
```

Then augment `ADVISORY_ENTITIES` immediately after its literal definition:

```python
# Generic pack entities (manifest-only packs) qualify automatically: any
# top-level id-list entity the generic write branch handles gets the same
# duplicate-advisory coverage as the hand-listed entities above.
ADVISORY_ENTITIES.update({
    entity: (spec[0], spec[1])
    for section_entities in ENTITY_SCHEMA.values()
    for entity in section_entities
    if entity not in ADVISORY_ENTITIES
    and (spec := _generic_entity_spec(entity)) is not None
})
```

- [ ] **Step 5: Run new tests, regenerate golden, full suite**

Run: `./venv/bin/python -m pytest tests/test_generic_entities.py -v` → all pass.
Regenerate the golden fixture with the exact same script as the Phase 2 plan's Task 1 Step 8 (unchanged), then run the full suite. Pinned tests to update in-task: `test_sections_registry.py` (toggleable now includes media/aesthetics), `test_settings_api.py` (packs list gains 2 entries in position order ... goals, knowledge, preferences, projects, lifestyle, media, aesthetics, circle? — positions: 55/56 land AFTER lifestyle (50) and BEFORE circle (60); assert the true computed order), `test_default_off_packs.py::test_default_enabled_map_covers_all_packs` (drop the "all True" assertion — assert media/aesthetics are False instead).
Run: `./venv/bin/python -m pytest tests/ -q` → green.

- [ ] **Step 6: Commit**

```bash
git add backend/section_packs/media backend/section_packs/aesthetics backend/server.py backend/tests/
git commit -m "feat: generic schema-driven writes + media and aesthetics packs (manifest-only)

Deliberate behavior change: golden fixture regenerated (two new packs)."
```

---

### Task 3: Frontend — GenericSectionEditor + dynamic pack wiring

**Files:**
- Create: `frontend/src/components/GenericSectionEditor.jsx`
- Modify: `frontend/src/App.jsx` (six touch points below)
- Delete: `frontend/src/lib/sections.js`

**Interfaces:**
- Consumes: `GET /api/settings` packs entries (`key,title,description,core,default_enabled,ui,entities,enabled`), `GET /api/all` (returns every enabled section keyed by file_type), `PUT /api/files/{key}`, `PUT /api/settings` (both lists).
- Produces: every enabled pack WITHOUT a bespoke editor gets a working tab; Manage sections drives both settings lists.

- [ ] **Step 1: GenericSectionEditor**

`frontend/src/components/GenericSectionEditor.jsx` — complete component:

```jsx
import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import ArrayInput from "@/components/ArrayInput";

const LONG_TEXT_FIELDS = new Set(["notes", "why", "description"]);

function FieldInput({ field, value, onChange, entity, arrayFields }) {
  const enums = entity.valid_values?.[field];
  if (enums) {
    return (
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">—</option>
        {enums.map((v) => (
          <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
        ))}
      </select>
    );
  }
  if (arrayFields.includes(field)) {
    return <ArrayInput value={value || []} onChange={onChange} placeholder={`Add ${field}…`} />;
  }
  if (LONG_TEXT_FIELDS.has(field)) {
    return <Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2} />;
  }
  return <Input value={value || ""} onChange={(e) => onChange(e.target.value)} />;
}

function PackList({ listKey, uiSpec, entityName, entity, items, onItems, onShowConfirmation }) {
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const titleField = uiSpec.title_field;
  const badges = uiSpec.badges || [];
  const detailFields = uiSpec.detail_fields || [];
  const arrayFields = uiSpec.array_fields || [];
  const suggestions = uiSpec.suggestions?.[titleField] || [];
  const existingTitles = new Set(items.map((i) => (i[titleField] || "").toLowerCase()));
  const editFields = [...new Set([...badges, ...detailFields])];

  const addItem = (base) => {
    const item = { ...(entity.field_defaults || {}), ...base };
    if (!item[titleField]) return;
    if (existingTitles.has(item[titleField].toLowerCase())) return;
    onItems([item, ...items]);
  };

  const updateItem = (idx, field, value) => {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: value };
    if (value === undefined || value === "") delete next[idx][field];
    onItems(next);
  };

  const removeItem = (idx) => {
    const doRemove = () => onItems(items.filter((_, i) => i !== idx));
    if (onShowConfirmation) {
      onShowConfirmation(
        `Remove ${items[idx][titleField]}?`,
        "This can't be undone.",
        doRemove
      );
    } else doRemove();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? "entry" : "entries"}
        </div>
        <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setDraft({}); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add {entityName.replace(/_/g, " ")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs capitalize">{titleField}</Label>
                <Input
                  value={draft[titleField] || ""}
                  onChange={(e) => setDraft({ ...draft, [titleField]: e.target.value })}
                  autoFocus
                />
              </div>
              {editFields.map((f) => (
                <div key={f}>
                  <Label className="text-xs capitalize">{f.replace(/_/g, " ")}</Label>
                  <FieldInput field={f} value={draft[f]} entity={entity} arrayFields={arrayFields}
                    onChange={(v) => setDraft({ ...draft, [f]: v })} />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => { addItem(draft); setAddOpen(false); setDraft({}); }}
                disabled={!draft[titleField]}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Suggested — tap to add
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions
              .filter((s) => !existingTitles.has(s.toLowerCase()))
              .map((s) => (
                <button key={s} type="button"
                  onClick={() => addItem({ [titleField]: s })}
                  className="rounded-full border border-input bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50">
                  + {s}
                </button>
              ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState>Nothing here yet — add your first entry above.</EmptyState>
      ) : (
        <div className="rounded-md border">
          {items.map((item, idx) => (
            <div key={item.id || `${item[titleField]}-${idx}`}
              className="border-b border-border last:border-b-0">
              <div className="flex cursor-pointer items-center gap-2 px-3 py-2.5 hover:bg-muted/40"
                onClick={() => setExpanded({ ...expanded, [idx]: !expanded[idx] })}>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded[idx] ? "" : "-rotate-90"}`} />
                <span className="truncate text-sm font-medium">{item[titleField]}</span>
                <span className="flex flex-1 items-center gap-1.5">
                  {badges.filter((b) => item[b]).map((b) => (
                    <Badge key={b} variant="secondary" className="text-[10px]">
                      {String(item[b]).replace(/_/g, " ")}
                    </Badge>
                  ))}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={(e) => { e.stopPropagation(); removeItem(idx); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {expanded[idx] && (
                <div className="grid gap-3 px-9 pb-3 sm:grid-cols-2">
                  {editFields.map((f) => (
                    <div key={f} className={LONG_TEXT_FIELDS.has(f) || arrayFields.includes(f) ? "sm:col-span-2" : ""}>
                      <Label className="text-xs capitalize">{f.replace(/_/g, " ")}</Label>
                      <FieldInput field={f} value={item[f]} entity={entity} arrayFields={arrayFields}
                        onChange={(v) => updateItem(idx, f, v)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GenericSectionEditor({ pack, data, onChange, onShowConfirmation }) {
  const ui = pack.ui || {};
  const entityByList = {};
  for (const [entityName, espec] of Object.entries(pack.entities || {})) {
    if (espec.list) entityByList[espec.list] = { entityName, espec };
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{pack.title}</CardTitle>
        <CardDescription>{pack.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(ui).map(([listKey, uiSpec]) => {
          const entityNames = Object.keys(pack.entities || {});
          const mapping = entityByList[listKey] ||
            (entityNames.length === 1
              ? { entityName: entityNames[0], espec: pack.entities[entityNames[0]] }
              : null);
          if (!mapping) return null;
          return (
            <PackList
              key={listKey}
              listKey={listKey}
              uiSpec={uiSpec}
              entityName={mapping.entityName}
              entity={mapping.espec}
              items={Array.isArray(data?.[listKey]) ? data[listKey] : []}
              onItems={(next) => onChange({ ...(data || {}), [listKey]: next })}
              onShowConfirmation={onShowConfirmation}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: App.jsx wiring (six touch points)**

(a) Imports: add `import GenericSectionEditor from "@/components/GenericSectionEditor";` and `Package, Target, Film, Palette` to the lucide-react import; remove the `SECTION_LABELS`/`SECTION_DESCRIPTIONS` import.

(b) State: add `const [packs, setPacks] = useState([]);` and `const [packData, setPackData] = useState({});` (keyed by section key for sections WITHOUT bespoke editors). Add above the component:

```jsx
const BESPOKE_EDITORS = new Set(["profile", "knowledge", "preferences", "projects", "lifestyle", "circle", "learning_log"]);
const PACK_ICONS = { goals: Target, media: Film, aesthetics: Palette };
```

(c) `loadSettings()`: also `setPacks(s.packs || []);` and keep existing state updates. Store `enabled_sections` if present: `setEnabledOptins(s.enabled_sections || [])` (new state `enabledOptins`).

(d) `loadAllData()`: after the existing destructure, collect the rest generically:

```jsx
      const known = new Set([...BESPOKE_EDITORS]);
      const rest = {};
      for (const [k, v] of Object.entries(response.data || {})) {
        if (!known.has(k)) rest[k] = v;
      }
      setPackData(rest);
```

(e) Save paths: one generic handler + inclusion in `saveAll`:

```jsx
  const handlePackChange = (key) => (newData) => {
    setPackData((prev) => ({ ...prev, [key]: newData }));
    setHasUnsavedChanges(true);
    if (isAutosaveEnabled) debouncedSave(key, newData);
  };
```

and in `saveAll()`'s body object spread `...packData` alongside the named keys. (Match the exact local naming conventions in the file — `setHasUnsavedChanges` etc. exist already; mirror what the bespoke `handleXChange` functions do.)

(f) Tabs: after the hardcoded `TabsTrigger` for learning_log-and-friends, render dynamic triggers and contents:

```jsx
  const dynamicPacks = packs.filter((p) => p.enabled && !BESPOKE_EDITORS.has(p.key));
```

```jsx
  {dynamicPacks.map((p) => {
    const Icon = PACK_ICONS[p.key] || Package;
    return (
      <TabsTrigger key={p.key} value={p.key} className="...same classes as siblings...">
        <Icon className="h-4 w-4" /><span>{p.title}</span>
      </TabsTrigger>
    );
  })}
```

```jsx
  {dynamicPacks.map((p) => (
    <TabsContent key={p.key} value={p.key} className="...same classes as siblings...">
      <GenericSectionEditor pack={p} data={packData[p.key]}
        onChange={handlePackChange(p.key)} onShowConfirmation={showConfirmation} />
    </TabsContent>
  ))}
```

(Copy the exact `className` strings and `onShowConfirmation` prop name from the neighboring hardcoded blocks — do not invent new ones.)

(g) Manage sections tab: replace the `toggleable`/`SECTION_LABELS` rendering with the packs array — one row per `packs.filter(p => !p.core)` showing `p.title`/`p.description` and a toggle bound to `p.enabled`. On toggle, recompute BOTH lists and PUT:

```jsx
  const togglePack = async (key, wantEnabled) => {
    const next = packs.map((p) => (p.key === key ? { ...p, enabled: wantEnabled } : p));
    const disabled = next.filter((p) => !p.core && p.default_enabled && !p.enabled).map((p) => p.key);
    const optins = next.filter((p) => !p.default_enabled && p.enabled).map((p) => p.key);
    setPacks(next);
    await api("/settings", { method: "PUT", body: JSON.stringify({ disabled_sections: disabled, enabled_sections: optins }) });
    await loadSettings();
    await loadAllData();  // newly-enabled sections need their data
  };
```

Keep the existing visual row/toggle components; only the data source changes. Delete `frontend/src/lib/sections.js` and every import of it.

- [ ] **Step 3: Build + manual smoke via tests**

Run: `cd frontend && npm run build` → must succeed.
Run backend suite (unchanged): `cd ../backend && ./venv/bin/python -m pytest tests/ -q` → green.
There is no frontend test infra; the reviewer gate is the build plus code review. In your report, walk through the manual flow you traced: enable media in Manage sections → media tab appears → add item via dialog and via suggestion chip (aesthetics) → toggle off → tab disappears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GenericSectionEditor.jsx frontend/src/App.jsx
git rm frontend/src/lib/sections.js
git commit -m "feat: manifest-driven GenericSectionEditor + dynamic pack tabs and toggles"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`, `docs/CONTRIBUTING-PACKS.md`, `docs/superpowers/specs/2026-07-23-modular-section-packs-design.md`, `backend/section_packs/_template/manifest.json`

**Interfaces:** Documentation only; suite + frontend build stay green.

- [ ] **Step 1: Edits**

1. `README.md`: section-scopes list gains `media`, `aesthetics`; entities table gains `media_item` and `aesthetic` rows (fields per Global Constraints); roadmap gains `- [x] Media and aesthetics packs — manifest-only sections with a generic schema-driven write path and manifest-driven web editor`. Note under the section-packs blurb: add-on packs can ship `default_enabled: false` (opt-in via Manage sections).
2. `docs/CONTRIBUTING-PACKS.md`: document the new manifest fields — `default_enabled`, entity `list` (required for the generic write path when a section has >1 id_list; recommended always), `field_defaults`, and the `ui` extensions (`array_fields`, `suggestions`); state that manifest-only entities are writable automatically (no server code) and rendered automatically by the web editor.
3. Spec: in Part 1's manifest example, re-add `"list": "items"` to the entity (now schema-supported) with no other changes.
4. `backend/section_packs/_template/manifest.json`: add `"default_enabled": false`, entity `"list": "items"`, and a `"suggestions"` example in `ui` (two or three values), keeping it valid against the meta-schema (verify by boot or a loader test run).

- [ ] **Step 2: Verify**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_pack_loader.py tests/ -q` → green (template stays inert and valid).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/CONTRIBUTING-PACKS.md docs/superpowers/specs/2026-07-23-modular-section-packs-design.md backend/section_packs/_template/manifest.json
git commit -m "docs: manifest-only pack authoring — default_enabled, list, field_defaults, ui extensions"
```

---

## Completion Criteria

- Full backend suite green; frontend builds.
- `media_item`/`aesthetic` writable via MCP with enum validation, defaults, dupe advisories — zero server code specific to them.
- Both packs default-off; opt-in via Manage sections; goals/media/aesthetics all render in the web UI via GenericSectionEditor (goals gets its editor for free).
- `get_schema` advertises both new entities; search indexes their entries (id_lists-driven, automatic).
