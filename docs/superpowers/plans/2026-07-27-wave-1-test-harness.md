# Wave 1: Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the frontend a test net — Vitest with Testing Library for behaviour, Storybook for visual review, and stories that run as real browser tests — so the section renderer migration in waves 3-6 cannot silently drop a field.

**Architecture:** One Vitest config with two projects. A `unit` project runs jsdom tests via Testing Library. A `storybook` project runs every story as a headless Chromium test through `@storybook/addon-vitest`, so a story and its test are the same artifact and cannot drift. Both are driven from generated pack fixtures, so the manifests stay the single source of truth.

**Tech Stack:** Vitest 4.1.10, @testing-library/react 16.3.2, jsdom 30, Storybook 10.5.5 (`@storybook/react-vite`, `@storybook/addon-vitest`), Playwright 1.62, Vite 7.3.6, React 18.

## Global Constraints

- **No application behaviour changes.** No file under `frontend/src/` may be modified except to add new test, fixture, and story files. `App.jsx`, the editors, and `GenericSectionEditor.jsx` are read-only in this wave.
- This project is **plain JavaScript, not TypeScript**. Every config and test file is `.js` or `.jsx`. Do not add TypeScript, `tsconfig.json`, or `.ts` files. Storybook's documentation shows `.ts` examples — translate them.
- The package manager is **npm**, not yarn. Storybook's docs show `yarn` in the `storybookScript` option — use the npm form.
- Vite stays at **7.3.6** and `@vitejs/plugin-react` at **4.7.0**. Tailwind stays at 3.4.
- Exact versions: `vitest@^4.1.10`, `@vitest/browser@^4.1.10`, `@vitest/browser-playwright@^4.1.10`, `@testing-library/react@^16.3.2`, `@testing-library/jest-dom@^7.0.0`, `@testing-library/user-event@^14.6.1`, `jsdom@^30.0.0`, `playwright@^1.62.0`, `storybook@^10.5.5`, `@storybook/react-vite@^10.5.5`, `@storybook/addon-vitest@^10.5.5`.
- Storybook is **local and CI only**. It is never deployed, and no Storybook build output may enter the Docker image.
- Branch: `feature/wave-1-test-harness`, branched from `main`. Pushes use the `liamthura` account.
- Wave 0 is merged and deployed; `main` is on Vite 7.3.6. `frontend/package.json`'s `engines.node` floor is `^22.22.2 || >=24.15.0` (raised in Task 2 from `^20.19.0 || >=22.12.0`, which had zero overlap with what `jsdom@30` actually supports — jsdom 30 does not run on Node 20 at all, and Node 20 went EOL in April 2026, which is why wave 0 moved the build off it in the first place).

## Deviation from the spec

The spec (§ Testing) says wave 1 delivers "per-section fixtures under `frontend/src/__fixtures__/`, populated with every stored key" for all seven sections.

**This plan delivers the fixture *mechanism* plus fixtures for the three generic packs only** (`goals`, `media`, `aesthetics`). Per-section data fixtures for the seven legacy sections move into their own waves (3-6).

The reason is the spec's own central finding: a legacy section's stored keys can only be established by reading its bespoke editor and its `execute_modify` branch, because `entities` is an MCP vocabulary rather than a storage schema. That same reading is what produces the section's `ui` block. Authoring the fixture in wave 1 and the `ui` block three waves later means doing that reading twice, from different context, with nothing checking that the two agree — which is precisely the divergence the fixtures exist to catch. Authored together, each cross-checks the other.

The three generic packs have no such problem: their entity fields *are* their storage keys, so their fixtures are derivable now, and they are enough to prove the whole harness end to end.

---

### Task 1: Generate pack fixtures from the manifests

Tests and stories both need the pack metadata the app receives from `/api/settings`. Hand-copying it would rot. A generator plus a CI drift check keeps the manifests authoritative.

