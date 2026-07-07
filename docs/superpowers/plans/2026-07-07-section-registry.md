# Section Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `backend/sections.py` the single source of truth for section-level persona structure (defaults, valid files, id-lists, per-scope context fields), add auto-derived per-section scopes with an always-on preferences bundle, and let `get_context` accept multiple scopes.

**Architecture:** Introduce a dependency-free `sections.py` holding a `SectionSpec` per file plus scope metadata. Migrate the existing consumers (`get_scoped_context`/`_files_for_scope` in `server.py`; `DEFAULTS`/`VALID_FILES`/`ID_LISTS`/`_assign_ids`/`load`/`reset` in `persona_store.py`) to read from the registry, deleting the now-duplicated tables. The `execute_modify` write path, `ENTITY_SCHEMA`/`get_schema`, `FIELD_ALIASES`, and `_normalize` are **out of scope** and untouched. Parity + Phase-0 characterization tests prove the refactor is behavior-neutral; two feature commits then add section scopes and multi-select.

**Tech Stack:** Python 3.11, FastAPI + FastMCP (`fastmcp==2.14.2`), Postgres via `psycopg`, pytest. Backend lives in `backend/`; tests in `backend/tests/`.

## Global Constraints

- Run everything from `backend/`: `cd backend && source venv/bin/activate`.
- A local test Postgres must be up; `tests/conftest.py` provides the `clean_database` (autouse) and `as_user` fixtures. Tests that touch persona data need `as_user`; pure-data tests over `sections.py` do not.
- MCP tools are FastMCP `FunctionTool` objects — call the raw function via `.fn` (e.g. `server.get_context.fn(...)`).
- **Behavior-neutral until stated:** Tasks 1–4 must not change any `get_context` / persona output. The Phase-0 characterization suite (`tests/test_context_efficiency.py`) and `tests/test_entity_ids.py` must stay green **unchanged** through Task 4. Only Task 5 (drift fix) and Tasks 6–7 (features) intentionally change/add behavior.
- `sections.py` imports **only stdlib** (`dataclasses`, `copy`). It must never import `db`, `persona_store`, or `server` (import direction: `sections ← persona_store ← server`). Circular imports are a production-down class of bug here.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Do not push; the controller handles pushing.

## Source-of-truth references (read these exact locations when transcribing)

- `persona_store.DEFAULTS` — `backend/persona_store.py:66-135`
- `persona_store.ID_LISTS` — `backend/persona_store.py:22-44`
- `persona_store.VALID_FILES` — `backend/persona_store.py:13`
- `CONTEXT_SCOPES` — `backend/server.py:679-721`
- `_files_for_scope` — `backend/server.py:723-730`
- `get_scoped_context` — `backend/server.py:732-790`
- `get_context` MCP tool — `backend/server.py:2894-2929`

---

## Task 1: Create `sections.py` registry (data only, parity-checked)

**Files:**
- Create: `backend/sections.py`
- Test: `backend/tests/test_sections_registry.py`

**Interfaces:**
- Produces:
  - `SectionSpec` dataclass with fields `key: str`, `default: dict`, `id_lists: tuple`, `context_fields: dict` (`{scope_name: [field, ...]}`).
  - `SCOPES: dict[str, str]` — global scope name → description.
  - `SECTION_REGISTRY: dict[str, SectionSpec]` — one entry per file_type.
- Consumes: nothing (pure data module).

- [ ] **Step 1: Write the failing parity tests**

Create `backend/tests/test_sections_registry.py`:

```python
import persona_store as store
import server
from sections import SECTION_REGISTRY, SCOPES, SectionSpec


def test_registry_keys_match_valid_files():
    assert set(SECTION_REGISTRY) == set(store.VALID_FILES)


def test_every_entry_is_a_sectionspec_keyed_by_its_own_key():
    for key, spec in SECTION_REGISTRY.items():
        assert isinstance(spec, SectionSpec)
        assert spec.key == key


def test_defaults_match_persona_store():
    assert {k: s.default for k, s in SECTION_REGISTRY.items()} == store.DEFAULTS


def test_id_lists_match_persona_store():
    # Registry stores tuples; persona_store stores lists of tuples. Compare as
    # {file: [(list_key, prefix), ...]} with list() coercion.
    registry_id_lists = {
        k: [tuple(pair) for pair in s.id_lists]
        for k, s in SECTION_REGISTRY.items()
        if s.id_lists
    }
    expected = {k: [tuple(p) for p in v] for k, v in store.ID_LISTS.items()}
    assert registry_id_lists == expected


def test_scope_descriptions_match_context_scopes():
    assert SCOPES == {k: v["description"] for k, v in server.CONTEXT_SCOPES.items()}


def test_context_fields_reconstruct_context_scopes():
    # For each non-"full" scope, rebuilding {file: fields} from the registry's
    # per-section context_fields must equal the old CONTEXT_SCOPES fields dict.
    for scope, cfg in server.CONTEXT_SCOPES.items():
        if cfg["fields"] == "all":
            continue
        rebuilt = {
            spec.key: spec.context_fields[scope]
            for spec in SECTION_REGISTRY.values()
            if scope in spec.context_fields
        }
        assert rebuilt == cfg["fields"], f"scope {scope} mismatch"


def test_full_scope_is_metadata_only():
    # "full" is a scope name with a description but no per-section field lists.
    assert "full" in SCOPES
    assert all("full" not in s.context_fields for s in SECTION_REGISTRY.values())
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_sections_registry.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'sections'`.

