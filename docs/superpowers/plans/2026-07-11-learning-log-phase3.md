# Learning Log Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full CRUD for learning-log entries via MCP (update by topic/id, validated `related_entries` links) and a frontend Learning Log editor panel.

**Architecture:** Backend rewrites the `learning_entry` update handler in `execute_modify` (locate by id, else most-recent topic match; falsy-ignored partial update; `new_topic` rename) and adds a shared write-time validator for `related_entries` links against the knowledge/projects/lifestyle id-lists. Frontend adds a `LearningLogEditor` (CircleEditor-style, per-item collapse) wired into the existing load/autosave plumbing, with server-side id assignment via the section registry's `id_lists`.

**Tech Stack:** FastAPI + FastMCP backend (Python, pytest, docker test-db on 5433), React + Tailwind/shadcn single-file editors in `frontend/src/App.jsx`, Playwright verification.

**Spec:** `docs/superpowers/specs/2026-07-11-learning-log-phase3-design.md`

## Global Constraints

- `learning_log` stays in `ALWAYS_ON_SECTIONS` — do NOT make it toggleable; the frontend tab is unconditional (like Profile/Preferences).
- Update locates by `id` if provided, else by `topic`: case-insensitive, most-recent match (reverse scan). Falsy values ignored (no empty-string clearing). `id`/`timestamp` immutable; rename only via `new_topic`.
- Editable-on-update fields, exactly: `details`, `source`, `tags`, `key_decisions`, `followup_items`, `conversation_metadata`, `related_entries`, plus `new_topic`.
- `related_entries` link types, exactly: `domain → knowledge.domains`, `project → projects.projects`, `hobby → lifestyle.hobbies`. Invalid link → ❌ naming the offender, nothing written.
- Frontend: no Manage Sections / SECTION_LABELS changes; `related_entries` shown read-only; entry ids are assigned server-side (registry `id_lists`), never client-side.
- Backend tests run against the docker test-db (`docker compose up -d test-db` from `backend/`; container is usually already running).
- Backend line numbers refer to commit 4914a4a; locate anchors by content.

---

### Task 1: Backend — full CRUD + related_entries validation (TDD)

**Files:**
- Modify: `backend/server.py` (learning_entry handler ~line 1760-1800; ENTITY_SCHEMA["learning_log"] ~line 2395; new `_validate_related_entries` helper just above `def execute_modify`)
- Modify: `backend/sections.py` (learning_log SectionSpec: `id_lists=()` → `id_lists=(("entries", "learn"),)`)
- Modify: `backend/tests/test_get_schema.py` (replace `test_learning_entry_does_not_advertise_update`)
- Create: `backend/tests/test_learning_crud.py`

**Interfaces:**
- Consumes: `execute_modify`, `load_json`/`save_json`, `persona_store._assign_ids` (registry-driven, `setdefault`), existing `learning_entry` add/remove handlers.
- Produces: `persona_modify(action="update", entity="learning_entry", data={"topic"|"id": ..., <fields>})` → `"✅ Updated learning entry: <topic> (field, ...)"`; `_validate_related_entries(links) -> str | None` (error string or None); saving `learning_log` assigns `learn_`-prefixed ids to id-less entries.

- [ ] **Step 1: Write the failing tests**

Replace `test_learning_entry_does_not_advertise_update` in `backend/tests/test_get_schema.py` (lines 82-89) with:

```python
def test_learning_entry_advertises_full_crud():
    result = _call(entity="learning_entry")
    assert result["actions"] == ["add", "update", "remove"]
    assert result["identifier"] == "topic"
    assert {"new_topic", "related_entries"} <= set(result["optional"])
    assert set(result["examples"].keys()) == {"add", "update", "remove"}
    # update example identifies by topic, not id
    assert "topic" in result["examples"]["update"]["data"]
    assert "id" not in result["examples"]["update"]["data"]
```

Create `backend/tests/test_learning_crud.py`:

```python
"""Tests for learning_entry full CRUD: update by topic/id, rename, related_entries."""
import server
import persona_store as store

# `as_user` fixture is provided by tests/conftest.py.
persona_modify = server.persona_modify.fn


def _add(topic, **fields):
    return persona_modify(action="add", entity="learning_entry",
                          data={"topic": topic, "details": "d", **fields})


def _entries():
    return server.load_json("learning_log.json")["entries"]


# --- update: locate semantics -------------------------------------------------

def test_update_by_topic_case_insensitive(as_user):
    _add("React Hooks")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "react hooks", "details": "new details"})
    assert result.startswith("✅")
    assert _entries()[-1]["details"] == "new details"


def test_update_by_topic_picks_most_recent_duplicate(as_user):
    _add("Docker")
    _add("Docker")
    persona_modify(action="update", entity="learning_entry",
                   data={"topic": "Docker", "details": "updated"})
    entries = _entries()
    assert entries[0]["details"] == "d"        # older duplicate untouched
    assert entries[1]["details"] == "updated"  # most recent updated


def test_update_by_id_wins_over_topic(as_user):
    _add("A")
    _add("B")
    a_id = _entries()[0]["id"]
    result = persona_modify(action="update", entity="learning_entry",
                            data={"id": a_id, "topic": "B", "details": "via id"})
    assert result.startswith("✅")
    assert _entries()[0]["details"] == "via id"
    assert _entries()[1]["details"] == "d"


def test_update_not_found(as_user):
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "nope", "details": "x"})
    assert result.startswith("❌")


# --- update: field semantics --------------------------------------------------

def test_partial_update_leaves_other_fields(as_user):
    _add("Kafka", tags=["queue"], key_decisions=["use it"])
    persona_modify(action="update", entity="learning_entry",
                   data={"topic": "Kafka", "followup_items": ["read docs"]})
    e = _entries()[-1]
    assert e["followup_items"] == ["read docs"]
    assert e["tags"] == ["queue"]
    assert e["key_decisions"] == ["use it"]


def test_rename_via_new_topic(as_user):
    _add("Typos")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Typos", "new_topic": "Typography"})
    assert result.startswith("✅")
    assert _entries()[-1]["topic"] == "Typography"


def test_id_and_timestamp_immutable(as_user):
    _add("Immutable")
    before = dict(_entries()[-1])
    persona_modify(action="update", entity="learning_entry",
                   data={"topic": "Immutable", "details": "changed"})
    after = _entries()[-1]
    assert after["id"] == before["id"]
    assert after["timestamp"] == before["timestamp"]


def test_identifier_only_update_errors(as_user):
    _add("Bare")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Bare"})
    assert result.startswith("❌")


# --- related_entries validation -----------------------------------------------

def _make_domain():
    persona_modify(action="add", entity="domain", data={"name": "Rust"})
    return server.load_json("knowledge.json")["domains"][-1]["id"]


def test_valid_related_entry_accepted_on_add(as_user):
    domain_id = _make_domain()
    result = _add("Ownership", related_entries=[{"type": "domain", "id": domain_id}])
    assert result.startswith("✅")
    assert _entries()[-1]["related_entries"] == [{"type": "domain", "id": domain_id}]


def test_valid_related_entry_accepted_on_update(as_user):
    domain_id = _make_domain()
    _add("Borrowing")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Borrowing",
                                  "related_entries": [{"type": "domain", "id": domain_id}]})
    assert result.startswith("✅")
    assert _entries()[-1]["related_entries"][0]["id"] == domain_id


def test_unknown_type_rejected(as_user):
    result = _add("Bad", related_entries=[{"type": "planet", "id": "x"}])
    assert result.startswith("❌") and "planet" in result
    assert _entries() == []  # nothing written


def test_nonexistent_id_rejected(as_user):
    result = _add("Bad", related_entries=[{"type": "domain", "id": "domain_missing"}])
    assert result.startswith("❌") and "domain_missing" in result
    assert _entries() == []


def test_malformed_link_rejected(as_user):
    result = _add("Bad", related_entries=["not-a-dict"])
    assert result.startswith("❌")
    assert _entries() == []


def test_rejected_update_writes_nothing(as_user):
    _add("Safe")
    result = persona_modify(action="update", entity="learning_entry",
                            data={"topic": "Safe", "details": "should not land",
                                  "related_entries": [{"type": "domain", "id": "domain_missing"}]})
    assert result.startswith("❌")
    assert _entries()[-1]["details"] == "d"


# --- registry id assignment ---------------------------------------------------

def test_save_assigns_ids_to_learning_entries(as_user):
    store.save("learning_log", {"entries": [
        {"topic": "no id yet", "timestamp": "2026-07-11T00:00:00"},
        {"id": "learn_keepme", "topic": "has id"},
    ]})
    entries = server.load_json("learning_log.json")["entries"]
    assert entries[0]["id"].startswith("learn_")
    assert entries[1]["id"] == "learn_keepme"  # setdefault: existing id untouched
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/khantthura/Documents/ProjectL/project-twin/backend && source venv/bin/activate && python -m pytest tests/test_learning_crud.py tests/test_get_schema.py -v`
Expected: all `test_learning_crud` tests FAIL (update path returns the old `❌ Learning log update requires entry 'id' and 'followup_items'`, related_entries accepted unvalidated, ids not assigned); `test_learning_entry_advertises_full_crud` FAILS (actions are `["add", "remove"]`). Pre-existing tests PASS.