**Files:**
- Create: `frontend/scripts/generate-pack-fixtures.mjs`
- Create: `frontend/src/__fixtures__/packs.json` (generated)
- Create: `frontend/src/__fixtures__/data/goals.json` (hand-written)
- Modify: `frontend/package.json` (add the `fixtures` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `frontend/src/__fixtures__/packs.json`, an array of pack objects each shaped `{ key, title, description, core, default_enabled, enabled, entities, ui }` — the same shape `backend/main.py:404-416` serves. `position` is used only to order the array (as `pack_loader.py` does) and is not itself a served field, so it does not appear on the objects. Tasks 2, 3 and 4 import it. Also `frontend/src/__fixtures__/data/goals.json`, a populated `goals` section payload.

- [ ] **Step 1: Write the generator**

Create `frontend/scripts/generate-pack-fixtures.mjs`:

```js
// Regenerates the pack fixtures from the backend manifests, so tests and
// stories stay bound to the real manifests rather than a hand-copied snapshot.
// Mirrors the shape backend/main.py serves at /api/settings.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packsDir = join(here, "..", "..", "backend", "section_packs");
const outFile = join(here, "..", "src", "__fixtures__", "packs.json");

// This fixture represents the all-enabled state: `enabled` is hardcoded to
// true for every pack. A later task that needs a disabled-pack case must
// construct it by hand rather than assuming this fixture covers it.
const packs = readdirSync(packsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .map((e) => JSON.parse(readFileSync(join(packsDir, e.name, "manifest.json"), "utf8")))
  .map((m) => ({
    key: m.key,
    title: m.title,
    description: m.description,
    core: m.core ?? false,
    default_enabled: m.default_enabled ?? true,
    enabled: true,
    entities: m.entities ?? {},
    ui: m.ui ?? {},
    __position: m.position ?? 999,
  }))
  .sort((a, b) => a.__position - b.__position || a.key.localeCompare(b.key))
  .map(({ __position, ...pack }) => pack);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(packs, null, 2) + "\n");
console.log(`wrote ${outFile}: ${packs.length} packs`);
```

Note the `!e.name.startsWith("_")` filter — it excludes `_template`, which is a scaffold rather than a real pack.

- [ ] **Step 2: Add the script and run it**

In `frontend/package.json`, add to `scripts`:

```json
    "fixtures": "node scripts/generate-pack-fixtures.mjs",
```

Then:

```bash
cd frontend
npm run fixtures
node -e "const p=require('./src/__fixtures__/packs.json');console.log(p.length,'packs:',p.map(x=>x.key).join(', '))"
```

Expected: 10 packs — `profile`, `goals`, `knowledge`, `preferences`, `projects`, `lifestyle`, `media`, `aesthetics`, `circle`, `learning_log` (order follows `position`, ascending: 10, 15, 20, 30, 40, 50, 55, 56, 60, 70). `_template` must NOT appear.

- [ ] **Step 3: Verify the goals pack carries a usable `ui` block**

```bash
cd frontend
node -e "
const p = require('./src/__fixtures__/packs.json').find(x => x.key === 'goals');
console.log(JSON.stringify(p.ui, null, 2));
console.log('entity valid_values:', JSON.stringify(p.entities.goal.valid_values));
"
```

Expected: `ui.goals` with `title_field: "title"`, `badges: ["type","status"]`, `detail_fields: ["target_date","why","notes"]`, and `valid_values` for `type` and `status`. Tasks 2-4 depend on exactly these field names.

- [ ] **Step 4: Write the goals data fixture**

Create `frontend/src/__fixtures__/data/goals.json`. Every field the `goals` `ui` block renders must be populated — that is what makes it useful as a coverage guard. Include an `id` on each goal: `backend/section_packs/goals/manifest.json` declares `id_lists: [["goals","goal"]]`, so real stored goals always carry one (assigned by `persona_store.generate_entity_id`, format `f"{prefix}_{uuid.uuid4().hex[:8]}"`, e.g. `goal_3f9a21c4`), and `GenericSectionEditor.jsx` uses `item.id` as its React key. `id` is also the one field in this fixture that the `ui` block's `badges`/`detail_fields` never expose, which is what makes the round-trip guard in Task 2 an actual test of drop-on-write rather than only of sibling-field preservation:

```json
{
  "goals": [
    {
      "id": "goal_3f9a21c4",
      "title": "Ship MyGist v3",
      "type": "career",
      "status": "active",
      "target_date": "2026-12-31",
      "why": "The single-container merge unblocked everything else.",
      "notes": "Section editor consolidation is the last big piece."
    },
    {
      "id": "goal_7be48d02",
      "title": "Learn Rust properly",
      "type": "learning",
      "status": "paused",
      "target_date": "2027-06-30",
      "why": "Curious whether it changes how I write Python.",
      "notes": "Parked until the docs site is done."
    }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/scripts/generate-pack-fixtures.mjs frontend/src/__fixtures__ frontend/package.json
git commit -m "test: generate pack fixtures from the backend manifests

Tests and stories both need the pack metadata the app gets from
/api/settings. Generating it keeps the manifests authoritative instead of
letting a hand-copied snapshot rot."
```

---

### Task 2: Vitest and Testing Library, with the first real guards

This task establishes the jsdom project and writes the two test shapes waves 3-6 depend on: a coverage guard (every stored field is reachable in the UI) and a round-trip guard (editing one field preserves every other).

**Files:**
- Create: `frontend/vitest.config.js`
- Create: `frontend/src/test/setup.js`
- Create: `frontend/src/test/harness.jsx`
- Create: `frontend/src/components/GenericSectionEditor.test.jsx`
- Modify: `frontend/package.json` (devDependencies, `test` scripts)

**Interfaces:**
- Consumes: `frontend/src/__fixtures__/packs.json` and `frontend/src/__fixtures__/data/goals.json` from Task 1.
- Produces: `frontend/src/test/harness.jsx` exporting `renderSection({ pack, initial })`, which returns `{ user, latest }` — `user` is a `userEvent` instance, and `latest()` returns the most recent data object the component passed to `onChange`, or the initial data if it has not fired. Tasks 3 and 4 do not use it; waves 3-6 do.
- Produces: `frontend/vitest.config.js` with a `projects` array containing one project named `unit`. Task 4 appends a second project named `storybook` to that same array.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/harness.jsx`:

```jsx
import { useState } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GenericSectionEditor from "@/components/GenericSectionEditor";

/**
 * Renders a section with real state, so typing behaves as it does in the app.
 *
 * GenericSectionEditor is controlled: it reads values from `data` and reports
 * changes upward. Rendering it with a static prop makes every keystroke appear
 * to do nothing, so tests need a stateful owner exactly as App.jsx provides.
 */
export function renderSection({ pack, initial }) {
  let seen = initial;

  function Harness() {
    const [data, setData] = useState(initial);
    return (
      <GenericSectionEditor
        pack={pack}
        data={data}
        onChange={(next) => {
          seen = next;
          setData(next);
        }}
      />
    );
  }

  const result = render(<Harness />);
  return { ...result, user: userEvent.setup(), latest: () => seen };
}
```

Create `frontend/src/components/GenericSectionEditor.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";
import { renderSection } from "@/test/harness";

const goalsPack = packs.find((p) => p.key === "goals");

describe("GenericSectionEditor", () => {
  it("renders every item's title", () => {
    renderSection({ pack: goalsPack, initial: goalsData });
    expect(screen.getByText("Ship MyGist v3")).toBeInTheDocument();
    expect(screen.getByText("Learn Rust properly")).toBeInTheDocument();
  });

  // The coverage guard. A ui block that omits a field would leave that field
  // unreachable in the UI -- and therefore silently unsaveable -- which is the
  // failure mode the whole consolidation has to avoid.
  it("exposes every detail field of an expanded item", async () => {
    const { user } = renderSection({ pack: goalsPack, initial: goalsData });
    await user.click(screen.getByText("Ship MyGist v3"));

    const goal = goalsData.goals[0];
    for (const field of ["target_date", "why", "notes"]) {
      expect(
        screen.getByDisplayValue(goal[field]),
        `field "${field}" is not reachable in the UI`
      ).toBeInTheDocument();
    }
  });

  // The round-trip guard. Catches drop-on-write: an edit that quietly discards
  // fields the renderer does not know about.
  it("preserves every other field when one is edited", async () => {
    const { user, latest } = renderSection({ pack: goalsPack, initial: goalsData });
    await user.click(screen.getByText("Ship MyGist v3"));

    const input = screen.getByDisplayValue(goalsData.goals[0].target_date);
    await user.type(input, "X");

    const after = latest();
    const expected = structuredClone(goalsData);
    expected.goals[0].target_date = goalsData.goals[0].target_date + "X";
    expect(after).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL with `npm error Missing script: "test"`. That is the expected starting state.

Do **not** use `npx vitest run` here — with no local install, `npx` silently downloads vitest from the registry and runs it, which muddies what the failure actually proves.

- [ ] **Step 3: Install and configure**

```bash
cd frontend
npm install --save-dev vitest@^4.1.10 jsdom@^30.0.0 \
  @testing-library/react@^16.3.2 @testing-library/jest-dom@^7.0.0 \
  @testing-library/user-event@^14.6.1
```

Create `frontend/src/test/setup.js`:

```js
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
```

Create `frontend/vitest.config.js`:

```js
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

// Merged with the app's Vite config so the "@" alias and the React plugin
// behave identically under test. Task 4 appends a second project here for
// Storybook's browser-mode tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "jsdom",
            globals: false,
            setupFiles: ["./src/test/setup.js"],
            include: ["src/**/*.test.{js,jsx}"],
          },
        },
      ],
    },
  })
);
```

In `frontend/package.json`, add to `scripts`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS — 3 tests in `src/components/GenericSectionEditor.test.jsx`, under a project named `unit`.

If `renders every item's title` passes but the other two fail, the `goals` `ui` block does not match what Task 1 Step 3 reported — re-read it rather than editing the tests to match.

- [ ] **Step 5: Confirm the app build is unaffected**

The test config must not leak into the production build.

```bash
cd frontend
rm -rf dist && npm run build
ls -1 dist/assets/
```

Expected: one `index-<hash>.js` and one `index-<hash>.css`, as before. No test file may appear in `dist`.

- [ ] **Step 6: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/vitest.config.js frontend/src/test frontend/src/components/GenericSectionEditor.test.jsx \
        frontend/package.json frontend/package-lock.json
git commit -m "test: add Vitest and Testing Library with the first two guards

A coverage guard (every stored field is reachable in the UI) and a
round-trip guard (editing one field preserves the rest). These are the two
shapes every migrated section needs in waves 3-6, proven here against the
goals pack, which already renders generically."
```

---

### Task 3: Storybook

Convergence means every section's appearance changes. Storybook is how each one gets looked at before its PR merges.

**Files:**
- Create: `frontend/.storybook/main.js`
- Create: `frontend/.storybook/preview.js`
- Create: `frontend/src/components/GenericSectionEditor.stories.jsx`
- Modify: `frontend/package.json` (devDependencies, `storybook` scripts)
- Modify: `.dockerignore` (exclude Storybook artifacts from the image)

**Interfaces:**
- Consumes: the fixtures from Task 1.
- Produces: `frontend/.storybook/` config that Task 4's `storybookTest` plugin points at via `configDir`. Produces at least one story file matching `src/**/*.stories.jsx`, which Task 4 turns into a browser test.

- [ ] **Step 1: Install Storybook**

```bash
cd frontend
npm install --save-dev storybook@^10.5.5 @storybook/react-vite@^10.5.5
```

Do not run `npx storybook init` — it rewrites configs, assumes TypeScript, and would fight the hand-written `vitest.config.js` from Task 2.

- [ ] **Step 2: Write the Storybook config**

Create `frontend/.storybook/main.js`:

```js
/** @type {import('@storybook/react-vite').StorybookConfig} */
export default {
  stories: ["../src/**/*.stories.@(js|jsx)"],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};
```

Create `frontend/.storybook/preview.js`:

```js
// The app's Tailwind layer and CSS custom properties. Without this, every
// story renders unstyled and visual review is worthless.
import "../src/globals.css";

/** @type {import('@storybook/react-vite').Preview} */
export default {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/ } },
  },
};
```

- [ ] **Step 3: Write the first story**

Create `frontend/src/components/GenericSectionEditor.stories.jsx`:

```jsx
import { useState } from "react";
import GenericSectionEditor from "@/components/GenericSectionEditor";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";

const goalsPack = packs.find((p) => p.key === "goals");

// Stateful wrapper: the component is controlled, so a static `data` prop would
// make every control appear frozen when someone tries the story by hand.
function Stateful({ pack, initial }) {
  const [data, setData] = useState(initial);
  return <GenericSectionEditor pack={pack} data={data} onChange={setData} />;
}

export default {
  title: "Sections/GenericSectionEditor",
  component: GenericSectionEditor,
};

export const Populated = {
  render: () => <Stateful pack={goalsPack} initial={goalsData} />,
};

export const Empty = {
  render: () => <Stateful pack={goalsPack} initial={{ goals: [] }} />,
};
```

- [ ] **Step 4: Add the scripts**

In `frontend/package.json`, add to `scripts`:

```json
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build",
```

- [ ] **Step 5: Keep Storybook out of the production image**

Storybook writes `storybook-static/` when built, and its cache lands in `node_modules/.cache`. Neither belongs in the Docker image.

Add to `.dockerignore`:

```
**/storybook-static
**/.storybook-cache
```

- [ ] **Step 6: Verify Storybook runs and the stories render**

```bash
cd frontend
npm run storybook -- --no-open --ci &
SB_PID=$!
sleep 40   # first run builds the Storybook manager; later runs are much faster
curl -s -o /dev/null -w 'storybook:%{http_code}\n' http://localhost:6006/
curl -s http://localhost:6006/index.json | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const e=JSON.parse(s).entries||{};
  console.log('stories:', Object.keys(e).join(', '));
});"
kill $SB_PID
```

Expected: `storybook:200`, and two entries — `sections-genericsectioneditor--populated` and `sections-genericsectioneditor--empty`.

Note: `timeout` is not available on this machine, which is why this backgrounds the process and kills it by PID.

- [ ] **Step 7: Verify the production build still ignores all of this**

```bash
cd frontend
rm -rf dist && npm run build
ls -1 dist/assets/
```

Expected: one JS and one CSS asset. No story file in `dist`.

- [ ] **Step 8: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/.storybook frontend/src/components/GenericSectionEditor.stories.jsx \
        frontend/package.json frontend/package-lock.json .dockerignore
git commit -m "test: add Storybook with the first section stories

Convergence changes how every section looks, so each one needs to be seen
before its PR merges. Storybook is local and CI only -- storybook-static is
excluded from the Docker image."
```