- [ ] **Step 3: Create `backend/sections.py`**

Define the types and scope metadata, then populate `SECTION_REGISTRY`. **Transcribe `default` verbatim** from `persona_store.DEFAULTS` (persona_store.py:66-135) and `id_lists` from `persona_store.ID_LISTS` (persona_store.py:22-44) — the parity tests in Step 1 guarantee exactness, so copy, don't paraphrase. The `context_fields` values are the **inversion** of `CONTEXT_SCOPES` (server.py:679-721), fully worked out below.

```python
# backend/sections.py
"""Declarative registry of persona sections — the single source of truth for
section-level structure (defaults, id-carrying lists, per-scope context fields).
Dependency-free: imports only stdlib so persona_store/server can import it
without a cycle. Per-entity write schema is intentionally NOT here (it stays in
server.ENTITY_SCHEMA); this registry owns section-level data only.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SectionSpec:
    key: str                       # file_type, e.g. "lifestyle"
    default: dict                  # skeleton (mirrors persona_store.DEFAULTS[key])
    id_lists: tuple = ()           # ((list_key, id_prefix), ...)
    context_fields: dict = field(default_factory=dict)  # {scope_name: [field, ...]}


# Global scope name -> human description (mirrors CONTEXT_SCOPES[...]["description"]).
SCOPES = {
    "minimal": "Quick identity snapshot",
    "professional": "Work-relevant context",
    "personal": "Hobbies, interests, personality, and tracked topics",
    "learning": "Current learning focus",
    "full": "Complete persona",
}


SECTION_REGISTRY = {
    "profile": SectionSpec(
        key="profile",
        default={  # VERBATIM from persona_store.DEFAULTS["profile"] (persona_store.py:67-84)
            "name": "", "preferred_name": "", "current_role": "", "organisation": "",
            "location": "", "nationality": "", "languages_spoken": [], "bio": "",
            "work_experience": [], "career_aspirations": [], "education": [],
            "goals_and_careers": [], "contact": {"emails": [], "links": []},
        },
        id_lists=(
            ("work_experience", "work"),
            ("education", "education"),
            ("languages_spoken", "language"),
            ("goals_and_careers", "goal"),
        ),
        context_fields={
            "minimal": ["name", "preferred_name", "bio", "location", "current_role"],
            "professional": ["name", "preferred_name", "bio", "location", "current_role",
                             "work_experience", "education", "career_aspirations"],
            "personal": ["name", "preferred_name", "bio", "location"],
            "learning": ["name", "preferred_name", "current_role", "career_aspirations"],
        },
    ),
    "knowledge": SectionSpec(
        key="knowledge",
        default={"domains": [], "mental_tabs": []},  # persona_store.py:85-88
        id_lists=(("domains", "domain"), ("mental_tabs", "tab")),
        context_fields={
            "professional": ["domains"],
            "personal": ["mental_tabs"],
            "learning": ["domains", "mental_tabs"],
        },
    ),
    "preferences": SectionSpec(
        key="preferences",
        default={  # VERBATIM from persona_store.DEFAULTS["preferences"] (persona_store.py:89-108)
            "code_style": {"preferred_languages": [], "frameworks": [], "tools": []},
            "communication": {
                "default": {"tone": "", "detail_level": "", "locale": "British English"},
                "mood_overrides": [],
            },
            "learning_style": {"preferred": [], "avoid": []},
            "dislikes": [],
        },
        id_lists=(),
        context_fields={
            # NOTE: identical across all four non-full scopes — this becomes the
            # ALWAYS_ON bundle in Task 6. For now transcribe it faithfully so the
            # migration stays behavior-neutral and parity holds.
            "minimal": ["code_style", "learning_style", "communication", "dislikes"],
            "professional": ["code_style", "learning_style", "communication", "dislikes"],
            "personal": ["code_style", "learning_style", "communication", "dislikes"],
            "learning": ["code_style", "learning_style", "communication", "dislikes"],
        },
    ),
    "projects": SectionSpec(
        key="projects",
        default={"projects": [], "current_learning": [], "top_of_mind": []},  # persona_store.py:109-113
        id_lists=(("projects", "project"), ("current_learning", "learning"), ("top_of_mind", "top")),
        context_fields={
            "minimal": ["top_of_mind"],
            "professional": ["projects", "current_learning", "top_of_mind"],
            "learning": ["current_learning", "top_of_mind"],
        },
    ),
    "lifestyle": SectionSpec(
        key="lifestyle",
        default={  # VERBATIM from persona_store.DEFAULTS["lifestyle"] (persona_store.py:114-128)
            "hobbies": [], "passions": [], "curiosities": [], "personality_traits": [],
            "values": [],
            "wellness": {
                "sleep": {"weekday": {"bedtime": "", "wakeup": ""},
                          "weekend": {"bedtime": "", "wakeup": ""}},
                "energy_peaks": [], "stress_triggers": [],
            },
        },
        id_lists=(("hobbies", "hobby"),),
        context_fields={
            "personal": ["hobbies", "passions", "curiosities", "personality_traits", "values", "wellness"],
        },
    ),
    "circle": SectionSpec(
        key="circle",
        default={"connections": []},  # persona_store.py:129-131
        id_lists=(("connections", "connection"),),
        context_fields={"personal": ["connections"]},
    ),
    "learning_log": SectionSpec(
        key="learning_log",
        default={"entries": []},  # persona_store.py:132-134
        id_lists=(),
        context_fields={"learning": ["entries"]},
    ),
}
```