- [ ] **Step 3: Implement**

**3a — sections.py.** In the `learning_log` `SectionSpec`, change `id_lists=()` to:

```python
        id_lists=(("entries", "learn"),),
```

**3b — validation helper.** In `backend/server.py`, insert immediately above `def execute_modify` (after `normalize_data`):

```python
# Allowed related_entries link types -> (file, list_key) they must resolve into.
_RELATED_ENTRY_TYPES = {
    "domain": ("knowledge.json", "domains"),
    "project": ("projects.json", "projects"),
    "hobby": ("lifestyle.json", "hobbies"),
}

def _validate_related_entries(links):
    """Return an error string if any link is malformed or dangling, else None."""
    if not isinstance(links, list):
        return "❌ related_entries must be a list of {type, id} objects"
    for link in links:
        if not isinstance(link, dict) or not link.get("type") or not link.get("id"):
            return f"❌ Malformed related entry (need type and id): {link}"
        spec = _RELATED_ENTRY_TYPES.get(link["type"])
        if spec is None:
            valid = ", ".join(sorted(_RELATED_ENTRY_TYPES))
            return f"❌ Unknown related entry type '{link['type']}' (valid: {valid})"
        file_name, list_key = spec
        items = load_json(file_name).get(list_key, [])
        if not any(isinstance(i, dict) and i.get("id") == link["id"] for i in items):
            return f"❌ Related {link['type']} not found: {link['id']}"
    return None
```

**3c — add-path validation.** In the `learning_entry` handler's `if action == "add":` branch, insert right after the required-fields check (before the entry dict is built):

```python
            if data.get("related_entries"):
                err = _validate_related_entries(data["related_entries"])
                if err:
                    return err
```

**3d — update handler.** Replace the entire existing `elif action == "update":` block of the `learning_entry` handler (currently the id+followup_items-only path ending with `return "❌ Learning log update requires entry 'id' and 'followup_items'"`) with:

```python
        elif action == "update":
            entry_id = data.get("id", "")
            topic = data.get("topic", "")
            if not entry_id and not topic:
                return "❌ Learning log update requires 'id' or 'topic'"
            target = None
            for entry in reversed(entries):
                if (entry_id and entry.get("id") == entry_id) or \
                   (not entry_id and topic and entry.get("topic", "").lower() == topic.lower()):
                    target = entry
                    break
            if target is None:
                return f"❌ Learning entry not found: {entry_id or topic}"
            if data.get("related_entries"):
                err = _validate_related_entries(data["related_entries"])
                if err:
                    return err
            updated = []
            for field in ("details", "source", "tags", "key_decisions",
                          "followup_items", "conversation_metadata", "related_entries"):
                if data.get(field):
                    target[field] = data[field]
                    updated.append(field)
            if data.get("new_topic"):
                target["topic"] = data["new_topic"]
                updated.append("topic")
            if not updated:
                return ("❌ Learning log update requires at least one of: details, source, tags, "
                        "key_decisions, followup_items, conversation_metadata, related_entries, new_topic")
            save_json("learning_log.json", log)
            return f"✅ Updated learning entry: {target.get('topic', entry_id)} ({', '.join(updated)})"
```