---

### Task 4: Run the stories as browser tests

This is what makes a story and its test the same artifact, so a story cannot drift from what is verified.

**Files:**
- Create: `frontend/.storybook/vitest.setup.js`
- Modify: `frontend/vitest.config.js` (append the `storybook` project)
- Modify: `frontend/package.json` (devDependencies, `test:storybook` script)
- Modify: `.gitignore` (Playwright and Storybook artifacts)

**Interfaces:**
- Consumes: `frontend/.storybook/main.js` from Task 3 (via `configDir`), and the `projects` array in `frontend/vitest.config.js` from Task 2.
- Produces: a second Vitest project named `storybook`. `npm test` runs both projects; `npm run test:storybook` runs only this one.

- [ ] **Step 1: Install the addon and browser provider**

```bash
cd frontend
npm install --save-dev @storybook/addon-vitest@^10.5.5 \
  @vitest/browser@^4.1.10 @vitest/browser-playwright@^4.1.10 playwright@^1.62.0
npx playwright install chromium
```

`@storybook/addon-vitest@10` declares a peer on `@vitest/browser-playwright@^4`, which is why Vitest must be 4 and Vite must be 6+ — the reason wave 0 existed.

- [ ] **Step 2: Register the addon**

In `frontend/.storybook/main.js`, change:

```js
  addons: [],
```

to:

```js
  addons: ["@storybook/addon-vitest"],
```

- [ ] **Step 3: Write the Vitest setup file**

Create `frontend/.storybook/vitest.setup.js`:

```js
import { beforeAll } from "vitest";
import { setProjectAnnotations } from "@storybook/react-vite";
import * as previewAnnotations from "./preview.js";

// Applies the same decorators, parameters and global styles the Storybook UI
// uses, so a story under test renders exactly as it does in the browser.
const project = setProjectAnnotations([previewAnnotations.default]);

beforeAll(project.beforeAll);
```

- [ ] **Step 4: Append the storybook project**

In `frontend/vitest.config.js`, add the imports at the top:

```js
import { playwright } from "@vitest/browser-playwright";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { fileURLToPath } from "node:url";
```

and add a second entry to the `projects` array, after the `unit` entry:

```js
        {
          extends: true,
          plugins: [
            storybookTest({
              configDir: fileURLToPath(new URL("./.storybook", import.meta.url)),
              storybookScript: "npm run storybook -- --no-open",
            }),
          ],
          test: {
            name: "storybook",
            browser: {
              enabled: true,
              provider: playwright({}),
              headless: true,
              instances: [{ browser: "chromium" }],
            },
            setupFiles: ["./.storybook/vitest.setup.js"],
          },
        },
```

