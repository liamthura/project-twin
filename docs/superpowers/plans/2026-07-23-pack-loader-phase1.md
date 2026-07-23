# Section Pack Loader + Core Retrofit (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four hardcoded section-definition sites (sections.py registry, server.py ENTITY_SCHEMA, and their consumers) with declarative per-section `manifest.json` packs loaded and validated at boot — with provably zero behavior change.

**Architecture:** A new `pack_loader.py` scans `backend/section_packs/*/manifest.json`, validates each against a JSON meta-schema (invalid pack → warn + skip; cross-pack collision → fail fast), and exposes cached manifests. `sections.py` builds `SECTION_REGISTRY`/`ALWAYS_ON_SECTIONS` from the loader; `server.py` builds `ENTITY_SCHEMA` from it. All downstream modules (persona_store, search_index, settings_store, main) are untouched. A golden-snapshot test pins the current structures before any refactor and must stay green through every task.

**Tech Stack:** Python 3.11+, jsonschema (new dep), pytest, existing docker-compose test Postgres.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-modular-section-packs-design.md` (Part 1 only — Phase 1 adds NO new packs, NO goals, NO UI).
- Zero behavior change: the golden test (Task 1) must pass unmodified after every subsequent task.
- Invalid manifest → `logging.warning` + skip; server must still boot. Entity-name or id-prefix collision across packs → raise `PackError` (fail fast).
- Section order matters (`VALID_FILES`, API iteration): manifests carry integer `position`; loader sorts by `(position, key)`. Existing order to preserve: profile, knowledge, preferences, projects, lifestyle, circle, learning_log.
- Requirements are pinned exactly (repo convention): add `jsonschema==4.25.1`.
- All tests run from `backend/` with the docker test DB up: `docker compose up -d` (Postgres on localhost:5433). Test command prefix: `./venv/bin/python -m pytest`.
- Directory names starting with `_` inside `section_packs/` are skipped by the loader (used by `_template`).
- Work on branch `feature/section-packs`. Commit after every task.

## File Structure

```
backend/
  pack_loader.py                     # NEW — scan, validate, invariants, cache
  section_packs/
    meta_schema.json                 # NEW — JSON Schema for manifests
    _template/manifest.json          # NEW (Task 8) — copy-me example, skipped by loader
    profile/manifest.json            # NEW (Task 4) — generated from current code
    knowledge/manifest.json          #   "
    preferences/manifest.json        #   "
    projects/manifest.json           #   "
    lifestyle/manifest.json          #   "
    circle/manifest.json             #   "
    learning_log/manifest.json       #   "
  sections.py                        # MODIFIED (Task 5) — registry built from loader
  server.py                          # MODIFIED (Task 6) — ENTITY_SCHEMA from loader (lines ~2307-2411)
  main.py                            # MODIFIED (Task 7) — GET /api/settings gains "packs"
  requirements.txt                   # MODIFIED (Task 2) — + jsonschema==4.25.1
  tests/
    fixtures/registry_golden.json    # NEW (Task 1) — generated snapshot
    test_registry_golden.py          # NEW (Task 1)
    test_pack_loader.py              # NEW (Tasks 2-4)
docs/CONTRIBUTING-PACKS.md           # NEW (Task 8)
```

---

### Task 1: Golden snapshot of current registry + entity schema

**Files:**
- Create: `backend/tests/fixtures/registry_golden.json` (generated)
- Test: `backend/tests/test_registry_golden.py`

**Interfaces:**
- Produces: `tests/fixtures/registry_golden.json` with keys `section_order` (list), `always_on_sections` (sorted list), `section_registry` (dict key → `{key, default, id_lists, context_fields}` with `id_lists` as list-of-2-lists), `entity_schema` (verbatim `server.ENTITY_SCHEMA`). Later tasks must keep `test_registry_golden.py` green.

- [ ] **Step 1: Generate the fixture from the CURRENT hardcoded code**

```bash
cd backend && docker compose up -d && mkdir -p tests/fixtures
DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test ./venv/bin/python - <<'EOF'
import json, sections, server

def norm_spec(spec):
    return {
        "key": spec.key,
        "default": spec.default,
        "id_lists": [list(t) for t in spec.id_lists],
        "context_fields": spec.context_fields,
    }

snapshot = {
    "section_order": list(sections.SECTION_REGISTRY),
    "always_on_sections": sorted(sections.ALWAYS_ON_SECTIONS),
    "section_registry": {k: norm_spec(v) for k, v in sections.SECTION_REGISTRY.items()},
    "entity_schema": server.ENTITY_SCHEMA,
}
with open("tests/fixtures/registry_golden.json", "w") as f:
    json.dump(snapshot, f, indent=2, sort_keys=True)
