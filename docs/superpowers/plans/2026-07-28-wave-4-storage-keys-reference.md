# Wave 4 — REAL storage keys for `projects` and `knowledge`

Method: every key below is claimed only from a line that **writes** it. Manifest
`entities` blocks were read but treated as MCP input vocabulary, never as schema.

Files read:
- `/Users/khantthura/Documents/ProjectL/project-twin/frontend/src/editors/ProjectsEditor.jsx`
- `/Users/khantthura/Documents/ProjectL/project-twin/frontend/src/editors/KnowledgeEditor.jsx`
- `/Users/khantthura/Documents/ProjectL/project-twin/backend/server.py`
- `/Users/khantthura/Documents/ProjectL/project-twin/backend/persona_store.py`
- `/Users/khantthura/Documents/ProjectL/project-twin/backend/search_index.py`
- `/Users/khantthura/Documents/ProjectL/project-twin/backend/section_packs/projects/manifest.json`
- `/Users/khantthura/Documents/ProjectL/project-twin/backend/section_packs/knowledge/manifest.json`
- `/Users/khantthura/Documents/ProjectL/project-twin/frontend/src/renderers/ListRenderer.jsx` (migration target)

Shared machinery that writes keys nobody's `elif` branch mentions:
- `persona_store.py:40` — `item.setdefault("id", generate_entity_id(prefix))` for
  **every** dict in a manifest `id_lists` list. Prefixes come from the manifests:
  `projects/manifest.json:12-21` → `projects`/`project`, `top_of_mind`/`top`;
  `knowledge/manifest.json:12-21` → `domains`/`domain`, `mental_tabs`/`tab`.
- `server.py:1298` + `server.py:1308` — `_execute_link` writes `entry["related"]`
  (`string[]`, ≤10 ids, `server.py:1305`) onto any entry located by
  `search_index.entity_location` (`server.py:1262`), i.e. any entry in one of the
  four id-lists above. Removed at `server.py:1327`/`1329`.
- `persona_store.py:112-127` (projects) and `:128-141` (knowledge) — load-time
  backfill; see §5.

---

# SECTION 1 of 2 — `projects` (file `projects.json`)

## 1. Storage-key tables

### Entity `project` → `projects.json["projects"][]` (`server.py:1826`)

| key | shape | editable in bespoke editor? | written at (server.py) |
|---|---|---|---|
| `id` | string (`project_<hex8>`) | no | `1838` (add). Also backfilled `persona_store.py:40` |
| `name` | string | yes — `ProjectsEditor.jsx:609-616` | `1838` (**add only**; no rename path on update — see §5) |
| `description` | long text | yes — `ProjectsEditor.jsx:637-644` | `1838` (add), `1851` via loop key `"description"` (`1849`) |
| `status` | enum `active\|paused\|completed\|archived\|idea` (manifest `projects/manifest.json:52-59`; editor `ProjectsEditor.jsx:39`) | yes — `ProjectsEditor.jsx:624-630` | `1839` (add), `1851` (update) |
| `tags` | string[] | yes — `ProjectsEditor.jsx:652-658` | `1839` (add), `1851` (update), `2279` (`project_tag` add), `2285` (remove) |
| `references` | nested object[] `{name,url,notes}` | yes — `ProjectsEditor.jsx:672-833` | `1839` (add), `1851` (update), `2304` (`project_reference` add) |
| `highlights` | string[] | yes — `ProjectsEditor.jsx:859-924` | `1840` (add), `1851` (update), `2347` (`project_highlight` add) |
| `notes` | long text | yes — `ProjectsEditor.jsx:840-852` | `1840` (add), `1851` (update) |
| `added_date` | date `YYYY-MM-DD` | **no** | `1841` (**add only**) |
| `last_updated` | date `YYYY-MM-DD` | **no** | `1852` (**update only**), `2349` (`project_highlight` add), `2358` (`project_highlight` remove) |
| `url` | string | **no** | `1851` via loop key `"url"` (`1849`) — **update only**, not in manifest, not rendered |
| `challenges` | unconstrained (whatever caller passes) | **no** | `1851` via loop key `"challenges"` (`1849`) — **update only**, not in manifest |
| `goals` | unconstrained (whatever caller passes) | **no** | `1851` via loop key `"goals"` (`1849`) — **update only**, not in manifest |
| `related` | string[] of entity ids | **no** | `1298`/`1308` (`_execute_link`) |
| `tech_stack` | string[] — **legacy, migrated away** | read-only fallback at `ProjectsEditor.jsx:521` | never written; removed at `persona_store.py:120` |