Note `storybookScript` uses the npm form — Storybook's documentation shows yarn.

- [ ] **Step 5: Add the script and ignore artifacts**

In `frontend/package.json`, add to `scripts`:

```json
    "test:storybook": "vitest run --project=storybook",
```

Add to `.gitignore`:

```
frontend/storybook-static
frontend/test-results
```

- [ ] **Step 6: Run both projects**

```bash
cd frontend
npm test
```

Expected: both projects run. The `unit` project reports 3 passing tests; the `storybook` project reports 2 passing tests, one per story (`Populated` and `Empty`). A story with no explicit `play` function still passes as a smoke test — it fails if the component throws while rendering.

If the browser fails to launch, run `npx playwright install chromium` again and report the error rather than switching the provider.

- [ ] **Step 7: Prove the story tests actually catch a broken render**

A test that cannot fail is worth nothing. Verify this one can.

Temporarily edit `frontend/src/components/GenericSectionEditor.stories.jsx` — change `packs.find((p) => p.key === "goals")` to `packs.find((p) => p.key === "no-such-pack")`, which makes `pack` undefined so the component throws on `pack.ui`:

```bash
cd frontend
npm run test:storybook
```

Expected: **both** stories FAIL — `goalsPack` is a module-level constant shared by `Populated` and `Empty`, so breaking it breaks both. If only one fails, or neither does, the story tests are not actually rendering the component and something is wrong with the setup. Then revert the edit:

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git checkout frontend/src/components/GenericSectionEditor.stories.jsx
cd frontend && npm run test:storybook
```

Expected: both stories pass again. Record both outcomes in your report.

- [ ] **Step 8: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/vitest.config.js frontend/.storybook frontend/package.json \
        frontend/package-lock.json .gitignore
git commit -m "test: run stories as headless browser tests

addon-vitest executes every story as a Chromium test, so a story and its
test are one artifact and cannot drift. Verified the story tests genuinely
fail on a broken render, not just pass vacuously."
```

