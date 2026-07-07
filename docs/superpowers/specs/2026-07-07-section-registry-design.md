# Section Registry — Design Spec (Phase 1, Option A + section scopes)

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan
**Supersedes:** the Phase 1 section of `docs/plans/2026-07-07-mcp-registry-efficiency-learning-log.md` (which described the fuller "Option B" refactor; this spec narrows Phase 1 to the low-risk keystone and adds section scopes).

## Goal

Make `sections.py` the single source of truth for section-*level* structure (defaults, valid files, id-carrying lists, per-scope field selection), eliminating the drift between `DEFAULTS`, `VALID_FILES`, `ID_LISTS`, and `CONTEXT_SCOPES`. Additionally, expose **per-section scopes** (auto-derived) and let `get_context` accept **multiple scopes** in one call. This unlocks Phase 2 (per-user enable/disable) and gives finer-grained context fetching, while keeping the migration a *provable, behavior-neutral* refactor.

## Non-goals (explicitly deferred)

- **Not** genericizing the `execute_modify` write path (the ~1,137-line if/elif). Stays as-is.
- **Not** rebuilding `get_schema` from the registry or deleting `ENTITY_SCHEMA`. It was just reworked and reviewed; leave it.
- **Not** touching `FIELD_ALIASES` / `normalize_data` / `persona_store._normalize` legacy migration.

These are "Option B" and can be done later as a separate, focused effort. This spec is designed so that later migration is clean, not a prerequisite.

---

## §1 — The boundary: what the registry owns vs. leaves alone

The registry must own things **exclusively** — never duplicate a table that still owns the same data, or we recreate the drift we're removing.

**Registry (`sections.py`) becomes the sole source of truth for:**

| Data | Migrated from |
|---|---|
| `default` skeleton per section | `persona_store.DEFAULTS` |
| valid file list | `persona_store.VALID_FILES` |
| id-carrying lists `(list_key, id_prefix)` | `persona_store.ID_LISTS` |
| per-scope field selection | `CONTEXT_SCOPES[scope]["fields"]` |
| always-on field bundle | (the `preferences` line duplicated across global scopes) |
| scope descriptions | `CONTEXT_SCOPES[scope]["description"]` |

**Left untouched (they keep owning their data):**

- `ENTITY_SCHEMA` (server.py) — write/validation schema behind `get_schema`
- `FIELD_ALIASES` + `normalize_data` (server.py) — alias resolution
- `execute_modify`'s per-entity branches (server.py)
- `persona_store._normalize` — legacy-format migration

**Consequence:** the registry carries **no** per-entity write schema (`required`/`optional`/`valid_values`/`identifier`) in this phase — that stays in `ENTITY_SCHEMA`. Copying it in would recreate drift. Entities appear in the registry only as the `(list_key, id_prefix)` tuples that need ids. (Option B later moves the write schema in and deletes `ENTITY_SCHEMA`.)

---

## §2 — `sections.py` shape

Dependency-free module: imports only stdlib. Import direction is `sections ← persona_store ← server` (and `sections ← server`), so no cycle — `sections.py` imports nothing from the project.

```python
# backend/sections.py
from dataclasses import dataclass, field

@dataclass(frozen=True)
class SectionSpec:
    key: str                       # file_type, e.g. "lifestyle"
    default: dict                  # skeleton (was DEFAULTS[key])
    id_lists: tuple = ()           # ((list_key, id_prefix), ...) (was ID_LISTS[key])
    context_fields: dict = field(default_factory=dict)   # {scope: [field, ...]}

# Always-on bundle: included in EVERY resolved scope (global and section).
# This is exactly the preferences slice every global scope currently carries.
ALWAYS_ON = {"preferences": ["code_style", "learning_style", "communication", "dislikes"]}

# Scope-level metadata (names + human descriptions), separate from section data.
SCOPES = {
    "minimal": "Quick identity snapshot",
    "professional": "Work-relevant context",
    "personal": "Hobbies, interests, personality, and tracked topics",
    "learning": "Current learning focus",
    "full": "Complete persona",     # 'full' = every field; no per-section list
}

SECTION_REGISTRY = { ... 7 SectionSpec, one per file_type ... }
```

