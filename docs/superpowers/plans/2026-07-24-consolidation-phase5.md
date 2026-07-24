# Section Consolidation (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate overlapping lists ahead of relations work: passions+curiosities → `interests` (kind-tagged), `dislikes` → `likes_dislikes` (stance-tagged), `current_learning` → goals(type=learning); sharpen mental_tabs/top_of_mind self-descriptions (they stay separate: bookmarks vs idea inbox); strip orphan blob keys.

**Architecture:** Same playbook as Phase 2: manifest changes + bespoke/generic write paths + write aliases for retired entities + one idempotent multi-user migration script (raw-read, per-user isolation) + golden regen + frontend editor updates. New lists are id-carrying (searchable — passions/curiosities/dislikes were invisible to search until now).

**Tech Stack:** Existing stack; no new deps.

## Global Constraints

- mental_tabs and top_of_mind are NOT merged. Their entity `description` fields (get_schema surface) become: mental_tab → "Saved topics and bookmarks to revisit later — a shelf, not an inbox"; top_of_mind → "Inbox for fleeting ideas and current thoughts — expect entries to be pruned". Capture/docs language must match.
- `interests`: lifestyle list of `{id, name, kind?}`, `kind ∈ {passion, curiosity}` (optional), id prefix `interest`, entity `interest` (generic write path, explicit `"list": "interests"`). `passion`/`curiosity` remain as ALIASES adding `interest` with kind preset (alias responses name the new entity). Old `passions`/`curiosities` lists removed from defaults/scopes; `_normalize` strips them from old blobs.
- `likes_dislikes`: preferences list of `{id, item, stance}`, `stance ∈ {like, dislike}` REQUIRED, id prefix `taste`. Entities `like` and `dislike`: required `[item]`, add sets stance from the entity name; update matches by `item` (supports `new_item`); remove by `item`; both operate on the same list via ONE shared bespoke branch. `sections.ALWAYS_ON` preferences bundle: `dislikes` → `likes_dislikes`. Old `dislikes` list removed from defaults; `_normalize` strips it.
- `current_learning` removed from projects (defaults, id_lists `["current_learning","learning"]`, scope_contributions minimal? — check: it appears in professional and learning scopes; remove from all). Entity `current_learning` becomes an alias → `goal` add with `type: "learning"`, `why` ← context; response names the goal entity. Goals scope hook (`_goals_full_tokens`) unchanged.
- `_normalize` also strips orphan keys: `knowledge.proficiency_levels`, `lifestyle.references` (top-level only — hobby-level references stay!).
- Migration script `backend/scripts/migrate_consolidation.py`: mirrors `migrate_goals.py` exactly — raw row reads (`_load_raw_*` pattern), per-user `run_all` isolation, idempotent (skip existing by identifier, case-insensitive), converts: passions/curiosities → interests (kind-tagged), dislikes strings → likes_dislikes (stance dislike), current_learning → goals (title←topic, why←context, type learning, status active; priority dropped). Pops all legacy keys.
- Capture: suggestion emitters referencing passion/interest phrases now emit `interest` (kind passion); any dislike emitter → `dislike` (alias still fine). Grep `suggestions.append` sites.
- Golden fixture regenerated ONCE (sanctioned; schema changes). `test_registry_golden.py` never edited.
- Tests pinning old shapes updated in-task and listed in reports. Suite green per task (322 baseline + new).
- Frontend: LifestyleEditor replaces the two ArrayInputs (passions, curiosities) with ONE interests list — text input + inline 2-option `EnumControl` (segmented) for kind; PreferencesEditor replaces the dislikes ArrayInput with a likes_dislikes list — item input + inline like/dislike segmented (VALUE_META: `like` exists (ThumbsUp); `dislike` → add entry `{icon: ThumbsDown, amber chip like disliked}`). Read each editor first; preserve its data-flow idiom; `npm run build` green.
- Branch `feature/section-packs`; exact commit messages; no Co-Authored-By; backend from `backend/` via `./venv/bin/python`; test DB localhost:5433; never reset/rebase/checkout; never `git add` .agents/, .claude/, skills-lock.json.

## File Structure