print("wrote", len(json.dumps(snapshot)), "bytes")
EOF
```

Expected: `wrote <N> bytes` (N > 10000). Eyeball the file: 7 sections, entity_schema has profile/lifestyle/knowledge/projects/circle/preferences/learning_log.

- [ ] **Step 2: Write the golden test**

```python
# backend/tests/test_registry_golden.py
"""Golden snapshot guard for the pack-loader refactor (Phase 1).

Pins the exact section registry and entity schema as they were BEFORE the
refactor. Every refactor task must keep this green. If this test fails, the
refactor changed behavior — fix the refactor, never the fixture.
"""
import json
from pathlib import Path

import sections
import server

FIXTURE = Path(__file__).parent / "fixtures" / "registry_golden.json"


def _norm_spec(spec):
    return {
        "key": spec.key,
        "default": spec.default,
        "id_lists": [list(t) for t in spec.id_lists],
        "context_fields": spec.context_fields,
    }


def test_section_registry_matches_golden():
    golden = json.loads(FIXTURE.read_text())
    assert list(sections.SECTION_REGISTRY) == golden["section_order"]
    assert sorted(sections.ALWAYS_ON_SECTIONS) == golden["always_on_sections"]
    current = {k: _norm_spec(v) for k, v in sections.SECTION_REGISTRY.items()}
    assert current == golden["section_registry"]


def test_entity_schema_matches_golden():
    golden = json.loads(FIXTURE.read_text())
    assert server.ENTITY_SCHEMA == golden["entity_schema"]
```

- [ ] **Step 3: Run the golden test — must pass against the unrefactored code**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_registry_golden.py -v`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/fixtures/registry_golden.json backend/tests/test_registry_golden.py
git commit -m "test: golden snapshot of section registry + entity schema before pack refactor"
```

---

### Task 2: Meta-schema, jsonschema dependency, and manifest validation

**Files:**
- Create: `backend/section_packs/meta_schema.json`
- Create: `backend/pack_loader.py`
- Modify: `backend/requirements.txt` (append to the deps list)
- Test: `backend/tests/test_pack_loader.py`

**Interfaces:**
- Produces: `pack_loader.PackError(Exception)`; `pack_loader.validate_manifest(manifest: dict) -> None` (raises `PackError` with a readable message on schema violation); `pack_loader.META_SCHEMA_PATH: Path`; `pack_loader.GLOBAL_SCOPE_NAMES = frozenset({"minimal","professional","personal","learning","full"})`.

- [ ] **Step 1: Add the dependency**

Append to `backend/requirements.txt` under the existing list:

```
# Section pack manifest validation (boot-time)
jsonschema==4.25.1
```

Run: `cd backend && ./venv/bin/pip install jsonschema==4.25.1`
Expected: `Successfully installed ... jsonschema-4.25.1` (or already satisfied).

- [ ] **Step 2: Write the meta-schema**

Save the following as `backend/section_packs/meta_schema.json` (JSON — no comments allowed in the file):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MyGist section pack manifest",
  "type": "object",
  "required": ["key", "title", "description", "core", "position", "defaults", "id_lists", "entities"],
  "additionalProperties": false,
  "properties": {
    "key": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "title": { "type": "string", "minLength": 1 },
    "description": { "type": "string", "minLength": 1 },
    "core": { "type": "boolean" },
    "position": { "type": "integer", "minimum": 0 },
    "defaults": { "type": "object" },
    "id_lists": {
      "type": "array",
      "items": {
        "type": "array",
        "prefixItems": [{ "type": "string" }, { "type": "string" }],
        "minItems": 2,
        "maxItems": 2,
        "items": false
      }
    },
    "scope_contributions": {
      "type": "object",
      "additionalProperties": { "type": "array", "items": { "type": "string" } }
    },
    "entities": {
      "type": "object",
      "minProperties": 1,
      "propertyNames": { "pattern": "^[a-z][a-z0-9_]*$" },
      "additionalProperties": { "$ref": "#/$defs/entity" }
    },
    "capture_triggers": { "type": "array", "items": { "type": "string" } },
    "ui": { "type": "object" }
  },
  "$defs": {
    "entity": {
      "type": "object",
      "required": ["actions", "required", "optional", "identifier"],
      "additionalProperties": false,
      "properties": {
        "actions": {
          "type": "array",
          "items": { "enum": ["add", "update", "remove"] },
          "minItems": 1,
          "uniqueItems": true
        },
        "required": { "type": "array", "items": { "type": "string" } },
        "optional": { "type": "array", "items": { "type": "string" } },
        "valid_values": {
          "type": "object",
          "additionalProperties": { "type": "array", "items": { "type": "string" } }
        },
        "identifier": { "type": ["string", "null"] },
        "parent": { "type": "string" },
        "description": { "type": "string" }
      }
    }
  }
}
```

