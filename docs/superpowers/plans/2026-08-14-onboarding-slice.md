# Onboarding Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, skippable, four-step onboarding flow that writes real persona fields, plus a Getting-started card on Profile that resumes it.

**Architecture:** Onboarding is a third route family — `#/onboarding/<step>` — rendered by `App` instead of the shell, never beside it. The flow owns its own data load and its own debounced autosave through the existing `/api/files/{key}` endpoint; the field steps render manifest nodes through the editor's own `FieldsRenderer` and `StringsRenderer`, so onboarding cannot drift from the editor. Progress is stored under a new `onboarding` key on `/api/settings`, because "skipped" is a fact no derived progress count can recover.

**Tech Stack:** React 18, Vite, Tailwind 3, shadcn/ui, Radix, Vitest + Testing Library (frontend); FastAPI, Pydantic, psycopg, pytest (backend).

## Global Constraints

- **No shell during onboarding.** A credentialed reader on `#/onboarding/*` sees no `Header` and no `Rail`. `lib/routes.js` promises in its own header that the route families never appear at once; this slice keeps that promise rather than quietly breaking it.
- **`parseRoute` is not modified.** `#/onboarding/about-you` already parses as `{section: "onboarding", band: "about-you"}`. The step **is** the band.
- **Corrections replace, moves push.** An unknown step is corrected to `welcome` with `goToRoute(..., { replace: true })`. Deliberate Next/Back push.
- **Nothing blocks.** Every step is skippable; leaving mid-step loses nothing because autosave has already written.
- **No onboarding-specific write path.** Saving goes through `PUT /api/files/{key}`, debounced at **1500 ms** — the same constant `App.jsx:469` uses for the editor.
- **Fields reuse the editor's controls.** `FieldsRenderer`, `StringsRenderer`, `ScalarField` — not bespoke inputs. The one exception is Complete's optional extras (Task 8), which append a single list item each and are explicitly justified there.
- **The card says only what it can prove.** A token connection can show `waiting for first call…` → `connected · <label>`; an OAuth grant cannot, and must not claim a call landed.
- **Prose rules.** All comments and copy follow `/Users/khantthura/.claude/skills/no-ai-slop/SKILL.md`. British spelling in user-facing copy, matching the existing manifests (`organisation`, `British English`).
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Correction to the spec, found during planning

The spec (§ "The four screens") says `learning_style.preferred` / `.avoid` "did not resolve in the manifest walk". **They do resolve.** They are `kind: "strings"` nodes at paths `["learning_style", "preferred"]` and `["learning_style", "avoid"]`, inside the `Learning Style` **group** in `backend/section_packs/preferences/manifest.json`. The original walk read `sections[].element.fields` and missed nested nodes, because a group node holds its children under `sections`, not `children`.

They stay **out of the flow** regardless. The approved design is two field steps; `How you like answers` already carries four controls, and six would make it a form rather than a step. This is recorded so the claim in the spec is not left standing as fact. Task 4's `findNode` reaches them, so adding them later is a two-line change, not a rewrite.

## File structure

**Frontend — new**

| File | Responsibility |
| --- | --- |
| `lib/onboardingSteps.js` | The step list and step normalisation. Pure. |
| `components/onboarding/manifestNode.js` | Find a manifest node by pack key and path. Pure. |
| `components/onboarding/connectionStatus.js` | Turn tokens + grants into what step 1 may claim. Pure. |
| `components/onboarding/OnboardingFlow.jsx` | Container: load, autosave, step routing, chrome, skip. |
| `components/onboarding/StepWelcome.jsx` | What this is, the delegate offer, Get started / Skip. |
| `components/onboarding/StepAboutYou.jsx` | Six profile scalars, through `FieldsRenderer`. |
| `components/onboarding/StepHowYouLike.jsx` | tone / locale / detail_level + response_format. |
| `components/onboarding/StepComplete.jsx` | What was filled, optional extras, the way in. |
| `components/GettingStartedCard.jsx` | The spine on Profile. Routes; does not collect. |

**Frontend — modified**

| File | Change |
| --- | --- |
| `lib/routes.js` | Re-export the onboarding helpers beside `isAuthRoute`. |
| `lib/api.js` | `saveOnboarding()`; `getSettings()` already returns the key. |
| `components/WelcomeAuth.jsx` | `onSuccess({ isNew })` so App knows a signup from a sign-in. |
| `App.jsx` | Third render branch, first-run redirect, the card on Profile. |
| `components/ConnectionSettings.jsx` | One control to bring the card back. |

**Backend — modified**

| File | Change |
| --- | --- |
| `settings_store.py` | `get_onboarding()` / `set_onboarding()`. |
| `main.py` | `onboarding` on GET; optional `onboarding` on `SettingsUpdate`, validated. |
| `tests/test_settings_store.py` | Store accessors. |
| `tests/test_settings_api.py` | Round-trip, defaults, rejection cases. |

**Why `lib/onboardingSteps.js` rather than putting it in `lib/routes.js`:** `routes.js` is about reading and writing the address bar and is imported by the auth screens. The step list is onboarding's own vocabulary. `routes.js` re-exports so call sites still have one import for routing, and the pure logic stays testable on its own.

## Test commands

- Frontend, one file: `cd frontend && npx vitest run --project unit src/path/to/file.test.jsx`
- Frontend, unit project: `cd frontend && npx vitest run --project unit`
- Frontend, everything (adds the Storybook browser project): `cd frontend && npm test`
- Backend, one file: `cd backend && ./venv/bin/python -m pytest tests/test_settings_api.py -v`
- Backend, everything: `cd backend && ./venv/bin/python -m pytest -q`

Baseline before this slice: **937 frontend tests** (both projects), **1001 backend passed + 1 skipped**.

---

### Task 1: The step vocabulary

**Files:**
- Create: `frontend/src/lib/onboardingSteps.js`
- Create: `frontend/src/lib/onboardingSteps.test.js`
- Modify: `frontend/src/lib/routes.js` (append after `isAuthRoute`, currently line 33)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ONBOARDING_STEPS: string[]` — `["welcome", "about-you", "how-you-like", "complete"]`
  - `DEFAULT_ONBOARDING_STEP: string` — `"welcome"`
  - `isOnboardingRoute(section: string): boolean`
  - `normaliseStep(step: string | null): string` — a known step unchanged, anything else `"welcome"`
  - `stepIndex(step: string): number` — index in `ONBOARDING_STEPS`, `0` for an unknown step
  - `nextStep(step: string): string | null`, `prevStep(step: string): string | null` — `null` at the ends
  - Re-exported from `lib/routes.js` under the same names.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/onboardingSteps.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  ONBOARDING_STEPS,
  DEFAULT_ONBOARDING_STEP,
  isOnboardingRoute,
  normaliseStep,
  stepIndex,
  nextStep,
  prevStep,
} from "./onboardingSteps";

describe("isOnboardingRoute", () => {
  it.each([
    ["onboarding", true],
    ["profile", false],
    ["review", false],
    ["signin", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (section, expected) => {
    expect(isOnboardingRoute(section)).toBe(expected);
  });
});

describe("normaliseStep", () => {
  it.each(ONBOARDING_STEPS)("keeps the known step %s", (step) => {
    expect(normaliseStep(step)).toBe(step);
  });

  it.each([["nonsense"], [null], [undefined], [""], ["Welcome"]])(
    "corrects %s to welcome",
    (step) => {
      expect(normaliseStep(step)).toBe(DEFAULT_ONBOARDING_STEP);
    },
  );
});

describe("walking the steps", () => {
  it("orders them welcome, about you, how you like, complete", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "welcome",
      "about-you",
      "how-you-like",
      "complete",
    ]);
  });

  it("reports an unknown step as the first one, matching normaliseStep", () => {
    expect(stepIndex("nonsense")).toBe(0);
  });

  it("has no next after the last step and no previous before the first", () => {
    expect(nextStep("complete")).toBe(null);
    expect(prevStep("welcome")).toBe(null);
  });

  it("walks forwards and backwards through the middle", () => {
    expect(nextStep("welcome")).toBe("about-you");
    expect(nextStep("about-you")).toBe("how-you-like");
    expect(prevStep("complete")).toBe("how-you-like");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/lib/onboardingSteps.test.js`
Expected: FAIL — `Failed to resolve import "./onboardingSteps"`.

- [ ] **Step 3: Write the module**

Create `frontend/src/lib/onboardingSteps.js`:

```js
/**
 * Onboarding's own vocabulary.
 *
 * A third route family, `#/onboarding/<step>`. `parseRoute` needs no change to
 * read it: the step IS the band, and `#/onboarding/about-you` already splits
 * into `{section: "onboarding", band: "about-you"}`.
 *
 * Kept out of routes.js -- which is about the address bar, and which the auth
 * screens import -- and re-exported from there, so a call site that only wants
 * routing still has one import while this stays testable on its own.
 */

export const ONBOARDING_STEPS = ["welcome", "about-you", "how-you-like", "complete"];

export const DEFAULT_ONBOARDING_STEP = "welcome";

export function isOnboardingRoute(section) {
  return section === "onboarding";
}

/**
 * A step name we are willing to render.
 *
 * Anything unrecognised -- a typo, a stale bookmark, a null band from
 * `#/onboarding` with nothing after it -- becomes the first step rather than a
 * blank screen. The caller corrects the address bar with `replace`, because
 * nobody navigated to the wrong step and it must not become a history entry.
 */
export function normaliseStep(step) {
  return ONBOARDING_STEPS.includes(step) ? step : DEFAULT_ONBOARDING_STEP;
}

// 0 for an unknown step, so this agrees with normaliseStep rather than
// returning -1 and letting a progress indicator render "step 0 of 4".
export function stepIndex(step) {
  const at = ONBOARDING_STEPS.indexOf(step);
  return at === -1 ? 0 : at;
}

export function nextStep(step) {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null;
}

export function prevStep(step) {
  const at = stepIndex(step);
  return at === 0 ? null : ONBOARDING_STEPS[at - 1];
}
```

- [ ] **Step 4: Re-export from routes.js**

In `frontend/src/lib/routes.js`, immediately after `isAuthRoute` (line 33), add:

```js
// Onboarding's routes live here too, so a call site that already imports
// `isAuthRoute` does not need a second import to ask the matching question.
// The logic itself is in ./onboardingSteps -- see that file's header.
export {
  ONBOARDING_STEPS,
  DEFAULT_ONBOARDING_STEP,
  isOnboardingRoute,
  normaliseStep,
  stepIndex,
  nextStep,
  prevStep,
} from "./onboardingSteps";
```

And amend the file's own header comment: change the "Two families:" block to read

```
 * Three families:
 *
 *   #/profile, #/review, ...   sections of the app, one per tab
 *   #/signin, #/signup, ...    the auth screens
 *   #/onboarding/<step>        the first-run flow
 *
 * They never appear at once. One is what you see with a credential and one is
 * what you see without; the third replaces the shell while it is up, rather
 * than sitting inside it.
