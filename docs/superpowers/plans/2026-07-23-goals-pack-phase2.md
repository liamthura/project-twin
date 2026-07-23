# Goals Pack + Migration (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship goals as a first-class section pack — write path, cross-scope presence, career_aspiration back-compat alias, and a one-off data migration off profile's two legacy goal lists.

**Architecture:** A new `backend/section_packs/goals/manifest.json` (the first pack added since the loader shipped). Profile's dormant `goals_and_careers` id-list and `career_aspirations` move out in the same commit (the `goal` id-prefix would otherwise collide). server.py gains: a `goal` entity branch in `execute_modify` (with unknown-type coercion to `other`+`custom_type`), a `career_aspiration` alias branch, a goals scope hook (active-only in global scopes, ≤5 title stubs in minimal, everything in the `goals` section scope), and an updated capture suggestion. A standalone idempotent migration script moves existing data. The Phase 1 golden fixture is REGENERATED once, deliberately, in Task 1 — this phase is an intentional behavior change.

**Tech Stack:** Python 3.11+, existing pack loader, pytest + docker test Postgres.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-modular-section-packs-design.md` Part 2 (goals) — NOT Parts 3/4 (no `_meta`, no media/aesthetics, no generic editor).
- Goal entity: required `title`; optional `type, custom_type, status, target_date, why, notes`; `type ∈ {career, learning, personal, health, financial, creative, other}`; `status ∈ {active, achieved, paused, dropped}`, default `active`; identifier `title`.
- Unknown `type` on write is COERCED to `other` + `custom_type` with a note in the success message — never an error. Unknown `status` IS an error.
- Scope presence: minimal → ≤5 active-goal `{id,title}` stubs; professional/personal/learning → active goals in full; `goals` section scope → everything including achieved/paused/dropped; `full` → active only (matches `_filter_inactive` behavior for every other section).
- Goals is toggleable (NOT in `ALWAYS_ON_SECTIONS`) and default-ON — which the existing `disabled_sections` model gives automatically. Do not build a default-off mechanism.
- The golden fixture regeneration in Task 1 is the ONLY sanctioned fixture change; `test_registry_golden.py` itself is never edited.
- Full suite green at the end of every task; tests that pin the old shape (named per task) are updated in the same task as the behavior change.
- Requirements stay pinned; no new dependencies this phase.
- Work on branch `feature/section-packs` (merge to main happens at the end via the user). Commit after every task, exact messages given, no Co-Authored-By.
- Run commands from `backend/` with `./venv/bin/python`; test DB via docker compose on localhost:5433 (already running).

## File Structure

```
backend/
  section_packs/goals/manifest.json    # NEW (Task 1)
  section_packs/profile/manifest.json  # MODIFIED (Task 1) — drop 2 legacy lists + career_aspiration entity
  server.py                            # MODIFIED (Tasks 1, 2) — goal branch, alias, suggestion, scope hook
  persona_store.py                     # MODIFIED (Task 1) — drop goals_and_careers normalize lines
  scripts/migrate_goals.py             # NEW (Task 3)
  tests/
    fixtures/registry_golden.json      # REGENERATED (Task 1, sanctioned)
    test_goals_write.py                # NEW (Task 1)
    test_goals_scope.py                # NEW (Task 2)
    test_migrate_goals.py              # NEW (Task 3)
