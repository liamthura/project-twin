# Profile basic_info Entity + Collapsible Experience Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MCP clients edit the profile's 7 top-level scalar fields via a new `basic_info` entity, and make work-experience / education items in the frontend ProfileEditor collapse per-item like Projects items do.

**Architecture:** Backend adds one update-only singleton entity (`basic_info`) to the existing `ENTITY_SCHEMA` + `execute_modify` machinery, modeled exactly on `preferences.communication_default`. Frontend is purely presentational: each work/education item gets a clickable collapsed header (chevron + title + badges + delete), with the existing edit form rendered only when expanded — mirroring the `expandedProjects` pattern already in `App.jsx`.

**Tech Stack:** FastAPI + FastMCP backend (Python, pytest, Postgres test-db via docker compose), React + Tailwind/shadcn frontend (single-file `App.jsx` editors), Playwright for browser verification.

**Spec:** `docs/superpowers/specs/2026-07-10-profile-basic-info-and-collapse-design.md`

## Global Constraints

- Falsy values are ignored on `basic_info` update (no empty-string clearing) — matches `communication_default` convention.
- The 7 scalar fields, exactly: `name`, `preferred_name`, `current_role`, `organisation`, `location`, `nationality`, `bio`.
- Collapse applies ONLY to work-experience and education items. Goals, languages, contact stay untouched.
- Frontend data shape and autosave handlers must not change — presentational only.
- Backend tests run against the docker test-db (`localhost:5433`); start it with `docker compose up -d test-db` from `backend/`.
- All backend line numbers below refer to `backend/server.py` at commit `579c632`; verify anchors by content, not just line number.

---

### Task 1: Backend `basic_info` entity (TDD)

**Files:**
- Modify: `backend/server.py` (ENTITY_SCHEMA ~line 2301, ENTITY_THRESHOLDS ~line 310, `normalize_data` ~line 1080, `execute_modify` — insert handler after the `career_aspiration` block ending ~line 1307)
- Modify: `backend/tests/test_get_schema.py`
- Create: `backend/tests/test_basic_info.py`

**Interfaces:**
- Consumes: existing `execute_modify(action, entity, data)`, `load_json`/`save_json`, `ENTITY_SCHEMA` digest machinery (all already in `server.py`).
- Produces: MCP-callable `persona_modify(action="update", entity="basic_info", data={<any of the 7 fields>})` returning `"✅ Updated profile: field=value, ..."` on success, `"❌ ..."` on error. Discoverable via `get_schema(entity="basic_info")`.

- [ ] **Step 1: Start the test database**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/backend
docker compose up -d test-db
```

Expected: container `mygist-test-db` running (check `docker ps`). If Docker Desktop isn't running, start it first.

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_get_schema.py`:

```python
def test_basic_info_is_update_only_singleton():
    # basic_info mirrors communication_default: update-only, no identifier.
    result = _call(entity="basic_info")
    assert result["file"] == "profile"
    assert result["actions"] == ["update"]
    assert result["identifier"] is None
    assert set(result["optional"]) == {
        "name", "preferred_name", "current_role", "organisation",
        "location", "nationality", "bio",
    }
    assert set(result["examples"].keys()) == {"update"}
    assert result["examples"]["update"]["data"]  # non-empty example data
```

Create `backend/tests/test_basic_info.py`:

```python
"""Tests for the basic_info update-only singleton (top-level profile scalars)."""
import server

# `as_user` fixture is provided by tests/conftest.py.
# persona_modify is registered as a FastMCP FunctionTool; `.fn` is the raw callable.
persona_modify = server.persona_modify.fn


def test_update_single_field_leaves_others_untouched(as_user):
    persona_modify(action="update", entity="basic_info",
                   data={"name": "Khant Thura"})
    result = persona_modify(action="update", entity="basic_info",
                            data={"bio": "Final-year IT student."})
    assert result.startswith("✅")
    profile = server.load_json("profile.json")
    assert profile["bio"] == "Final-year IT student."
    assert profile["name"] == "Khant Thura"  # untouched by the second update


def test_update_multiple_fields_at_once(as_user):
    result = persona_modify(action="update", entity="basic_info",
                            data={"location": "Newcastle upon Tyne, UK",
                                  "current_role": "IT Consultant"})
    assert result.startswith("✅")
    assert "location" in result and "current_role" in result
    profile = server.load_json("profile.json")
    assert profile["location"] == "Newcastle upon Tyne, UK"
    assert profile["current_role"] == "IT Consultant"


def test_update_with_no_known_field_errors(as_user):
    result = persona_modify(action="update", entity="basic_info", data={})
    assert result.startswith("❌")
    result = persona_modify(action="update", entity="basic_info",
                            data={"unknown_field": "x"})
    assert result.startswith("❌")


def test_non_update_action_errors(as_user):
    result = persona_modify(action="add", entity="basic_info",
                            data={"name": "X"})
    assert result.startswith("❌")
    result = persona_modify(action="remove", entity="basic_info",
                            data={"name": "X"})
    assert result.startswith("❌")


def test_alias_fields_do_not_leak_into_name(as_user):
    # normalize_data must NOT inject a phantom "name" from generic aliases
    # (title/label/value/item) for basic_info.
    result = persona_modify(action="update", entity="basic_info",
                            data={"title": "should not become name"})
    assert result.startswith("❌")
    profile = server.load_json("profile.json")
    assert profile.get("name", "") == ""
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/backend
source venv/bin/activate
python -m pytest tests/test_basic_info.py tests/test_get_schema.py -v
```

Expected: the 5 new `test_basic_info` tests FAIL (❌ "Unknown entity" style results / assertion errors), `test_basic_info_is_update_only_singleton` FAILS with an `error` key in the response. All pre-existing tests PASS.

- [ ] **Step 4: Implement**

**4a — Schema entry.** In `backend/server.py`, inside `ENTITY_SCHEMA["profile"]`, add after the `career_aspiration` entry (~line 2301):

```python
        "career_aspiration": {"actions": ["add", "remove"], "required": ["aspiration"], "optional": [],
                             "identifier": "aspiration"},
        "basic_info": {"actions": ["update"], "required": [],
                      "optional": ["name", "preferred_name", "current_role", "organisation",
                                   "location", "nationality", "bio"],
                      "identifier": None,
                      "description": "Update-only singleton for top-level profile fields"}
```

**4b — Capture threshold.** In `ENTITY_THRESHOLDS` (~line 310), add after the `communication_default` line:

```python
    "basic_info": {"auto": 0.90, "ask": 0.70},
```

**4c — normalize_data early return.** In `normalize_data` (~line 1080), add an early-return branch alongside the `link` one so generic name-aliases (`title`, `label`, `value`, `item`) are never copied into `name` for basic_info:

```python
    elif entity == "link":
        return normalized
    elif entity == "basic_info":
        return normalized
```

**4d — Handler.** In `execute_modify`, insert after the `career_aspiration` handler block (it ends with `return f"✅ Removed aspiration: {asp}"` + blank line, just before `elif entity == "education":` ~line 1309):

```python
    elif entity == "basic_info":
        profile = load_json("profile.json")
        if action == "update":
            fields = ["name", "preferred_name", "current_role", "organisation",
                      "location", "nationality", "bio"]
            updated = []
            for field in fields:
                if data.get(field):
                    profile[field] = data[field]
                    updated.append(f"{field}={data[field]}")
            if not updated:
                return f"❌ basic_info update requires at least one of: {', '.join(fields)}"
            save_json("profile.json", profile)
            return f"✅ Updated profile: {', '.join(updated)}"
        return "❌ basic_info only supports 'update' action"
```

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/backend
source venv/bin/activate
python -m pytest tests/test_basic_info.py tests/test_get_schema.py -v
python -m pytest tests/ -q
```

Expected: all PASS (no regressions anywhere in the suite).

- [ ] **Step 6: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add backend/server.py backend/tests/test_basic_info.py backend/tests/test_get_schema.py
git commit -m "feat: basic_info MCP entity for top-level profile scalar fields"
```

---

### Task 2: Collapsible work-experience items (frontend)

**Files:**
- Modify: `frontend/src/App.jsx` (ProfileEditor: state near line 390, work-experience list lines ~1086–1232)