Verify the transcription against the real source before running: open `persona_store.py:66-135` and confirm each `default` matches key-for-key (the parity test will also catch any drift).

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_sections_registry.py -q`
Expected: PASS (7 tests). If `test_defaults_match_persona_store` or `test_context_fields_reconstruct_context_scopes` fails, fix the transcription until it matches — do not change the test.

- [ ] **Step 5: Commit**

```bash
git add backend/sections.py backend/tests/test_sections_registry.py
git commit -m "feat: add declarative section registry (parity-checked against existing tables)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Context field-selection reads the registry

**Files:**
- Modify: `backend/server.py` — `_files_for_scope` (723-730), `get_scoped_context` (732-790), `CONTEXT_SCOPES` (679-721)
- Test: `backend/tests/test_context_efficiency.py` (existing — must stay green)

**Interfaces:**
- Consumes: `sections.SECTION_REGISTRY`, `sections.SCOPES` from Task 1.
- Produces: `_resolve_scope_fields(scope: str) -> dict | str` returning `{file_key: [fields]}` for a named scope, or the string `"all"` for `full`. Used by `get_scoped_context`.

- [ ] **Step 1: Add a characterization test locking today's resolved fields**

Add to `backend/tests/test_context_efficiency.py` (append; keep existing tests):

```python
import server
from sections import SECTION_REGISTRY


def test_resolve_scope_fields_matches_legacy_scopes():
    # _resolve_scope_fields must reproduce the exact {file: fields} the old
    # CONTEXT_SCOPES table encoded, for every named scope.
    for scope in ["minimal", "professional", "personal", "learning"]:
        legacy = {
            spec.key: spec.context_fields[scope]
            for spec in SECTION_REGISTRY.values()
            if scope in spec.context_fields
        }
        assert server._resolve_scope_fields(scope) == legacy


def test_resolve_scope_fields_full_is_all():
    assert server._resolve_scope_fields("full") == "all"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_context_efficiency.py::test_resolve_scope_fields_matches_legacy_scopes -q`
Expected: FAIL with `AttributeError: module 'server' has no attribute '_resolve_scope_fields'`.

- [ ] **Step 3: Add `_resolve_scope_fields` and rewrite the two consumers**

In `server.py`, add an import near the other imports (there is already `import persona_store`):

```python
import sections
```

Add this helper directly above `_files_for_scope` (server.py:723):

```python
def _resolve_scope_fields(scope: str):
    """Resolve a scope name to its {file_key: [fields]} selection, or the string
    "all" for the full scope. Derived from the section registry so the per-scope
    field tables live in exactly one place."""
    if scope == "full":
        return "all"
    return {
        spec.key: spec.context_fields[scope]
        for spec in sections.SECTION_REGISTRY.values()
        if scope in spec.context_fields
    }
```

Replace `_files_for_scope` (server.py:723-730) with a registry-driven version:

```python
def _files_for_scope(fields) -> list[str]:
    """Return the persona file keys a scope actually needs. ``fields`` is the
    resolved selection from _resolve_scope_fields: the string "all" needs every
    file; a {file: fields} dict needs only its keys."""
    if fields == "all":
        return list(persona_store.VALID_FILES)
    return list(fields.keys())
```

Update the head of `get_scoped_context` (server.py:740-751). Change the validity check and field source to the registry (note: `scope_config["fields"]` and `scope_config["description"]` usages are replaced):

```python
    if scope not in sections.SCOPES:
        return {"error": f"Unknown scope '{scope}'. Valid: {list(sections.SCOPES.keys())}"}

    fields = _resolve_scope_fields(scope)
    needed = _files_for_scope(fields)
    all_data = {ft: load_json(FILE_MAP[ft]) for ft in needed}
    result = {}

    if fields == "all":
        result = all_data
    else:
        for file_key, field_list in fields.items():
            data = all_data.get(file_key, {})
            if not data or "error" in data:
                continue
            result[file_key] = {}
            for field in field_list:
                if field == "communication_default":
                    comm = data.get("communication", {})
                    if isinstance(comm, dict) and "default" in comm:
                        result[file_key]["communication"] = {"default": comm["default"]}
                elif field in data:
                    result[file_key][field] = data[field]
```

Then update the payload's `scope_description` (server.py:781) to read from the registry:

```python
        "scope_description": sections.SCOPES[scope],
```

- [ ] **Step 4: Run the full context suite to verify identical behavior**