Editor-only add path (`ProjectsEditor.jsx:128-141`) writes exactly
`name, description:"" , status, tags:[], references:[], notes:""` — **no `id`,
no `highlights`, no `added_date`**. `id` arrives via `persona_store.py:40`;
`highlights` via `persona_store.py:124`.

Update-loop guard: `server.py:1850` is `if data.get(field)` — falsy values are
skipped, so **`update` can never clear a field to `""` or `[]`** via MCP.

### Entity `project_tag` → `projects.json["projects"][i]["tags"][]` (`server.py:2275`)
Not an object. Appends a **bare string** (`server.py:2279`). No id, no shape.

### Entity `project_reference` → `projects.json["projects"][i]["references"][]` (`server.py:2298`)

| key | shape | editable? | written at |
|---|---|---|---|
| `name` | string | yes — `ProjectsEditor.jsx:747` | `2304` (add). **Never written on update** — no `new_name` branch (contrast `2428-2430`) |
| `url` | string | yes — `ProjectsEditor.jsx:767` | `2304` (add), `2312` (update) |
| `notes` | long text | yes — `ProjectsEditor.jsx:788` | `2304` (add), `2314` (update) |

No `id` — this list is not in `id_lists`, so `persona_store.py:40` skips it and
`_execute_link` can never target a reference (`server.py:1262`).

### Entity `project_highlight` → `projects.json["projects"][i]["highlights"][]` (`server.py:2335`)
Bare strings (`server.py:2347`). Side-effect: also writes the parent's
`last_updated` (`server.py:2349`, `2358`).

### Entity `top_of_mind` → `projects.json["top_of_mind"][]` (`server.py:1878`)

| key | shape | editable? | written at |
|---|---|---|---|
| `idea` | string | yes — `ProjectsEditor.jsx:306-309` (field name `"idea"` at `286-287`) | `1891` (**add only**; entity has no `update` action, `projects/manifest.json:107-110`) |
| `note` | string / short text | yes — `ProjectsEditor.jsx:316-319` | `1891` (add only) |
| `id` | string (`top_<hex8>`) | no | not written by `execute_modify`; only `persona_store.py:40`. Consumed at `server.py:864` |
| `related` | string[] | no | `1298`/`1308` |

Legacy plain-string entries are tolerated on read: `server.py:1883`
(`get_idea_text`) and `ProjectsEditor.jsx:277`/`283-285` both coerce
`"foo"` → `{idea:"foo", note:""}`.

## 2. `projects` manifest `entities` names that are NOT storage keys

| manifest name | manifest line | what it really is | proof |
|---|---|---|---|
| `project_tag.project_name` | `projects/manifest.json:70` | parent selector | read at `server.py:2270`, used only for `find_in_array` at `2271`; never assigned |
| `project_tag.tag` | `:70` | the *value* appended into `tags[]`, not a key | `server.py:2276` → `2279` |
| `project_reference.project_name` | `:83` | parent selector | `server.py:2293` → `2294` |
| **`project_reference.ref_name`** | `:84` | **input alias — the stored key is `name`** | `server.py:2299` reads `ref_name`, `server.py:2304` writes `{"name": ref_name}` |
| `project_highlight.project_name` | `:99` | parent selector | `server.py:2328` → `2331` |
| `project_highlight.highlight` | `:100` | the *value* appended into `highlights[]` | `server.py:2339` → `2347` |
| **`top_of_mind.item`** | `:112` | **input alias — the stored key is `idea`** | `server.py:1879` reads `item`/`topic`/`thought`/`subject`/`name`/`idea`; `server.py:1891` writes `{"idea": item, "note": note}` |

Storage keys **missing** from the manifest that a `ui` block must still expect:
`id`, `added_date`, `last_updated`, `url`, `challenges`, `goals`, `related` on
`project`; `id`, `related` on `top_of_mind`.

## 3. Nesting structure (`projects`)