README.md                              # MODIFIED (Task 4)
```

---

### Task 1: Goals pack, write path, alias, and golden regeneration (atomic)

**Files:**
- Create: `backend/section_packs/goals/manifest.json`
- Modify: `backend/section_packs/profile/manifest.json`
- Modify: `backend/server.py` (goal branch in `execute_modify`; replace `career_aspiration` branch at ~line 1278; suggestion emitter at ~line 2779; `ADVISORY_ENTITIES` + its comment at ~line 3125)
- Modify: `backend/persona_store.py` (~lines 84-90: the `goals_and_careers` normalize block)
- Regenerate: `backend/tests/fixtures/registry_golden.json`
- Test: `backend/tests/test_goals_write.py` (new); update `backend/tests/test_sections_registry.py`, `backend/tests/test_settings_api.py`, and any suggest/schema tests the suite flags

**Interfaces:**
- Produces: section `goals` (file_type `goals`, blob `{"goals": [...]}`, id prefix `goal`); entity `goal` writable via persona_modify/persona_batch; `career_aspiration` alias (no longer in ENTITY_SCHEMA); module constants `GOAL_TYPES`, `GOAL_STATUSES` in server.py. Task 2 consumes the section; Task 3 consumes `persona_store` file_type `goals`.

- [ ] **Step 1: Write the goals manifest**

`backend/section_packs/goals/manifest.json`:

```json
{
  "key": "goals",
  "title": "Goals",
  "description": "What you're working toward — type, status, and target date",
  "core": false,
  "position": 15,
  "defaults": { "goals": [] },
  "id_lists": [["goals", "goal"]],
  "scope_contributions": {
    "minimal": ["goals"],
    "professional": ["goals"],
    "personal": ["goals"],
    "learning": ["goals"]
  },
  "entities": {
    "goal": {
      "actions": ["add", "update", "remove"],
      "required": ["title"],
      "optional": ["type", "custom_type", "status", "target_date", "why", "notes"],
      "valid_values": {
        "type": ["career", "learning", "personal", "health", "financial", "creative", "other"],
        "status": ["active", "achieved", "paused", "dropped"]
      },
      "identifier": "title"
    }
  },
  "capture_triggers": ["goal is", "aiming to", "planning to", "hoping to", "want to", "working toward"],
  "ui": {
    "goals": {
      "title_field": "title",
      "badges": ["type", "status"],
      "detail_fields": ["target_date", "why", "notes"]
    }
  }
}
```

- [ ] **Step 2: Trim the profile manifest**

In `backend/section_packs/profile/manifest.json`: delete the `"career_aspirations": []` and `"goals_and_careers": []` entries from `defaults`; delete the `["goals_and_careers", "goal"]` pair from `id_lists`; delete `"career_aspirations"` from `scope_contributions.professional` and `scope_contributions.learning` and `"goals_and_careers"` from `scope_contributions.personal`; delete the whole `"career_aspiration"` entity from `entities`.

- [ ] **Step 3: Trim persona_store profile normalization**

In `backend/persona_store.py` `_normalize`, delete these lines (~84-90):

```python
        # Ensure goals_and_careers is at profile level
        if isinstance(education, dict) and education.get("goals_and_careers"):
            data.setdefault("goals_and_careers", education["goals_and_careers"])
        data.setdefault("goals_and_careers", [])
```

- [ ] **Step 4: Write failing write-path tests**

`backend/tests/test_goals_write.py`:

```python
"""Goals pack write path: add/update/remove, type coercion, alias."""
import server


def test_goals_pack_registered(clean_database):
    import sections
    assert "goals" in sections.SECTION_REGISTRY
    assert list(sections.SECTION_REGISTRY)[:2] == ["profile", "goals"]  # position 15
    assert "goals" not in sections.ALWAYS_ON_SECTIONS
    assert "career_aspirations" not in sections.SECTION_REGISTRY["profile"].default
    assert "goals_and_careers" not in sections.SECTION_REGISTRY["profile"].default


def test_goal_add_and_defaults(clean_database, register_user):
    msg = server.execute_modify("add", "goal", {"title": "Run a 10K", "type": "health"})
    assert msg.startswith("✅")
    blob = server.load_json("goals.json")
    [g] = blob["goals"]
    assert g["title"] == "Run a 10K"
    assert g["type"] == "health"
    assert g["status"] == "active"  # default


def test_goal_unknown_type_coerces_to_other(clean_database, register_user):
    msg = server.execute_modify("add", "goal", {"title": "Serve community", "type": "spiritual"})
    assert msg.startswith("✅")
    assert "other" in msg  # coercion noted in the message
    [g] = server.load_json("goals.json")["goals"]
    assert g["type"] == "other"
    assert g["custom_type"] == "spiritual"