Run: `python -m pytest tests/test_context_efficiency.py tests/test_learning_log_load.py -q`
Expected: PASS (all existing characterization tests + the 2 new resolver tests). The per-scope file-touch and token-estimate tests passing proves output is byte-identical.

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_context_efficiency.py
git commit -m "refactor: select context fields from the section registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Defaults + id-assignment read the registry (with deepcopy fix)

**Files:**
- Modify: `backend/persona_store.py` — imports, `_assign_ids` (52-63), `load` (284-296), `reset` (321-323)
- Test: `backend/tests/test_persona_store_defaults.py` (create); `backend/tests/test_entity_ids.py` (existing — must stay green)

**Interfaces:**
- Consumes: `sections.SECTION_REGISTRY` from Task 1.
- Produces: no signature changes to `load`/`save`/`reset`/`_assign_ids`; behavior identical except `load`/`reset` now return deep copies of the default.

- [ ] **Step 1: Write the deepcopy-correctness test**

Create `backend/tests/test_persona_store_defaults.py`:

```python
import copy
import persona_store as store
from sections import SECTION_REGISTRY


def test_load_returns_default_when_empty_and_does_not_mutate_registry(as_user):
    # Loading a never-saved file returns its default...
    loaded = store.load("circle")
    assert loaded == SECTION_REGISTRY["circle"].default
    # ...and mutating the returned object must NOT corrupt the registry default.
    loaded["connections"].append({"name": "Mutant"})
    assert SECTION_REGISTRY["circle"].default["connections"] == []


def test_reset_does_not_inject_ids_into_registry_default(as_user):
    # reset() saves the default, which runs _assign_ids. That must not add ids
    # to the shared registry default (the pre-fix bug: reset() mutated DEFAULTS).
    store.reset("lifestyle")
    assert all("id" not in h for h in SECTION_REGISTRY["lifestyle"].default["hobbies"])
    # Baseline default has no hobbies, so this also asserts it stayed empty:
    assert SECTION_REGISTRY["lifestyle"].default["hobbies"] == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_persona_store_defaults.py -q`
Expected: FAIL — either `AttributeError` (registry not imported in persona_store yet is fine; the test imports `sections` directly) or `AssertionError` on the mutation checks, because today `load`/`reset` return `DEFAULTS` by reference and `_assign_ids` mutates in place.