```
backend/
  section_packs/lifestyle/manifest.json    # T1: interests replaces passions/curiosities
  section_packs/preferences/manifest.json  # T1: likes_dislikes replaces dislikes
  section_packs/projects/manifest.json     # T1: current_learning removed
  section_packs/knowledge/manifest.json    # T1: mental_tab description sharpened
  server.py                                # T1: likes_dislikes branch, aliases, capture emitters, ALWAYS_ON ref check
  sections.py                              # T1: ALWAYS_ON bundle key swap
  persona_store.py                         # T1: _normalize strips (passions, curiosities, dislikes, current_learning, proficiency_levels, references)
  scripts/migrate_consolidation.py         # T2
  tests/fixtures/registry_golden.json      # T1 regen (sanctioned)
  tests/test_consolidation.py              # T1 (write paths) + T2 (migration)
frontend/src/editors/LifestyleEditor.jsx   # T3
frontend/src/editors/PreferencesEditor.jsx # T3
frontend/src/components/controls.jsx       # T3: VALUE_META dislike entry
README.md                                  # T4
```

---

### Task 1: Manifests, write paths, aliases, descriptions, golden regen (atomic)

**Files:** the four manifests, server.py, sections.py, persona_store.py, tests (new test_consolidation.py + pinned updates), golden regen.

**Interfaces produced:** entity `interest` (generic path; list `interests`); entities `like`/`dislike` (shared bespoke branch; list `likes_dislikes`, ids `taste_*`); aliases `passion`/`curiosity`/`current_learning`; `sections.ALWAYS_ON = {"preferences": ["code_style", "learning_style", "communication", "likes_dislikes"]}`.

- [ ] **Step 1: Manifest edits**

(a) `lifestyle/manifest.json`: defaults — remove `"passions": []`, `"curiosities": []`, add `"interests": []`; id_lists — add `["interests", "interest"]`; scope_contributions.personal — replace `passions`, `curiosities` with `interests`; entities — remove `passion` and `curiosity`, add:

```json
    "interest": {
      "actions": ["add", "update", "remove"],
      "required": ["name"],
      "optional": ["kind", "notes"],
      "valid_values": { "kind": ["passion", "curiosity"] },
      "identifier": "name",
      "list": "interests",
      "description": "Things you're into: kind=passion for what you love doing/following, kind=curiosity for what you want to explore"
    }
```

ui block: add `"interests": {"title_field": "name", "badges": ["kind"], "detail_fields": ["notes"]}` if the manifest has a ui block; add one if absent (harmless — bespoke editor still wins).

(b) `preferences/manifest.json`: defaults — remove `"dislikes": []`, add `"likes_dislikes": []`; id_lists — add `["likes_dislikes", "taste"]`; entities — remove `dislike`, add:

```json
    "like": {
      "actions": ["add", "update", "remove"],
      "required": ["item"],
      "optional": [],
      "identifier": "item",
      "list": "likes_dislikes",
      "description": "Something you like; stored with stance=like in the likes_dislikes list"
    },
    "dislike": {
      "actions": ["add", "update", "remove"],
      "required": ["item"],
      "optional": [],
      "identifier": "item",
      "list": "likes_dislikes",
      "description": "Something you dislike; stored with stance=dislike in the likes_dislikes list"
    }
```

(c) `projects/manifest.json`: defaults — remove `"current_learning": []`; id_lists — remove `["current_learning", "learning"]`; scope_contributions — remove `current_learning` everywhere it appears; entities — remove `current_learning`.

(d) `knowledge/manifest.json`: `mental_tab` entity gains/replaces `description`: "Saved topics and bookmarks to revisit later — a shelf, not an inbox". `projects/manifest.json`: `top_of_mind` entity description: "Inbox for fleeting ideas and current thoughts — expect entries to be pruned".

- [ ] **Step 2: sections.py + persona_store.py**