- [ ] **Step 3: Write failing tests for validate_manifest**

```python
# backend/tests/test_pack_loader.py
import copy

import pytest

import pack_loader

MINIMAL = {
    "key": "demo",
    "title": "Demo",
    "description": "A demo pack",
    "core": False,
    "position": 99,
    "defaults": {"items": []},
    "id_lists": [["items", "demo"]],
    "entities": {
        "demo_item": {
            "actions": ["add", "remove"],
            "required": ["name"],
            "optional": ["notes"],
            "identifier": "name",
        }
    },
}


def test_validate_accepts_minimal_manifest():
    pack_loader.validate_manifest(copy.deepcopy(MINIMAL))  # must not raise


def test_validate_rejects_missing_required_field():
    bad = copy.deepcopy(MINIMAL)
    del bad["defaults"]
    with pytest.raises(pack_loader.PackError, match="defaults"):
        pack_loader.validate_manifest(bad)


def test_validate_rejects_unknown_action():
    bad = copy.deepcopy(MINIMAL)
    bad["entities"]["demo_item"]["actions"] = ["add", "obliterate"]
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(bad)


def test_validate_rejects_extra_top_level_key():
    bad = copy.deepcopy(MINIMAL)
    bad["surprise"] = True
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(bad)
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_pack_loader.py -v`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'pack_loader'`.

- [ ] **Step 5: Implement pack_loader validation**

```python
# backend/pack_loader.py
"""Loader for declarative section packs (backend/section_packs/*/manifest.json).

Each pack is one manifest validated against meta_schema.json. Invalid packs
are skipped with a warning (the server must always boot); cross-pack
collisions (duplicate entity names or id prefixes) raise PackError because
they are packaging bugs, not user data. sections.py and server.py build
their registry/entity-schema views from manifests() — this module must not
import either of them (they import us).
"""
import json
import logging
from pathlib import Path

import jsonschema

logger = logging.getLogger(__name__)

PACKS_DIR = Path(__file__).parent / "section_packs"
META_SCHEMA_PATH = PACKS_DIR / "meta_schema.json"

# Mirrors sections.SCOPES keys; asserted equal in tests to prevent drift.
GLOBAL_SCOPE_NAMES = frozenset({"minimal", "professional", "personal", "learning", "full"})


class PackError(Exception):
    """A manifest is invalid or two packs collide."""


_meta_validator = None


def _validator() -> jsonschema.Draft202012Validator:
    global _meta_validator
    if _meta_validator is None:
        schema = json.loads(META_SCHEMA_PATH.read_text())
        _meta_validator = jsonschema.Draft202012Validator(schema)
    return _meta_validator


def validate_manifest(manifest: dict) -> None:
    """Schema + intra-pack cross-reference checks. Raises PackError."""
    errors = sorted(_validator().iter_errors(manifest), key=lambda e: list(e.path))
    if errors:
        first = errors[0]
        where = "/".join(str(p) for p in first.path) or "<root>"
        raise PackError(f"manifest schema violation at {where}: {first.message}")

    defaults = manifest["defaults"]
    for list_key, _prefix in manifest["id_lists"]:
        if not isinstance(defaults.get(list_key), list):
            raise PackError(
                f"id_lists references '{list_key}' which is not a list in defaults"
            )
    for scope in manifest.get("scope_contributions", {}):
        if scope not in GLOBAL_SCOPE_NAMES:
            raise PackError(f"unknown scope '{scope}' in scope_contributions")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_pack_loader.py -v`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/section_packs/meta_schema.json backend/pack_loader.py backend/requirements.txt backend/tests/test_pack_loader.py
git commit -m "feat: pack manifest meta-schema and validate_manifest"
```

---

### Task 3: load_packs — directory scan, skip-invalid, cross-pack invariants, cache

**Files:**
- Modify: `backend/pack_loader.py` (append)
- Test: `backend/tests/test_pack_loader.py` (append)