```
projects.json
├── projects[]                              id-list, prefix "project"  (projects/manifest.json:13-16)
│   ├── tags[]         : string[]           (server.py:2275, 2279)
│   ├── highlights[]   : string[]           (server.py:2335, 2347)
│   └── references[]   : object[] {name,url,notes}   (server.py:2298, 2304)   ← no ids
└── top_of_mind[]                           id-list, prefix "top"      (projects/manifest.json:17-20)
    └── (no children)
```

Exact parent key paths for the nested-child renderer:
- `projects[*].references` — child item shape `{ name: string, url: string, notes: long text }` (`server.py:2304`; editor `ProjectsEditor.jsx:814`).
- `projects[*].highlights` — child item shape **bare string** (`server.py:2347`; editor `ProjectsEditor.jsx:911-914` appends `""`).
- `projects[*].tags` — bare string (`server.py:2279`; editor `ProjectsEditor.jsx:652-658` via `ArrayInput`).

## 4. Non-flat things the bespoke `projects` editor renders

| what | where | why a naive migration breaks it |
|---|---|---|
| `{refCount} refs` badge | computed `ProjectsEditor.jsx:522`, rendered `548-555` | derived count, not a field |
| `{tagCount} tags` badge | `:523`, rendered `556-563` | derived count |
| `notes` badge (presence-only) | `:524` (`(project.notes\|\|"").trim().length>0`), rendered `564-571` | boolean derived from a long-text field |
| `{highlightsCount} highlights` badge | `:525`, rendered `572-579` | derived count |
| status badge with `\|\| "active"` fallback | `:586` | displays a value that may not be stored |
| `tags \|\| tech_stack` fallback | `:521` | reads a legacy key the store strips (`persona_store.py:120`) |
| reference `URL`/`notes` presence badges | `:698-713` | derived booleans on a **nested child** |
| collapsible per-reference sub-accordion | `:672-804`, state `:43-45`, `:154-159` | two-level expand/collapse; `ListRenderer` has one level only |
| search + status filter + `.reverse()` | `:203-215` | display-order/filter logic; `ListRenderer` has `node.sort`/`query` but **no `.reverse()` default and no status facet** (`ListRenderer.jsx:170-213`) |
| `originalIndex` re-derivation via `indexOf(project)` | `:520` | identity by object reference; duplicates collapse |
| Add-project modal that seeds 6 keys | `:128-141` | `ListRenderer.addItem` seeds only `field_defaults` + drafted fields (`ListRenderer.jsx:104-112`) |
| per-section `Info` dialogs | `:69-99`, `989-1017` | must move into `ui.sections[].info` (cf. `circle/manifest.json` `ui`) |
| "Untitled project" / "Untitled reference" placeholders | `:545`, `:695` | display fallbacks |

---

# SECTION 2 of 2 — `knowledge` (file `knowledge.json`)

## 1. Storage-key tables

### Entity `domain` → `knowledge.json["domains"][]` (`server.py:1746`)

| key | shape | editable? | written at |
|---|---|---|---|
| `id` | string (`domain_<hex8>`) | no | `1757` (add); backfilled `persona_store.py:40` |
| `name` | string | yes — `KnowledgeEditor.jsx:421-428` | `1757` (**add only** — `update` has no rename branch, `1762-1771`) |
| `level` | enum `beginner\|learning\|intermediate\|advanced\|expert` (`knowledge/manifest.json:49-57`; editor `KnowledgeEditor.jsx:40`) | yes — `KnowledgeEditor.jsx:436-442` | `1757` (add, default `"learning"` from `1748`), `1767` (update, guarded by `1766`) |
| `notes` | long text | yes — `KnowledgeEditor.jsx:448-460` | `1758` (add), `1769` (update, guarded by `1768` — cannot be cleared) |
| `references` | nested object[] `{name,url,notes}` | yes — `KnowledgeEditor.jsx:467-607` | `1758` (**add only** — `update` never touches it), `2417` (`domain_reference` add) |
| `added_date` | date `YYYY-MM-DD` | no | **not written by `domain`**; written at `2380` when the same list is reached via entity `knowledge` (see §5) |
| `last_updated` | date `YYYY-MM-DD` | no | **not written by `domain`**; written at `2392` via entity `knowledge` |
| `related` | string[] | no | `1298`/`1308` |