```

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run --project unit src/lib/onboardingSteps.test.js src/lib/routes.test.js`
Expected: PASS. (`routes.test.js` must still pass — the re-export must not shadow anything.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/onboardingSteps.js frontend/src/lib/onboardingSteps.test.js frontend/src/lib/routes.js
git commit -m "$(cat <<'EOF'
feat(onboarding): a third route family, with the step as the band

parseRoute already splits #/onboarding/about-you correctly, so this adds a
vocabulary rather than a parser. An unknown step normalises to welcome instead
of rendering blank.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Onboarding state on the settings endpoint

**Files:**
- Modify: `backend/settings_store.py` (append after `set_enabled_optins`, line 60)
- Modify: `backend/main.py:695-746`
- Test: `backend/tests/test_settings_store.py`
- Test: `backend/tests/test_settings_api.py`

**Interfaces:**
- Consumes: `settings_store.get_settings()` / `set_settings(blob)` (existing).
- Produces:
  - `settings_store.ONBOARDING_STEP_KEYS: frozenset[str]` — `{"about-you", "how-you-like"}`
  - `settings_store.ONBOARDING_STATUSES: frozenset[str]` — `{"done", "skipped"}`
  - `settings_store.get_onboarding() -> dict` — always `{"dismissed": bool, "steps": dict[str, str]}`
  - `settings_store.set_onboarding(state: dict) -> None`
  - `GET /api/settings` gains an `onboarding` key of that shape.
  - `SettingsUpdate.onboarding: Optional[dict]`; `PUT /api/settings` echoes `onboarding` in its response.

Only the two **field** steps are storable. `welcome` and `complete` collect nothing, so a status on either would be a fact about a page view, not about the persona.

- [ ] **Step 1: Write the failing store test**

Append to `backend/tests/test_settings_store.py`:

```python
def test_onboarding_defaults_for_an_account_that_predates_it(clean_database):
    with _as_user("onboarding-default-user"):
        assert settings_store.get_onboarding() == {"dismissed": False, "steps": {}}


def test_onboarding_round_trips(clean_database):
    with _as_user("onboarding-roundtrip-user"):
        settings_store.set_onboarding({"dismissed": True, "steps": {"about-you": "done"}})
        assert settings_store.get_onboarding() == {
            "dismissed": True,
            "steps": {"about-you": "done"},
        }


def test_onboarding_does_not_disturb_the_rest_of_the_blob(clean_database):
    with _as_user("onboarding-coexist-user"):
        settings_store.set_disabled_sections(["circle"])
        settings_store.set_onboarding({"dismissed": True, "steps": {}})
        assert settings_store.get_disabled_sections() == {"circle"}


def test_onboarding_repairs_a_blob_written_by_hand(clean_database):
    # The settings blob is free-form on the Python side and nothing stops a
    # future writer -- or a hand-edited row -- leaving a string here. Reading it
    # must produce a usable shape rather than raising in a GET everything else
    # depends on.
    with _as_user("onboarding-junk-user"):
        blob = settings_store.get_settings()
        blob["onboarding"] = "yes"
        settings_store.set_settings(blob)
        assert settings_store.get_onboarding() == {"dismissed": False, "steps": {}}
```

Read the top of `backend/tests/test_settings_store.py` first: it already has a helper that scopes a block to one user. If it is not named `_as_user`, use whatever it is called and drop the import. If there is no such helper, replace each `with _as_user("..."):` with the file's existing setup idiom (registering a user via `db` and setting `db.current_user_id`) — do not invent a second one.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_settings_store.py -v`
Expected: FAIL — `AttributeError: module 'settings_store' has no attribute 'get_onboarding'`.

- [ ] **Step 3: Write the store accessors**

Append to `backend/settings_store.py`, after `set_enabled_optins`:

```python
# The steps that COLLECT something, and are therefore the only ones whose
# status is a fact about the persona. `welcome` and `complete` are pages, and a
# status on either would record a page view.
ONBOARDING_STEP_KEYS = frozenset({"about-you", "how-you-like"})

# `skipped` is stored rather than derived, because it is the one thing a
# progress count over field values cannot recover: a reader who deliberately
# passed a step has not failed it, and both look identical from the data.
ONBOARDING_STATUSES = frozenset({"done", "skipped"})


def get_onboarding() -> dict:
    """Onboarding progress, always in the documented shape.

    Repaired rather than trusted on read: the blob is free-form, so a bad value
    must degrade to "nothing recorded yet" instead of breaking GET /api/settings
    for everything else that shares the response.
    """
    raw = get_settings().get("onboarding")
    if not isinstance(raw, dict):
        return {"dismissed": False, "steps": {}}
    steps = raw.get("steps")
    if not isinstance(steps, dict):
        steps = {}
    return {
        "dismissed": bool(raw.get("dismissed", False)),
        "steps": {
            k: v
            for k, v in steps.items()
            if k in ONBOARDING_STEP_KEYS and v in ONBOARDING_STATUSES
        },
    }


def set_onboarding(state: dict) -> None:
    blob = get_settings()
    blob["onboarding"] = {
        "dismissed": bool(state.get("dismissed", False)),
        "steps": dict(state.get("steps") or {}),
    }
    set_settings(blob)
```

- [ ] **Step 4: Run the store tests**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_settings_store.py -v`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the failing API test**

Append to `backend/tests/test_settings_api.py`:

```python
def test_get_settings_reports_onboarding_defaults(clean_database):
    client, auth = _client_and_auth()
    body = client.get("/api/settings", headers=auth).json()
    assert body["onboarding"] == {"dismissed": False, "steps": {}}


def test_put_settings_persists_onboarding(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/settings",
        json={
            "disabled_sections": [],
            "onboarding": {"dismissed": False, "steps": {"about-you": "done"}},
        },
        headers=auth,
    )
    assert r.status_code == 200
    body = client.get("/api/settings", headers=auth).json()
    assert body["onboarding"] == {"dismissed": False, "steps": {"about-you": "done"}}


def test_put_settings_leaves_onboarding_alone_when_omitted(clean_database):
    # Every existing caller sends only disabled_sections -- App.jsx's togglePack
    # is one -- and none of them may quietly clear progress.
    client, auth = _client_and_auth()
    client.put(
        "/api/settings",
        json={"disabled_sections": [], "onboarding": {"dismissed": True, "steps": {}}},
        headers=auth,
    )
    client.put("/api/settings", json={"disabled_sections": ["circle"]}, headers=auth)
    body = client.get("/api/settings", headers=auth).json()
    assert body["onboarding"]["dismissed"] is True


def test_put_rejects_an_unknown_onboarding_step(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/settings",
        json={"disabled_sections": [], "onboarding": {"steps": {"welcome": "done"}}},
        headers=auth,
    )
    assert r.status_code == 400
    assert "welcome" in r.json()["detail"]


def test_put_rejects_an_unknown_onboarding_status(clean_database):
    client, auth = _client_and_auth()
    r = client.put(
        "/api/settings",
        json={"disabled_sections": [], "onboarding": {"steps": {"about-you": "later"}}},
        headers=auth,
    )
    assert r.status_code == 400
    assert "later" in r.json()["detail"]
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_settings_api.py -v`
Expected: FAIL — `KeyError: 'onboarding'` on the first, and 200 instead of 400 on the rejection cases.

- [ ] **Step 7: Wire the endpoint**

In `backend/main.py`, change `SettingsUpdate` (line 695) to:

```python
class SettingsUpdate(BaseModel):
    disabled_sections: list[str]
    enabled_sections: Optional[list[str]] = None
    # Omitted means "not my business", not "clear it". Every existing caller
    # sends only disabled_sections, and none of them may wipe onboarding
    # progress as a side effect of toggling a section.
    onboarding: Optional[dict] = None
```

In `get_settings` (line 700), add one key to the returned dict, after `"always_on"`:

```python
        "onboarding": settings_store.get_onboarding(),
```

In `update_settings`, immediately before the final `return`:

```python
    if update.onboarding is not None:
        steps = update.onboarding.get("steps") or {}
        if not isinstance(steps, dict):
            raise HTTPException(status_code=400, detail="onboarding.steps must be an object")
        bad_steps = set(steps) - settings_store.ONBOARDING_STEP_KEYS
        if bad_steps:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown onboarding steps: {sorted(bad_steps)}. "
                       f"Storable: {sorted(settings_store.ONBOARDING_STEP_KEYS)}",
            )
        bad_statuses = set(steps.values()) - settings_store.ONBOARDING_STATUSES
        if bad_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown onboarding statuses: {sorted(bad_statuses)}. "
                       f"Valid: {sorted(settings_store.ONBOARDING_STATUSES)}",
            )
        settings_store.set_onboarding(update.onboarding)
```

and change the return statement to include the key:

```python
    return {"status": "saved", "disabled_sections": sorted(requested),
            "enabled_sections": sorted(settings_store.get_enabled_optins()),
            "onboarding": settings_store.get_onboarding()}
```

- [ ] **Step 8: Run both test files**

Run: `cd backend && ./venv/bin/python -m pytest tests/test_settings_api.py tests/test_settings_store.py -v`
Expected: PASS.

- [ ] **Step 9: Run the whole backend suite**

Run: `cd backend && ./venv/bin/python -m pytest -q`
Expected: 1010 passed, 1 skipped. Any other number means something outside this task reads `/api/settings`'s response shape — find it before continuing.

- [ ] **Step 10: Commit**

```bash
git add backend/settings_store.py backend/main.py backend/tests/test_settings_store.py backend/tests/test_settings_api.py
git commit -m "$(cat <<'EOF'
feat(settings): onboarding progress, stored rather than derived

/api/settings was not a general settings store -- PUT accepted two fields and
nothing reached the free-form blob over HTTP. This adds one key end to end.

Stored because `skipped` is the one state a progress count over field values
cannot recover: a step someone deliberately passed looks identical to one they
never reached. Only the two steps that collect anything are storable; a status
on welcome or complete would record a page view.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The client side of onboarding state

**Files:**
- Modify: `frontend/src/lib/api.js` (add beside `proposalCount`, around line 467; export at line 491)
- Test: `frontend/src/lib/onboardingApi.test.js` (create)

**Interfaces:**
- Consumes: `api(path, options)` from `lib/api.js`.
- Produces:
  - `getOnboarding(): Promise<{dismissed: boolean, steps: Record<string, string>}>`
  - `saveOnboarding(state): Promise<void>` — sends `disabled_sections` alongside, because `SettingsUpdate` requires it
  - Both added to the export list at the bottom of `api.js`.

`saveOnboarding` has to send `disabled_sections` because it is a required field on `SettingsUpdate`. Sending the CURRENT value rather than `[]` matters: `[]` would re-enable every section the reader had turned off.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/onboardingApi.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: apiMock };
});

const { getOnboarding, saveOnboarding } = await import("./onboarding.js");

beforeEach(() => {
  apiMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getOnboarding", () => {
  it("returns the stored state", async () => {
    apiMock.mockResolvedValue({
      disabled_sections: [],
      onboarding: { dismissed: true, steps: { "about-you": "done" } },
    });
    await expect(getOnboarding()).resolves.toEqual({
      dismissed: true,
      steps: { "about-you": "done" },
    });
  });

  it("defaults when the server sends no onboarding key at all", async () => {
    // A backend that predates Task 2, or a detached instance pointed at an
    // older server. A missing key is not a broken page.
    apiMock.mockResolvedValue({ disabled_sections: [] });
    await expect(getOnboarding()).resolves.toEqual({ dismissed: false, steps: {} });
  });
});