def test_goal_unknown_status_errors(clean_database, register_user):
    msg = server.execute_modify("add", "goal", {"title": "X", "status": "someday"})
    assert msg.startswith("❌")


def test_goal_update_and_remove(clean_database, register_user):
    server.execute_modify("add", "goal", {"title": "Ship v2", "type": "learning"})
    msg = server.execute_modify("update", "goal", {"title": "Ship v2", "status": "achieved", "why": "portfolio"})
    assert msg.startswith("✅")
    [g] = server.load_json("goals.json")["goals"]
    assert g["status"] == "achieved" and g["why"] == "portfolio"
    msg = server.execute_modify("remove", "goal", {"title": "Ship v2"})
    assert msg.startswith("✅")
    assert server.load_json("goals.json")["goals"] == []


def test_career_aspiration_alias_creates_goal(clean_database, register_user):
    msg = server.execute_modify("add", "career_aspiration", {"aspiration": "Become a consultant"})
    assert msg.startswith("✅")
    assert "goal" in msg.lower()  # advisory names the new entity
    [g] = server.load_json("goals.json")["goals"]
    assert g["title"] == "Become a consultant"
    assert g["type"] == "career"


def test_career_aspiration_not_in_schema(clean_database):
    assert "career_aspiration" not in server.ENTITY_SCHEMA.get("profile", {})
    assert "goal" in server.ENTITY_SCHEMA["goals"]
```

If the existing suite has no `register_user` fixture, look at how `backend/tests/test_entity_ids.py` or `test_persona_store.py` establish a user context (register via TestClient or set `db.current_user_id` after inserting a user) and use that same mechanism — adapt the fixture name accordingly, do not invent a parallel one.

- [ ] **Step 5: Run to verify failures**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_goals_write.py -v`
Expected: FAIL — goals pack loads (manifest exists) but `execute_modify` has no goal branch yet, so add returns the fall-through error.

- [ ] **Step 6: Implement the server.py write path**

(a) Immediately after the `ENTITY_SCHEMA = _pack_loader.build_entity_schema(...)` assignment, add:

```python
GOAL_TYPES = set(ENTITY_SCHEMA["goals"]["goal"]["valid_values"]["type"])
GOAL_STATUSES = set(ENTITY_SCHEMA["goals"]["goal"]["valid_values"]["status"])
```

(b) Add a `goal` branch to `execute_modify` (place it after the `career_aspiration` branch):

```python
    elif entity == "goal":
        blob = load_json("goals.json")
        goals = blob.setdefault("goals", [])
        title = get_field(data, "title", "name", "goal")

        def _coerce_type(raw, custom):
            """Unknown types become other/custom_type — never an error."""
            t = (raw or "").strip().lower()
            if t and t not in GOAL_TYPES:
                return "other", (custom or raw), f" (type '{raw}' stored as other/custom_type)"
            return t, custom, ""

        if action == "add":
            if not title:
                return "❌ Goal requires 'title'"
            idx, _ = find_in_array(goals, title, "title")
            if idx != -1:
                return f"ℹ️ Goal '{title}' already exists"
            gtype, custom_type, note = _coerce_type(
                get_field(data, "type", "category"), get_field(data, "custom_type", "type_label"))
            status = (get_field(data, "status") or "active").strip().lower()
            if status not in GOAL_STATUSES:
                return f"❌ Invalid status '{status}'. Valid: {sorted(GOAL_STATUSES)}"
            item = {"title": title, "status": status}
            if gtype:
                item["type"] = gtype
            if custom_type:
                item["custom_type"] = custom_type
            for f in ("target_date", "why", "notes"):
                v = get_field(data, f)
                if v:
                    item[f] = v
            goals.append(item)
            save_json("goals.json", blob)
            return f"✅ Added goal: {title}{note}"

        elif action == "update":
            idx, goal = find_in_array(goals, title or "", "title")
            if idx == -1:
                return f"❌ Goal '{title}' not found"
            note = ""
            if get_field(data, "type", "category") is not None:
                gtype, custom_type, note = _coerce_type(
                    get_field(data, "type", "category"), get_field(data, "custom_type", "type_label"))
                if gtype:
                    goal["type"] = gtype
                if custom_type:
                    goal["custom_type"] = custom_type
            status = get_field(data, "status")
            if status:
                status = status.strip().lower()
                if status not in GOAL_STATUSES:
                    return f"❌ Invalid status '{status}'. Valid: {sorted(GOAL_STATUSES)}"
                goal["status"] = status
            for f in ("target_date", "why", "notes"):
                v = get_field(data, f)
                if v is not None:
                    goal[f] = v
            new_title = get_field(data, "new_title")
            if new_title:
                goal["title"] = new_title
            save_json("goals.json", blob)
            return f"✅ Updated goal: {goal['title']}{note}"

        elif action == "remove":
            idx, _ = find_in_array(goals, title or "", "title")
            if idx == -1:
                return f"❌ Goal '{title}' not found"
            goals.pop(idx)
            save_json("goals.json", blob)
            return f"✅ Removed goal: {title}"
```