---

### Task 5: Wire it into CI

**Files:**
- Modify: `.github/workflows/ci.yml` (the `frontend` job)

**Interfaces:**
- Consumes: the `test` and `test:storybook` scripts from Tasks 2 and 4.
- Produces: a CI job that fails on a failing test.

- [ ] **Step 1: Add the test steps**

In `.github/workflows/ci.yml`, the `frontend` job currently ends with the `Build` step. Add two steps **before** `Build`, so a test failure is reported before a build failure:

```yaml
      - name: Install Playwright browser
        working-directory: frontend
        run: npx playwright install --with-deps chromium

      - name: Test
        working-directory: frontend
        run: npm test
```

Keep the existing `Build` step unchanged and last.

- [ ] **Step 2: Verify the fixtures are not stale**

The generated `packs.json` must match the manifests, or the tests verify a snapshot of a manifest nobody has any more. Add this step immediately after `Install dependencies`:

```yaml
      # packs.json is generated from backend/section_packs/*/manifest.json.
      # If a manifest changes and the fixture is not regenerated, the tests
      # would be checking a shape that no longer exists.
      - name: Check pack fixtures are current
        working-directory: frontend
        run: |
          npm run fixtures
          git diff --exit-code src/__fixtures__/packs.json
```

- [ ] **Step 3: Verify the drift check actually catches drift**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
python3 -c "
import json
p='backend/section_packs/goals/manifest.json'
m=json.load(open(p)); m['description']='DRIFT PROBE'
json.dump(m, open(p,'w'), indent=2)
"
cd frontend && npm run fixtures && git diff --exit-code src/__fixtures__/packs.json; echo "exit=$? (expect non-zero)"
cd /Users/khantthura/Documents/ProjectL/project-twin
git checkout backend/section_packs/goals/manifest.json frontend/src/__fixtures__/packs.json
cd frontend && npm run fixtures && git diff --exit-code src/__fixtures__/packs.json; echo "exit=$? (expect 0)"
```

Expected: non-zero then zero. Record both in your report.

- [ ] **Step 4: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add .github/workflows/ci.yml
git commit -m "ci: run the frontend tests and check fixture drift

Tests run before the build so a test failure is reported as a test
failure. The drift check fails CI if a manifest changes without the
generated fixture being regenerated."
```