### Entity `mental_tab` → `knowledge.json["mental_tabs"][]` (`server.py:1782`)

| key | shape | editable? | written at |
|---|---|---|---|
| `title` | string | yes — `KnowledgeEditor.jsx:829-836` | `1793` (**add only** — no rename on update, `1799-1812`) |
| `notes` | long text | yes — `KnowledgeEditor.jsx:857-864` | `1793` (add), `1806` (update, guarded by `1805`) |
| `tags` | string[] | yes — `KnowledgeEditor.jsx:873-879` | `1793` (add), `1810` (update, guarded by `1809`) |
| `status` | enum `open\|closed\|archived` (`knowledge/manifest.json:110-116`; editor `KnowledgeEditor.jsx:36`) | yes — `KnowledgeEditor.jsx:845-851` | `1794` (add, default `"open"` from `1785`), `1808` (update) |
| `references` | nested object[] `{name,url,notes}` | yes — `KnowledgeEditor.jsx:886-1026` | `1794` (**add only**), `2457` (`mental_tab_reference` add) |
| `created_at` | ISO-8601-ish string | no (editor writes it on add: `KnowledgeEditor.jsx:178`) | `1795` (**add only**) — **shape differs between paths, see §5** |
| `id` | string (`tab_<hex8>`) | no | **never written by `execute_modify`**; only `persona_store.py:40` |
| `related` | string[] | no | `1298`/`1308` |
| `topic` | string — **legacy, read-only** | no | **never written by any current path**; still *read* at `1790`, `1802`, `1816`, `2447` |

### Entity `knowledge` → `knowledge.json[<data["category"]>][]` (`server.py:2366-2367`)
`category` defaults to `"domains"` (`server.py:2366`), so by default this writes
into the same list as `domain` — **with a different shape**.

| key | shape | editable? | written at |
|---|---|---|---|
| `name` | string | (only when category=`domains`, via the domain UI) | `2378` (add) |
| `level` | enum (same values as `domain`) | ditto | `2378` (add), `2389` (update) |
| `notes` | long text | ditto | `2378` (add), `2391` (update) |
| `references` | nested object[] | ditto | `2379` (add only) |
| `added_date` | date `YYYY-MM-DD` | no | `2380` (**add only**) |
| `last_updated` | date `YYYY-MM-DD` | no | `2392` (**update only**) |
| `id` | — | — | **never written here**; only `persona_store.py:40`, and only if `category` happens to be `domains`/`mental_tabs` |

### Entity `domain_reference` → `knowledge.json["domains"][i]["references"][]` (`server.py:2411`)

| key | shape | editable? | written at |
|---|---|---|---|
| `name` | string | yes — `KnowledgeEditor.jsx:524` | `2417` (add), `2430` (update, via `new_name`) |
| `url` | string | yes — `KnowledgeEditor.jsx:544` | `2417` (add), `2425` (update) |
| `notes` | long text | yes — `KnowledgeEditor.jsx:565` | `2417` (add), `2427` (update) |

### Entity `mental_tab_reference` → `knowledge.json["mental_tabs"][i]["references"][]` (`server.py:2451`)

| key | shape | editable? | written at |
|---|---|---|---|
| `name` | string | yes — `KnowledgeEditor.jsx:943` | `2457` (add), `2470` (update, via `new_name`) |
| `url` | string | yes — `KnowledgeEditor.jsx:963` | `2457` (add), `2465` (update) |
| `notes` | long text | yes — `KnowledgeEditor.jsx:984` | `2457` (add), `2467` (update) |

## 2. `knowledge` manifest `entities` names that are NOT storage keys