`sections.py` ALWAYS_ON: `"dislikes"` → `"likes_dislikes"` (comment stays accurate — update its wording if it names dislikes).
`persona_store._normalize`: extend the existing strip lines — profile branch pattern — with:
- lifestyle branch (create if the branch lacks one): `data.pop("passions", None); data.pop("curiosities", None); data.pop("references", None)` (top-level only)
- preferences branch: `data.pop("dislikes", None)` — CAREFUL: `_normalize` preferences branch currently does `data.setdefault("dislikes", [])` — remove that setdefault too.
- projects branch: `data.pop("current_learning", None)`
- knowledge branch: `data.pop("proficiency_levels", None)`
Each with the one-line "moved/retired in Phase 5" comment style used for the goals strips.

- [ ] **Step 3: server.py**

(a) Shared likes_dislikes branch (place near the old dislike branch; REPLACE the old `elif entity == "dislike":` branch):

```python
    elif entity in ("like", "dislike"):
        blob = load_json("preferences.json")
        items = blob.setdefault("likes_dislikes", [])
        item = get_field(data, "item", "name", "dislike", "like")
        stance = entity  # entity name IS the stance
        if action == "add":
            if not item:
                return f"❌ {entity} requires 'item'"
            idx, existing = find_in_array(items, item, "item")
            if idx != -1:
                if existing.get("stance") != stance:
                    existing["stance"] = stance
                    save_json("preferences.json", blob)
                    return f"✅ Updated stance: {item} is now a {stance}"
                return f"ℹ️ '{item}' already recorded as a {stance}"
            items.append({"item": item, "stance": stance})
            save_json("preferences.json", blob)
            return f"✅ Added {stance}: {item}"
        elif action == "update":
            idx, entry = find_in_array(items, item or "", "item")
            if idx == -1:
                return f"❌ '{item}' not found in likes_dislikes"
            new_item = get_field(data, "new_item")
            if new_item:
                entry["item"] = new_item
            entry["stance"] = stance
            save_json("preferences.json", blob)
            return f"✅ Updated {stance}: {entry['item']}"
        elif action == "remove":
            idx, _ = find_in_array(items, item or "", "item")
            if idx == -1:
                return f"❌ '{item}' not found in likes_dislikes"
            items.pop(idx)
            save_json("preferences.json", blob)
            return f"✅ Removed: {item}"
```

(b) Replace the bespoke `passion` and `curiosity` branches with aliases (career_aspiration pattern):

```python
    elif entity in ("passion", "curiosity"):
        name = get_field(data, "name", "passion", "topic", "curiosity", "interest")
        if not name:
            return f"❌ {entity} requires 'name'"
        result = execute_modify(action, "interest", {"name": name, "kind": entity})
        if result.startswith("✅"):
            result += f" — {entity}s are stored as interests now; use entity 'interest'"
        return result
```

(`interest` itself is handled by the GENERIC branch — no bespoke code. Verify `_generic_entity_spec("interest")` resolves via explicit `list`.)

(c) Replace the bespoke `current_learning` branch with an alias:

```python
    elif entity == "current_learning":
        topic = get_field(data, "topic", "name", "title")
        if not topic:
            return "❌ current_learning requires 'topic'"
        payload = {"title": topic, "type": "learning"}
        context = get_field(data, "context", "why")
        if context:
            payload["why"] = context
        result = execute_modify(action, "goal", payload)
        if result.startswith("✅"):
            result += " — current learning is stored as a goal (type: learning) now; use entity 'goal'"
        return result
```