---

### Task 6: Ship it

**Files:** none modified.

- [ ] **Step 1: Confirm the Docker image is unaffected**

Storybook and the test tooling are devDependencies. The image runs `npm ci`, which installs them — so verify the build still succeeds and no Storybook output is copied in.

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
docker build -t mygist:wave1 .
docker run --rm --entrypoint sh mygist:wave1 -c 'ls /app/static | head; echo "---"; ls /app/static/assets | wc -l'
```

Expected: the build succeeds, `/app/static` contains `index.html` and `assets/`, and no `storybook-static` directory exists anywhere under `/app`.

- [ ] **Step 2: Push and open the PR**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git push -u origin feature/wave-1-test-harness
gh pr create --title "test: add the frontend test harness (wave 1)" --body "$(cat <<'EOF'
Wave 1 of the section editor consolidation
(`docs/superpowers/specs/2026-07-27-section-editor-consolidation-design.md`).

The frontend had no tests at all. Waves 3-6 rewrite the entire editing
surface of a personal-data app, so this is the net that has to exist first.

### What lands

- **Vitest 4 + Testing Library**, jsdom, as a project named `unit`.
- **Storybook 10**, local and CI only — `storybook-static` is excluded from
  the Docker image.
- **`@storybook/addon-vitest`**, running every story as a headless Chromium
  test, so a story and its test are one artifact and cannot drift.
- **Generated pack fixtures** from `backend/section_packs/*/manifest.json`,
  with a CI drift check, so tests bind to the real manifests rather than a
  hand-copied snapshot.

### The two guards waves 3-6 depend on

- **Coverage** — every stored field is reachable in the rendered UI. A `ui`
  block that forgets a field makes it unsaveable; this catches that.
- **Round-trip** — editing one field preserves every other. Catches
  drop-on-write, which coverage alone cannot.

Both are proven here against the `goals` pack, which already renders
generically.

### Deviation from the spec

The spec put per-section fixtures for all seven legacy sections in this wave.
They move to waves 3-6 instead. A legacy section's stored keys can only be
established by reading its bespoke editor and its `execute_modify` branch —
the same reading that produces its `ui` block. Doing it once, with the
fixture and the `ui` block cross-checking each other, is safer than doing it
twice three waves apart with nothing verifying they agree.

Verified the story tests genuinely fail on a broken render, and the fixture
drift check genuinely fails on a changed manifest — neither passes vacuously.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI**

```bash
gh pr checks --watch
```

Expected: `backend` matrix jobs and `frontend build` all pass. The frontend job now installs Chromium, checks fixture drift, runs 5 tests across two projects, then builds.

- [ ] **Step 4: Hand over for merge**

Report the PR number and CI status. Merging is the human's call.

---

## What this wave does not do

- Change any application behaviour, or touch `App.jsx`, the seven editors, or `GenericSectionEditor.jsx`.
- Build the renderer kit — that is wave 2.
- Add fixtures or tests for the seven legacy sections — those land with their own migrations in waves 3-6.
- Deploy Storybook anywhere.
- Add TypeScript.

## Rollback

Everything here is additive: new files, new devDependencies, new CI steps. Reverting the merge commit removes the harness and leaves the application untouched.