| manifest name | manifest line | what it really is | proof |
|---|---|---|---|
| `domain_reference.domain_name` | `knowledge/manifest.json:67` | parent selector | `server.py:2406` → `2407`; never assigned |
| **`domain_reference.ref_name`** | `:68` | **input alias — stored key is `name`** | `server.py:2412` reads it, `server.py:2417` writes `{"name": …}` |
| **`knowledge.category`** | `:87` | **list router, not a field** — picks the top-level list | `server.py:2366-2367` (`items = knowledge.setdefault(category, [])`); never written onto the item (`2377-2381`) |
| `mental_tab_reference.title` | `:127` | parent selector (the *tab's* title) | `server.py:2444` → `2445`; the ref itself gets `name` at `2457` |
| **`mental_tab_reference.ref_name`** | `:128` | **input alias — stored key is `name`** | `server.py:2452` → `2457` |
| `mental_tab.title` (as an alias list) | `:102` | *is* real, but the alias chain is a trap | `FIELD_ALIASES["mental_tab"] = ["name","mental_tab","topic","title","subject"]` (`server.py:1106`) — `name`/`topic` are inputs only; `server.py:1793` writes `title` |
| `domain.name` alias chain | `:42` | `name` is real; `domain`/`domain_name`/`area`/`topic` are inputs only | `server.py:1097`, `1747` → `1757` |

Storage keys **missing** from the manifest that a `ui` block must still expect:
`id`, `created_at`, `related`, legacy `topic` on `mental_tab`; `id`, `related`,
plus `added_date`/`last_updated` (arriving via entity `knowledge`) on `domain`.

## 3. Nesting structure (`knowledge`)

```
knowledge.json
├── domains[]                               id-list, prefix "domain"   (knowledge/manifest.json:13-16)
│   └── references[]  : object[] {name,url,notes}   (server.py:2411, 2417)   ← no ids
└── mental_tabs[]                           id-list, prefix "tab"      (knowledge/manifest.json:17-20)
    ├── tags[]        : string[]            (server.py:1793, 1810)
    └── references[]  : object[] {name,url,notes}   (server.py:2451, 2457)   ← no ids
```

Exact parent key paths for the nested-child renderer:
- `domains[*].references` — `{ name, url, notes }` (`server.py:2417`; editor `KnowledgeEditor.jsx:590`).
- `mental_tabs[*].references` — `{ name, url, notes }` (`server.py:2457`; editor `KnowledgeEditor.jsx:1009`).
- `mental_tabs[*].tags` — bare string (`server.py:1793`; editor `KnowledgeEditor.jsx:873-879`).

All three reference lists across both sections share **one** child shape, so a
single nested-child node type covers `projects[*].references`,
`domains[*].references` and `mental_tabs[*].references`.

## 4. Non-flat things the bespoke `knowledge` editor renders

| what | where | why a naive migration breaks it |
|---|---|---|
| `level` badge with `\|\| "learning"` fallback | `KnowledgeEditor.jsx:388-390` | shows a value that may not be stored |
| `notes` presence badge | `:366` (`hasNotes = !!domain.notes`), rendered `391-398` | derived boolean |
| tags badge strip capped at 3 + `+N` overflow badge | `:788-808` | derived/truncated display, not a field |
| collapsible per-reference sub-accordion (domains **and** tabs) | `:467-581` and `:886-1000`; state `:44`, `:46` | second nesting level |
| search over `tab.title` **or** `tab.tags` | `:233-240` | multi-field search incl. an array |
| domain search over `domain.name` unguarded | `:226-228` (`domain.name.toLowerCase()`, no `?.`) | throws on a domain with no `name`; `ListRenderer` search is null-safe (`ListRenderer.jsx:207-210`) |
| level filter facet | `:229-230`, control `:330-342` | no equivalent in `ListRenderer` |
| `originalIndex` via `indexOf(domain)`/`indexOf(tab)` | `:364`, `:765` | identity by object reference |
| tabs prepended, domains appended | `:172-181` vs `:150-158` | opposite insert order for two lists in one section |
| `created_at` written client-side on add | `:178` | machine key with no control; needs `field_defaults: {created_at: "@now"}` (cf. `learning_log` `ui.field_defaults`) |
| `addDomain` (`{name:"",level:"learning",notes:""}`) | `:109-117` | **dead code — no call site in the file**; only `handleAddSkillFromModal` (`:146-165`) is wired |
| `Info` dialogs | `:70-100`, `1107-1135` | must move into `ui.sections[].info` |

---

## 5. Genuinely surprising / silent-data-loss risks

1. **`top_of_mind` stores `idea`; the manifest's only required name is `item`.**
   `server.py:1879` accepts `item`/`topic`/`thought`/`subject`/`name`/`idea` as
   input; `server.py:1891` writes `{"idea": …, "note": …}`. The editor agrees
   (`ProjectsEditor.jsx:117`, `:286-287`). A `ui` block with
   `title_field: "item"` would render every existing entry as blank and write a
   parallel `item` key that `execute_modify`'s dedupe (`server.py:1888` via
   `get_idea_text`, `:1883`) cannot see — silent duplicate explosion.