(c) Replace the whole `career_aspiration` branch (~line 1278) with the alias:

```python
    elif entity == "career_aspiration":
        # Back-compat alias: aspirations are goals now (type=career).
        asp = get_field(data, "aspiration", "goal", "title", "career_goal", "objective", "aim")
        if not asp:
            return "❌ career_aspiration requires 'aspiration'"
        result = execute_modify(action, "goal", {"title": asp, "type": "career"})
        if result.startswith("✅"):
            result += " — career_aspiration is stored as a goal now; use entity 'goal'"
        return result
```

(d) Suggestion emitter (~line 2779): change the appended suggestion to

```python
                        suggestions.append({
                            "action": "add", "entity": "goal",
                            "data": {"title": goal, "type": "career"},
                            "reason": f"Career/learning goal: {goal}",
                            "confidence": 0.65
                        })
```

(e) `ADVISORY_ENTITIES` (~line 3143): add `"goal": ("goals", "goals"),` and update the explanatory comment above it — remove the sentence about `career_aspiration`/`goals_and_careers` (now stale) and note that `career_aspiration` is an alias for `goal`.

- [ ] **Step 7: Run the new tests, then the full suite; update pinned tests**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_goals_write.py -v` → all pass.
Run: `./venv/bin/python -m pytest tests/ -q` → EXPECTED failures now: `test_registry_golden.py` (schema changed — fixed in Step 8), `test_sections_registry.py` (toggleable set now includes `goals`), `test_settings_api.py` (packs list gains goals at index 1; toggleable gains goals), possibly suggest-related tests (entity name change) and schema-listing tests (career_aspiration gone). Update those assertions to the new truth IN THIS TASK. Do not touch `test_registry_golden.py` itself.

- [ ] **Step 8: Regenerate the golden fixture (sanctioned, deliberate)**

```bash
cd backend && DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test ./venv/bin/python - <<'EOF'
import json, sections, server

def norm_spec(spec):
    return {"key": spec.key, "default": spec.default,
            "id_lists": [list(t) for t in spec.id_lists],
            "context_fields": spec.context_fields}

snapshot = {
    "section_order": list(sections.SECTION_REGISTRY),
    "always_on_sections": sorted(sections.ALWAYS_ON_SECTIONS),
    "section_registry": {k: norm_spec(v) for k, v in sections.SECTION_REGISTRY.items()},
    "entity_schema": server.ENTITY_SCHEMA,
}
with open("tests/fixtures/registry_golden.json", "w") as f:
    json.dump(snapshot, f, indent=2, sort_keys=True)
    f.write("\n")
print("regenerated")
EOF
```

Then: `./venv/bin/python -m pytest tests/ -q` → ALL green.

- [ ] **Step 9: Commit**

```bash
git add backend/section_packs/goals/manifest.json backend/section_packs/profile/manifest.json \
  backend/server.py backend/persona_store.py backend/tests/
git commit -m "feat: goals section pack — write path, type coercion, career_aspiration alias