(remove path: goal remove by title works via the payload's title.)

(d) Capture emitters: grep `suggestions.append` — any emitting `passion`/`interest`-flavored entities now emit `{"entity": "interest", "data": {"name": ..., "kind": "passion"}}`; any emitting `current_learning` → emit `goal` type learning (mirror the Phase 2 goal-emitter change). Report each change.

(e) `ADVISORY_ENTITIES`: remove `current_learning` entry (list is gone). `interest`/`like`/`dislike`: `interest` auto-qualifies via the generic augmentation (verify); like/dislike are bespoke with a shared list — add `"like": ("preferences", "likes_dislikes"), "dislike": ("preferences", "likes_dislikes")` manually with a comment.

- [ ] **Step 4: TDD**

Write `backend/tests/test_consolidation.py` FIRST (before Steps 1-3 — this task's steps are ordered for reading; execute test-first):

```python
"""Phase 5 consolidation: interests, likes_dislikes, current_learning alias."""
import server


def test_interest_write_and_kinds(clean_database, as_user):
    assert server.execute_modify("add", "interest", {"name": "Photography", "kind": "passion"}).startswith("✅")
    assert server.execute_modify("add", "interest", {"name": "Quantum computing", "kind": "curiosity"}).startswith("✅")
    items = server.load_json("lifestyle.json")["interests"]
    assert {(i["name"], i.get("kind")) for i in items} == {("Photography", "passion"), ("Quantum computing", "curiosity")}


def test_passion_curiosity_aliases(clean_database, as_user):
    msg = server.execute_modify("add", "passion", {"name": "Street food"})
    assert msg.startswith("✅") and "interest" in msg
    msg = server.execute_modify("add", "curiosity", {"topic": "Type design"})
    assert msg.startswith("✅")
    kinds = {i["name"]: i.get("kind") for i in server.load_json("lifestyle.json")["interests"]}
    assert kinds == {"Street food": "passion", "Type design": "curiosity"}


def test_like_dislike_shared_list_and_stance_flip(clean_database, as_user):
    assert server.execute_modify("add", "dislike", {"item": "Meetings before 10am"}).startswith("✅")
    assert server.execute_modify("add", "like", {"item": "Dark mode"}).startswith("✅")
    items = server.load_json("preferences.json")["likes_dislikes"]
    assert {(i["item"], i["stance"]) for i in items} == {("Meetings before 10am", "dislike"), ("Dark mode", "like")}
    # adding the same item under the other entity flips stance instead of duplicating
    msg = server.execute_modify("add", "like", {"item": "Meetings before 10am"})
    assert "now a like" in msg
    assert len(server.load_json("preferences.json")["likes_dislikes"]) == 2


def test_always_on_bundle_carries_likes_dislikes(clean_database, as_user):
    server.execute_modify("add", "like", {"item": "Dark mode"})
    ctx = server.get_scoped_context("minimal")["context"]
    assert any(i["item"] == "Dark mode" for i in ctx["preferences"]["likes_dislikes"])
    assert "dislikes" not in ctx["preferences"]


def test_current_learning_alias_creates_learning_goal(clean_database, as_user):
    msg = server.execute_modify("add", "current_learning", {"topic": "SQL", "context": "consulting prep"})
    assert msg.startswith("✅") and "goal" in msg
    [g] = server.load_json("goals.json")["goals"]
    assert g["title"] == "SQL" and g["type"] == "learning" and g["why"] == "consulting prep"


def test_schema_reflects_consolidation(clean_database):
    assert "interest" in server.ENTITY_SCHEMA["lifestyle"]
    assert "passion" not in server.ENTITY_SCHEMA["lifestyle"]
    assert "like" in server.ENTITY_SCHEMA["preferences"]
    assert "likes_dislikes" not in server.ENTITY_SCHEMA["preferences"]  # list, not entity
    assert "current_learning" not in server.ENTITY_SCHEMA["projects"]
```

RED first (schema/entities missing), then implement Steps 1-3, then GREEN.

- [ ] **Step 5: Golden regen + pinned tests + full suite**

Regenerate golden (same script as Phase 2 Task 1 Step 8). Expect pinned updates in: `test_context_efficiency.py` (ALWAYS_ON field list / preferences shape), `test_sections_registry.py` if it enumerates lists, `test_get_schema.py`, advisory invariants (current_learning removal, like/dislike additions), suggest tests (emitter changes), `test_persona_store*` (normalize strips), anything referencing `passions`/`dislikes` shapes. Update to new truth in-task; list every change. Full suite green.

- [ ] **Step 6: Commit**

```bash
git add backend/section_packs backend/server.py backend/sections.py backend/persona_store.py backend/tests
git commit -m "feat: consolidate lists — interests (kind-tagged), likes_dislikes (stance-tagged), current_learning folds into goals

Deliberate schema change: golden regenerated. passion/curiosity/dislike/
current_learning live on as write aliases; mental_tabs vs top_of_mind
sharpened as bookmarks-vs-inbox in schema descriptions."
```

---

### Task 2: Migration script

**Files:** `backend/scripts/migrate_consolidation.py` (new), tests appended to `test_consolidation.py`.

Mirror `migrate_goals.py` EXACTLY: raw row read helper(s) (SQL like `_load_raw_profile`, parameterized per file_type), `migrate_user(user_id) -> dict` stats, `run_all(users)` with per-user try/except isolation, `main()` printing per-user lines + failure summary + non-zero exit on failures.

Per user:
1. lifestyle raw: `passions` strings → interests `{name, kind: "passion"}`; `curiosities` → `{name, kind: "curiosity"}` (dict legacy items: name|title|topic fallback). Dedupe case-insensitive by name against existing interests. Pop `passions`, `curiosities`, top-level `references`.
2. preferences raw: `dislikes` strings → likes_dislikes `{item, stance: "dislike"}`; dedupe by item. Pop `dislikes`.
3. projects raw: `current_learning` items → goals `{title←topic, type: "learning", "status": "active"}` + `why`←context when present (priority dropped); dedupe by title against existing goals. Pop `current_learning`.
4. knowledge raw: pop `proficiency_levels`.
Save each blob only when changed (via `persona_store.save` — ids assigned + search index synced).

Tests (TDD): seed legacy shapes via raw SQL or persona_store.save (verify save persists legacy keys — it does, save doesn't normalize), run `migrate_user`, assert: converted entries with kinds/stances/types, legacy keys gone, second run `{"moved": 0, ...}` no-ops, pre-existing same-name entries skipped. Plus a `run_all` isolation test (monkeypatch migrate_user, mirror migrate_goals' test).

Run focused + full suite. Commit: `feat: idempotent consolidation migration — interests, likes_dislikes, learning goals, orphan keys`.

---

### Task 3: Frontend editors

**Files:** `frontend/src/editors/LifestyleEditor.jsx`, `frontend/src/editors/PreferencesEditor.jsx`, `frontend/src/components/controls.jsx`.

1. `controls.jsx` VALUE_META: add `dislike: { icon: ThumbsDown, tone/chip: amber (copy `disliked`) }` — `like` already exists (ThumbsUp, neutral). CHECK collision: `like` value is used by aesthetics stance — same semantics (neutral thumbs-up), fine.
2. LifestyleEditor: read first. Replace the passions ArrayInput and curiosities ArrayInput with ONE "Interests" block: list of rows (name text + inline `EnumControl options={["passion","curiosity"]}` — 2 options → segmented) + add input; write into `data.interests` (array of objects) via the editor's existing onChange idiom. Preserve card/label styling conventions.
3. PreferencesEditor: read first. Replace the dislikes ArrayInput with a "Likes & dislikes" block: rows of item text + inline like/dislike segmented; write `data.likes_dislikes`. Empty state hint: "Things you want every AI to know you like or avoid."
4. `cd frontend && npm run build` green; backend suite untouched (confirm count).
Commit: `feat: interests and likes/dislikes editors with inline stance controls`.

---

### Task 4: Documentation

**Files:** `README.md`.
1. Entities table: replace `dislike` row → `like` / `dislike` rows (item; stance implied); add `interest` row (name, kind: passion/curiosity, notes); remove `current_learning` row; note aliases (passion/curiosity/current_learning still accepted, stored in the new homes).
2. Scoped-context table / ALWAYS_ON mention: `dislikes` → `likes_dislikes` wherever the preferences bundle is described.
3. Mental-tabs/top-of-mind: one sentence where sections are described — tabs are saved bookmarks, top of mind is an idea inbox.
4. Roadmap: `- [x] List consolidation — interests, likes/dislikes, learning goals unified; searchable taste lists`.
Verify suite; commit `docs: consolidation README updates`.

---

## Post-execution (controller)
- Final whole-phase review (most capable model), fixes, merge to main, deploy, run `scripts/migrate_consolidation.py` against production (controller or user per preference), live-verify.

## Completion Criteria
Suite green; `get_schema` shows interest/like/dislike, no passion/curiosity/dislike-list/current_learning entities; aliases respond with pointers; migration idempotent on fixtures; editors build and render new lists; production data converted.