2. **`mental_tab` stores `title`, but `FIELD_ALIASES["mental_tab"]` starts with
   `name` and includes `topic`.** `server.py:1106` lists
   `["name","mental_tab","topic","title","subject"]`; only `title` is written
   (`server.py:1793`). Worse: `topic` is a **legacy key that is still read and
   never written** — `server.py:1790` (`t.get("title","") or t.get("topic","")`),
   `1802`, `1816`, `2447`. Any old blob still carrying `topic` is findable by MCP
   but invisible to the editor (`KnowledgeEditor.jsx:235`, `:786`, `:829`), and a
   generic renderer keyed on `title` will show it as "Untitled tab" and, on first
   edit, write a `title` alongside the orphaned `topic`.

3. **Entity `knowledge` writes into a caller-chosen top-level list.**
   `server.py:2366-2367`: `category = get_field(data,"category","type",default="domains")`
   then `items = knowledge.setdefault(category, [])`. So
   `persona_modify(add, "knowledge", {name:"X", category:"skills"})` creates
   `knowledge.json["skills"]` — a top-level list with **no manifest default
   (`knowledge/manifest.json:8-11`), no `id_lists` entry (`:12-21`), no
   `scope_contributions` (`:22-33`), no editor and no `id`** (`persona_store.py:35`
   iterates only registered id-lists). Such entries are unreachable by
   `get_entity`, `_execute_link` (`server.py:1262`) and the search index
   (`search_index.py:53` skips id-less entries), and a section-level editor that
   round-trips only `domains` + `mental_tabs` would **delete them on the next
   save** (`main.py:387` overwrites the whole blob).

4. **Two entities write different shapes into the *same* `domains` list.**
   `domain` add writes `{id,name,level,notes,references}` (`server.py:1756-1759`)
   and never `added_date`/`last_updated`; `knowledge` add (category defaults to
   `domains`) writes `{name,level,notes,references,added_date}` **with no `id`**
   (`server.py:2377-2381`) and its update writes `last_updated`
   (`server.py:2392`). The same list therefore contains entries with and without
   `added_date`/`last_updated`, and `id` is only present because
   `persona_store.py:40` backfills it on the next save.

5. **`created_at` on `mental_tab` has two incompatible shapes.**
   Backend: `datetime.now().isoformat() + "Z"` (`server.py:1795`) — *local* time
   stamped as UTC. Editor: `new Date().toISOString()` (`KnowledgeEditor.jsx:178`)
   — real UTC. Any `display_formats: {created_at: "datetime"}` in a `ui` block
   (`ListRenderer.jsx:32-40` parses via `new Date()`) will render backend-created
   tabs off by the local UTC offset. Not data loss, but it is a real inconsistency.

6. **Rename is impossible over MCP for `project`, `domain` and `mental_tab`.**
   No `new_name`/`new_title` branch exists at `server.py:1845-1854`,
   `1762-1771`, `1799-1812` — the identifier is only ever written on `add`
   (`1838`, `1757`, `1793`). The editors *can* rename (`ProjectsEditor.jsx:609`,
   `KnowledgeEditor.jsx:421`, `:829`). So the UI can produce an entry that
   `find_in_array` (`server.py:673`) can no longer match by its old name; any
   `related` ids pointing at it still resolve (they use `id`), but every
   name-addressed MCP update silently 404s.

7. **`project` update writes three keys nothing else in the system knows about.**
   `server.py:1849` iterates `["description","status","url","tags","references",
   "highlights","notes","challenges","goals"]`. `url`, `challenges` and `goals`
   are absent from `projects/manifest.json:44-51`, absent from
   `ProjectsEditor.jsx` entirely, and absent from `search_index.TEXT_FIELDS`
   except `url` (`search_index.py:18-20`). They are write-only orphans: an MCP
   caller can set them and nothing will ever display them.