describe("saveOnboarding", () => {
  it("sends the sections it was given, not an empty list", async () => {
    // disabled_sections is required by SettingsUpdate. Sending [] would turn
    // every section the reader had switched off back on.
    apiMock.mockResolvedValue({ status: "saved" });
    await saveOnboarding({ dismissed: true, steps: {} }, ["circle", "media"]);

    expect(apiMock).toHaveBeenCalledWith("/settings", {
      method: "PUT",
      body: JSON.stringify({
        disabled_sections: ["circle", "media"],
        onboarding: { dismissed: true, steps: {} },
      }),
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/lib/onboardingApi.test.js`
Expected: FAIL — `Failed to resolve import "./onboarding.js"`.

- [ ] **Step 3: Write the module**

Create `frontend/src/lib/onboarding.js`:

```js
/**
 * Reading and writing onboarding progress.
 *
 * A separate file from api.js rather than two more functions in it: api.js is
 * already 518 lines and every credential rule in the app lives there. These two
 * are onboarding's own, and they are the only place that knows onboarding
 * progress rides on the settings endpoint.
 */
import { api } from "./api.js";

export const EMPTY_ONBOARDING = { dismissed: false, steps: {} };

export async function getOnboarding() {
  const settings = await api("/settings");
  const state = settings?.onboarding;
  if (!state || typeof state !== "object") return { ...EMPTY_ONBOARDING };
  return {
    dismissed: !!state.dismissed,
    steps: state.steps && typeof state.steps === "object" ? state.steps : {},
  };
}

/**
 * `disabledSections` is not optional and must be the CURRENT value.
 *
 * SettingsUpdate requires `disabled_sections`, and the endpoint writes whatever
 * it is sent -- so passing `[]` for convenience would re-enable every section
 * the reader had turned off, as a side effect of finishing a step.
 */
export async function saveOnboarding(state, disabledSections) {
  await api("/settings", {
    method: "PUT",
    body: JSON.stringify({
      disabled_sections: disabledSections,
      onboarding: { dismissed: !!state.dismissed, steps: state.steps || {} },
    }),
  });
}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run --project unit src/lib/onboardingApi.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/onboarding.js frontend/src/lib/onboardingApi.test.js
git commit -m "$(cat <<'EOF'
feat(onboarding): client helpers for progress, in their own file

api.js already carries every credential rule in the app; these two functions
are onboarding's own. saveOnboarding takes the current disabled sections rather
than defaulting to [] -- SettingsUpdate requires the field and writes what it is
sent, so a convenience default would silently re-enable sections.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Finding a manifest node by path

**Files:**
- Create: `frontend/src/components/onboarding/manifestNode.js`
- Create: `frontend/src/components/onboarding/manifestNode.test.js`

**Interfaces:**
- Consumes: pack objects as `GET /api/settings` returns them — `{key, title, sections, ...}` — the same shape `App.jsx` already holds in `packs`.
- Produces:
  - `findNode(pack, path: string[]): object | null` — depth-first through `sections`, matching `node.path` exactly
  - `nodeAt(packs, packKey: string, path: string[]): object | null`

Group nodes hold their children under `sections`, not `children` — the same key the top level uses. This is exactly what the original spec walk missed.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/manifestNode.test.js`:

```js
import { describe, it, expect } from "vitest";
import { findNode, nodeAt } from "./manifestNode";
import packs from "@/__fixtures__/packs.json";

describe("findNode", () => {
  it("finds a node declared at the top level", () => {
    const profile = packs.find((p) => p.key === "profile");
    const node = findNode(profile, []);
    expect(node?.kind).toBe("fields");
    expect(node?.element?.entity).toBe("basic_info");
  });

  it("finds a node nested inside a group", () => {
    // Groups hold their children under `sections`, the same key the top level
    // uses -- not `children`. A walk that only reads the top level misses every
    // one of preferences' real nodes.
    const preferences = packs.find((p) => p.key === "preferences");
    const node = findNode(preferences, ["communication", "default"]);
    expect(node?.kind).toBe("fields");
    expect(node.element.fields.map((f) => f.name)).toEqual([
      "tone",
      "locale",
      "detail_level",
    ]);
  });

  it("finds response_format, which is a strings node inside a group", () => {
    const preferences = packs.find((p) => p.key === "preferences");
    const node = findNode(preferences, ["response_format"]);
    expect(node?.kind).toBe("strings");
    expect(node.control).toBe("input");
  });

  it("returns null for a path no node declares", () => {
    const preferences = packs.find((p) => p.key === "preferences");
    expect(findNode(preferences, ["nonsense"])).toBe(null);
  });

  it("survives a pack with no sections at all", () => {
    expect(findNode({ key: "empty" }, ["anything"])).toBe(null);
    expect(findNode(null, [])).toBe(null);
  });
});

describe("nodeAt", () => {
  it("picks the pack by key first", () => {
    const node = nodeAt(packs, "preferences", ["communication", "default"]);
    expect(node?.element?.entity).toBe("communication_default");
  });

  it("returns null when the pack is absent -- a disabled section", () => {
    expect(nodeAt(packs, "not-a-pack", [])).toBe(null);
    expect(nodeAt(null, "profile", [])).toBe(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/manifestNode.test.js`
Expected: FAIL — `Failed to resolve import "./manifestNode"`.

- [ ] **Step 3: Write the module**

Create `frontend/src/components/onboarding/manifestNode.js`:

```js
/**
 * One manifest node, by pack and path.
 *
 * Onboarding renders a handful of specific nodes -- profile's root scalars,
 * preferences' `communication.default` -- rather than a whole section, so it
 * needs to reach into the tree SectionRenderer walks top to bottom.
 *
 * The subtlety, and the reason this is tested rather than inlined: a GROUP node
 * holds its children under `sections`, the same key the pack itself uses for
 * its top level. Nothing in preferences' tree is reachable without recursing
 * through that -- `communication.default`, `response_format` and both
 * `learning_style` lists all sit one level down inside a group.
 *
 * Pure, so it is testable against the real shipped manifests with no DOM.
 */

// `[]` is a real path -- profile's basic_info node addresses the section ROOT.
// So this compares element-by-element rather than testing truthiness, and an
// empty path matches the node that declares an empty one.
function samePath(a, b) {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((seg, i) => seg === right[i]);
}

export function findNode(pack, path) {
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (!node) continue;
      // A group declares no path of its own; only leaves can match. Checking
      // `node.element` is not enough -- a `strings` node has no fields but is
      // still a leaf -- so the kind is what decides.
      if (node.kind !== "group" && samePath(node.path, path)) return node;
      const found = walk(node.sections);
      if (found) return found;
    }
    return null;
  };
  return walk(pack?.sections);
}

export function nodeAt(packs, packKey, path) {
  const pack = (packs || []).find((p) => p?.key === packKey);
  return pack ? findNode(pack, path) : null;
}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/manifestNode.test.js`
Expected: PASS, 7 tests.

If `@/__fixtures__/packs.json` turns out not to carry the full `sections` tree, regenerate it with `cd frontend && npm run fixtures` before assuming the code is wrong — `proposalSummary.test.js` already reads entity specs out of the same file, so it is the right source.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/manifestNode.js frontend/src/components/onboarding/manifestNode.test.js
git commit -m "$(cat <<'EOF'
feat(onboarding): reach one manifest node by pack and path

Onboarding renders specific nodes rather than whole sections. The recursion
matters: a group holds its children under `sections`, the same key the pack uses
for its top level, so everything in preferences sits one level down and a
top-level-only walk finds none of it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: What step 1 is allowed to claim

**Files:**
- Create: `frontend/src/components/onboarding/connectionStatus.js`
- Create: `frontend/src/components/onboarding/connectionStatus.test.js`

**Interfaces:**
- Consumes: `listTokens()` rows `{id, label, created_at, last_used_at, scopes}` and `listConnectedApps()` rows `{id, clientId, clientName, scopes, createdAt}` — both already in `lib/api.js`.
- Produces:
  - `connectionStatus(tokens, grants): {state: "none" | "waiting" | "connected", name: string | null, canPropose: boolean}`
  - `PROPOSE_SCOPES: string[]` — `["persona:propose", "persona:write"]`

The rule the spec fixes, restated so the implementer does not soften it: a **token** whose `last_used_at` is non-null is genuine evidence a client called, because only `db.resolve_token` touches it. An **OAuth grant** is not — OAuth clients authenticate as Better Auth JWTs through `db.resolve_user_by_id`, which the web app itself also uses, so `users.last_seen_at` cannot tell a client call from the reader browsing their own persona. A grant therefore reports `connected`, never `waiting`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/connectionStatus.test.js`:

```js
import { describe, it, expect } from "vitest";
import { connectionStatus } from "./connectionStatus";

const token = (over = {}) => ({
  id: "t1",
  label: "Claude Desktop",
  created_at: "2026-08-01T00:00:00Z",
  last_used_at: null,
  scopes: ["persona:read", "persona:propose"],
  ...over,
});

const grant = (over = {}) => ({
  id: "g1",
  clientId: "c1",
  clientName: "Claude",
  scopes: ["persona:read"],
  createdAt: "2026-08-01T00:00:00Z",
  ...over,
});

describe("connectionStatus", () => {
  it("reports nothing connected when there is nothing", () => {
    expect(connectionStatus([], [])).toEqual({
      state: "none",
      name: null,
      canPropose: false,
    });
  });

  it("waits on a token that has never been used", () => {
    expect(connectionStatus([token()], [])).toEqual({
      state: "waiting",
      name: "Claude Desktop",
      canPropose: true,
    });
  });

  it("confirms a token once it has actually been used", () => {
    // last_used_at is touched only by db.resolve_token, so a non-null value is
    // genuine evidence a client called.
    const used = token({ last_used_at: "2026-08-12T09:00:00Z" });
    expect(connectionStatus([used], [])).toEqual({
      state: "connected",
      name: "Claude Desktop",
      canPropose: true,
    });
  });

  it("never says a grant is waiting, because it cannot know", () => {
    // OAuth clients authenticate as JWTs through db.resolve_user_by_id, which
    // the web app itself uses. Nothing distinguishes a client call from the
    // reader browsing their own persona.
    expect(connectionStatus([], [grant()])).toEqual({
      state: "connected",
      name: "Claude",
      canPropose: false,
    });
  });

  it("reports propose when any one connection has it", () => {
    const readOnly = token({ scopes: ["persona:read"] });
    const proposer = grant({ id: "g2", scopes: ["persona:write"] });
    expect(connectionStatus([readOnly], [proposer]).canPropose).toBe(true);
  });

  it("counts write as carrying propose, matching the scope hierarchy", () => {
    const writer = token({ scopes: ["persona:write"] });
    expect(connectionStatus([writer], []).canPropose).toBe(true);
  });

  it("prefers a used token's name over an unused one", () => {
    const unused = token({ id: "t1", label: "Old" });
    const used = token({ id: "t2", label: "New", last_used_at: "2026-08-12T09:00:00Z" });
    expect(connectionStatus([unused, used], [])).toEqual({
      state: "connected",
      name: "New",
      canPropose: true,
    });
  });

  it("survives nulls, which is what a failed fetch leaves behind", () => {
    expect(connectionStatus(null, null)).toEqual({
      state: "none",
      name: null,
      canPropose: false,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/connectionStatus.test.js`
Expected: FAIL — `Failed to resolve import "./connectionStatus"`.

- [ ] **Step 3: Write the module**

Create `frontend/src/components/onboarding/connectionStatus.js`:

```js
/**
 * What the Getting-started card may say about step 1.
 *
 * The card claims `waiting for first call... -> connected` for one connection
 * type and not the other, and the asymmetry is real rather than an omission:
 *
 *   Token. `tokens.last_used_at` is touched only by `db.resolve_token`, so a
 *     non-null value is genuine evidence that a client called. This gets the
 *     real waiting-then-connected moment.
 *
 *   OAuth grant. OAuth clients authenticate as Better Auth JWTs through
 *     `db.resolve_user_by_id` -- which the WEB APP ITSELF also uses -- so
 *     `users.last_seen_at` cannot distinguish a client call from the reader
 *     browsing their own persona. A grant is therefore reported connected and
 *     named, and never claimed to have made a call.
 *
 * Per-grant call tracking would close the gap and was rejected for this slice:
 * new state, a migration and a write on a hot auth path, to earn one word.
 */

// persona:write implies persona:propose -- backend/scopes.py states the
// hierarchy and expands at the edge. A stored scope set may or may not have
// been expanded already, so both spellings count.
export const PROPOSE_SCOPES = ["persona:propose", "persona:write"];

function carriesPropose(scopes) {
  return (scopes || []).some((s) => PROPOSE_SCOPES.includes(s));
}

export function connectionStatus(tokens, grants) {
  const tokenRows = tokens || [];
  const grantRows = grants || [];

  const canPropose =
    tokenRows.some((t) => carriesPropose(t?.scopes)) ||
    grantRows.some((g) => carriesPropose(g?.scopes));

  // A used token first: it is the only evidence here that a client actually
  // called, and the card's best moment is naming the thing that did.
  const used = tokenRows.find((t) => t?.last_used_at);
  if (used) return { state: "connected", name: used.label || null, canPropose };

  if (grantRows.length > 0) {
    const first = grantRows[0];
    return { state: "connected", name: first.clientName || null, canPropose };
  }

  if (tokenRows.length > 0) {
    return { state: "waiting", name: tokenRows[0].label || null, canPropose };
  }

  return { state: "none", name: null, canPropose: false };
}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/connectionStatus.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/connectionStatus.js frontend/src/components/onboarding/connectionStatus.test.js
git commit -m "$(cat <<'EOF'
feat(onboarding): step 1 says only what it can prove

A token's last_used_at is touched only by db.resolve_token, so it is real
evidence a client called. An OAuth grant authenticates through
db.resolve_user_by_id, which the web app itself uses, so nothing there can tell
a client call from the reader browsing their own persona -- a grant is reported
connected and never waiting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The flow container and Welcome

**Files:**
- Create: `frontend/src/components/onboarding/OnboardingFlow.jsx`
- Create: `frontend/src/components/onboarding/StepWelcome.jsx`
- Create: `frontend/src/components/onboarding/OnboardingFlow.test.jsx`

**Interfaces:**
- Consumes: `ONBOARDING_STEPS`, `normaliseStep`, `stepIndex`, `nextStep`, `prevStep` (Task 1); `getOnboarding`, `saveOnboarding` (Task 3); `api` from `lib/api.js`; `goToRoute`, `parseRoute`, `readRoute` from `lib/routes.js`.
- Produces:
  - `OnboardingFlow({ step, onNavigate, onLeave })` — default export
    - `step: string` — the raw band from the URL; the component normalises it
    - `onNavigate(step: string): void` — the parent writes the address bar and its own state
    - `onLeave(): void` — leave onboarding for Profile
  - `StepWelcome({ onStart, onSkip })` — named export from its own file

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/OnboardingFlow.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: apiMock };
});
vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const OnboardingFlow = (await import("./OnboardingFlow")).default;

beforeEach(() => {
  apiMock.mockReset();
  getOnboardingMock.mockReset();
  saveOnboardingMock.mockReset();
  getOnboardingMock.mockResolvedValue({ dismissed: false, steps: {} });
  saveOnboardingMock.mockResolvedValue(undefined);
  apiMock.mockImplementation((path) => {
    if (path === "/all") return Promise.resolve({ data: { profile: {}, preferences: {} } });
    if (path === "/settings") return Promise.resolve({ disabled_sections: [], packs: [] });
    return Promise.resolve({});
  });
});

describe("OnboardingFlow", () => {
  it("shows Welcome, with the delegate offer above the buttons", async () => {
    render(<OnboardingFlow step="welcome" onNavigate={vi.fn()} onLeave={vi.fn()} />);

    const heading = await screen.findByRole("heading", { name: /welcome to mygist/i });
    expect(heading).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("Get started asks the parent for the next step", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="welcome" onNavigate={onNavigate} onLeave={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /get started/i }));
    expect(onNavigate).toHaveBeenCalledWith("about-you");
  });

  it("Skip for now leaves, and does not pretend a step was done", async () => {
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingFlow step="welcome" onNavigate={vi.fn()} onLeave={onLeave} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));
    expect(onLeave).toHaveBeenCalled();
    expect(saveOnboardingMock).not.toHaveBeenCalled();
  });

  it("corrects an unknown step to welcome rather than rendering blank", async () => {
    render(<OnboardingFlow step="nonsense" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /welcome to mygist/i })).toBeInTheDocument();
  });

  it("shows which step of how many, and Welcome is not counted as work", async () => {
    render(<OnboardingFlow step="about-you" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByText(/step 1 of 3/i)).toBeInTheDocument();
  });

  it("renders no app shell at all", async () => {
    render(<OnboardingFlow step="welcome" onNavigate={vi.fn()} onLeave={vi.fn()} />);
    await screen.findByRole("heading", { name: /welcome to mygist/i });
    // The whole point of the standalone flow. The rail and the header are the
    // two things that must not be here.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/OnboardingFlow.test.jsx`
Expected: FAIL — `Failed to resolve import "./OnboardingFlow"`.

- [ ] **Step 3: Write StepWelcome**

Create `frontend/src/components/onboarding/StepWelcome.jsx`:

```jsx
/**
 * Step zero: what this is, and the offer to not do it yourself.
 *
 * The delegate offer sits ABOVE everything, before any field. It landed below a
 * step's own fields first and was moved deliberately: handing the work to a
 * client is a choice offered before the work, not a consolation found after it.
 */
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

export function StepWelcome({ onStart, onSkip }) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to MyGist</h1>
        <p className="text-muted-foreground leading-relaxed">
          MyGist is one place to keep the context an AI assistant needs about
          you -- your name, your work, how you like answers written -- so you
          stop explaining yourself at the start of every conversation.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/40 p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">You don't have to type any of it</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Connect an assistant and it can fill this in for you, a suggestion
              at a time, for you to approve. The next two steps cover the basics
              if you would rather start now.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onStart} className="sm:w-auto">
          Get started
        </Button>
        <Button variant="ghost" onClick={onSkip} className="sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write OnboardingFlow**

Create `frontend/src/components/onboarding/OnboardingFlow.jsx`:

```jsx
/**
 * The standalone stepped flow. No app shell -- no header, no rail.
 *
 * That absence is the design, not an oversight: this screen is what someone
 * sees before they have any reason to care what the rail contains, and putting
 * the whole navigation around four questions was the version that got reversed.
 *
 * The flow owns its own load and its own save. It writes through the same
 * `PUT /api/files/{key}` the editor uses, debounced by the same 1500 ms, so
 * there is no onboarding-specific write path to keep in step -- and leaving
 * mid-step costs nothing, because there is no "finish" to abandon.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import { normaliseStep, nextStep, prevStep } from "@/lib/onboardingSteps.js";

import { StepWelcome } from "./StepWelcome";

// Welcome explains and Complete congratulates; neither collects anything, so
// counting them would tell someone they have four things to do when they have
// two.
const COUNTED_STEPS = ["about-you", "how-you-like", "complete"];

// The editor's debounce, from App.jsx. Same number on purpose: a reader who
// learns the app's saving rhythm here should find it unchanged afterwards.
const SAVE_DELAY_MS = 1500;

export default function OnboardingFlow({ step, onNavigate, onLeave }) {
  const current = normaliseStep(step);

  const [data, setData] = useState(null);
  const [packs, setPacks] = useState([]);
  const [disabledSections, setDisabledSections] = useState([]);
  const [progress, setProgress] = useState({ dismissed: false, steps: {} });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api("/all").catch(() => ({ data: {} })),
      api("/settings").catch(() => ({ packs: [], disabled_sections: [] })),
      getOnboarding().catch(() => ({ dismissed: false, steps: {} })),
    ]).then(([all, settings, saved]) => {
      if (cancelled) return;
      setData(all?.data || {});
      setPacks(settings?.packs || []);
      setDisabledSections(settings?.disabled_sections || []);
      setProgress(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // One timer per section key. Editing profile and then preferences must not
  // have the second edit cancel the first section's pending write -- a single
  // shared timer would do exactly that, and the loss would be silent.
  const timers = useRef({});
  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
    },
    [],
  );

  const write = useCallback((key, next) => {
    setData((prev) => ({ ...(prev || {}), [key]: next }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      api(`/files/${key}`, { method: "PUT", body: JSON.stringify({ data: next }) }).catch(
        () => {
          // Deliberately quiet. There is no toaster on this screen and no
          // action to offer: the next keystroke schedules another write, and
          // the fields are still on screen either way.
        },
      );
    }, SAVE_DELAY_MS);
  }, []);

  // Flush anything still waiting before the step changes, so moving on cannot
  // outrun the debounce and lose the last thing typed.
  const flush = useCallback(() => {
    for (const [key, timer] of Object.entries(timers.current)) {
      clearTimeout(timer);
      delete timers.current[key];
      const payload = dataRef.current?.[key];
      if (payload === undefined) continue;
      api(`/files/${key}`, { method: "PUT", body: JSON.stringify({ data: payload }) }).catch(
        () => {},
      );
    }
  }, []);

  // `flush` runs from an event handler and must see the latest data without
  // being rebuilt on every keystroke, which would re-run any effect depending
  // on it.
  const dataRef = useRef(data);
  dataRef.current = data;

  const markStep = useCallback(
    (key, status) => {
      setProgress((prev) => {
        const next = { ...prev, steps: { ...prev.steps, [key]: status } };
        saveOnboarding(next, disabledSections).catch(() => {
          // A lost status costs the reader a card that reappears, which is a
          // far smaller failure than a blocked step.
        });
        return next;
      });
    },
    [disabledSections],
  );

  const go = useCallback(
    (to) => {
      flush();
      if (to) onNavigate(to);
      else onLeave();
    },
    [flush, onNavigate, onLeave],
  );

  if (data === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const countedAt = COUNTED_STEPS.indexOf(current);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-10 sm:py-16">
        {countedAt >= 0 && (
          <div className="mb-8 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Step {countedAt + 1} of {COUNTED_STEPS.length}
            </p>
            <div className="flex gap-1.5" role="presentation">
              {COUNTED_STEPS.map((key, i) => (
                <span
                  key={key}
                  className={`h-1 flex-1 rounded-full ${
                    i <= countedAt ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex-1">
          {current === "welcome" && (
            <StepWelcome onStart={() => go("about-you")} onSkip={() => go(null)} />
          )}
        </div>

        {current !== "welcome" && (
          <div className="mt-10 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => go(prevStep(current))}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  markStep(current, "skipped");
                  go(nextStep(current));
                }}
              >
                Skip this step
              </Button>
              <Button
                onClick={() => {
                  markStep(current, "done");
                  go(nextStep(current));
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: the `dataRef` declaration must sit **above** `flush` in the final file — move it up when writing, since `flush` closes over it. The listing above places it after for readability; the implementer should reorder so `const dataRef = useRef(data); dataRef.current = data;` appears directly before `const flush = useCallback(...)`.

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/OnboardingFlow.test.jsx`
Expected: PASS, 6 tests. The `step 1 of 3` test passes because `about-you` is the first counted step; if it reads `step 2 of 4`, `COUNTED_STEPS` still contains `welcome`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/onboarding/OnboardingFlow.jsx frontend/src/components/onboarding/StepWelcome.jsx frontend/src/components/onboarding/OnboardingFlow.test.jsx
git commit -m "$(cat <<'EOF'
feat(onboarding): the standalone flow, and the step that offers to skip the work

No header and no rail: the absent shell is the design, and wrapping four
questions in the whole navigation is the version that got reversed. The delegate
offer sits above everything, because handing the work to a client is a choice
offered before the work rather than a consolation found after it.

One debounce timer per section key -- a shared one would let an edit in
preferences cancel profile's pending write, and lose it silently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The two field steps

**Files:**
- Create: `frontend/src/components/onboarding/StepAboutYou.jsx`
- Create: `frontend/src/components/onboarding/StepHowYouLike.jsx`
- Create: `frontend/src/components/onboarding/steps.test.jsx`
- Modify: `frontend/src/components/onboarding/OnboardingFlow.jsx` (render them)

**Interfaces:**
- Consumes: `nodeAt(packs, packKey, path)` (Task 4); `FieldsRenderer` from `@/renderers/FieldsRenderer`; `StringsRenderer` from `@/renderers/StringsRenderer`; `getAt`/`setAt` from `@/renderers/paths`.
- Produces:
  - `StepAboutYou({ packs, data, onChange })` — `onChange(nextProfileObject)`
  - `StepHowYouLike({ packs, data, onChange })` — `onChange(nextPreferencesObject)`
  - In both, `data` is that ONE section's stored object and `onChange` receives the whole replacement for it.

**The field list, verified against the shipped manifests:**

- About you → pack `profile`, node path `[]`, entity `basic_info`. Its `element.fields` are `name`, `preferred_name`, `current_role`, `organisation`, `location`, `nationality`, `bio`. The spec's six are those minus `nationality`; the node declares seven and `FieldsRenderer` renders what the node declares. **Render all seven** — dropping one would mean either forking the node or filtering fields, and `nationality` is one more optional text box on a step that already has six. Record it in the commit rather than silently diverging from the spec's table.
- How you like answers → pack `preferences`, node path `["communication", "default"]` (fields `tone`, `locale`, `detail_level` — `detail_level` is `type: "longtext"`, so `ScalarField` gives it a textarea), plus node path `["response_format"]`, a `kind: "strings"` node with `control: "input"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/steps.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import packs from "@/__fixtures__/packs.json";

import { StepAboutYou } from "./StepAboutYou";
import { StepHowYouLike } from "./StepHowYouLike";

describe("StepAboutYou", () => {
  it("renders the profile root scalars through the editor's own renderer", async () => {
    render(<StepAboutYou packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Preferred name")).toBeInTheDocument();
    expect(screen.getByLabelText("Current role")).toBeInTheDocument();
    expect(screen.getByLabelText("Organisation")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
    expect(screen.getByLabelText("Bio")).toBeInTheDocument();
  });

  it("hands the whole section back on an edit, keys it does not render included", async () => {
    // The stored profile object carries lists this step never shows. A write
    // that dropped them would delete someone's work history for typing a name.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StepAboutYou
        packs={packs}
        data={{ work_experience: [{ company: "Acme" }] }}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "A");
    expect(onChange).toHaveBeenCalledWith({
      work_experience: [{ company: "Acme" }],
      name: "A",
    });
  });

  it("says nothing is required", () => {
    render(<StepAboutYou packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/nothing here is required/i)).toBeInTheDocument();
  });

  it("renders an explanation rather than throwing when the pack is absent", () => {
    // A disabled section, or a server that does not ship this pack.
    render(<StepAboutYou packs={[]} data={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/not available on this server/i)).toBeInTheDocument();
  });
});

describe("StepHowYouLike", () => {
  it("renders tone, locale and detail level", () => {
    render(<StepHowYouLike packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Tone")).toBeInTheDocument();
    expect(screen.getByLabelText("Locale")).toBeInTheDocument();
    expect(screen.getByLabelText("Detail level")).toBeInTheDocument();
  });

  it("gives detail level a textarea, because the manifest types it longtext", () => {
    render(<StepHowYouLike packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Detail level").tagName).toBe("TEXTAREA");
  });

  it("writes tone under communication.default, not at the root", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StepHowYouLike packs={packs} data={{}} onChange={onChange} />);

    await user.type(screen.getByLabelText("Tone"), "d");
    expect(onChange).toHaveBeenCalledWith({
      communication: { default: { tone: "d" } },
    });
  });

  it("offers response format as editable rows, one statement each", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StepHowYouLike packs={packs} data={{}} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /add response format/i }));
    expect(onChange).toHaveBeenCalledWith({ response_format: [""] });
  });

  it("keeps preferences keys it never renders", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StepHowYouLike
        packs={packs}
        data={{ likes_dislikes: [{ item: "jargon", stance: "dislike" }] }}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Locale"), "B");
    expect(onChange).toHaveBeenCalledWith({
      likes_dislikes: [{ item: "jargon", stance: "dislike" }],
      communication: { default: { locale: "B" } },
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/steps.test.jsx`
Expected: FAIL — `Failed to resolve import "./StepAboutYou"`.

- [ ] **Step 3: Write StepAboutYou**

Create `frontend/src/components/onboarding/StepAboutYou.jsx`:

```jsx
/**
 * The basics, rendered by the editor's own `fields` renderer.
 *
 * Not bespoke inputs. The flow teaches the interface by BEING the interface,
 * and it cannot drift from the editor's design because it is that design: the
 * node it renders is the same one Profile renders, read out of the same
 * manifest.
 */
import { FieldsRenderer } from "@/renderers/FieldsRenderer";

import { nodeAt } from "./manifestNode";

// profile's basic_info node addresses the section ROOT -- its seven keys are
// stored as top-level scalars, which is why the path is empty rather than
// missing.
const PROFILE_ROOT = [];

export function StepAboutYou({ packs, data, onChange }) {
  const node = nodeAt(packs, "profile", PROFILE_ROOT);

  if (!node) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
        <p className="text-muted-foreground">
          This step is not available on this server. Carry on -- you can fill
          this in from Profile whenever it is.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
        <p className="text-muted-foreground">
          Nothing here is required, and everything saves as you type. Fill in
          what is useful and move on.
        </p>
      </div>
      {/* `value` is the whole section object and `onValue` gets the whole
          replacement: FieldsRenderer spreads what is stored on every write, so
          the lists this step never shows -- work experience, education --
          survive an edit rather than being replaced by seven scalars. */}
      <FieldsRenderer
        node={node}
        entity={node.element?.entity}
        value={data}
        onValue={onChange}
        packKey="onboarding-profile"
      />
    </div>
  );
}
```

- [ ] **Step 4: Write StepHowYouLike**

Create `frontend/src/components/onboarding/StepHowYouLike.jsx`:

```jsx
/**
 * How answers should be written.
 *
 * Two nodes rather than one, because the manifest declares two: a `fields` node
 * at `communication.default` (tone, locale, detail level) and a `strings` node
 * at `response_format`. Both are rendered by the editor's renderers, and both
 * are reached with `nodeAt` rather than described a second time here.
 *
 * `learning_style.preferred` and `.avoid` resolve too -- they are `strings`
 * nodes one level down inside the Learning Style group. They are deliberately
 * NOT here: this step already carries four controls, and six would make it a
 * form rather than a step.
 */
import { FieldsRenderer } from "@/renderers/FieldsRenderer";
import { StringsRenderer } from "@/renderers/StringsRenderer";
import { getAt, setAt } from "@/renderers/paths";

import { nodeAt } from "./manifestNode";

const COMMUNICATION_DEFAULT = ["communication", "default"];
const RESPONSE_FORMAT = ["response_format"];

export function StepHowYouLike({ packs, data, onChange }) {
  const communication = nodeAt(packs, "preferences", COMMUNICATION_DEFAULT);
  const responseFormat = nodeAt(packs, "preferences", RESPONSE_FORMAT);

  if (!communication && !responseFormat) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">How you like answers</h1>
        <p className="text-muted-foreground">
          This step is not available on this server. Carry on -- you can fill
          this in from Preferences whenever it is.
        </p>
      </div>
    );
  }

  // Both nodes live at a path inside preferences, so every write goes through
  // the same immutable `setAt` the section root uses: keys outside the path
  // survive by reference rather than being rebuilt.
  const writeAt = (path) => (next) => onChange(setAt(data || {}, path, next));

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">How you like answers</h1>
        <p className="text-muted-foreground">
          Nothing here is required, and everything saves as you type. These
          apply to every assistant you connect.
        </p>
      </div>

      {communication && (
        <FieldsRenderer
          node={communication}
          entity={communication.element?.entity}
          value={getAt(data || {}, COMMUNICATION_DEFAULT)}
          onValue={writeAt(COMMUNICATION_DEFAULT)}
          packKey="onboarding-preferences"
        />
      )}

      {responseFormat && (
        <div className="space-y-2">
          <h2 className="headline-3">{responseFormat.title}</h2>
          <p className="text-sm text-muted-foreground">{responseFormat.description}</p>
          <StringsRenderer
            node={responseFormat}
            items={getAt(data || {}, RESPONSE_FORMAT)}
            onItems={writeAt(RESPONSE_FORMAT)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Render them from the flow**

In `frontend/src/components/onboarding/OnboardingFlow.jsx`, add the imports:

```jsx
import { StepAboutYou } from "./StepAboutYou";
import { StepHowYouLike } from "./StepHowYouLike";
```

and inside the `<div className="flex-1">`, after the `welcome` branch:

```jsx
          {current === "about-you" && (
            <StepAboutYou
              packs={packs}
              data={data.profile || {}}
              onChange={(next) => write("profile", next)}
            />
          )}

          {current === "how-you-like" && (
            <StepHowYouLike
              packs={packs}
              data={data.preferences || {}}
              onChange={(next) => write("preferences", next)}
            />
          )}
```

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/`
Expected: PASS — 10 new tests here plus the 21 from Tasks 4-6.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/onboarding/StepAboutYou.jsx frontend/src/components/onboarding/StepHowYouLike.jsx frontend/src/components/onboarding/steps.test.jsx frontend/src/components/onboarding/OnboardingFlow.jsx
git commit -m "$(cat <<'EOF'
feat(onboarding): the two field steps, through the editor's own renderers

Not bespoke inputs: the nodes rendered here are the ones Profile and
Preferences render, read out of the same manifest, so the flow cannot drift from
the editor's design.

Two notes against the spec's field table. About you renders `nationality` too --
the basic_info node declares seven fields and FieldsRenderer renders what the
node declares; filtering one out would mean forking the node to hide an optional
text box. And `learning_style.preferred`/`.avoid` DO resolve, contrary to the
spec -- they are strings nodes one level down inside a group -- but stay out,
because four controls is a step and six is a form.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Complete, with the optional extras

**Files:**
- Create: `frontend/src/components/onboarding/StepComplete.jsx`
- Create: `frontend/src/components/onboarding/StepComplete.test.jsx`
- Modify: `frontend/src/components/onboarding/OnboardingFlow.jsx`

**Interfaces:**
- Consumes: `data` (the whole `/api/all` payload), `onAdd(sectionKey, path, item)`, `onDone()`.
- Produces: `StepComplete({ data, onAdd, onDone })`.

The two extras are single-item appends, verified against the manifests: `projects.top_of_mind` is a `list` node whose entity is `top_of_mind` with identifier `idea`, and `goals.goals` is a `list` whose entity's title field is `title`. Ids are assigned server-side on write — `useListItems.addItem` also appends bare objects — so the client appends `{idea}` / `{title}` and nothing more.

This is the one place the slice does not reuse a renderer. A `ListRenderer` here would bring search, badges, an add dialog and a remove confirmation to collect one sentence. A labelled input and an Add button is the proportionate control, and it writes the same shape the renderer would.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/StepComplete.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StepComplete } from "./StepComplete";

const filled = {
  profile: { name: "Ada", preferred_name: "", bio: "Builds things." },
  preferences: { communication: { default: { tone: "direct" } } },
};

describe("StepComplete", () => {
  it("counts what was actually filled, not what was offered", () => {
    render(<StepComplete data={filled} onAdd={vi.fn()} onDone={vi.fn()} />);
    // name and bio on profile, tone on preferences. preferred_name is empty and
    // must not be counted -- a count that included it would congratulate
    // someone for a field they skipped.
    expect(screen.getByText(/3 things saved/i)).toBeInTheDocument();
  });

  it("says so plainly when nothing was filled", () => {
    render(<StepComplete data={{}} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeInTheDocument();
  });

  it("appends one top-of-mind idea in the shape the entity declares", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={onAdd} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText(/what is on your mind/i), "Ship the flow");
    await user.click(screen.getByRole("button", { name: /add this/i }));

    expect(onAdd).toHaveBeenCalledWith("projects", ["top_of_mind"], {
      idea: "Ship the flow",
    });
  });

  it("appends one goal by its title field", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={onAdd} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText(/one goal/i), "Learn Rust");
    await user.click(screen.getByRole("button", { name: /add goal/i }));

    expect(onAdd).toHaveBeenCalledWith("goals", ["goals"], { title: "Learn Rust" });
  });

  it("adds nothing for whitespace, and clears the box after a real add", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={onAdd} onDone={vi.fn()} />);

    const box = screen.getByLabelText(/what is on your mind/i);
    await user.type(box, "   ");
    await user.click(screen.getByRole("button", { name: /add this/i }));
    expect(onAdd).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, "Ship it");
    await user.click(screen.getByRole("button", { name: /add this/i }));
    expect(box).toHaveValue("");
  });

  it("has one way into the app", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={vi.fn()} onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: /go to my persona/i }));
    expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/StepComplete.test.jsx`
Expected: FAIL — `Failed to resolve import "./StepComplete"`.

- [ ] **Step 3: Write StepComplete**

Create `frontend/src/components/onboarding/StepComplete.jsx`:

```jsx
/**
 * The last screen: what landed, two optional extras, and the way in.
 *
 * The extras exist because the reversed design had four field bands and this
 * one has two. Rather than lose `top_of_mind` and a goal entirely, they are
 * offered here as a one-line add -- so the flow stays short without the fields
 * disappearing.
 *
 * The one place in this slice that does not reuse a renderer. A ListRenderer
 * would bring search, badges, an add dialog and a remove confirmation to
 * collect one sentence. What it writes is identical: both entities id-assign
 * server-side, and `useListItems.addItem` appends bare objects too.
 */
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A value someone actually gave us. An empty string is a field they passed
// over, and counting it would congratulate them for skipping.
function filledCount(value) {
  if (Array.isArray(value)) return value.length > 0 ? 1 : 0;
  if (value && typeof value === "object") {
    return Object.values(value).reduce((n, v) => n + filledCount(v), 0);
  }
  return String(value ?? "").trim() === "" ? 0 : 1;
}

function OneLineAdd({ id, label, placeholder, buttonLabel, onAdd }) {
  const [text, setText] = useState("");
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onAdd(value);
    setText("");
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button variant="outline" onClick={submit} className="shrink-0">
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

export function StepComplete({ data, onAdd, onDone }) {
  const saved =
    filledCount(data?.profile) + filledCount(data?.preferences?.communication);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <h1 className="text-2xl font-semibold tracking-tight">That's the basics</h1>
        </div>
        <p className="text-muted-foreground">
          {saved > 0
            ? `${saved} things saved. Everything is editable later, and an assistant can fill in the rest.`
            : "Nothing saved yet -- which is fine. You can fill this in whenever, or let an assistant do it."}
        </p>
      </div>

      <div className="space-y-5 rounded-lg border p-4">
        <p className="text-sm font-medium">Two more, if you want them</p>
        <OneLineAdd
          id="onboarding-top-of-mind"
          label="What is on your mind right now?"
          placeholder="e.g. finishing the migration"
          buttonLabel="Add this"
          onAdd={(value) => onAdd("projects", ["top_of_mind"], { idea: value })}
        />
        <OneLineAdd
          id="onboarding-goal"
          label="One goal you are working towards"
          placeholder="e.g. learn Rust properly"
          buttonLabel="Add goal"
          onAdd={(value) => onAdd("goals", ["goals"], { title: value })}
        />
      </div>

      <Button onClick={onDone} className="w-full sm:w-auto">
        Go to my persona
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Render it, and give the flow an append**

In `frontend/src/components/onboarding/OnboardingFlow.jsx`, import it:

```jsx
import { StepComplete } from "./StepComplete";
```

Add the append helper next to `write` — it uses `getAt`/`setAt` so it reaches a path inside a section rather than only its root:

```jsx
  // An optional extra from Complete. Prepends, matching what the list editor
  // does, and goes through `write` so it is saved by the same debounce as
  // everything else on this screen -- there is no second write path.
  const append = useCallback(
    (key, path, item) => {
      const section = dataRef.current?.[key] || {};
      const list = getAt(section, path);
      write(key, setAt(section, path, [item, ...(Array.isArray(list) ? list : [])]));
    },
    [write],
  );
```

with `import { getAt, setAt } from "@/renderers/paths";` at the top, and render the step:

```jsx
          {current === "complete" && (
            <StepComplete data={data} onAdd={append} onDone={() => go(null)} />
          )}
```

Complete has no Continue: `go(null)` leaves for Profile. Hide the Back/Skip/Continue footer on it by changing the footer's condition from `current !== "welcome"` to:

```jsx
        {current !== "welcome" && current !== "complete" && (
```

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run --project unit src/components/onboarding/`
Expected: PASS — 6 new tests plus the 31 already there.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/onboarding/StepComplete.jsx frontend/src/components/onboarding/StepComplete.test.jsx frontend/src/components/onboarding/OnboardingFlow.jsx
git commit -m "$(cat <<'EOF'
feat(onboarding): Complete, with the two fields the shorter flow dropped

The reversed design had four field bands and this one has two, so top_of_mind
and one goal are offered here as a one-line add rather than lost.

The one screen that does not reuse a renderer, deliberately: a ListRenderer
brings search, badges, an add dialog and a remove confirmation to collect one
sentence. What it writes is identical -- both entities id-assign server-side.

The count reads what was actually filled: an empty string is a field someone
passed over, and counting it would congratulate them for skipping.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: App renders the flow, and first run lands on it

**Files:**
- Modify: `frontend/src/App.jsx` (imports; `navigate`, line 257; the section-validation effect, lines 272-286; a new branch before the shell's `return`, line 691)
- Modify: `frontend/src/components/WelcomeAuth.jsx:264`
- Create: `frontend/src/App.onboarding.test.jsx`

**Interfaces:**
- Consumes: `OnboardingFlow` (Tasks 6-8); `isOnboardingRoute`, `normaliseStep`, `DEFAULT_ONBOARDING_STEP` (Task 1).
- Produces: `WelcomeAuth`'s `onSuccess` is called as `onSuccess({ isNew: boolean })`. Every existing call site ignores its argument, so this is additive.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/App.onboarding.test.jsx`. Read the top of `frontend/src/components/ProposalsPanel.test.jsx` first for this repo's mocking idiom and copy it; the assertions below are what matters.

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: apiMock, getAuthToken: () => "test-token" };
});
vi.mock("@/lib/session.js", () => ({ hasSession: () => Promise.resolve(true) }));
vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: () => Promise.resolve({ dismissed: false, steps: {} }),
  saveOnboarding: () => Promise.resolve(),
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const App = (await import("./App")).default;

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path) => {
    if (path === "/all") return Promise.resolve({ data: { profile: {}, preferences: {} } });
    if (path === "/settings") {
      return Promise.resolve({
        disabled_sections: [],
        packs: [{ key: "profile", title: "Profile", core: true, enabled: true, sections: [] }],
        onboarding: { dismissed: false, steps: {} },
      });
    }
    if (path === "/proposals/count") return Promise.resolve({ entity: 0, note: 0, total: 0 });
    return Promise.resolve({});
  });
});

afterEach(() => {
  window.location.hash = "";
});

describe("App on an onboarding route", () => {
  it("renders the flow with no shell around it", async () => {
    window.location.hash = "#/onboarding/welcome";
    render(<App />);

    await screen.findByRole("heading", { name: /welcome to mygist/i });
    // The two things the shell always draws. Their absence IS the feature.
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders the shell on a normal section, so the branch is not sticky", async () => {
    window.location.hash = "#/profile";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("banner")).toBeInTheDocument());
  });

  it("corrects an unknown step in the address bar, without a history entry", async () => {
    window.location.hash = "#/onboarding/nonsense";
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    render(<App />);

    await screen.findByRole("heading", { name: /welcome to mygist/i });
    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
      expect(window.location.hash).toBe("#/onboarding/welcome");
    });
    expect(push).not.toHaveBeenCalled();
    replace.mockRestore();
    push.mockRestore();
  });

  it("does not send an onboarding route through the section validator", async () => {
    // The effect at App.jsx:274 rewrites any section not in the enabled set to
    // profile. Without an exemption it would evict the flow the moment
    // settings resolved -- which is the failure this test exists to catch.
    window.location.hash = "#/onboarding/about-you";
    render(<App />);

    await screen.findByRole("heading", { name: /about you/i });
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe("#/onboarding/about-you");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/App.onboarding.test.jsx`
Expected: FAIL — the shell renders on `#/onboarding/welcome`, so `banner` is found.

- [ ] **Step 3: Exempt onboarding from section validation**

In `frontend/src/App.jsx`, add the imports:

```jsx
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
```

and extend the existing routes import at line 34 to:

```jsx
import {
  DEFAULT_ONBOARDING_STEP,
  goToRoute,
  isAuthRoute,
  isOnboardingRoute,
  normaliseStep,
  parseRoute,
  readRoute,
} from "@/lib/routes.js";
```

Then guard the validation effect (line 274) so it leaves onboarding alone — insert immediately after `if (!enabledKeys) return;`:

```jsx
    // Onboarding is a route family of its own, not a section, so it is not in
    // `valid` and would be rewritten to profile the moment settings resolved.
    // Its own step correction lives in the branch that renders it.
    if (isOnboardingRoute(activeSection)) return;
```

and add `isOnboardingRoute` to that effect's dependency array is unnecessary — it is a module-level import, not state.

- [ ] **Step 4: Add the third render branch**

In `frontend/src/App.jsx`, immediately before `// Review's toasts link to whatever section just changed` (line 668), insert:

```jsx
  // The third render branch. A credential exists and the route names the
  // onboarding family, so the flow replaces the shell entirely -- no header,
  // no rail. `routes.js` promises the families never appear at once, and this
  // is where that promise is kept rather than quietly broken.
  if (isOnboardingRoute(activeSection)) {
    const step = normaliseStep(activeBand);
    // A step nobody navigated to must not become a history entry, which is why
    // this replaces. Same correction the shell already makes for an unknown
    // band, one level up.
    if (step !== activeBand) goToRoute(`onboarding/${step}`, { replace: true });
    return (
      <OnboardingFlow
        step={step}
        onNavigate={(next) => navigate("onboarding", next)}
        onLeave={() => navigate("profile", null)}
      />
    );
  }
```

`navigate` already writes `#/onboarding/about-you` unchanged — it interpolates `` `${section}/${band}` `` — so no new navigation helper is needed.

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run --project unit src/App.onboarding.test.jsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Send new accounts to the flow**

In `frontend/src/components/WelcomeAuth.jsx`, change line 264 from `onSuccess();` to:

```jsx
      // The signup moment is the one thing only this component knows, and it
      // knows it without asking the server anything. App uses it to send a
      // brand-new account to onboarding rather than to an empty Profile.
      onSuccess({ isNew: mode === "signup" });
```

In `frontend/src/App.jsx`, change the `WelcomeAuth` inside the `showingAuth` branch (line 604) to:

```jsx
          <WelcomeAuth
            onUseToken={() => setShowConnectionSettings(true)}
            onSuccess={({ isNew } = {}) => {
              // A brand-new account lands on Welcome, not on an empty Profile:
              // that is the moment intent is highest, and Welcome is where the
              // offer to hand the work to a client is made.
              if (isNew) navigate("onboarding", DEFAULT_ONBOARDING_STEP);
              loadAllData();
              loadSettings();
            }}
          />
```

- [ ] **Step 7: Run the affected suites**

Run: `cd frontend && npx vitest run --project unit src/App.onboarding.test.jsx src/components/WelcomeAuth.test.jsx`
Expected: PASS. If `WelcomeAuth.test.jsx` asserts `onSuccess` was called with no arguments, update that assertion to `toHaveBeenCalledWith({ isNew: false })` — the call site changed, and the test is describing the old call.

- [ ] **Step 8: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS. Any failure outside `src/components/onboarding/` is a real regression in the shell, not a stale expectation — read it before changing it.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/WelcomeAuth.jsx frontend/src/App.onboarding.test.jsx
git commit -m "$(cat <<'EOF'
feat(onboarding): App's third render branch, and first run lands on it

Two-way becomes three: no credential, credential on an onboarding route,
otherwise the shell. The section validator gets an explicit exemption -- without
it the flow is rewritten to profile the moment settings resolve, since
onboarding is a route family rather than a section.

WelcomeAuth now reports whether the success was a signup. It is the one place
that knows, and it knows without asking the server anything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The Getting-started card on Profile

**Files:**
- Create: `frontend/src/components/GettingStartedCard.jsx`
- Create: `frontend/src/components/GettingStartedCard.test.jsx`
- Modify: `frontend/src/App.jsx` (render it above `SectionRenderer` when the section is `profile`)

**Interfaces:**
- Consumes: `connectionStatus` (Task 5); `listTokens`, `listConnectedApps` (`lib/api.js`); `getOnboarding`, `saveOnboarding` (Task 3).
- Produces: `GettingStartedCard({ disabledSections, onStart, onOpenSettings })`.

Three steps, and it **routes rather than collects**. Step 3 is a copy-paste prompt, and the trap it guards is real: `mcp_scopes.py` **hides** out-of-scope tools rather than failing them, so a connection without `persona:propose` makes the pasted prompt do nothing at all, silently. Where propose is absent the card says so and points at reconnecting, instead of offering a copy button that cannot work.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/GettingStartedCard.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listTokensMock = vi.hoisted(() => vi.fn());
const listConnectedAppsMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listTokens: listTokensMock,
    listConnectedApps: listConnectedAppsMock,
  };
});
vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const { GettingStartedCard } = await import("./GettingStartedCard");

beforeEach(() => {
  listTokensMock.mockReset().mockResolvedValue([]);
  listConnectedAppsMock.mockReset().mockResolvedValue([]);
  getOnboardingMock.mockReset().mockResolvedValue({ dismissed: false, steps: {} });
  saveOnboardingMock.mockReset().mockResolvedValue(undefined);
});

const renderCard = (props = {}) =>
  render(
    <GettingStartedCard
      disabledSections={[]}
      onStart={vi.fn()}
      onOpenSettings={vi.fn()}
      {...props}
    />,
  );

describe("GettingStartedCard", () => {
  it("shows three steps and how many are done", async () => {
    renderCard();
    expect(await screen.findByText(/getting started/i)).toBeInTheDocument();
    expect(screen.getByText(/0 of 3/)).toBeInTheDocument();
  });

  it("waits on a token that has never been called", async () => {
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Claude Desktop", last_used_at: null, scopes: ["persona:propose"] },
    ]);
    renderCard();
    expect(await screen.findByText(/waiting for first call/i)).toBeInTheDocument();
  });

  it("names the client once a token has actually been used", async () => {
    listTokensMock.mockResolvedValue([
      {
        id: "t1",
        label: "Claude Desktop",
        last_used_at: "2026-08-12T09:00:00Z",
        scopes: ["persona:propose"],
      },
    ]);
    renderCard();
    expect(await screen.findByText(/connected · Claude Desktop/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for first call/i)).not.toBeInTheDocument();
  });

  it("never claims a grant made a call", async () => {
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:propose"] },
    ]);
    renderCard();
    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for first call/i)).not.toBeInTheDocument();
  });

  it("offers no copy button when the connection cannot propose, and says why", async () => {
    // mcp_scopes.py HIDES out-of-scope tools rather than failing them, so the
    // pasted prompt would do nothing at all, with no error anywhere. Silence is
    // the failure this branch exists to prevent.
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Read only", last_used_at: null, scopes: ["persona:read"] },
    ]);
    renderCard();
    await screen.findByText(/waiting for first call/i);
    expect(screen.queryByRole("button", { name: /copy prompt/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can only read/i)).toBeInTheDocument();
  });

  it("offers the prompt when the connection can propose", async () => {
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Claude", last_used_at: null, scopes: ["persona:propose"] },
    ]);
    renderCard();
    expect(
      await screen.findByRole("button", { name: /copy prompt/i }),
    ).toBeInTheDocument();
  });

  it("Start routes rather than collecting", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    renderCard({ onStart });
    await user.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("dismissing hides the card and records it", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: /dismiss getting started/i }));

    await waitFor(() =>
      expect(saveOnboardingMock).toHaveBeenCalledWith(
        expect.objectContaining({ dismissed: true }),
        [],
      ),
    );
    expect(screen.queryByText(/getting started/i)).not.toBeInTheDocument();
  });

  it("renders nothing at all when it was already dismissed", async () => {
    getOnboardingMock.mockResolvedValue({ dismissed: true, steps: {} });
    const { container } = renderCard();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("stays usable when the token list is forbidden", async () => {
    // listTokens throws for a read-scoped credential -- an OAuth grant, or a
    // token minted without write. That is not a broken page.
    listTokensMock.mockRejectedValue(new Error("read access only"));
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:read"] },
    ]);
    renderCard();
    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/GettingStartedCard.test.jsx`
Expected: FAIL — `Failed to resolve import "./GettingStartedCard"`.

- [ ] **Step 3: Write the card**

Create `frontend/src/components/GettingStartedCard.jsx`:

```jsx
/**
 * The spine card, on Profile. Three steps, and it ROUTES rather than collects.
 *
 * It survived the reversal that turned onboarding into a standalone flow, and
 * it survived deliberately: the flow is where the work happens, and this is
 * where someone finds their way back to it.
 *
 * Dismissing is not destructive. Nothing is deleted -- the flow is a view over
 * fields that already exist, and `#/onboarding/welcome` still works if typed.
 * The card comes back from Connection Settings.
 */
import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listConnectedApps, listTokens } from "@/lib/api.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";

import { connectionStatus } from "./onboarding/connectionStatus";

// What someone pastes into an assistant that already has propose. It asks for
// suggestions rather than writes, which is the whole point: the reader's first
// real task becomes approving rows in Review, and the review mechanic is
// learned on day one instead of being discovered later.
const PROMPT =
  "Read my MyGist persona, then propose updates for anything you know about me " +
  "that is missing -- one compact proposal per fact, with a one-sentence reason.";

export function GettingStartedCard({ disabledSections, onStart, onOpenSettings }) {
  const [state, setState] = useState(null);
  const [connection, setConnection] = useState({
    state: "none",
    name: null,
    canPropose: false,
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOnboarding()
      .then((saved) => {
        if (!cancelled) setState(saved);
      })
      .catch(() => {
        // A card that fails to load its own progress is better hidden than
        // wrong: showing "0 of 3" to someone who finished would be a lie.
        if (!cancelled) setState({ dismissed: true, steps: {} });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      // listTokens throws for a read-scoped credential -- see its comment in
      // api.js. That is a permission, not a failure, so it degrades to "no
      // tokens I can see" rather than taking the card down.
      listTokens().catch(() => []),
      listConnectedApps().catch(() => []),
    ]).then(([tokens, grants]) => {
      if (!cancelled) setConnection(connectionStatus(tokens, grants));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || state.dismissed) return null;

  const connected = connection.state !== "none";
  const basicsDone = state.steps["about-you"] === "done";
  const doneCount = [connected, basicsDone].filter(Boolean).length;

  const dismiss = () => {
    const next = { ...state, dismissed: true };
    setState(next);
    saveOnboarding(next, disabledSections).catch(() => {
      // The card is already gone from this page. A lost write costs one
      // reappearance on the next load, which is a smaller failure than an
      // undismissable card.
    });
  };

  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Getting started</p>
            <p className="text-xs text-muted-foreground">{doneCount} of 3</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            aria-label="Dismiss getting started"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ol className="space-y-3">
          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <StepMark done={connected} n={1} />
              <span className="truncate">Connect a client</span>
            </span>
            {connection.state === "connected" && (
              <span className="shrink-0 text-xs text-muted-foreground">
                connected · {connection.name || "a client"}
              </span>
            )}
            {connection.state === "waiting" && (
              <span className="shrink-0 text-xs text-muted-foreground">
                waiting for first call…
              </span>
            )}
            {connection.state === "none" && (
              <Button variant="outline" size="sm" onClick={onOpenSettings}>
                Connect
              </Button>
            )}
          </li>

          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <StepMark done={basicsDone} n={2} />
              <span className="truncate">Fill in the basics</span>
            </span>
            <Button variant="outline" size="sm" onClick={onStart} className="shrink-0">
              {basicsDone ? "Review" : "Start"}
            </Button>
          </li>

          <li className="space-y-2 text-sm">
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <StepMark done={false} n={3} />
                <span className="truncate">Ask your client to fill in the rest</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">optional</span>
            </span>

            {/* The silent-failure guard. mcp_scopes.py HIDES tools a connection
                is not scoped for rather than failing them, so pasting this
                prompt into a read-only connection does nothing at all, with no
                error anywhere. Offering the button there would be offering a
                button that cannot work. */}
            {connected && !connection.canPropose && (
              <p className="pl-6 text-xs leading-relaxed text-muted-foreground">
                Your connection can only read your persona, so it cannot suggest
                anything.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={onOpenSettings}
                >
                  Reconnect with permission to suggest
                </button>{" "}
                to use this.
              </p>
            )}

            {connected && connection.canPropose && (
              <div className="pl-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(PROMPT);
                    setCopied(true);
                  }}
                >
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy prompt"}
                </Button>
              </div>
            )}
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function StepMark({ done, n }) {
  return done ? (
    <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
  ) : (
    <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">{n}</span>
  );
}
```

- [ ] **Step 4: Run the card's tests**

Run: `cd frontend && npx vitest run --project unit src/components/GettingStartedCard.test.jsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Render it on Profile**

In `frontend/src/App.jsx`, import it:

```jsx
import { GettingStartedCard } from "@/components/GettingStartedCard";
```

and inside `<div className="min-w-0 flex-1">` (line 718), immediately before `{activePack && (`:

```jsx
            {/* Profile only. It is the screen someone lands on, and a card that
                followed them to every section would be an interruption rather
                than a starting point. */}
            {activeSection === "profile" && (
              <GettingStartedCard
                disabledSections={disabledSections}
                onStart={() => navigate("onboarding", DEFAULT_ONBOARDING_STEP)}
                onOpenSettings={() => setShowConnectionSettings(true)}
              />
            )}
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/GettingStartedCard.jsx frontend/src/components/GettingStartedCard.test.jsx frontend/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(onboarding): the spine card on Profile, saying only what it can prove

Step 1 distinguishes a token (last_used_at is real evidence of a call) from an
OAuth grant (nothing can tell a client call from the reader browsing their own
persona), and never claims the second made one.

Step 3 guards a silent failure: mcp_scopes.py hides out-of-scope tools rather
than failing them, so pasting the prompt into a read-only connection does
nothing at all, with no error anywhere. Where propose is absent the card says so
instead of offering a button that cannot work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Bringing the card back

**Files:**
- Modify: `frontend/src/components/ConnectionSettings.jsx` (the `connection` tab, after the auto-save block at lines 547-563)
- Modify: `frontend/src/App.jsx` (pass the two new props)
- Create: `frontend/src/components/ConnectionSettings.onboarding.test.jsx`

**Interfaces:**
- Consumes: `getOnboarding`, `saveOnboarding` (Task 3).
- Produces: `ConnectionSettings` accepts `disabledSections: string[]` (default `[]`).

This is slice 5's file, reached deliberately. The umbrella spec's rule is that footholds are ruled in rather than discovered, and the spec rules this one in: **one control, in the panel the account button at `shell/Header.jsx:112` already opens** — not a header dropdown built for a single item. It sits beside auto-save and follows that block's own precedent, including its note that slice 5 rebuilds this dialog into tabs.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ConnectionSettings.onboarding.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getOnboardingMock = vi.hoisted(() => vi.fn());
const saveOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/onboarding.js", () => ({
  getOnboarding: getOnboardingMock,
  saveOnboarding: saveOnboardingMock,
  EMPTY_ONBOARDING: { dismissed: false, steps: {} },
}));

const { ConnectionSettings } = await import("./ConnectionSettings");

beforeEach(() => {
  getOnboardingMock.mockReset().mockResolvedValue({ dismissed: true, steps: {} });
  saveOnboardingMock.mockReset().mockResolvedValue(undefined);
});

describe("ConnectionSettings, getting-started restore", () => {
  it("offers to bring the card back once it has been dismissed", async () => {
    render(
      <ConnectionSettings
        isOpen
        onClose={vi.fn()}
        onConnectionChange={vi.fn()}
        disabledSections={["circle"]}
      />,
    );
    expect(
      await screen.findByRole("button", { name: /show getting started/i }),
    ).toBeInTheDocument();
  });

  it("offers nothing while the card is still showing", async () => {
    getOnboardingMock.mockResolvedValue({ dismissed: false, steps: {} });
    render(<ConnectionSettings isOpen onClose={vi.fn()} onConnectionChange={vi.fn()} />);
    await waitFor(() => expect(getOnboardingMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /show getting started/i }),
    ).not.toBeInTheDocument();
  });

  it("restores it, keeping the sections the reader had disabled", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionSettings
        isOpen
        onClose={vi.fn()}
        onConnectionChange={vi.fn()}
        disabledSections={["circle"]}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /show getting started/i }));
    await waitFor(() =>
      expect(saveOnboardingMock).toHaveBeenCalledWith(
        expect.objectContaining({ dismissed: false }),
        ["circle"],
      ),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/ConnectionSettings.onboarding.test.jsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Add the control**

In `frontend/src/components/ConnectionSettings.jsx`, add to the imports:

```jsx
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
```

add `disabledSections = [],` to the destructured props (beside `isAutosaveEnabled` at line 84), and add state near the component's other `useState` calls:

```jsx
  // Whether the Getting-started card has been dismissed. Only read to decide
  // whether to OFFER the restore -- there is nothing to say to someone whose
  // card is already on screen.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getOnboarding()
      .then((s) => {
        if (!cancelled) setOnboardingDismissed(!!s.dismissed);
      })
      .catch(() => {
        // Nothing to offer if we cannot tell. The card is either showing
        // already or genuinely unavailable, and a control that might do
        // nothing is worse than no control.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);
```

Then, in the `connection` tab, immediately after the auto-save block's closing `</div>` (line 563):

```jsx
            {/* Dismissing the Getting-started card is not destructive -- nothing
                is deleted, and #/onboarding/welcome still works if typed -- so
                this brings back a card, not data.

                It lands here rather than in a new Account tab for the same
                reason auto-save above does: slice 5 rebuilds this dialog with
                Account / Server / Token tabs, and inventing one now would
                prejudge that structure. The account button in the header
                already opens this panel, which is the route the design calls
                for. */}
            {onboardingDismissed && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">Getting started</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    You dismissed the setup card. Bring it back to pick up where
                    you left off.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setOnboardingDismissed(false);
                    saveOnboarding({ dismissed: false, steps: {} }, disabledSections).catch(
                      () => {
                        // The offer is already gone from this panel; a lost
                        // write costs one more click on the next visit.
                      },
                    );
                  }}
                >
                  Show getting started
                </Button>
              </div>
            )}
```

Note the write sends `steps: {}` rather than the loaded steps — the state loaded here is only `dismissed`. If a later slice needs the steps preserved through a restore, hold the whole object in `onboardingDismissed`'s place. For this slice the steps are recomputed from the persona on the card anyway.

- [ ] **Step 4: Pass the prop from App**

In `frontend/src/App.jsx`, add `disabledSections={disabledSections}` to **every** `<ConnectionSettings ...>` — there are three: inside `showingAuth` (line 613), inside the `error` branch (line 654), and the shell's own (line 807).

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run --project unit src/components/ConnectionSettings.onboarding.test.jsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run everything**

Run: `cd frontend && npm test`
Expected: PASS.
Run: `cd backend && ./venv/bin/python -m pytest -q`
Expected: 1010 passed, 1 skipped.

- [ ] **Step 7: Build**

Run: `cd frontend && npm run build`
Expected: a clean build. This is the step that catches an import that only Vite resolves differently from Vitest.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ConnectionSettings.jsx frontend/src/components/ConnectionSettings.onboarding.test.jsx frontend/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(onboarding): bring the dismissed card back, from where the account button goes

The spec said "the account menu". There is no account menu -- Header.jsx:112 is
an account BUTTON that opens this panel -- so the control lands here, beside
auto-save and for the same stated reason: slice 5 rebuilds this dialog into
tabs, and inventing one now would prejudge it.

Offered only once the card has actually been dismissed. There is nothing to say
to someone whose card is already on screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Manual verification

Automated tests do not see a browser, and the last two slices both shipped defects that 900+ green tests could not catch — a count with no gap beside it, a neutral reject button. Run the preview and look:

1. `#/onboarding/welcome` — no header, no rail, nothing but the flow. The delegate offer sits **above** the buttons.
2. Walk forwards. The progress bar reads `Step 1 of 3` on About you, not `Step 2 of 4`.
3. Type a name, wait two seconds, reload. It is still there.
4. Type into Detail level — it is a **textarea**, not a one-line input.
5. Add two response-format rows; each is its own editable row with a remove button, not a chip.
6. On Complete, add a top-of-mind idea, then go to Projects and confirm it landed at the top of the list.
7. `#/onboarding/nonsense` — corrects to `welcome`, and the back button does **not** walk through the bad step.
8. On Profile, the Getting-started card. Dismiss it; reload; it stays gone. Open Connection Settings and bring it back.
9. Both themes. The `text-success` tick and the muted step numbers have to stay legible in dark mode — that is where the last slice's tint problems showed up.

## Self-review

**Spec coverage.** Routing → Task 1 + Task 9. The four screens → Tasks 6, 7, 8. Delegate offer on Welcome → Task 6. Complete's optional extras → Task 8. Fields reuse the editor's controls → Task 7. The spine card, step 1's two connection types, step 3's silent-failure trap, dismissal → Tasks 5 and 10. Restore from Connection Settings → Task 11. Onboarding state → Tasks 2 and 3. First run → Task 9. Saving → Task 6. Testing → each task's own tests, plus the manual pass. Out of scope stays out: no per-grant call tracking, no learning_style in the flow, no bespoke mobile layout beyond what `max-w-xl` and the `sm:` breakpoints give, no replay of the flow from settings.

**One divergence, stated rather than absorbed.** Task 7 renders `nationality` because the manifest node declares it and `FieldsRenderer` renders what the node declares; filtering it would mean forking the node. The spec's table lists six fields; the flow shows seven.

**One correction to the spec**, at the top of this plan: `learning_style.preferred` / `.avoid` do resolve. They stay out of the flow on scope grounds, not on availability grounds.

**Type consistency.** `normaliseStep` is spelled the same in Tasks 1, 6 and 9. `nodeAt(packs, packKey, path)` has the same argument order in Tasks 4, 7. `connectionStatus(tokens, grants)` returns `{state, name, canPropose}` in Tasks 5 and 10. `saveOnboarding(state, disabledSections)` takes the same two arguments in Tasks 3, 6, 10 and 11. `getOnboarding()` returns `{dismissed, steps}` everywhere.

**Ordering note for Task 6:** `dataRef` must be declared above `flush`, which closes over it. Called out in the task itself.