Deliberate behavior change: golden fixture regenerated (goals pack added;
profile loses career_aspirations + dormant goals_and_careers)."
```

---

### Task 2: Goals scope hook — active-only globals, minimal stubs, goals-scope completeness

**Files:**
- Modify: `backend/server.py` — `_CONTEXT_FILE_ORDER` (~line 686), `_filter_inactive` (~line 976), `get_scoped_context` (~lines 810-816)
- Test: `backend/tests/test_goals_scope.py` (new); update any context tests the suite flags

**Interfaces:**
- Consumes: goals section + write path from Task 1.
- Produces: scope behavior per Global Constraints. `_filter_inactive(data, exempt=frozenset())` gains an optional exempt param (default preserves existing call sites).

- [ ] **Step 1: Write failing scope tests**

`backend/tests/test_goals_scope.py`:

```python
"""Goals scope hook: active-only in globals, ≤5 stubs in minimal, all in goals scope."""
import server


def _seed(n_active=6, achieved=True):
    for i in range(n_active):
        server.execute_modify("add", "goal", {"title": f"Active goal {i}", "type": "learning"})
    if achieved:
        server.execute_modify("add", "goal", {"title": "Done goal", "status": "achieved"})
        server.execute_modify("add", "goal", {"title": "Dropped goal", "status": "dropped"})


def test_minimal_scope_stubs_active_goals_max5(clean_database, register_user):
    _seed()
    ctx = server.get_scoped_context("minimal")["context"]
    goals = ctx["goals"]["goals"]
    assert len(goals) == 5
    assert all(set(g) == {"id", "title"} for g in goals)
    assert all("Done goal" != g["title"] and "Dropped goal" != g["title"] for g in goals)


def test_professional_scope_full_active_goals_only(clean_database, register_user):
    _seed(n_active=2)
    ctx = server.get_scoped_context("professional")["context"]
    goals = ctx["goals"]["goals"]
    assert len(goals) == 2
    assert all(g["status"] == "active" for g in goals)
    assert any("type" in g for g in goals)  # full entries, not stubs


def test_goals_section_scope_includes_non_active(clean_database, register_user):
    _seed(n_active=1)
    ctx = server.get_scoped_context("goals")["context"]
    titles = {g["title"] for g in ctx["goals"]["goals"]}
    assert {"Active goal 0", "Done goal", "Dropped goal"} <= titles


def test_mixed_scope_with_goal_bearing_token_keeps_full(clean_database, register_user):
    _seed(n_active=2)
    ctx = server.get_scoped_context(["minimal", "professional"])["context"]
    goals = ctx["goals"]["goals"]
    assert all("status" in g for g in goals)  # professional wins: full entries


def test_full_scope_active_only(clean_database, register_user):
    _seed(n_active=1)
    ctx = server.get_scoped_context("full")["context"]
    titles = {g["title"] for g in ctx["goals"]["goals"]}
    assert "Done goal" not in titles
```

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_goals_scope.py -v`
Expected: minimal-stub and goals-scope tests FAIL (no hook yet); note which pass by accident and why in the report.

- [ ] **Step 3: Implement the hook**

(a) `_CONTEXT_FILE_ORDER`: insert `"goals"` after `"profile"`:

```python
_CONTEXT_FILE_ORDER = ("preferences", "profile", "goals", "lifestyle", "knowledge", "circle", "projects", "learning_log")
```

(b) `_filter_inactive` gains an exempt param — signature and first loop line change only:

```python
def _filter_inactive(data: dict, exempt: frozenset = frozenset()) -> dict:
    """Remove inactive/paused items from context. Sections named in `exempt`
    pass through unfiltered (the goals section scope shows every status)."""
    filtered = {}

    for key, section in data.items():
        if key in exempt or not isinstance(section, dict):
            filtered[key] = section
            continue
```

(c) In `get_scoped_context`, replace the `_filter_inactive` call and add the minimal-stub hook after the `detail == "titles"` block:

```python
    tokens = [scope] if isinstance(scope, str) else list(scope)
    if not include_inactive:
        # Goals hook (1/2): the goals section scope shows every status.
        exempt = frozenset({"goals"}) if "goals" in tokens else frozenset()
        result = _filter_inactive(result, exempt)

    if detail == "titles":
        result = _stub_titles(result)

    # Goals hook (2/2): when no goal-bearing scope was requested (i.e. goals
    # rode in via minimal only), reduce to ≤5 active-goal {id, title} stubs.
    _goals_full_tokens = {"professional", "personal", "learning", "goals", "full"}
    if "goals" in result and not any(t in _goals_full_tokens for t in tokens):
        glist = result["goals"].get("goals")
        if isinstance(glist, list):
            import search_index
            result["goals"]["goals"] = [
                {"id": g.get("id"), "title": search_index.flatten_entity(g)[0]}
                if isinstance(g, dict) else g
                for g in glist[:5]
            ]
```

(The existing `scope_label = ...` line follows; do not duplicate it.)

- [ ] **Step 4: Run scope tests, then the full suite**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_goals_scope.py -v` → all pass.
Run: `./venv/bin/python -m pytest tests/ -q` → green. Context tests that pin scope output shapes (`test_context_efficiency.py`, `test_context_titles.py`, `test_multi_scope.py`, `test_section_scopes.py`, `test_disable_context.py`) may need updates for the new `goals` key — update them to the new truth in this task and list every change in your report.

- [ ] **Step 5: Commit**

```bash
git add backend/server.py backend/tests/
git commit -m "feat: goals scope hook — active-only globals, minimal title stubs, full goals scope"
```

---

### Task 3: Migration script

**Files:**
- Create: `backend/scripts/migrate_goals.py`
- Test: `backend/tests/test_migrate_goals.py`

**Interfaces:**
- Consumes: `persona_store` (file_type `goals` from Task 1), `db.current_user_id`.
- Produces: `migrate_goals.migrate_user(user_id) -> dict` (importable, unit-testable) and a `main()` CLI iterating all users.

- [ ] **Step 1: Write failing migration tests**

`backend/tests/test_migrate_goals.py`:

```python
"""migrate_goals: legacy profile lists -> goals section, idempotent."""
import db
import persona_store
from scripts.migrate_goals import migrate_user


def _seed_legacy_profile():
    profile = persona_store.load("profile")
    profile["career_aspirations"] = ["Become a consultant", "Lead a team"]
    profile["goals_and_careers"] = [{"title": "Run a marathon"}, "Learn Mandarin"]
    persona_store.save("profile", profile)


def test_migrate_moves_both_lists(clean_database, register_user):
    _seed_legacy_profile()
    stats = migrate_user(db.current_user_id.get())
    assert stats["moved"] == 4
    goals = persona_store.load("goals")["goals"]
    titles = {g["title"] for g in goals}
    assert titles == {"Become a consultant", "Lead a team", "Run a marathon", "Learn Mandarin"}
    assert all(g["type"] == "career" and g["status"] == "active" for g in goals)
    assert all("id" in g for g in goals)  # ids assigned on save
    profile = persona_store.load("profile")
    assert "career_aspirations" not in profile
    assert "goals_and_careers" not in profile


def test_migrate_is_idempotent(clean_database, register_user):
    _seed_legacy_profile()
    migrate_user(db.current_user_id.get())
    stats2 = migrate_user(db.current_user_id.get())
    assert stats2["moved"] == 0
    assert len(persona_store.load("goals")["goals"]) == 4


def test_migrate_skips_titles_already_present(clean_database, register_user):
    import server
    server.execute_modify("add", "goal", {"title": "Become a consultant"})
    _seed_legacy_profile()
    stats = migrate_user(db.current_user_id.get())
    assert stats["moved"] == 3  # duplicate title skipped
```

Use the same user-context fixture mechanism as Task 1's tests.

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_migrate_goals.py -v`
Expected: FAIL with `ModuleNotFoundError` / `ImportError` for `scripts.migrate_goals`.

- [ ] **Step 3: Implement the script**

`backend/scripts/migrate_goals.py`. BEFORE writing, check the exact `persona_store` load/save function names and the per-user iteration pattern in `backend/scripts/migrate_json_to_postgres.py` and mirror them — the code below assumes `persona_store.load(file_type)` / `persona_store.save(file_type, blob)`; adjust to the real API if it differs and say so in your report.