**Interfaces:**
- Consumes: existing `update(field, value)` helper, `Badge`, `Button`, `ChevronDown`, `Trash2` (all already imported in `App.jsx`), Projects reference pattern at App.jsx:3517.
- Produces: per-item expand state `expandedWorkExp` (object keyed by array index) + `toggleWorkExp(index)`; work items render a Projects-style collapsed header; new items auto-expand. Task 3 mirrors this shape for education.

All line numbers refer to `App.jsx` at commit `579c632` — re-locate anchors by content.

- [ ] **Step 1: Add expand state and toggles**

In ProfileEditor, directly after the `collapsedSections` useState (~line 390–395):

```jsx
  const [collapsedSections, setCollapsedSections] = useState({
    academic: true,
    contact: true,
    languages: true,
    workExp: true,
  });

  const [expandedWorkExp, setExpandedWorkExp] = useState({});
  const [expandedEducation, setExpandedEducation] = useState({});

  const toggleWorkExp = (index) =>
    setExpandedWorkExp((prev) => ({ ...prev, [index]: !prev[index] }));
  const toggleEducation = (index) =>
    setExpandedEducation((prev) => ({ ...prev, [index]: !prev[index] }));
```

(`expandedEducation`/`toggleEducation` are added now so Task 3 only touches JSX.)

- [ ] **Step 2: Wrap each work item in a collapsed-header shell**

The current work item (starting ~line 1088) is:

```jsx
{data.work_experience.map((exp, idx) => (
  <div
    key={idx}
    className="space-y-3 p-3 rounded border border-muted bg-muted/20"
  >
    {/* ...role/company grid, type/period grid, highlights... */}
    <Button ...>  {/* bottom "Remove" button, lines ~1196-1209 */}
      <Trash2 className="h-4 w-4 mr-2" />
      Remove
    </Button>
  </div>
))}
```

Replace the wrapper with (the inner form fields — both grids and the Highlights block, lines ~1093–1195 — move unchanged into the `isExpanded` block; the bottom "Remove" button block at lines ~1196–1209 is DELETED, replaced by the header delete icon):