Notes:
- Scopes are stored transposed vs. today: today it's `scope → file → fields`; the registry stores `section → {scope: fields}`, making each section self-contained (which is what makes Phase 2 enable/disable and section scopes trivial).
- No `EntitySpec` in this phase (YAGNI — it arrives with Option B, when there's write-schema to hang on it).
- `frozen=True` guards attribute reassignment; because `default` is still a mutable dict, **consumers must deep-copy it on read** (see §3, deepcopy fix).

---

## §3 — Consumers migrated (each behavior-neutral)

1. **Context field selection** (`server.get_scoped_context` + `_files_for_scope`): read `SECTION_REGISTRY[file].context_fields.get(scope, [])` instead of `CONTEXT_SCOPES[scope]["fields"]`. `_files_for_scope` becomes "sections whose `context_fields[scope]` is non-empty (plus always-on sections)."
2. **Defaults** (`persona_store.load` / `reset`): return `copy.deepcopy(SECTION_REGISTRY[ft].default)`.
3. **Id assignment** (`persona_store._assign_ids`): derive `(list_key, prefix)` from `spec.id_lists`.
4. **Derived compat**: `persona_store.VALID_FILES = list(SECTION_REGISTRY)`, `FILE_MAP` derived from it.

**Correctness fix (in-scope):** today `persona_store.load()` returns `DEFAULTS.get(ft)` **by reference**, and `reset()` → `save(DEFAULTS[ft])` → `_assign_ids` mutates it in place, so calling `reset()` permanently injects `id`s into the `DEFAULTS` constant. Switching reads to `copy.deepcopy(spec.default)` fixes this latent bug. A test asserts that load/reset never mutate the registry default.

---

## §4 — Scopes: global + section, composable

### Global scopes (unchanged behavior)
`minimal`, `professional`, `personal`, `learning`, `full` — curated cross-section slices. Each already includes the preferences bundle; after this change that bundle comes from `ALWAYS_ON` (see §5) rather than a repeated per-scope line. Output is identical.

### Section scopes (new, auto-derived)
One per section key: `profile`, `knowledge`, `preferences`, `projects`, `lifestyle`, `circle`, `learning_log`. A section scope resolves to **that section's full field set ∪ `ALWAYS_ON`**. Derived from the registry (`fields = keys of that section's default`), so adding a section auto-creates its scope — no new table.

Namespace: global names (`minimal`/`professional`/`personal`/`learning`/`full`) and section keys (the 7 file types) do **not** collide (`learning` ≠ `learning_log`), so one flat scope namespace is safe.

### Always-on resolution
`ALWAYS_ON` is applied to **every** resolved scope (global and section):
- Global scopes already include the preferences bundle → unioning `ALWAYS_ON` is a no-op → **output unchanged**.
- Section scopes gain the preferences bundle → you always get comms/tone/learning-style/dislikes context.

`ALWAYS_ON` is defined once and is the sole source of "what's always on"; the redundant preferences lines are removed from the global scopes' `context_fields`, protected by characterization tests proving global output is byte-identical.

### `get_context` accepts one scope or a list
```
get_context(scope="lifestyle")                 # one section
get_context(scope=["lifestyle", "circle"])     # two sections, unioned
get_context(scope=["professional", "circle"])  # global scope ∪ section
get_context(scope="professional")              # unchanged — still valid
```
Resolution: each token (global or section) resolves to its `{section: [fields]}` contribution via the registry; the list is **unioned** (per-section field sets merged, deduped), `ALWAYS_ON` folded in, then only the touched sections load. A single string stays valid → **backward-compatible**. Unknown token → error listing all valid scopes (global + section names). Mixing global + section is allowed and just unions.

**Tool-schema change:** `scope: str | list[str]` — the only API-surface change.

---

## §5 — Testing strategy (how this is *proven* safe)

- **Parity tests** (`test_sections_registry.py`, new): `{k: s.default for k,s in registry} == old DEFAULTS`; `set(registry) == VALID_FILES`; `id_lists` reconstruct old `ID_LISTS`; and scope fields reconstruct `CONTEXT_SCOPES[scope]["fields"]` exactly per scope. **The scope-field parity assertion evolves with the commit order:** at transcription time (commits 1–4) `context_fields` includes the preferences line verbatim, so the assertion is `context_fields == old fields`. After commit 6 factors preferences into `ALWAYS_ON` and removes the redundant lines, the assertion becomes `context_fields ∪ ALWAYS_ON == old fields`. Either way, the *actual* `get_context` output is the ground-truth guarantee (characterization tests below), and parity just proves the tables match.
- **Phase 0 characterization tests stay green unchanged** (`test_context_efficiency.py` — per-scope file-touch + token estimate) → proves global-scope context output is byte-identical through the migration and the `ALWAYS_ON` factoring.
- **`test_entity_ids.py` stays green** → proves id-assignment unchanged.
- **Deepcopy test** → load/reset never mutate registry defaults.
- **Section-scope tests** → each of the 7 returns exactly its section's fields ∪ `ALWAYS_ON` and nothing else.
- **Multi-select tests** → single-string parity (identical to today), two-section union, global∪section mix, dedup on overlap, unknown-token error.
- Full suite green after every commit.

---

## §6 — Commit sequence (small, each provably neutral except the two marked)

1. **`sections.py` + parity tests** (data only, no consumer changes). Commit.
2. **Context-field selection reads registry** (`get_scoped_context`, `_files_for_scope`); `CONTEXT_SCOPES` shrinks to `SCOPES` descriptions. Characterization tests green. Commit.
3. **Defaults + ids read registry** (+ deepcopy fix). `test_entity_ids` + suite green. Commit.
4. **Delete dead duplication** (`DEFAULTS`, `ID_LISTS`, `CONTEXT_SCOPES["fields"]`). Full suite green. Commit.
5. **[behavior change, isolated] Context-scope drift fix**: add `organisation`, `nationality`, `languages_spoken`, `goals_and_careers` to their scopes (`professional`/`personal`), each with a test asserting it now appears in context. Commit.
6. **[behavior-additive] Section scopes + always-on**: derive the 7 section scopes; introduce `ALWAYS_ON` and apply to all scope resolution; remove redundant per-scope preferences lines (characterization tests prove global output identical). Tests per §5. Commit.
7. **[behavior-additive] Multi-select `get_context`**: accept `str | list[str]`, union resolution; tests per §5. Commit.

---

## §7 — How this unlocks Phase 2 (enable/disable)

Every section is now a self-contained `SectionSpec` with its own `context_fields`. Per-user enable/disable becomes: store a per-user set of enabled section keys, and have context-loading / `get_all` iterate `SECTION_REGISTRY` filtered by that set (intersecting resolved scope fields with enabled sections). No new plumbing — the registry is exactly the list to filter.

## Exit criteria

- `DEFAULTS`, `VALID_FILES`, `ID_LISTS`, and the per-scope field tables no longer exist as independent structures; `sections.py` is the single source.
- Section scopes work and always carry the `ALWAYS_ON` preferences bundle; `get_context` accepts one-or-many scopes.
- The `reset()`/`load()` deepcopy correctness fix is in place.
- The context-scope drift is fixed as an isolated, tested change.
- All parity + characterization + entity-id + suite tests green.