```python
"""One-off migration: move profile.career_aspirations and the dormant
profile.goals_and_careers into the goals section as goal entities
(type=career, status=active). Idempotent: existing goal titles are skipped
(case-insensitive), and once the profile keys are gone reruns are no-ops.

Usage: DATABASE_URL=... python scripts/migrate_goals.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db  # noqa: E402
import persona_store  # noqa: E402


def _legacy_titles(profile: dict) -> list[str]:
    titles = []
    for asp in profile.get("career_aspirations") or []:
        if isinstance(asp, str) and asp.strip():
            titles.append(asp.strip())
    for item in profile.get("goals_and_careers") or []:
        if isinstance(item, dict):
            t = item.get("title") or item.get("name") or item.get("goal")
            if t and str(t).strip():
                titles.append(str(t).strip())
        elif isinstance(item, str) and item.strip():
            titles.append(item.strip())
    return titles


def migrate_user(user_id) -> dict:
    db.current_user_id.set(user_id)
    profile = persona_store.load("profile")
    goals_blob = persona_store.load("goals")
    goals = goals_blob.setdefault("goals", [])
    existing = {g.get("title", "").lower() for g in goals if isinstance(g, dict)}

    moved = 0
    for title in _legacy_titles(profile):
        if title.lower() in existing:
            continue
        goals.append({"title": title, "type": "career", "status": "active"})
        existing.add(title.lower())
        moved += 1

    had_legacy_keys = "career_aspirations" in profile or "goals_and_careers" in profile
    profile.pop("career_aspirations", None)
    profile.pop("goals_and_careers", None)

    if moved:
        persona_store.save("goals", goals_blob)
    if had_legacy_keys:
        persona_store.save("profile", profile)
    return {"moved": moved}


def main():
    with db.get_pool().connection() as conn:
        users = conn.execute("select id, username from users").fetchall()
    total = 0
    for row in users:
        stats = migrate_user(row["id"])
        total += stats["moved"]
        print(f"{row['username']}: moved {stats['moved']}")
    print(f"done — {total} goal(s) migrated across {len(users)} user(s)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run migration tests, then the full suite**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_migrate_goals.py -v` → all pass.
Run: `./venv/bin/python -m pytest tests/ -q` → green.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/migrate_goals.py backend/tests/test_migrate_goals.py
git commit -m "feat: idempotent migration of legacy profile goal lists into the goals pack"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above. Documentation only; suite must stay green.

- [ ] **Step 1: Update README**

Four surgical edits (find each location by searching the quoted text):

1. **Section scopes line** (search `"profile", "knowledge", "projects"`): add `goals` to the list of section keys usable as scopes.
2. **Supported-entities sampler table** (search `career_aspiration` if present, and the `| Entity` header): add a row `| goal | add, update, remove | title, type (7 kinds + custom via "other"), status, target_date, why, notes |`; remove any `career_aspiration` row; note beneath the table: `career_aspiration` still works as a write alias and records a goal with type "career".
3. **Scoped-context table** (search `| Scope          | Tokens`): append to the Includes column — minimal: `+ top 5 active goal titles`; professional/personal/learning: `+ active goals`. Add one sentence under the table: token estimates predate the goals pack; expect a small increase (active goals only; full entries are ~40 tokens each, minimal stubs ~10).
4. **Roadmap** (search `- [ ] Conversation history`): add above it: `- [x] Goals as a first-class section (types, status, target dates, custom types, migration off profile lists)`.

- [ ] **Step 2: Verify suite untouched and green**

Run: `cd backend && ./venv/bin/python -m pytest tests/ -q` → green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README updates for the goals pack"
```

---

## Post-execution (controller, not a task)

- Run `scripts/migrate_goals.py` against PRODUCTION (VPS Postgres) after deploy — controller coordinates with the user; the script is one-off and idempotent.
- Merge/PR decision per user.

## Completion Criteria

- Full suite green; goals visible in `get_context` scopes per the constraint table; `get_schema` lists `goal` and not `career_aspiration`; migration tests prove idempotency.