The `remove` branch is unchanged.

**3e — schema.** Replace `ENTITY_SCHEMA["learning_log"]` (including the multi-line comment above the `learning_entry` entry — delete the comment entirely) with:

```python
    "learning_log": {
        "learning_entry": {"actions": ["add", "update", "remove"], "required": ["topic", "details"],
                          "optional": ["source", "tags", "conversation_metadata", "key_decisions",
                                       "followup_items", "new_topic", "related_entries"],
                          "identifier": "topic"}
    }
```

- [ ] **Step 4: Run tests to verify they pass, then the full suite**

Run: `python -m pytest tests/test_learning_crud.py tests/test_get_schema.py -v` then `python -m pytest tests/ -q`
Expected: all PASS, no regressions. (If the update example generated by `_example_data` happens to sample `id` — it won't, `id` is not in `optional` — the schema test guards it.)

- [ ] **Step 5: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add backend/server.py backend/sections.py backend/tests/test_learning_crud.py backend/tests/test_get_schema.py
git commit -m "feat: full learning_entry CRUD with validated related_entries links"
```

---

### Task 2: Frontend — LearningLogEditor panel + wiring

**Files:**
- Modify: `frontend/src/App.jsx` (lucide import ~line 3; new component before `SECTION_LABELS` ~line 5693; App state/loadAllData/saveAll/handlers ~lines 5711-5856; tab rail ~lines 5992-6052)

**Interfaces:**
- Consumes: `useDebounce`d `debouncedSave(fileType, data)` autosave pattern; `ArrayInput` (already in App.jsx); `showConfirmation`; per-item collapse pattern (see the education/work-experience blocks in ProfileEditor); backend GET/PUT `/api/files/learning_log` and `/api/all` (both already registry-generic — no backend change).
- Produces: `LearningLogEditor({ data, onChange, onShowConfirmation })` rendering `data.entries`; `handleLearningLogChange` autosaving to `learning_log`.

All line numbers refer to commit 4914a4a — locate anchors by content.

- [ ] **Step 1: Import the tab icon**

Add `BookOpen` to the lucide-react import list at the top of App.jsx (alphabetical position doesn't matter; match the existing list style):

```jsx
import {
  User,
  Brain,
  BookOpen,
  Settings,
  ...
```

- [ ] **Step 2: Add the LearningLogEditor component**

Insert immediately before `const SECTION_LABELS = {` (~line 5693):

```jsx
// Learning Log Editor
function LearningLogEditor({ data, onChange, onShowConfirmation }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedEntries, setExpandedEntries] = useState({});

  const entries = data.entries || [];

  const toggleEntry = (key) =>
    setExpandedEntries((prev) => ({ ...prev, [key]: !prev[key] }));

  const updateEntry = (index, field, value) => {
    const next = [...entries];
    next[index] = { ...next[index], [field]: value };
    onChange({ ...data, entries: next });
  };

  const addEntry = () => {
    const newIndex = entries.length;
    onChange({
      ...data,
      entries: [
        ...entries,
        {
          topic: "",
          details: "",
          source: "manual",
          tags: [],
          timestamp: new Date().toISOString(),
        },
      ],
    });
    setExpandedEntries((prev) => ({ ...prev, [newIndex]: true }));
  };

  const removeEntry = (index) => {
    const entry = entries[index];
    const doRemove = () =>
      onChange({ ...data, entries: entries.filter((_, i) => i !== index) });
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Learning Entry",
        `Remove "${entry?.topic || "entry"}"? This action cannot be undone.`,
        doRemove
      );
    } else {
      doRemove();
    }
  };

  const matchesSearch = (entry) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return [entry.topic, entry.details, ...(entry.tags || [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  };

  // Newest first; editing still targets the original array index.
  const sortedIndexes = entries
    .map((_, i) => i)
    .sort((a, b) =>
      (entries[b].timestamp || "").localeCompare(entries[a].timestamp || "")
    );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Learning Log</CardTitle>
          <CardDescription>
            Things you've learned, decisions you've made, and follow-ups —
            captured from conversations or added here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Search topic, details, or tags..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No learning entries yet. Click "Add Entry" to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {sortedIndexes
                .filter((idx) => matchesSearch(entries[idx]))
                .map((idx) => {
                  const entry = entries[idx];
                  const isExpanded = expandedEntries[idx];
                  const tagCount = (entry.tags || []).length;
                  const followupCount = (entry.followup_items || []).length;
                  const date = (entry.timestamp || "").slice(0, 10);
                  return (
                    <div
                      key={entry.id || idx}
                      className="rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden"
                    >
                      {/* Collapsed Header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleEntry(idx)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {entry.topic || "Untitled entry"}
                          </span>
                          <div className="flex gap-1.5 items-center flex-shrink-0">
                            {date && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {date}
                              </Badge>
                            )}
                            {entry.source && (
                              <Badge variant="outline" className="h-5 text-xs">
                                {entry.source}
                              </Badge>
                            )}
                            {tagCount > 0 && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {tagCount} tags
                              </Badge>
                            )}
                            {followupCount > 0 && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {followupCount} follow-ups
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEntry(idx);
                          }}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Form */}
                      {isExpanded && (
                        <div className="space-y-3 p-3 pt-0">
                          <div className="space-y-2">
                            <Label>Topic</Label>
                            <Input
                              value={entry.topic || ""}
                              onChange={(e) =>
                                updateEntry(idx, "topic", e.target.value)
                              }
                              placeholder="e.g. React Server Components"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Details</Label>
                            <Textarea
                              value={entry.details || ""}
                              onChange={(e) =>
                                updateEntry(idx, "details", e.target.value)
                              }
                              placeholder="What you learned or discussed..."
                              rows={4}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Source</Label>
                            <Input
                              value={entry.source || ""}
                              onChange={(e) =>
                                updateEntry(idx, "source", e.target.value)
                              }
                              placeholder="e.g. conversation, article, course"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tags</Label>
                            <ArrayInput
                              items={entry.tags || []}
                              onChange={(items) =>
                                updateEntry(idx, "tags", items)
                              }
                              placeholder="e.g. react, architecture"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Key Decisions</Label>
                            <ArrayInput
                              items={entry.key_decisions || []}
                              onChange={(items) =>
                                updateEntry(idx, "key_decisions", items)
                              }
                              placeholder="e.g. Chose Postgres over SQLite"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Follow-up Items</Label>
                            <ArrayInput
                              items={entry.followup_items || []}
                              onChange={(items) =>
                                updateEntry(idx, "followup_items", items)
                              }
                              placeholder="e.g. Read the migration guide"
                            />
                          </div>
                          {(entry.related_entries || []).length > 0 && (
                            <div className="space-y-2">
                              <Label>Related</Label>
                              <div className="flex flex-wrap gap-1.5">
                                {entry.related_entries.map((link, i) => (
                                  <Badge
                                    key={i}
                                    variant="outline"
                                    className="h-5 text-xs"
                                  >
                                    {link.type}: {link.id}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {entry.id ? `${entry.id} · ` : ""}
                            {entry.timestamp || ""}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <Button
            onClick={addEntry}
            variant="outline"
            className="w-full border-dashed"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Entry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Wire state, load, save, autosave**

In `App()`:

After `const [circle, setCircle] = useState({});` (~line 5716) add:

```jsx
  const [learningLog, setLearningLog] = useState({});
```

In `loadAllData` after `setCircle(response.data.circle || {});` (~line 5764) add:

```jsx
      setLearningLog(response.data.learning_log || {});
```

In `saveAll`'s PUT body after `circle,` (~line 5842) add:

```jsx
          learning_log: learningLog,
```

After `handleCircleChange` (~line 5829) add:

```jsx
  const handleLearningLogChange = (newData) => {
    setLearningLog(newData);
    if (isAutosaveEnabled) debouncedSave("learning_log", newData);
  };
```

- [ ] **Step 4: Add the tab (unconditional — learning_log is always-on)**

In the `TabsList`, after the circle trigger's closing `)}` and BEFORE the preferences trigger (~line 5997), insert (NOT wrapped in a `disabledSections` check):

```jsx
            <TabsTrigger value="learning" className="gap-2 md:w-full md:justify-start">
              <BookOpen className="h-4 w-4" />
              <span className="hidden md:inline">Learning Log</span>
            </TabsTrigger>
```

After the circle `TabsContent` closing `)}` and before the preferences `TabsContent` (~line 6052), insert:

```jsx
          <TabsContent value="learning">
            <LearningLogEditor
              data={learningLog}
              onChange={handleLearningLogChange}
              onShowConfirmation={showConfirmation}
            />
          </TabsContent>
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/khantthura/Documents/ProjectL/project-twin/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/App.jsx
git commit -m "feat: learning log editor panel in frontend"
```

---

### Task 3: Browser verification (Playwright)

**Files:**
- Create: `<scratchpad>/verify_learning_log.py` (throwaway, not committed)
- No source changes expected; fix-and-recommit only if verification finds real bugs.

**Interfaces:**
- Consumes: Tasks 1–2 committed; docker test-db running.
- Produces: screenshots + printed assertions; persistence round-trip proof including server-assigned id.

- [ ] **Step 1: Start servers and seed a user**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/backend
source venv/bin/activate
DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test uvicorn main:app --port 8000 &
sleep 3
curl -s -X POST http://localhost:8000/api/auth/register -H "Content-Type: application/json" -d '{"username": "learner"}'
# record the token; then start the frontend
cd ../frontend && npm run dev &   # serves on port 3000
```

- [ ] **Step 2: Seed learning entries via the MCP path**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/backend
DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test python3 - <<'EOF'
import db, server
with db.get_pool().connection() as conn:
    row = conn.execute("select id from users where username='learner'").fetchone()
db.current_user_id.set(str(row["id"]))
pm = server.persona_modify.fn
print(pm(action="add", entity="domain", data={"name": "Rust"}))
domain_id = server.load_json("knowledge.json")["domains"][-1]["id"]
print(pm(action="add", entity="learning_entry",
         data={"topic": "Ownership model", "details": "Borrow checker basics",
               "tags": ["rust"], "followup_items": ["read the book ch4"],
               "related_entries": [{"type": "domain", "id": domain_id}]}))
print(pm(action="add", entity="learning_entry",
         data={"topic": "Lifetimes", "details": "Annotations and elision", "tags": ["rust"]}))
print(pm(action="update", entity="learning_entry",
         data={"topic": "lifetimes", "key_decisions": ["skip advanced lifetimes for now"]}))
EOF
```

Expected: three ✅ adds/updates; the update matched case-insensitively.

- [ ] **Step 3: Playwright checks**

Write `verify_learning_log.py` in the scratchpad (inject `mygist_config` localStorage with the token and empty serverUrl, goto http://localhost:3000, same bootstrap as the previous profile verification):

1. Click the "Learning Log" tab → screenshot. Assert both entries render collapsed, newest first ("Lifetimes" above "Ownership model"); "Ownership model" header shows the date badge, source badge, "1 tags", "1 follow-ups".
2. Type "ownership" in the search box → only "Ownership model" remains; clear search.
3. Expand "Ownership model" → screenshot. Assert Topic/Details inputs populated, related chip "domain: domain_..." visible, id+timestamp footer visible.
4. Edit Details to "Borrow checker mastered", wait ~2.5s (autosave debounce + request), then GET `/api/files/learning_log` with the token via `requests`/`curl` and assert the change persisted.
5. Click "Add Entry" → assert a new expanded empty form appears; type a topic "UI test entry"; wait ~2.5s; GET the file and assert the new entry exists AND has a server-assigned `id` starting with `learn_`.
6. Delete the "UI test entry" (confirm dialog), wait, GET and assert it's gone.

- [ ] **Step 4: Clean up and report**

Kill the uvicorn and vite PIDs you started (not by name); leave docker running. Report results with screenshot paths. If a step failed, fix source, re-run, commit the fix with `fix:`.