8. **`_filter_inactive` silently hides three of the five valid project statuses.**
   `server.py:1073-1076` allows `active, open, exploring, planning, completed,
   want, in_progress, finished`. Manifest statuses `paused`, `archived` and
   **`idea`** (`projects/manifest.json:52-59`) are dropped from every
   `get_context` call (`server.py:818-821`), and `server.py:1079` deletes the
   whole `projects` key if *all* projects are filtered out. Same for
   `mental_tab` statuses `closed`/`archived` (`knowledge/manifest.json:110-116`).
   The editor's own comment (`ProjectsEditor.jsx:36-39`) says `idea` replaced the
   old `planning` value — `planning` was on the allow-list, `idea` is not, so
   that change made those projects invisible to context.

9. **`project` `add` requires `description`; the editor does not.**
   `server.py:1833` rejects an add without a description; the Add-Project modal
   writes `description: ""` (`ProjectsEditor.jsx:133`). The UI path bypasses
   `execute_modify` entirely (`main.py:387` → `persona_store.save`), so the two
   paths have different validity rules for the same data.

10. **`references` cannot be updated through the `domain`/`mental_tab` update
    branch — only through `*_reference`.** `server.py:1762-1771` and
    `1799-1812` never touch `references`; only the add paths (`1758`, `1794`) and
    the child entities (`2417`, `2457`) write it. Similarly `mental_tab` update
    never rewrites `created_at`.

11. **`project_reference` cannot rename its `name`; the other two reference
    entities can.** `server.py:2307-2316` has no `new_name` branch, while
    `domain_reference` (`2428-2430`) and `mental_tab_reference` (`2468-2470`) do.
    Same child shape, asymmetric verbs.

12. **`ListRenderer.updateItem` deletes a key when the value becomes `""`**
    (`ListRenderer.jsx:137-138`), whereas both bespoke editors store the empty
    string (`ProjectsEditor.jsx:846`, `KnowledgeEditor.jsx:861`). After
    migration, clearing a `notes` box removes the key. `persona_store.py:123`
    re-adds `notes: ""` for projects on the next load, but **not** for
    `domains`/`mental_tabs` (`persona_store.py:128-138` only backfills
    `references`) — so knowledge notes genuinely vanish as keys.

13. **`related` is invisible everywhere the user looks.** Written at
    `server.py:1298`/`1308`, stripped from `get_context` at `server.py:826`
    (`_strip_related`, `1033-1054`), resolved only by `get_entity`
    (`server.py:3397-3420`). Neither editor mentions it. It survives migration
    only because both bespoke editors and `ListRenderer.updateItem`
    (`ListRenderer.jsx:135-136`) spread the existing item; any `ui` migration that
    rebuilds items from a whitelist instead would drop every stored link.

14. **`top_of_mind` entries can still be bare strings.** `server.py:1883` and
    `ProjectsEditor.jsx:277` both coerce; `persona_store.py:38` skips non-dicts
    when assigning ids, so a string entry has no `id`, is absent from the search
    index (`search_index.py:53`), and is exempt from the staleness advisory
    (`server.py:864-867`). A generic list renderer that assumes objects will
    render `undefined` for these.

## Ambiguities (not guesses — flagged as unresolved)

- **`project.challenges` / `project.goals` shape is unknown.** `server.py:1851`
  assigns `data[field]` verbatim with no coercion and no validation, and nothing
  reads them. Could be string, string[] or object[]. Do not put them in a `ui`
  block without first inspecting real blobs.
- **Whether any production blob still carries `mental_tabs[].topic`** cannot be
  determined from source; the read paths (`server.py:1790`, `1802`, `1816`,
  `2447`) exist, but `persona_store._normalize` (`:128-141`) does **not** migrate
  `topic` → `title`. Needs a data query before the manifest drops the fallback.
- **Whether any blob carries `knowledge.json[<other category>]`** (surprise #3)
  likewise needs a data query — `persona_store._normalize` only pops
  `proficiency_levels` (`persona_store.py:141`), so any other stray list survives.
- **`domain.level` clearing semantics.** `server.py:1766` reads
  `if level != "learning" or data.get("level")`, so an explicit
  `level: "learning"` update works, but the guard makes it impossible to tell a
  deliberate default from an omission. Same pattern for `mental_tab.status` at
  `server.py:1807`.