(If it unexpectedly passes, that means today's code already deep-copies — it does not; verify you ran against unmodified `persona_store.py`.)

- [ ] **Step 3: Migrate `persona_store.py` to the registry + deepcopy**

Add imports at the top of `persona_store.py` (it already imports `json`, `uuid`, `db`):

```python
import copy

import sections
```

Replace the `VALID_FILES` literal (persona_store.py:13) with a registry derivation, and `FILE_MAP` stays derived from it:

```python
VALID_FILES = list(sections.SECTION_REGISTRY)

FILE_MAP = {name: f"{name}.json" for name in VALID_FILES}
```

Rewrite `_assign_ids` (persona_store.py:52-63) to source its `(list_key, prefix)` pairs from the registry instead of the module-level `ID_LISTS`:

```python
def _assign_ids(file_type: str, data: dict) -> dict:
    """Give every object in a designated list a stable `id` if it lacks one.
    Uses setdefault, so existing IDs are never rewritten. The id-carrying lists
    come from the section registry."""
    if not isinstance(data, dict):
        return data
    spec = sections.SECTION_REGISTRY.get(file_type)
    if spec is None:
        return data
    for list_key, prefix in spec.id_lists:
        items = data.get(list_key)
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    item.setdefault("id", generate_entity_id(prefix))
    return data
```

In `load` (persona_store.py:294-296), return a deep copy of the registry default when the row is missing:

```python
    if row is None:
        spec = sections.SECTION_REGISTRY.get(file_type)
        return copy.deepcopy(spec.default) if spec else {}
    return _normalize(file_type, row["data"])
```

In `reset` (persona_store.py:321-323), save a deep copy so `_assign_ids` never mutates the shared default:

```python
def reset(file_type: str) -> bool:
    """Reset one file to its default."""
    return save(file_type, copy.deepcopy(sections.SECTION_REGISTRY[file_type].default))
```

Leave the module-level `DEFAULTS` and `ID_LISTS` literals in place for now (Task 4 deletes them) — but they are no longer read by `load`/`reset`/`_assign_ids`.

- [ ] **Step 4: Run to verify the new tests pass and nothing regressed**

Run: `python -m pytest tests/test_persona_store_defaults.py tests/test_entity_ids.py -q`
Expected: PASS (new deepcopy tests + all existing id tests).

- [ ] **Step 5: Commit**

```bash
git add backend/persona_store.py backend/tests/test_persona_store_defaults.py
git commit -m "refactor: drive defaults + id assignment from the registry; fix default-mutation bug

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Delete the now-dead duplicated tables

**Files:**
- Modify: `backend/persona_store.py` — remove `DEFAULTS` (66-135), remove `ID_LISTS` (22-44)
- Modify: `backend/server.py` — reduce `CONTEXT_SCOPES` (679-721) to nothing (all fields+descriptions now in the registry)

**Interfaces:**
- Consumes: everything already migrated in Tasks 2–3.
- Produces: `DEFAULTS`, `ID_LISTS`, and `CONTEXT_SCOPES` no longer exist as module attributes.

- [ ] **Step 1: Confirm no remaining readers (grep before deleting)**

Run each and read the output:

```bash
cd backend
grep -rn "DEFAULTS" --include=*.py . | grep -v "tests/"
grep -rn "ID_LISTS" --include=*.py . | grep -v "tests/"
grep -rn "CONTEXT_SCOPES" --include=*.py . | grep -v "tests/"
```

Expected: after Tasks 2–3, the only non-test references are the definitions themselves (plus any docstrings). If a **non-test** `.py` file still *reads* one of these (other than its own definition line), migrate that reader to the registry first — do not delete out from under a live consumer. `main.py` is a known potential reader of `DEFAULTS`/`VALID_FILES`: if it imports `DEFAULTS` from `persona_store`, switch it to `persona_store.VALID_FILES` / `sections.SECTION_REGISTRY` accordingly.

- [ ] **Step 2: Update tests that referenced the deleted tables**

The parity tests from Task 1 compared the registry to `store.DEFAULTS` / `store.ID_LISTS` / `server.CONTEXT_SCOPES`, which are about to vanish. Those served their purpose (proving faithful transcription at introduction time); now retarget them so the suite stays green and still meaningful. In `backend/tests/test_sections_registry.py`:

- Delete `test_defaults_match_persona_store`, `test_id_lists_match_persona_store`, `test_scope_descriptions_match_context_scopes`, and `test_context_fields_reconstruct_context_scopes` (they reference deleted symbols).
- Also delete `test_registry_keys_match_valid_files`: once Task 3 made `VALID_FILES = list(sections.SECTION_REGISTRY)`, this asserts `set(reg) == set(list(reg))` — a tautology that verifies nothing. (Its real intent — every file has a spec — is already covered by `test_every_entry_is_a_sectionspec_keyed_by_its_own_key`.)
- Keep `test_every_entry_is_a_sectionspec_keyed_by_its_own_key` and `test_full_scope_is_metadata_only`.

Similarly, `tests/test_context_efficiency.py::test_resolve_scope_fields_matches_legacy_scopes` reconstructs `legacy` from the registry itself (not from `CONTEXT_SCOPES`), so it stays valid — leave it.

- [ ] **Step 3: Delete the dead code**

- In `persona_store.py`: delete the `DEFAULTS = {...}` block (66-135) and the `ID_LISTS = {...}` block (22-44), plus their now-stale comments.
- In `server.py`: delete the entire `CONTEXT_SCOPES = {...}` block (679-721). All its data now lives in `sections.SCOPES` (descriptions) and `SECTION_REGISTRY[...].context_fields` (fields).

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest -q`
Expected: PASS (all green). If an `ImportError`/`AttributeError` appears for `DEFAULTS`/`ID_LISTS`/`CONTEXT_SCOPES`, a reader was missed in Step 1 — migrate it to the registry, then rerun.

- [ ] **Step 5: Commit**

```bash
git add backend/persona_store.py backend/server.py backend/tests/test_sections_registry.py
git commit -m "refactor: delete DEFAULTS/ID_LISTS/CONTEXT_SCOPES — registry is the single source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Fix the context-scope drift (isolated, tested behavior change)

**Files:**
- Modify: `backend/sections.py` — `profile.context_fields`
- Test: `backend/tests/test_context_drift_fix.py` (create)

**Context:** `DEFAULTS["profile"]` defines `organisation`, `nationality`, `languages_spoken`, and `goals_and_careers`, but the old `CONTEXT_SCOPES` never listed them, so they never reached the LLM. Now that fields live in the registry, add them to the scopes where they belong. This is the **one intentional output change** in this plan.

**Interfaces:**
- Consumes: `_resolve_scope_fields` / `get_scoped_context` from Task 2.
- Produces: `professional` context now includes `organisation`, `nationality`, `languages_spoken`; `personal` context now includes `nationality`, `languages_spoken`, `goals_and_careers`. (Placement rationale below; adjust only if the user directs.)

- [ ] **Step 1: Write the failing test asserting the new fields appear**

Create `backend/tests/test_context_drift_fix.py`:

```python
import json
import server


def test_professional_scope_includes_previously_dropped_fields(as_user):
    # Seed the drifted fields directly through the store (this also creates the row):
    import persona_store as store
    p = store.load("profile")
    p["organisation"] = "Acme"
    p["nationality"] = "British"
    p["languages_spoken"] = [{"name": "English"}]
    store.save("profile", p)

    ctx = json.loads(server.get_context.fn(scope="professional"))["context"]["profile"]
    assert ctx.get("organisation") == "Acme"
    assert ctx.get("nationality") == "British"
    assert "languages_spoken" in ctx


def test_personal_scope_includes_goals_and_languages(as_user):
    import persona_store as store
    p = store.load("profile")
    p["goals_and_careers"] = [{"goal": "Ship it"}]
    p["languages_spoken"] = [{"name": "English"}]
    p["nationality"] = "British"
    store.save("profile", p)

    ctx = json.loads(server.get_context.fn(scope="personal"))["context"]["profile"]
    assert "goals_and_careers" in ctx
    assert "languages_spoken" in ctx
    assert ctx.get("nationality") == "British"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_context_drift_fix.py -q`
Expected: FAIL — the asserted keys are absent from the returned context.

- [ ] **Step 3: Add the fields to `profile.context_fields` in `sections.py`**

Edit `SECTION_REGISTRY["profile"].context_fields` so the two scopes gain the fields:

```python
        context_fields={
            "minimal": ["name", "preferred_name", "bio", "location", "current_role"],
            "professional": ["name", "preferred_name", "bio", "location", "current_role",
                             "organisation", "nationality", "languages_spoken",
                             "work_experience", "education", "career_aspirations"],
            "personal": ["name", "preferred_name", "bio", "location",
                         "nationality", "languages_spoken", "goals_and_careers"],
            "learning": ["name", "preferred_name", "current_role", "career_aspirations"],
        },
```

- [ ] **Step 4: Run to verify it passes, and the rest of the suite is still green**

Run: `python -m pytest tests/test_context_drift_fix.py tests/test_context_efficiency.py -q`
Expected: PASS. Note: the Task 2 resolver test rebuilds `legacy` from the registry, so it still passes (it's not pinned to the old omission).

- [ ] **Step 5: Commit**

```bash
git add backend/sections.py backend/tests/test_context_drift_fix.py
git commit -m "fix: surface organisation/nationality/languages/goals in context scopes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Section scopes + always-on preferences

**Files:**
- Modify: `backend/sections.py` — add `ALWAYS_ON`, `section_scope_names()`, adjust preferences `context_fields`
- Modify: `backend/server.py` — `_resolve_scope_fields`, `get_scoped_context` validity check
- Test: `backend/tests/test_section_scopes.py` (create)

**Interfaces:**
- Consumes: `SECTION_REGISTRY`, `SCOPES` from Task 1.
- Produces:
  - `sections.ALWAYS_ON: dict` — `{file_key: [fields]}` folded into every resolved scope.
  - `sections.all_scope_names() -> list[str]` — global scope names + section keys (the full valid set).
  - `_resolve_scope_fields(scope)` now also accepts a section key, returning `{section_key: <all default keys>}` unioned with `ALWAYS_ON`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_section_scopes.py`:

```python
import json
import server
from sections import SECTION_REGISTRY, ALWAYS_ON


def _pref_fields():
    return set(ALWAYS_ON["preferences"])


def test_section_scope_returns_its_whole_section(as_user):
    fields = server._resolve_scope_fields("lifestyle")
    assert set(fields["lifestyle"]) == set(SECTION_REGISTRY["lifestyle"].default.keys())


def test_section_scope_includes_always_on_preferences(as_user):
    fields = server._resolve_scope_fields("circle")
    assert set(fields["preferences"]) == _pref_fields()
    assert set(fields["circle"]) == {"connections"}


def test_section_scope_has_no_other_sections(as_user):
    fields = server._resolve_scope_fields("circle")
    assert set(fields.keys()) == {"circle", "preferences"}


def test_global_scope_output_unchanged_after_always_on(as_user):
    # professional still yields the same preferences fields via ALWAYS_ON.
    fields = server._resolve_scope_fields("professional")
    assert set(fields["preferences"]) == _pref_fields()


def test_get_context_accepts_a_section_scope(as_user):
    import persona_store as store
    p = store.load("circle")
    p["connections"] = [{"name": "Sam"}]
    store.save("circle", p)
    ctx = json.loads(server.get_context.fn(scope="circle"))["context"]
    assert "circle" in ctx and "preferences" in ctx


def test_unknown_scope_lists_valid_names(as_user):
    out = json.loads(server.get_context.fn(scope="nope"))
    assert "error" in out
    assert "lifestyle" in out["error"]  # section names are advertised too
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_section_scopes.py -q`
Expected: FAIL — `ALWAYS_ON` doesn't exist / `_resolve_scope_fields("circle")` returns `{}` (circle isn't a global scope yet).

- [ ] **Step 3: Add `ALWAYS_ON` + helpers in `sections.py`**

Add after `SCOPES` in `sections.py`:

```python
# Fields included in EVERY resolved scope (global and section). This is exactly
# the preferences slice every global scope carried before it was factored out.
ALWAYS_ON = {"preferences": ["code_style", "learning_style", "communication", "dislikes"]}


def all_scope_names() -> list[str]:
    """Every valid scope token: the global scope names plus one per section."""
    return list(SCOPES.keys()) + list(SECTION_REGISTRY.keys())
```

Remove the now-redundant preferences lines from the global scopes so `ALWAYS_ON` is the single source. Edit `SECTION_REGISTRY["preferences"].context_fields` to be empty (preferences contributes only via `ALWAYS_ON` now):

```python
        context_fields={},
```

- [ ] **Step 4: Update `_resolve_scope_fields` and the validity check in `server.py`**

Replace `_resolve_scope_fields` (from Task 2) with a version that handles global scopes, section scopes, and folds in `ALWAYS_ON`:

```python
def _merge_fields(target: dict, addition: dict) -> None:
    """Union a {file: [fields]} addition into target in place, preserving order
    and de-duplicating."""
    for file_key, field_list in addition.items():
        existing = target.setdefault(file_key, [])
        for f in field_list:
            if f not in existing:
                existing.append(f)


def _resolve_scope_fields(scope: str):
    """Resolve one scope token to its {file_key: [fields]} selection, or "all"
    for the full scope. Accepts a global scope name or a section key; the
    ALWAYS_ON bundle is folded into every non-full result."""
    if scope == "full":
        return "all"
    result: dict = {}
    if scope in sections.SECTION_REGISTRY and scope not in sections.SCOPES:
        # Section scope: the whole section, all its default fields.
        spec = sections.SECTION_REGISTRY[scope]
        result[scope] = list(spec.default.keys())
    else:
        # Global scope: each section's declared fields for this scope.
        for spec in sections.SECTION_REGISTRY.values():
            if scope in spec.context_fields:
                result[spec.key] = list(spec.context_fields[scope])
    _merge_fields(result, sections.ALWAYS_ON)
    return result
```

Update the validity guard in `get_scoped_context` (the line added in Task 2) to accept section scopes:

```python
    if scope not in sections.all_scope_names():
        return {"error": f"Unknown scope '{scope}'. Valid: {sections.all_scope_names()}"}
```

Also update `_files_for_scope`: a resolved section scope may reference `preferences` via `ALWAYS_ON`, so files-needed is still just `fields.keys()` — no change required (it already returns `list(fields.keys())`). Confirm by reading it.

Note the Task 2 characterization test `test_resolve_scope_fields_matches_legacy_scopes` reconstructs `legacy` from `spec.context_fields`, which no longer includes preferences — update that test to fold `ALWAYS_ON` in so it still asserts parity:

```python
def test_resolve_scope_fields_matches_legacy_scopes():
    from sections import ALWAYS_ON
    for scope in ["minimal", "professional", "personal", "learning"]:
        legacy = {
            spec.key: list(spec.context_fields[scope])
            for spec in SECTION_REGISTRY.values()
            if scope in spec.context_fields
        }
        for fk, fl in ALWAYS_ON.items():
            legacy.setdefault(fk, [])
            legacy[fk] = legacy[fk] + [f for f in fl if f not in legacy[fk]]
        assert server._resolve_scope_fields(scope) == legacy
```

- [ ] **Step 5: Run to verify pass + no regression**

Run: `python -m pytest tests/test_section_scopes.py tests/test_context_efficiency.py tests/test_context_drift_fix.py -q`
Expected: PASS. The characterization file-touch/token tests still pass → global-scope output is byte-identical after factoring preferences into `ALWAYS_ON`.

- [ ] **Step 6: Commit**

```bash
git add backend/sections.py backend/server.py backend/tests/test_section_scopes.py backend/tests/test_context_efficiency.py
git commit -m "feat: per-section scopes with always-on preferences bundle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `get_context` accepts one scope or a list (union)

**Files:**
- Modify: `backend/server.py` — `get_scoped_context` (accept list), `get_context` MCP tool (2894-2929)
- Test: `backend/tests/test_multi_scope.py` (create)

**Interfaces:**
- Consumes: `_resolve_scope_fields`, `_merge_fields` from Task 6.
- Produces: `get_scoped_context(scope: str | list[str], ...)` and `get_context(scope: str | list[str], ...)`. Passing a single string is unchanged; a list unions each token's resolution.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_multi_scope.py`:

```python
import json
import server


def _seed(as_user):
    import persona_store as store
    c = store.load("circle"); c["connections"] = [{"name": "Sam"}]; store.save("circle", c)
    l = store.load("lifestyle"); l["hobbies"] = [{"name": "Chess"}]; store.save("lifestyle", l)


def test_single_string_scope_still_works(as_user):
    out = json.loads(server.get_context.fn(scope="minimal"))
    assert out["scope"] == "minimal"
    assert "context" in out


def test_two_section_scopes_union(as_user):
    _seed(as_user)
    out = json.loads(server.get_context.fn(scope=["lifestyle", "circle"]))
    ctx = out["context"]
    assert "lifestyle" in ctx and "circle" in ctx
    assert "preferences" in ctx  # always-on


def test_global_and_section_mix(as_user):
    _seed(as_user)
    ctx = json.loads(server.get_context.fn(scope=["professional", "circle"]))["context"]
    assert "circle" in ctx           # from the section scope
    assert "projects" in ctx or "profile" in ctx  # from professional


def test_overlapping_scopes_dedup_fields(as_user):
    # personal already includes lifestyle; unioning with the lifestyle section
    # scope must not duplicate fields.
    fields = server._resolve_scope_fields_multi(["personal", "lifestyle"])
    assert len(fields["lifestyle"]) == len(set(fields["lifestyle"]))


def test_unknown_token_in_list_errors(as_user):
    out = json.loads(server.get_context.fn(scope=["minimal", "bogus"]))
    assert "error" in out


def test_list_with_full_returns_everything(as_user):
    out = json.loads(server.get_context.fn(scope=["minimal", "full"]))
    # full wins → all files present
    assert set(out["context"].keys()) >= {"profile", "lifestyle", "circle", "preferences"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_multi_scope.py -q`
Expected: FAIL — `_resolve_scope_fields_multi` missing / `get_context` rejects a list.

- [ ] **Step 3: Add multi-scope resolution and thread it through**

Add to `server.py` (near `_resolve_scope_fields`):

```python
def _resolve_scope_fields_multi(scopes):
    """Resolve one scope (str) or several (list) into a single {file: [fields]}
    selection, or "all" if any token is the full scope. Unknown tokens raise
    ValueError so the caller can surface a friendly error."""
    tokens = [scopes] if isinstance(scopes, str) else list(scopes)
    valid = set(sections.all_scope_names())
    merged: dict = {}
    for tok in tokens:
        if tok not in valid:
            raise ValueError(tok)
        resolved = _resolve_scope_fields(tok)
        if resolved == "all":
            return "all"
        _merge_fields(merged, resolved)
    return merged
```

Update `get_scoped_context` to accept `str | list[str]` and use the multi-resolver. Change its signature and the head (replacing the single-scope validity check + `_resolve_scope_fields` call from Tasks 2/6):

```python
def get_scoped_context(
    scope="minimal",
    topic: str = None,
    include_inactive: bool = False,
    days: int = None,
    limit: int = None
) -> dict:
    """Get persona context filtered by scope(s) and optional topic. `scope` is a
    global scope name, a section key, or a list mixing them (unioned)."""
    try:
        fields = _resolve_scope_fields_multi(scope)
    except ValueError:
        return {"error": f"Unknown scope '{scope}'. Valid: {sections.all_scope_names()}"}

    needed = _files_for_scope(fields)
    all_data = {ft: load_json(FILE_MAP[ft]) for ft in needed}
    result = {}
    # ... (the fields == "all" / else field-selection loop is unchanged from Task 2) ...
```

For the payload's `scope`/`scope_description` (which assume a single string), make them list-safe:

```python
    scope_label = scope if isinstance(scope, str) else ",".join(scope)
    scope_desc = sections.SCOPES.get(scope, "") if isinstance(scope, str) else "Combined scopes"
    payload = {
        "scope": scope_label,
        "scope_description": scope_desc,
        "topic_filter": topic,
        "token_estimate": 0,
        "context": result
    }
```

Also update the `learning`-scope special case for `effective_days` (server.py:768), which checks `scope == "learning"`; make it list-aware:

```python
        is_learning = scope == "learning" or (not isinstance(scope, str) and "learning" in scope)
        effective_days = days if days is not None else (60 if is_learning else None)
```

Finally, widen the `get_context` MCP tool signature (server.py:2895-2901) and document section scopes + lists. Replace the `Literal[...]` with a union type and update the docstring SCOPES section:

```python
@mcp.tool()
def get_context(
    scope: Union[str, List[str]] = "minimal",   # a global scope, a section key, or a list (unioned)
    topic: Optional[str] = None,
    include_inactive: bool = False,
    days: Optional[int] = None,
    limit: Optional[int] = None
) -> str:
    """
    Retrieve scoped persona context. Call this FIRST at conversation start.

    SCOPES (global): minimal | professional | personal | learning | full
    SECTION SCOPES: profile | knowledge | preferences | projects | lifestyle | circle | learning_log
        - A section scope returns that whole section plus your always-on
          preferences (tone, detail_level, dislikes, learning_style).
    MULTIPLE: pass a list to union scopes, e.g. ["lifestyle", "circle"].

    ARGS:
        scope: a global scope name, a section key, or a list of them
        topic: filter to items matching this topic
        include_inactive: include inactive/paused items
        days: limit learning_log to last N days
        limit: max learning_log entries

    RETURNS: filtered persona data (+ always-on preferences).
    """
    result = get_scoped_context(scope, topic, include_inactive, days, limit)
    return json.dumps(result, ensure_ascii=False)
```

> Note on the type hint: FastMCP derives the tool's input schema from the annotation. Annotate `scope` as `Union[str, List[str]]` (add `from typing import Union, List` if not already imported) rather than a bare default, so the MCP schema advertises both forms. Verify the tool still registers by importing `server` in a test.

- [ ] **Step 4: Run to verify pass + full suite green**

Run: `python -m pytest tests/test_multi_scope.py tests/ -q`
Expected: PASS (all new multi-scope tests + entire existing suite).

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/test_multi_scope.py
git commit -m "feat: get_context accepts one scope or a list (union resolution)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after Task 7)

- [ ] Run the whole suite: `cd backend && source venv/bin/activate && python -m pytest -q` → all green.
- [ ] Grep confirms the old tables are gone: `grep -rn "^DEFAULTS\|^ID_LISTS\|^CONTEXT_SCOPES" backend/*.py` → no matches.
- [ ] `sections.py` imports only stdlib: `grep -n "^import\|^from" backend/sections.py` → only `dataclasses` (and `copy` if used).
- [ ] Manual smoke via the raw functions: `get_context.fn(scope="lifestyle")`, `get_context.fn(scope=["lifestyle","circle"])`, `get_context.fn(scope="professional")` all return sensible JSON with a `preferences` block present.