**Interfaces:**
- Consumes: `validate_manifest`, `PackError` from Task 2.
- Produces: `pack_loader.load_packs(packs_dir: Path = PACKS_DIR) -> dict[str, dict]` — manifests keyed by pack key, ordered by `(position, key)`; skips `_`-prefixed dirs, non-dirs, and invalid manifests (with `logger.warning`); raises `PackError` on cross-pack entity-name or id-prefix collision, or if a manifest's `key` ≠ its directory name (that one is skip+warn). Also `pack_loader.manifests() -> dict[str, dict]` (cached `load_packs(PACKS_DIR)`), and `pack_loader._reset_cache()` for tests.

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_pack_loader.py`:

```python
import json as _json


def _write_pack(root, key, mutate=None, dirname=None):
    m = copy.deepcopy(MINIMAL)
    m["key"] = key
    m["entities"] = {
        f"{key}_item": {
            "actions": ["add", "remove"],
            "required": ["name"],
            "optional": [],
            "identifier": "name",
        }
    }
    m["id_lists"] = [["items", key]]
    if mutate:
        mutate(m)
    d = root / (dirname or key)
    d.mkdir()
    (d / "manifest.json").write_text(_json.dumps(m))
    return m


def test_load_packs_loads_and_orders(tmp_path):
    _write_pack(tmp_path, "bbb", mutate=lambda m: m.update(position=20))
    _write_pack(tmp_path, "aaa", mutate=lambda m: m.update(position=10))
    packs = pack_loader.load_packs(tmp_path)
    assert list(packs) == ["aaa", "bbb"]


def test_load_packs_skips_invalid_manifest_with_warning(tmp_path, caplog):
    _write_pack(tmp_path, "good")
    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    (bad_dir / "manifest.json").write_text("{not json")
    with caplog.at_level("WARNING"):
        packs = pack_loader.load_packs(tmp_path)
    assert list(packs) == ["good"]
    assert any("bad" in r.message for r in caplog.records)


def test_load_packs_skips_underscore_dirs(tmp_path):
    _write_pack(tmp_path, "real")
    _write_pack(tmp_path, "template", dirname="_template")
    assert list(pack_loader.load_packs(tmp_path)) == ["real"]


def test_load_packs_skips_key_dir_mismatch(tmp_path, caplog):
    _write_pack(tmp_path, "sneaky", dirname="honest")
    with caplog.at_level("WARNING"):
        packs = pack_loader.load_packs(tmp_path)
    assert packs == {}


def test_load_packs_raises_on_entity_collision(tmp_path):
    _write_pack(tmp_path, "one")
    _write_pack(tmp_path, "two",
                mutate=lambda m: m["entities"].update({"one_item": m["entities"]["two_item"]}))
    with pytest.raises(pack_loader.PackError, match="one_item"):
        pack_loader.load_packs(tmp_path)


def test_load_packs_raises_on_prefix_collision(tmp_path):
    _write_pack(tmp_path, "one")
    _write_pack(tmp_path, "two", mutate=lambda m: m.update(id_lists=[["items", "one"]]))
    with pytest.raises(pack_loader.PackError, match="prefix"):
        pack_loader.load_packs(tmp_path)


def test_manifests_is_cached(tmp_path, monkeypatch):
    calls = []
    real = pack_loader.load_packs

    def counting(packs_dir=pack_loader.PACKS_DIR):
        calls.append(1)
        return real(packs_dir)

    monkeypatch.setattr(pack_loader, "load_packs", counting)
    pack_loader._reset_cache()
    pack_loader.manifests()
    pack_loader.manifests()
    assert len(calls) == 1
    pack_loader._reset_cache()
```

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_pack_loader.py -v`
Expected: new tests FAIL with `AttributeError: ... no attribute 'load_packs'`.

- [ ] **Step 3: Implement**

Append to `backend/pack_loader.py`:

```python
def load_packs(packs_dir: Path = PACKS_DIR) -> dict[str, dict]:
    """Scan packs_dir for <key>/manifest.json. Invalid → warn + skip.
    Cross-pack collisions → PackError. Returns manifests ordered by
    (position, key)."""
    loaded: list[dict] = []
    for entry in sorted(packs_dir.iterdir()) if packs_dir.exists() else []:
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        path = entry / "manifest.json"
        if not path.exists():
            logger.warning("section pack %s: no manifest.json — skipped", entry.name)
            continue
        try:
            manifest = json.loads(path.read_text())
            validate_manifest(manifest)
            if manifest["key"] != entry.name:
                raise PackError(
                    f"key '{manifest['key']}' does not match directory '{entry.name}'"
                )
        except (PackError, json.JSONDecodeError, OSError) as exc:
            logger.warning("section pack %s: invalid manifest — skipped (%s)", entry.name, exc)
            continue
        loaded.append(manifest)

    seen_entities: dict[str, str] = {}
    seen_prefixes: dict[str, str] = {}
    for m in loaded:
        for entity in m["entities"]:
            if entity in seen_entities:
                raise PackError(
                    f"entity '{entity}' defined by both '{seen_entities[entity]}' and '{m['key']}'"
                )
            seen_entities[entity] = m["key"]
        for _list_key, prefix in m["id_lists"]:
            if prefix in seen_prefixes and seen_prefixes[prefix] != m["key"]:
                raise PackError(
                    f"id prefix '{prefix}' used by both '{seen_prefixes[prefix]}' and '{m['key']}'"
                )
            seen_prefixes[prefix] = m["key"]

    loaded.sort(key=lambda m: (m["position"], m["key"]))
    return {m["key"]: m for m in loaded}


_cache: dict | None = None


def manifests() -> dict[str, dict]:
    """Cached load of the real packs directory (call _reset_cache() in tests)."""
    global _cache
    if _cache is None:
        _cache = load_packs(PACKS_DIR)
    return _cache


def _reset_cache() -> None:
    global _cache
    _cache = None


def build_entity_schema(packs: dict[str, dict]) -> dict[str, dict]:
    """{section_key: entities} in pack order — server.ENTITY_SCHEMA shape."""
    return {key: m["entities"] for key, m in packs.items()}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_pack_loader.py -v`