```jsx
{data.work_experience.map((exp, idx) => {
  const isExpanded = expandedWorkExp[idx];
  const highlightsCount = (exp.highlights || []).length;
  return (
    <div
      key={idx}
      className="rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden"
    >
      {/* Collapsed Header */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer"
        onClick={() => toggleWorkExp(idx)}
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform text-muted-foreground ${
            isExpanded ? "" : "-rotate-90"
          }`}
        />
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">
            {[exp.role, exp.company].filter(Boolean).join(" — ") ||
              "Untitled experience"}
          </span>
          <div className="flex gap-1.5 items-center flex-shrink-0">
            {exp.period && (
              <Badge variant="secondary" className="h-5 text-xs">
                {exp.period}
              </Badge>
            )}
            {highlightsCount > 0 && (
              <Badge variant="secondary" className="h-5 text-xs">
                {highlightsCount} highlights
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            update(
              "work_experience",
              data.work_experience.filter((_, i) => i !== idx)
            );
          }}
          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Expanded Form */}
      {isExpanded && (
        <div className="space-y-3 p-3 pt-0">
          {/* MOVED UNCHANGED: role/company grid, type/period grid,
              Highlights block (previous lines ~1093-1195) */}
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 3: Auto-expand newly added items**

The "Add Experience" button (~line 1214) currently calls `update("work_experience", [...])` inline. Change its `onClick` to:

```jsx
onClick={() => {
  const newIndex = (data.work_experience || []).length;
  update("work_experience", [
    ...(data.work_experience || []),
    {
      role: "",
      company: "",
      type: "",
      period: "",
      highlights: [],
    },
  ]);
  setExpandedWorkExp((prev) => ({ ...prev, [newIndex]: true }));
}}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/frontend
npm run build
```

Expected: build succeeds with no errors (warnings about chunk size are pre-existing and fine).

- [ ] **Step 5: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/App.jsx
git commit -m "feat: collapsible work-experience items in profile editor"
```

---

### Task 3: Collapsible education items (frontend)

**Files:**
- Modify: `frontend/src/App.jsx` (ProfileEditor: `addEducation` ~line 225, education list lines ~649–971)

**Interfaces:**
- Consumes: `expandedEducation` / `toggleEducation` from Task 2 Step 1; existing `removeEducation(index)` (keeps its confirmation dialog), `updateEducation`, `Badge`, `ChevronDown`.
- Produces: education items with the same collapsed-header shell as work experience.

- [ ] **Step 1: Wrap each education item in a collapsed-header shell**

The current item (starting ~line 649) has a `<div className="p-4 rounded-lg border border-muted bg-muted/10 space-y-4">` wrapper whose first child is a header block (institution `<h3>`, degree subtitle, delete button — lines ~654–673). Replace the wrapper and DELETE that old header block; everything else (the fields grid, Coursework, Clubs, Highlights sections — lines ~675–969) moves unchanged into the `isExpanded` block:

```jsx
{(data.education || []).map((edu, eduIndex) => {
  const isExpanded = expandedEducation[eduIndex];
  const highlightsCount = (edu.highlights || []).length;
  const courseCount = (edu.coursework || []).length;
  const years = [edu.start_year, edu.end_year].filter(Boolean).join("–");
  return (
    <div
      key={eduIndex}
      className="rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden"
    >
      {/* Collapsed Header */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer"
        onClick={() => toggleEducation(eduIndex)}
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform text-muted-foreground ${
            isExpanded ? "" : "-rotate-90"
          }`}
        />
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">
            {edu.institution || "Untitled Institution"}
          </span>
          <span className="text-sm text-muted-foreground truncate hidden sm:inline">
            {edu.field_of_study && edu.degree_level
              ? `${edu.degree_level} in ${edu.field_of_study}`
              : edu.field_of_study || edu.degree_level || ""}
          </span>
          <div className="flex gap-1.5 items-center flex-shrink-0">
            {years && (
              <Badge variant="secondary" className="h-5 text-xs">
                {years}
              </Badge>
            )}
            {courseCount > 0 && (
              <Badge variant="secondary" className="h-5 text-xs">
                {courseCount} courses
              </Badge>
            )}
            {highlightsCount > 0 && (
              <Badge variant="secondary" className="h-5 text-xs">
                {highlightsCount} highlights
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            removeEducation(eduIndex);
          }}
          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Expanded Form */}
      {isExpanded && (
        <div className="p-4 pt-1 space-y-4">
          {/* MOVED UNCHANGED: fields grid, Coursework, Clubs, Highlights
              sections (previous lines ~675-969) */}
        </div>
      )}
    </div>
  );
})}
```

Note: `removeEducation` keeps its existing confirmation dialog — do not change it.

- [ ] **Step 2: Auto-expand newly added education**

Replace `addEducation` (~line 225, currently an implicit-return arrow):

```jsx
  const addEducation = () => {
    const newIndex = (data.education || []).length;
    onChange({
      ...data,
      education: [
        ...(data.education || []),
        {
          institution: "",
          degree_level: "",
          field_of_study: "",
          start_year: "",
          end_year: "",
          status: "completed",
          coursework: [],
          clubs: [],
          highlights: [],
        },
      ],
    });
    setExpandedEducation((prev) => ({ ...prev, [newIndex]: true }));
  };
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/App.jsx
git commit -m "feat: collapsible education items in profile editor"
```

---

### Task 4: Browser verification (Playwright)

**Files:**
- Create: `<scratchpad>/verify_profile_collapse.py` (throwaway, not committed)
- No source changes expected; fix-and-recommit only if verification finds bugs.

**Interfaces:**
- Consumes: Tasks 1–3 complete; docker test-db up (Task 1 Step 1).
- Produces: screenshots + printed assertions proving the collapse behavior; a final `basic_info` smoke test through the running server.

- [ ] **Step 1: Start backend against the test-db and register a user**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/backend
source venv/bin/activate
DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test uvicorn main:app --port 8000 &
sleep 3
curl -s -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" -d '{"username": "verifier"}'
```

Expected: JSON with `token` — save it for Step 3.

- [ ] **Step 2: Seed profile data with 2 work experiences + 1 education**

```bash
TOKEN=<token from step 1>
curl -s -X PUT http://localhost:8000/api/files/profile \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Verifier", "preferred_name": "V", "current_role": "", "organisation": "",
    "location": "", "nationality": "", "languages_spoken": [], "bio": "",
    "career_aspirations": [], "goals_and_careers": [], "contact": {"emails": [], "links": []},
    "work_experience": [
      {"role": "Engineer", "company": "Acme", "type": "Full-time", "period": "2022-2023",
       "highlights": ["Shipped v1", "Led migration"]},
      {"role": "Intern", "company": "Globex", "type": "Internship", "period": "2021",
       "highlights": []}
    ],
    "education": [
      {"institution": "Northumbria University", "degree_level": "BSc",
       "field_of_study": "IT Management", "start_year": "2022", "end_year": "2026",
       "status": "current", "coursework": [{"name": "Databases", "topics": []}],
       "clubs": [], "highlights": ["First Class"]}
    ]
  }'
```

Expected: success JSON.

- [ ] **Step 3: Run the Playwright check**

Start the frontend dev server (`cd frontend && npm run dev &` — it serves on port 3000 per `vite.config.js`), then write and run `verify_profile_collapse.py` in the scratchpad:

```python
from playwright.sync_api import sync_playwright
import json

TOKEN = "<token from step 1>"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    # Bind the app to the registered user; empty serverUrl -> dev proxy /api.
    page.add_init_script(
        f"localStorage.setItem('mygist_config', JSON.stringify({{serverUrl: '', token: '{TOKEN}'}}))"
    )
    page.goto("http://localhost:3000")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)

    # Open the Work Experience section (section header is collapsed by default)
    page.get_by_text("Work Experience", exact=False).first.click()
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/prof_01_work_collapsed.png")
    # Collapsed: role/company header visible, form inputs NOT visible
    print("collapsed header visible:",
          page.get_by_text("Engineer — Acme").count())
    print("role input visible while collapsed:",
          page.get_by_placeholder("e.g. Software Engineer").count())

    # Expand the first item
    page.get_by_text("Engineer — Acme").click()
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/prof_02_work_expanded.png")
    print("role input visible after expand:",
          page.get_by_placeholder("e.g. Software Engineer").count())

    # Add a new experience -> should auto-expand (2 role inputs now visible)
    page.get_by_role("button", name="Add Experience").click()
    page.wait_for_timeout(300)
    print("role inputs after add:",
          page.get_by_placeholder("e.g. Software Engineer").count())
    page.screenshot(path="/tmp/prof_03_work_added.png")

    # Education section
    page.get_by_text("Academic Background", exact=False).first.click()
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/prof_04_edu_collapsed.png")
    print("edu header visible:",
          page.get_by_text("Northumbria University").count())
    print("institution input while collapsed:",
          page.locator("#institution-0").count())
    page.get_by_text("Northumbria University").first.click()
    page.wait_for_timeout(300)
    print("institution input after expand:",
          page.locator("#institution-0").count())
    page.screenshot(path="/tmp/prof_05_edu_expanded.png")

    browser.close()
```

Expected output: collapsed → header 1 / inputs 0; expanded → inputs ≥ 1; after add → role inputs increase by 1 (new item auto-expanded). Inspect the screenshots for clean rendering (chevrons, badges: period, "2 highlights", "2022–2026", "1 courses").

If the section-header click selectors don't match the actual card titles, read the CardHeader text in `App.jsx` (ProfileEditor `sectionInfo` / CardTitle strings) and adjust the selectors — do not change app code for the test's sake.

- [ ] **Step 4: MCP smoke test of basic_info through the live server**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin/backend
source venv/bin/activate
DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test python3 - <<'EOF'
import db, server
with db.get_pool().connection() as conn:
    row = conn.execute("select id from users where username='verifier'").fetchone()
db.current_user_id.set(str(row["id"]))
print(server.persona_modify.fn(action="update", entity="basic_info",
                               data={"bio": "Updated via MCP", "location": "Newcastle"}))
print(server.load_json("profile.json")["bio"])
EOF
```

Expected: `✅ Updated profile: bio=Updated via MCP, location=Newcastle` then `Updated via MCP`.

- [ ] **Step 5: Clean up and report**

Stop the uvicorn and vite dev servers started in this task (they were started by this task, so stopping them is in-scope). Report verification results with screenshots to the user. If any step failed, fix the source, re-run the failed check, and commit the fix with a `fix:` message.