Expected: all pass (11 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/pack_loader.py backend/tests/test_pack_loader.py
git commit -m "feat: load_packs with skip-invalid, cross-pack invariants, cache"
```

---

### Task 4: Generate the seven core manifests + parity test

**Files:**
- Create: `backend/section_packs/{profile,knowledge,preferences,projects,lifestyle,circle,learning_log}/manifest.json` (generated)
- Test: `backend/tests/test_pack_loader.py` (append)

**Interfaces:**
- Consumes: current (still hardcoded) `sections.SECTION_REGISTRY` and `server.ENTITY_SCHEMA` as the generation source; `pack_loader.load_packs`.
- Produces: seven manifests whose loader output exactly reproduces the legacy structures. Titles/descriptions/core/position are fixed here and consumed by Task 7's API field.

- [ ] **Step 1: Generate manifests from the live legacy structures**

```bash
cd backend && DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test ./venv/bin/python - <<'EOF'
import json
from pathlib import Path
import sections, server

META = {
    "profile":      ("Profile",      "Identity, work, education, contact",        True,  10),
    "knowledge":    ("Knowledge",    "Domains you know and topics you track",     False, 20),
    "preferences":  ("Preferences",  "Communication style, code style, dislikes", True,  30),
    "projects":     ("Projects",     "Active work and current learning",          False, 40),
    "lifestyle":    ("Lifestyle",    "Hobbies, values, and routines",             False, 50),
    "circle":       ("Circle",       "People and relationships",                  False, 60),
    "learning_log": ("Learning Log", "What you learn, decide, and reflect on",    True,  70),
}
assert set(META) == set(sections.SECTION_REGISTRY), "META out of sync with registry"

for key, spec in sections.SECTION_REGISTRY.items():
    title, desc, core, pos = META[key]
    manifest = {
        "key": key, "title": title, "description": desc,
        "core": core, "position": pos,
        "defaults": spec.default,
        "id_lists": [list(t) for t in spec.id_lists],
        "scope_contributions": spec.context_fields,
        "entities": server.ENTITY_SCHEMA[key],
    }
    d = Path("section_packs") / key
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("wrote", d / "manifest.json")
EOF
```

Expected: seven `wrote section_packs/<key>/manifest.json` lines.

- [ ] **Step 2: Write the parity test (legacy vs manifests — both still exist)**

Append to `backend/tests/test_pack_loader.py`:

```python
def test_core_manifests_reproduce_legacy_registry():
    """While sections.py/server.py are still hardcoded, the generated
    manifests must reproduce them exactly. After Tasks 5-6 flip those
    modules onto the loader, this becomes a tautology and the golden
    test carries the guarantee instead."""
    import sections
    import server

    packs = pack_loader.load_packs()
    assert list(packs) == list(sections.SECTION_REGISTRY)
    for key, spec in sections.SECTION_REGISTRY.items():
        m = packs[key]
        assert m["defaults"] == spec.default, key
        assert [tuple(t) for t in m["id_lists"]] == list(spec.id_lists), key
        assert m.get("scope_contributions", {}) == spec.context_fields, key
    assert pack_loader.build_entity_schema(packs) == server.ENTITY_SCHEMA
    core = {k for k, m in packs.items() if m["core"]}
    assert core == set(sections.ALWAYS_ON_SECTIONS)
```

- [ ] **Step 3: Run the test**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_pack_loader.py::test_core_manifests_reproduce_legacy_registry -v`
Expected: PASS. If it fails, the generator missed something — fix generation, never hand-edit toward green.

- [ ] **Step 4: Commit**

```bash
git add backend/section_packs/*/manifest.json backend/tests/test_pack_loader.py
git commit -m "feat: seven core section manifests generated from legacy structures"
```

---

### Task 5: sections.py builds from the loader

**Files:**
- Modify: `backend/sections.py` (replace the hardcoded `SECTION_REGISTRY` dict and `ALWAYS_ON_SECTIONS`; keep `SectionSpec`, `SCOPES`, `ALWAYS_ON`, helper functions)

**Interfaces:**
- Consumes: `pack_loader.manifests()`.
- Produces: unchanged public API (`SECTION_REGISTRY: dict[str, SectionSpec]`, `SCOPES`, `ALWAYS_ON`, `ALWAYS_ON_SECTIONS: frozenset`, `all_scope_names()`, `toggleable_sections()`) **plus** new `PACK_META: dict[str, dict]` — `{key: {"title": str, "description": str, "core": bool}}` in pack order (consumed by Task 7).

- [ ] **Step 1: Rewrite sections.py**

Replace the entire file with:

```python
"""Declarative registry of persona sections, built from section packs.

The single source of truth for section-level structure now lives in
backend/section_packs/<key>/manifest.json; this module loads those packs
once (via pack_loader) and exposes the same API downstream code has always
used. Per-entity write schema is also manifest-owned and surfaced as
server.ENTITY_SCHEMA — this registry owns section-level data only.
"""
from dataclasses import dataclass, field

import pack_loader


@dataclass(frozen=True)
class SectionSpec:
    key: str                       # file_type, e.g. "lifestyle"
    default: dict                  # skeleton persona blob for the section
    id_lists: tuple = ()           # ((list_key, id_prefix), ...)
    context_fields: dict = field(default_factory=dict)  # {scope_name: [field, ...]}


# Global scope name -> human description.
SCOPES = {
    "minimal": "Quick identity snapshot",
    "professional": "Work-relevant context",
    "personal": "Hobbies, interests, personality, and tracked topics",
    "learning": "Current learning focus",
    "full": "Complete persona",
}

assert set(SCOPES) == pack_loader.GLOBAL_SCOPE_NAMES  # keep the two lists in lockstep

# Fields included in EVERY resolved scope (global and section). This is exactly
# the preferences slice every global scope carried before it was factored out.
ALWAYS_ON = {"preferences": ["code_style", "learning_style", "communication", "dislikes"]}

_MANIFESTS = pack_loader.manifests()

SECTION_REGISTRY = {
    key: SectionSpec(
        key=key,
        default=m["defaults"],
        id_lists=tuple(tuple(pair) for pair in m["id_lists"]),
        context_fields=m.get("scope_contributions", {}),
    )
    for key, m in _MANIFESTS.items()
}

# Sections that can never be disabled by a user (always loaded / always visible).
# Distinct from ALWAYS_ON (the always-included preferences *field* bundle above).
ALWAYS_ON_SECTIONS = frozenset(k for k, m in _MANIFESTS.items() if m["core"])

# Display metadata for the Sections manager UI (pack order preserved).
PACK_META = {
    key: {"title": m["title"], "description": m["description"], "core": m["core"]}
    for key, m in _MANIFESTS.items()
}


def all_scope_names() -> list[str]:
    """Every valid scope token: the global scope names plus one per section."""
    return list(SCOPES.keys()) + list(SECTION_REGISTRY.keys())


def toggleable_sections() -> set:
    """Registry sections a user may enable/disable (everything not always-on)."""
    return set(SECTION_REGISTRY) - ALWAYS_ON_SECTIONS
```

- [ ] **Step 2: Run the golden test and the full suite**

Run: `cd backend && ./venv/bin/python -m pytest tests/ -x -q`
Expected: everything passes — in particular `test_registry_golden.py` (order, always-on set, spec contents identical) and the pre-existing `test_sections_registry.py`, `test_settings_api.py`, `test_section_scopes.py`.

- [ ] **Step 3: Commit**

```bash
git add backend/sections.py
git commit -m "refactor: sections registry built from pack manifests (golden-verified)"
```

---

### Task 6: server.py ENTITY_SCHEMA from the loader

**Files:**
- Modify: `backend/server.py` — replace the literal `ENTITY_SCHEMA = { ... }` block (currently lines 2307–2411, from `ENTITY_SCHEMA = {` through the closing `}` right before `def _section_for_entity`).

**Interfaces:**
- Consumes: `pack_loader.manifests()`, `pack_loader.build_entity_schema`.
- Produces: `server.ENTITY_SCHEMA` — identical dict, now manifest-sourced. No other line in server.py changes.

- [ ] **Step 1: Replace the block**

Delete the entire literal dict and substitute:

```python
# Per-entity write schema, owned by the section pack manifests
# (backend/section_packs/<key>/manifest.json). Shape is unchanged:
# {section_key: {entity_name: {actions, required, optional, valid_values?,
# identifier, parent?, description?}}}.
import pack_loader as _pack_loader

ENTITY_SCHEMA = _pack_loader.build_entity_schema(_pack_loader.manifests())
```

(Keep the import inline next to the assignment — server.py's import block is at the top of a 3.7k-line file and an aliased local import keeps this change one contiguous hunk. If you prefer, move `import pack_loader` to the top imports near `import sections`; either is fine, but do only one.)

- [ ] **Step 2: Run the golden test and full suite**

Run: `cd backend && ./venv/bin/python -m pytest tests/ -x -q`
Expected: all pass — `test_entity_schema_matches_golden` proves byte-for-byte equality; `test_get_schema.py`, `test_advisory_schema_invariants.py`, `test_dupe_advisory.py` exercise the consumers.

- [ ] **Step 3: Commit**

```bash
git add backend/server.py
git commit -m "refactor: ENTITY_SCHEMA assembled from pack manifests (golden-verified)"
```

---

### Task 7: GET /api/settings exposes pack metadata

**Files:**
- Modify: `backend/main.py` — the `get_settings` handler (currently at ~line 256)
- Test: `backend/tests/test_settings_api.py` (append)

**Interfaces:**
- Consumes: `sections.PACK_META` (Task 5), `settings_store.enabled_sections()` (existing), existing handler fields.
- Produces: response gains `"packs"`: ordered list of `{"key", "title", "description", "core", "enabled"}`. Existing fields unchanged (frontend keeps working untouched).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_settings_api.py`:

```python
def test_get_settings_includes_pack_metadata(clean_database):
    client, auth = _client_and_auth()
    body = client.get("/api/settings", headers=auth).json()
    packs = body["packs"]
    assert [p["key"] for p in packs] == [
        "profile", "knowledge", "preferences", "projects",
        "lifestyle", "circle", "learning_log",
    ]
    profile = packs[0]
    assert profile == {
        "key": "profile",
        "title": "Profile",
        "description": "Identity, work, education, contact",
        "core": True,
        "enabled": True,
    }
    # disabling a toggleable pack is reflected in `enabled`
    client.put("/api/settings", json={"disabled_sections": ["circle"]}, headers=auth)
    body = client.get("/api/settings", headers=auth).json()
    circle = next(p for p in body["packs"] if p["key"] == "circle")
    assert circle["enabled"] is False and circle["core"] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_settings_api.py -v`
Expected: new test FAILS with `KeyError: 'packs'`; the four existing tests still pass.

- [ ] **Step 3: Extend the handler**

In `backend/main.py`, replace the `get_settings` function body:

```python
@app.get("/api/settings")
async def get_settings():
    enabled = settings_store.enabled_sections()
    return {
        "disabled_sections": sorted(settings_store.get_disabled_sections()),
        "toggleable": sorted(sections.toggleable_sections()),
        "always_on": sorted(sections.ALWAYS_ON_SECTIONS),
        "packs": [
            {
                "key": key,
                "title": meta["title"],
                "description": meta["description"],
                "core": meta["core"],
                "enabled": key in enabled,
            }
            for key, meta in sections.PACK_META.items()
        ],
    }
```

- [ ] **Step 4: Run the settings tests, then the full suite**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_settings_api.py -v && ./venv/bin/python -m pytest tests/ -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_settings_api.py
git commit -m "feat: /api/settings returns ordered pack metadata for the Sections UI"
```

---

### Task 8: Template pack + contribution docs + README note

**Files:**
- Create: `backend/section_packs/_template/manifest.json`
- Create: `docs/CONTRIBUTING-PACKS.md`
- Modify: `README.md` — insert a short subsection after the "Project layout" block (the `mygist/` tree near the top)

**Interfaces:**
- Consumes: loader's `_`-prefix skip rule (Task 3) — the template is inert by construction.
- Produces: documentation only; no runtime change. Full suite must still pass.

- [ ] **Step 1: Write the template manifest**

```json
{
  "key": "example",
  "title": "Example",
  "description": "One-line description shown in the Sections manager",
  "core": false,
  "position": 100,
  "defaults": { "items": [] },
  "id_lists": [["items", "example"]],
  "scope_contributions": { "personal": ["items"] },
  "entities": {
    "example_item": {
      "actions": ["add", "update", "remove"],
      "required": ["name"],
      "optional": ["notes", "tags"],
      "identifier": "name"
    }
  },
  "capture_triggers": ["example phrase"],
  "ui": { "items": { "title_field": "name", "badges": [], "detail_fields": ["notes", "tags"] } }
}
```

Save as `backend/section_packs/_template/manifest.json`. (The `_` prefix means the loader ignores it; to activate a copy, the directory name must equal `key`.)

- [ ] **Step 2: Write docs/CONTRIBUTING-PACKS.md**

```markdown
# Contributing a Section Pack

A section pack adds a new persona section to MyGist with **one file** — no
backend code. The loader validates every pack at boot against
`backend/section_packs/meta_schema.json`; an invalid pack is skipped with a
warning (the server still boots).

## Steps

1. Copy `backend/section_packs/_template/` to `backend/section_packs/<key>/`
   where `<key>` is your section key (lowercase, snake_case). The manifest's
   `"key"` must equal the directory name.
2. Edit `manifest.json`:
   - `defaults` — the empty skeleton blob for the section.
   - `id_lists` — `[list_field, id_prefix]` pairs; every listed field must
     exist in `defaults` as a list. Prefixes must be unique across all packs.
   - `entities` — the write schema (actions, required/optional fields,
     enum `valid_values`, the `identifier` field used for update/remove).
     Entity names must be unique across all packs.
   - `scope_contributions` — which fields each global scope
     (minimal/professional/personal/learning/full) pulls from this section.
     Omit a scope to stay out of it; the section always gets its own scope
     token for free.
   - `capture_triggers` — phrases that hint `suggest_persona_update`.
   - `ui` — how the generic web editor renders each list: `title_field`,
     `badges` (fields shown as chips), `detail_fields`, and optional
     `suggestions` (preset values rendered as tap-to-add chips).
3. Boot the server (`python main.py`) — a schema violation is logged as a
   warning naming your pack; fix until the log is clean.
4. Run the tests: `python -m pytest tests/test_pack_loader.py -q`.
5. Open a PR containing exactly one new directory under
   `backend/section_packs/`.

## Rules

- Packs are declarative only — community packs cannot ship Python.
- New packs default **off**; users enable them in the Sections manager.
- Keep entries small: every field you add costs context tokens for every
  user who enables the pack. MyGist is a context provider — describe the
  person, don't manage their tasks.
```

- [ ] **Step 3: Add the README note**

In `README.md`, directly after the project-layout tree block, insert:

```markdown
### Section packs

Persona sections are defined as **packs** — one declarative
`backend/section_packs/<key>/manifest.json` per section covering defaults,
write schema, scope contributions, search id-lists, and editor UI hints.
Packs are validated at boot (invalid packs are skipped with a warning) and
toggled per user in the Sections manager. To add a section, see
[docs/CONTRIBUTING-PACKS.md](docs/CONTRIBUTING-PACKS.md).
```

- [ ] **Step 4: Verify the template is inert and the suite passes**

Run: `cd backend && ./venv/bin/python -m pytest tests/ -q`
Expected: all pass; `test_registry_golden.py` proves the template didn't leak into the registry (still 7 sections).

- [ ] **Step 5: Commit**

```bash
git add backend/section_packs/_template/manifest.json docs/CONTRIBUTING-PACKS.md README.md
git commit -m "docs: section pack template and contribution guide"
```

---

## Completion Criteria

- Full suite green (`./venv/bin/python -m pytest tests/ -q`), including the untouched golden fixture from Task 1.
- `git log` shows one commit per task on `feature/section-packs`.
- Boot check: `cd backend && DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test ./venv/bin/python -c "import main; print(len(main.sections.SECTION_REGISTRY), 'sections loaded')"` prints `7 sections loaded` with no warnings.
