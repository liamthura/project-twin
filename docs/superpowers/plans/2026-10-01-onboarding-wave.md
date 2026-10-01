# Onboarding wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first run that ends on your first approved suggestion, with Connect split into three screens, honest status from one server endpoint, driver.js guides, and house-style copy.

**Architecture:** `GET /api/watchtower` (the renamed `/api/usage`) is the one answer to "what is connected and what has it done"; onboarding polls it, the card and Review read it once. Onboarding becomes five routed steps on two paths (`assistant → connect → handover → Review`, or `about-you → complete → Profile`). `lib/guide.js` wraps driver.js and remembers what has been shown in `onboarding.seen` on the server.

**Tech Stack:** FastAPI + psycopg (backend), React 18 + Vite + Tailwind 3 + Radix (frontend), `motion` (installed), `driver.js` 1.8.0 (new), `canvas-confetti` (installed), Vitest + Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-10-01-onboarding-wave-design.md`

**Order:** 1, 2, 3, **8**, 4, 5, 6, 7, 9, 10, 11, 12. Task 8 (`lib/guide.js`) is numbered with the other guide work but lands before Task 4, because Tasks 5 and 7 import it.

## Global Constraints

- Branch `design/wave10-onboarding`; commit per task; push only when Liam asks. Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- UI copy: plain British English, second person, present tense, **no em dashes**, sentence-case headings with no full stop, one or two sentences of body. One word for the thing: **assistant**. Copy comes verbatim from the spec's section 6 tables.
- `{name}` is the assistant you chose, never a default. Something else reads "your assistant" mid-sentence and "Your assistant" at the start.
- Nothing moves under `prefers-reduced-motion`: no transforms, no driver.js animation, no confetti.
- `driver.js` `^1.8.0`; no other new dependency.
- Versions are `0.MINOR.PATCH`, set in both `frontend/package.json` and `FastAPI(version=...)` in `backend/main.py`. This wave is **0.3.0**.
- Never print keys. Never touch the `maya` demo account; throwaway accounts are deleted after use.
- Ponytail (full): reuse what exists, no abstraction with one caller, one runnable check for each non-trivial branch.

## Review Focus

1. **An app whose registered client has no name** (Better Auth's `oauthClient.name` is nullable). Watchtower falls back to the token label, then the activity label, and the screens to "your assistant". Test: Task 1 `test_a_nameless_grant_falls_back`.
2. **The tab hidden while onboarding waits.** Polling must not fetch while hidden and must resume within one tick when shown. Test: Task 3 `skips fetches while the tab is hidden`.
3. **Suggestions already waiting when you reach handover** (a returning person sent from the card). The screen shows "N suggestions waiting" and Review straight away, without asking you to copy first. Test: Task 6 `shows waiting suggestions before anything is copied`.
4. **An instance without assistant sign-in** (`mcp_oauth: false`, the self-hosted default). Every assistant shows the token route; no sign-in copy. Test: Task 5 `shows the token route on an instance without sign-in`.
5. **A guide target that exists but is hidden** (the rail is in the DOM on a phone, just `display:none`). The guide points at the visible element or drops the step. Test: Task 8 `points at the visible element`.

---

### Task 1: `GET /api/watchtower`

**Files:**
- Create: `backend/watchtower.py`
- Modify: `backend/db.py` (add `list_grants` after `list_tokens`, ~line 425)
- Modify: `backend/main.py:716-728` (rename the usage endpoint, add the alias)
- Test: `backend/tests/test_watchtower.py`

**Interfaces:**
- Produces: `GET /api/watchtower` → `{activity: [...], connection: {state, name, kind, can_propose, total}, assistant: {called, read, suggested, last_seen}, pending: {entity, note, total}}`. `GET /api/usage` returns the same body, `deprecated=True`.
- Produces: `watchtower.connection(grants, tokens, rows) -> dict`, `watchtower.summary(rows) -> dict`, `watchtower.report(user_id) -> dict`, `db.list_grants(user_id) -> list[{name, scopes, created_at}]`.

- [ ] **Step 1: Write the failing tests**

```python
"""What is connected, and what it has done: the rules behind GET /api/watchtower."""
import pytest
from fastapi.testclient import TestClient

import db
import main
import mcp_activity
import watchtower

ROW = {"client": "claude-code 2.0.14", "method": "initialize", "tool": None,
       "calls": 1, "first_seen": "2026-10-01T10:00:00+00:00", "last_seen": "2026-10-01T10:00:00+00:00"}


def call(tool, last="2026-10-01T10:05:00+00:00"):
    return {**ROW, "method": "tools/call", "tool": tool, "last_seen": last}


@pytest.mark.nodb
def test_nothing_connected_is_none_whatever_the_activity_says():
    # Activity rows outlive a revoked token, so they alone are not a connection.
    assert watchtower.connection([], [], [ROW]) == {
        "state": "none", "name": None, "kind": None, "can_propose": False, "total": 0}


@pytest.mark.nodb
def test_a_token_is_waiting_until_a_call_is_seen():
    token = {"label": "my assistant", "scopes": ["persona:propose"], "last_used_at": None}
    assert watchtower.connection([], [token], [])["state"] == "waiting"
    assert watchtower.connection([], [token], [ROW])["state"] == "connected"
    # A token used before activity was counted (0008) is evidence too.
    used = {**token, "last_used_at": "2026-09-01T00:00:00+00:00"}
    assert watchtower.connection([], [used], [])["state"] == "connected"


@pytest.mark.nodb
def test_a_grant_is_named_and_says_what_it_may_do():
    grant = {"name": "Claude Code", "scopes": ["persona:read", "persona:propose"]}
    c = watchtower.connection([grant], [], [ROW])
    assert c == {"state": "connected", "name": "Claude Code", "kind": "grant",
                 "can_propose": True, "total": 1}
    reader = {"name": "Reader", "scopes": ["persona:read"]}
    assert watchtower.connection([reader], [], [ROW])["can_propose"] is False


@pytest.mark.nodb
def test_a_nameless_grant_falls_back():
    nameless = {"name": None, "scopes": ["persona:propose"]}
    assert watchtower.connection([nameless], [], [ROW])["name"] == "claude-code"
    token = {"label": "laptop", "scopes": [], "last_used_at": None}
    assert watchtower.connection([nameless], [token], [ROW])["name"] == "laptop"
    assert watchtower.connection([nameless], [], [])["name"] is None


@pytest.mark.nodb
def test_summary_reads_what_the_assistant_did():
    assert watchtower.summary([]) == {"called": False, "read": False, "suggested": False, "last_seen": None}
    s = watchtower.summary([ROW, call("get_context"), call("propose_update", "2026-10-01T10:09:00+00:00")])
    assert s == {"called": True, "read": True, "suggested": True, "last_seen": "2026-10-01T10:09:00+00:00"}
    assert watchtower.summary([ROW, call("whoami")])["read"] is False


def _better_auth_user(conn, user_id):
    conn.execute(
        'insert into better_auth."user" ("id", "name", "email", "emailVerified", "username", "displayUsername")'
        " values (%s, 'u', %s, false, %s, %s)",
        (user_id, f"{user_id}@example.test", f"u-{user_id[:8]}", f"u-{user_id[:8]}"),
    )


def test_list_grants_reads_consents_with_their_client_name(as_user):
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        _better_auth_user(conn, user_id)
        conn.execute('insert into better_auth."oauthClient" ("id", "clientId", "name", "redirectUris")'
                     " values ('c1', 'cid-1', 'Claude Code', '[]')")
        conn.execute('insert into better_auth."oauthConsent" ("id", "clientId", "userId", "scopes", "createdAt", "updatedAt")'
                     """ values ('k1', 'cid-1', %s, '["persona:read", "persona:propose"]', now(), now())""",
                     (user_id,))
    [grant] = db.list_grants(user_id)
    assert grant["name"] == "Claude Code"
    assert grant["scopes"] == ["persona:read", "persona:propose"]


def test_the_endpoint_and_its_old_name(clean_database):
    client = TestClient(main.app)
    token = client.post("/api/auth/register", json={"username": "watch-test"}).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    body = client.get("/api/watchtower", headers=auth).json()
    # Registering mints a token and makes the whoami/registration calls over
    # REST, not MCP, so nothing has called yet.
    assert body["connection"]["state"] == "waiting"
    assert body["assistant"]["called"] is False
    assert body["pending"] == {"entity": 0, "note": 0, "total": 0}
    db.current_user_id.set(client.get("/api/auth/whoami", headers=auth).json()["user_id"])
    mcp_activity.record("claude-code 2.0.14", "tools/call", "get_context")
    body = client.get("/api/watchtower", headers=auth).json()
    assert body["connection"]["state"] == "connected"
    assert body["assistant"]["read"] is True
    assert client.get("/api/usage", headers=auth).json()["connection"] == body["connection"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && pytest tests/test_watchtower.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'watchtower'`

- [ ] **Step 3: Write `backend/watchtower.py`**

```python
"""What is connected to an account, and what it has done: GET /api/watchtower.

The one place the app answers "is an assistant connected". Onboarding's live
status, the Getting started card and Review's empty state all read this, so
they cannot disagree, which they did while each worked it out in the browser.

Connected means a call was seen. A grant exists from the moment it is approved,
before its client calls, and the web app's own requests look like any other
signed-in traffic, so neither is evidence. mcp_activity is: only MCP requests
reach it. Its rows outlive a revoked token, which is why a connection also needs
a grant or a token that still exists.
"""
import db
import mcp_activity
import proposals_store

PROPOSE = frozenset({"persona:propose", "persona:write"})  # write implies propose (scopes.py)
READ_TOOLS = frozenset({"get_context", "search_context", "get_entity", "get_raw"})


def _bare(label):
    """'claude-code 2.0.14' -> 'claude-code': a client's own name without its version."""
    head, _, tail = (label or "").rpartition(" ")
    return head if head and tail[:1].isdigit() else (label or None)


def summary(rows):
    calls = [r for r in rows if r["method"] == "tools/call"]
    return {
        "called": bool(rows),
        "read": any(r["tool"] in READ_TOOLS for r in calls),
        "suggested": any(r["tool"] == "propose_update" for r in calls),
        "last_seen": max((r["last_seen"] for r in rows), default=None),
    }


def connection(grants, tokens, rows):
    """`grants` and `tokens` newest first, as report() passes them."""
    total = len(grants) + len(tokens)
    if not total:
        return {"state": "none", "name": None, "kind": None, "can_propose": False, "total": 0}
    called = bool(rows) or any(t.get("last_used_at") for t in tokens)
    newest = max(rows, key=lambda r: r["last_seen"], default=None)
    name = ((grants[0]["name"] if grants else None)
            or (tokens[0]["label"] if tokens else None)
            or _bare(newest["client"] if newest else None))
    return {
        "state": "connected" if called else "waiting",
        "name": name,
        "kind": "grant" if grants else "token",
        "can_propose": any(PROPOSE & set(c.get("scopes") or []) for c in [*grants, *tokens]),
        "total": total,
    }


def report(user_id):
    rows = mcp_activity.usage(user_id)
    tokens = sorted(db.list_tokens(user_id), key=lambda t: t["created_at"], reverse=True)
    return {
        "activity": rows,
        "connection": connection(db.list_grants(user_id), tokens, rows),
        "assistant": summary(rows),
        "pending": proposals_store.pending_counts(),
    }
```

- [ ] **Step 4: Add `db.list_grants` after `list_tokens`**

```python
def list_grants(user_id: str) -> list[dict]:
    """The apps this account approved over OAuth, newest first: each one's
    registered name (nullable in Better Auth) and the scopes granted.

    Read from Better Auth's tables, as delete_account writes to them. Its ids
    are text and users.id is a uuid, hence the cast."""
    with get_pool().connection() as conn:
        return conn.execute(
            'select k."name" as name, c."scopes" as scopes, c."createdAt" as created_at'
            ' from better_auth."oauthConsent" c'
            ' left join better_auth."oauthClient" k on k."clientId" = c."clientId"'
            ' where c."userId" = %s order by c."createdAt" desc',
            (str(user_id),),
        ).fetchall()
```

- [ ] **Step 5: Replace the usage endpoint in `main.py`** (add `import watchtower` beside `import mcp_activity`)

```python
@app.get("/api/watchtower")
async def watchtower_report():
    """What is connected to this account and what it has done.

    `activity` is every client's counters, as /api/usage always returned:
    method names, tool names and the client's own label, nothing from arguments.
    `connection`, `assistant` and `pending` are worked out from them, the
    account's grants and tokens, and the review queue (see watchtower.py).
    """
    return watchtower.report(db.current_user_id.get())


@app.get("/api/usage", deprecated=True)
async def usage():
    """Renamed /api/watchtower in 0.3.0. Answers for one more release."""
    return watchtower.report(db.current_user_id.get())
```

Update `mcp_activity.py`'s two docstring mentions of `/api/usage` to `/api/watchtower`.

- [ ] **Step 6: Run the tests**

Run: `cd backend && pytest tests/test_watchtower.py tests/test_mcp_activity.py -q`
Expected: PASS. If the endpoint test's first assertion fails because registration counts as a call, check `mcp_activity` rows after register; only `/mcp` requests should record.

- [ ] **Step 7: Commit**

```bash
git add backend/watchtower.py backend/db.py backend/main.py backend/mcp_activity.py backend/tests/test_watchtower.py
git commit -m "feat: /api/watchtower says what is connected and what it has done"
```

---

### Task 2: `onboarding.seen` and pack defaults

**Files:**
- Modify: `backend/settings_store.py:64-101`
- Modify: `backend/main.py` (new `POST /api/onboarding/seen`; `defaults` in `/api/settings` packs)
- Modify: `backend/sections.py:85-97` (`defaults` in `PACK_META`)
- Modify: `frontend/src/lib/onboarding.js`
- Modify: `frontend/src/__fixtures__/packs.json` (regenerate, see Step 5)
- Test: `backend/tests/test_settings_api.py`

**Interfaces:**
- Produces: `GET /api/settings` → `onboarding.seen: string[]`; each pack carries `defaults` (the manifest's).
- Produces: `POST /api/onboarding/seen {key}` → `{seen: string[]}`; 400 for a key not matching `^[a-z0-9:-]{1,48}$`.
- Produces (frontend): `getOnboarding() -> {dismissed, steps, seen}`, `markSeen(key) -> Promise<void>`, `EMPTY_ONBOARDING = {dismissed: false, steps: {}, seen: []}`.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_settings_api.py`, reusing its client/auth fixture; read the top of the file for the fixture name)

```python
def test_seen_is_remembered_once_and_survives_other_writes(clean_database):
    client = TestClient(main.app)
    token = client.post("/api/auth/register", json={"username": "seen-test"}).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/settings", headers=auth).json()["onboarding"]["seen"] == []
    for key in ("guide:editor", "guide:editor", "hint:promote"):
        assert client.post("/api/onboarding/seen", headers=auth, json={"key": key}).status_code == 200
    assert client.post("/api/onboarding/seen", headers=auth, json={"key": "Bad Key!"}).status_code == 400
    # The card's dismiss sends dismissed and steps; it must not wipe seen.
    client.put("/api/settings", headers=auth,
               json={"disabled_sections": [], "onboarding": {"dismissed": True, "steps": {}}})
    onboarding = client.get("/api/settings", headers=auth).json()["onboarding"]
    assert onboarding["seen"] == ["guide:editor", "hint:promote"]
    assert onboarding["dismissed"] is True


@pytest.mark.nodb
def test_seen_is_repaired_on_read():
    assert settings_store._seen(None) == []
    assert settings_store._seen(["a", "a", 5, "NO", "b:c"]) == ["a", "b:c"]
    assert len(settings_store._seen([f"k{i}" for i in range(40)])) == settings_store.MAX_SEEN


def test_settings_packs_carry_their_defaults(clean_database):
    client = TestClient(main.app)
    token = client.post("/api/auth/register", json={"username": "defaults-test"}).json()["token"]
    packs = client.get("/api/settings", headers={"Authorization": f"Bearer {token}"}).json()["packs"]
    prefs = next(p for p in packs if p["key"] == "preferences")
    assert prefs["defaults"]["communication"]["default"]["locale"] == "British English"
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && pytest tests/test_settings_api.py -q -k "seen or defaults"`
Expected: FAIL, `KeyError: 'seen'`

- [ ] **Step 3: `settings_store.py`** (add `import re`)

```python
# Guides and hints already shown (frontend/src/lib/guide.js). Kept here rather
# than in the browser so a second device does not replay them. The pattern is
# the contract; no list of keys is mirrored on the server.
SEEN_KEY = re.compile(r"^[a-z0-9:-]{1,48}$")
MAX_SEEN = 32


def _seen(raw) -> list[str]:
    """Repaired, never trusted: anything that is not a short key goes, repeats
    go, and the list stops at MAX_SEEN."""
    out = []
    for key in raw if isinstance(raw, list) else []:
        if isinstance(key, str) and SEEN_KEY.match(key) and key not in out:
            out.append(key)
    return out[:MAX_SEEN]
```

In `get_onboarding`, return `"seen": _seen(raw.get("seen"))` in both branches (`[]` when `raw` is not a dict). Replace `set_onboarding` and add `add_seen`:

```python
def set_onboarding(state: dict) -> None:
    blob = get_settings()
    stored = blob.get("onboarding") if isinstance(blob.get("onboarding"), dict) else {}
    blob["onboarding"] = {
        "dismissed": bool(state.get("dismissed", False)),
        "steps": dict(state.get("steps") or {}),
        # Only ever grows, and only through add_seen: a stale copy of the card's
        # state must not un-see a guide.
        "seen": _seen(stored.get("seen")),
    }
    set_settings(blob)


def add_seen(key: str) -> list[str]:
    blob = get_settings()
    stored = blob.get("onboarding") if isinstance(blob.get("onboarding"), dict) else {}
    seen = _seen([*_seen(stored.get("seen")), key])
    blob["onboarding"] = {"dismissed": False, "steps": {}, **stored, "seen": seen}
    set_settings(blob)
    return seen
```

- [ ] **Step 4: `main.py` and `sections.py`**

In `sections.py` `PACK_META`, add `"defaults": m["defaults"],`. In `main.py` `/api/settings` packs, add `"defaults": meta["defaults"],`. Then:

```python
class SeenRequest(BaseModel):
    key: str


@app.post("/api/onboarding/seen")
async def onboarding_seen(body: SeenRequest):
    """Remember a guide or hint as shown, for this account on every device."""
    if not settings_store.SEEN_KEY.match(body.key):
        raise HTTPException(status_code=400, detail="key must be 1-48 of a-z, 0-9, ':' and '-'")
    return {"seen": settings_store.add_seen(body.key)}
```

- [ ] **Step 5: Frontend `lib/onboarding.js`, and the packs fixture**

```js
export const EMPTY_ONBOARDING = { dismissed: false, steps: {}, seen: [] };

export async function getOnboarding() {
  const settings = await api("/settings");
  const state = settings?.onboarding;
  if (!state || typeof state !== "object") return { ...EMPTY_ONBOARDING };
  return {
    dismissed: !!state.dismissed,
    steps: state.steps && typeof state.steps === "object" ? state.steps : {},
    seen: Array.isArray(state.seen) ? state.seen : [],
  };
}

/** A guide or hint has been shown. See lib/guide.js. */
export async function markSeen(key) {
  await api("/onboarding/seen", { method: "POST", body: JSON.stringify({ key }) });
}
```

`test_pack_fixture_current.py` compares `frontend/src/__fixtures__/packs.json` with the server. Read that test for its regeneration command and run it, so the fixture gains `defaults`.

- [ ] **Step 6: Run the tests**

Run: `cd backend && pytest tests/test_settings_api.py tests/test_pack_fixture_current.py -q` and `cd frontend && npx vitest run src/lib`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/settings_store.py backend/main.py backend/sections.py backend/tests/test_settings_api.py frontend/src/lib/onboarding.js frontend/src/__fixtures__/packs.json
git commit -m "feat: remember shown guides per account, and serve pack defaults"
```

---

### Task 3: `lib/watchtower.js`

**Files:**
- Create: `frontend/src/lib/watchtower.js`
- Test: `frontend/src/lib/watchtower.test.js`

**Interfaces:**
- Consumes: `GET /api/watchtower` (Task 1).
- Produces: `getWatchtower() -> Promise<report>`, `useWatchtower({active}) -> report|null`, `atStart(name, fallback = "your assistant") -> string`, constants `FAST_MS = 3000`, `SLOW_MS = 10000`, `SLOW_AFTER_MS = 120000`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api.js", () => ({ api: apiMock }));
const { useWatchtower, atStart, FAST_MS, SLOW_MS, SLOW_AFTER_MS } = await import("./watchtower.js");

const visibility = (v) => Object.defineProperty(document, "visibilityState", { value: v, configurable: true });

beforeEach(() => {
  vi.useFakeTimers();
  apiMock.mockReset().mockResolvedValue({ connection: { state: "none" } });
  visibility("visible");
});
afterEach(() => vi.useRealTimers());

describe("useWatchtower", () => {
  it("fetches once when not active", async () => {
    renderHook(() => useWatchtower());
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS * 3));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("/watchtower");
  });

  it("polls fast, then slow after two minutes", async () => {
    renderHook(() => useWatchtower({ active: true }));
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS * 2));
    expect(apiMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(SLOW_AFTER_MS));
    const before = apiMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(SLOW_MS - 1));
    expect(apiMock.mock.calls.length - before).toBeLessThanOrEqual(1);
  });

  it("skips fetches while the tab is hidden", async () => {
    renderHook(() => useWatchtower({ active: true }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    visibility("hidden");
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS * 3));
    expect(apiMock).toHaveBeenCalledTimes(1);
    visibility("visible");
    await act(() => vi.advanceTimersByTimeAsync(FAST_MS));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});

describe("atStart", () => {
  it("capitalises a name that opens a sentence, and falls back", () => {
    expect(atStart("my assistant")).toBe("My assistant");
    expect(atStart(null)).toBe("Your assistant");
    expect(atStart("Cursor")).toBe("Cursor");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/lib/watchtower.test.js`
Expected: FAIL, cannot resolve `./watchtower.js`

- [ ] **Step 3: Write `lib/watchtower.js`**

```js
/**
 * What is connected, and what it has done: GET /api/watchtower.
 *
 * One endpoint for every screen that asks, so onboarding, the Getting started
 * card and Review's empty state cannot disagree about whether an assistant is
 * connected. The rules are the server's (backend/watchtower.py).
 */
import { useEffect, useState } from "react";

import { api } from "./api.js";

export const FAST_MS = 3000;
export const SLOW_MS = 10000;
export const SLOW_AFTER_MS = 120000;

export function getWatchtower() {
  return api("/watchtower");
}

/** A name that opens a sentence: a token labelled "my assistant" reads "My assistant". */
export function atStart(name, fallback = "your assistant") {
  const n = (name || "").trim() || fallback;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * The latest report. While `active`, asks every 3 s, then every 10 s after two
 * minutes, and not at all while the tab is hidden. Not active, it asks once.
 */
export function useWatchtower({ active = false } = {}) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let timer;
    const started = Date.now();
    const tick = async () => {
      if (document.visibilityState !== "hidden") {
        try {
          const next = await getWatchtower();
          if (!cancelled) setReport(next);
        } catch {
          // The next tick asks again; a screen that is waiting keeps waiting.
        }
      }
      if (cancelled || !active) return;
      timer = setTimeout(tick, Date.now() - started > SLOW_AFTER_MS ? SLOW_MS : FAST_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active]);
  return report;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/lib/watchtower.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/watchtower.js frontend/src/lib/watchtower.test.js
git commit -m "feat: useWatchtower polls what is connected while a screen waits"
```

---

### Task 4: Steps, the flow, and the first screen

**Files:**
- Rewrite: `frontend/src/lib/onboardingSteps.js`, `frontend/src/components/onboarding/OnboardingFlow.jsx`, `frontend/src/components/onboarding/ClientPicker.jsx`
- Create: `frontend/src/components/onboarding/StepAssistant.jsx`
- Modify: `frontend/src/lib/routes.js:38-50` (re-exports), `frontend/src/lib/clients.js` (the Claude row), `frontend/src/App.jsx` (`onLeave`, `onStart`)
- Test: rewrite `steps.test.jsx`, `OnboardingFlow.test.jsx`, `ClientPicker.test.jsx`

**Interfaces:**
- Consumes: `useWatchtower` (Task 3).
- Produces: `ONBOARDING_STEPS = ["assistant","connect","handover","about-you","complete"]`, `DEFAULT_ONBOARDING_STEP = "assistant"`, `PHASE_COUNT = 3`, `NEEDS_CLIENT: Set`, `phaseOf(step) -> 0|1|2`, `normaliseStep`, `isOnboardingRoute`. Removed: `STORABLE_STEPS`, `isStorableStep`, `stepIndex`, `nextStep`, `prevStep`.
- Produces: `OTHER_CLIENT = {id: "other", name: "Something else", kind: "other"}`; `ClientPicker({clients, onChoose(id)})`; `StepAssistant({onChoose, onTypeMyself, onSkip})`.
- Produces: `OnboardingFlow({step, onNavigate(step), onLeave({to?, tour?})})`. Later tasks render `StepConnect({client, report, onBack, onContinue})`, `StepHandover({client, report, onReview, onTypeMyself, onLater})`, `StepAboutYou({..., saveState, onRetry, onBack, onLater, onContinue})`, `StepComplete({added, report, onAdd, onDone})` from it. This task wires all five; Tasks 5 to 7 change the steps' insides.

- [ ] **Step 1: Write the failing tests**

`steps.test.jsx` (replace the routing part of the file):

```js
import { describe, it, expect } from "vitest";
import { ONBOARDING_STEPS, normaliseStep, phaseOf, NEEDS_CLIENT } from "@/lib/onboardingSteps.js";

describe("onboarding steps", () => {
  it("has five steps on three phases", () => {
    expect(ONBOARDING_STEPS).toEqual(["assistant", "connect", "handover", "about-you", "complete"]);
    expect(ONBOARDING_STEPS.map(phaseOf)).toEqual([0, 0, 1, 1, 2]);
  });
  it("sends old and unknown steps somewhere real", () => {
    expect(normaliseStep("welcome")).toBe("assistant");
    expect(normaliseStep("how-you-like")).toBe("about-you");
    expect(normaliseStep("nonsense")).toBe("assistant");
    expect(normaliseStep(undefined)).toBe("assistant");
  });
  it("knows which steps need a chosen assistant", () => {
    expect([...NEEDS_CLIENT]).toEqual(["connect", "handover"]);
  });
});
```

`OnboardingFlow.test.jsx` (keep the existing mock block, add `vi.mock("@/lib/watchtower.js", () => ({ useWatchtower: () => null, atStart: (n, f = "your assistant") => { const s = n || f; return s[0].toUpperCase() + s.slice(1); } }))` and `getInstance` in the api mock resolving `{ mcp_oauth: true }`; `beforeEach(() => sessionStorage.clear())`):

```js
it("opens on the choice of assistant, with nothing chosen", async () => {
  render(<OnboardingFlow step="assistant" onNavigate={vi.fn()} onLeave={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Which assistant do you use?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /something else/i })).toBeInTheDocument();
});

it("choosing an assistant remembers it and moves on", async () => {
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  render(<OnboardingFlow step="assistant" onNavigate={onNavigate} onLeave={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: /cursor/i }));
  expect(onNavigate).toHaveBeenCalledWith("connect");
  expect(sessionStorage.getItem("mygist_onboarding_client")).toBe("cursor");
});

it("a step that needs an assistant shows the choice when none is chosen", async () => {
  render(<OnboardingFlow step="handover" onNavigate={vi.fn()} onLeave={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Which assistant do you use?" })).toBeInTheDocument();
});

it("keeps the chosen assistant across a reload", async () => {
  sessionStorage.setItem("mygist_onboarding_client", "codex");
  render(<OnboardingFlow step="connect" onNavigate={vi.fn()} onLeave={vi.fn()} />);
  // Task 5 makes this "Connect Codex"; here it is enough that the choice is not asked again.
  await waitFor(() => expect(screen.queryByRole("progressbar") ?? document.body).toBeInTheDocument());
  expect(screen.queryByRole("heading", { name: "Which assistant do you use?" })).not.toBeInTheDocument();
});

it("Skip for now leaves, and I'll type it myself goes to About you", async () => {
  const onLeave = vi.fn();
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  render(<OnboardingFlow step="assistant" onNavigate={onNavigate} onLeave={onLeave} />);
  await user.click(await screen.findByRole("button", { name: "I'll type it myself" }));
  expect(onNavigate).toHaveBeenCalledWith("about-you");
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  expect(onLeave).toHaveBeenCalled();
});
```

Keep the existing About you save tests (one timer per section, flush on leave), changing the step navigation they click through to the new buttons.

`ClientPicker.test.jsx`:

```js
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientPicker } from "./ClientPicker";
import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";
import { OTHER_CLIENT } from "./StepAssistant";

describe("ClientPicker", () => {
  it("lists each assistant with its effort, and reports the choice", async () => {
    const onChoose = vi.fn();
    render(<ClientPicker clients={[...INSTALLABLE_CLIENTS, OTHER_CLIENT]} onChoose={onChoose} />);
    expect(screen.getByRole("button", { name: /cursor.*one click/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /something else.*paste a prompt, or use a token/i })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /^claude\b/i }));
    expect(onChoose).toHaveBeenCalledWith("claude-desktop");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/components/onboarding src/lib`
Expected: FAIL (no `phaseOf`, no `StepAssistant`)

- [ ] **Step 3: `lib/onboardingSteps.js`** (keep the file header, update its step list)

```js
// Five steps on two paths. With an assistant: assistant, connect, handover,
// then Review. Typing it yourself: about-you, complete, then Profile.
export const ONBOARDING_STEPS = ["assistant", "connect", "handover", "about-you", "complete"];

// Steps that no longer have a page of their own, and where they went.
const RETIRED_STEPS = { welcome: "assistant", "how-you-like": "about-you" };

export const DEFAULT_ONBOARDING_STEP = "assistant";

// The progress bar's three parts: Connect, Fill in, and the end.
const PHASE = { assistant: 0, connect: 0, handover: 1, "about-you": 1, complete: 2 };
export const PHASE_COUNT = 3;

// Steps about the assistant you chose. With none chosen they show the choice.
export const NEEDS_CLIENT = new Set(["connect", "handover"]);

export function isOnboardingRoute(section) {
  return section === "onboarding";
}

export function normaliseStep(step) {
  if (ONBOARDING_STEPS.includes(step)) return step;
  return RETIRED_STEPS[step] ?? DEFAULT_ONBOARDING_STEP;
}

export function phaseOf(step) {
  return PHASE[normaliseStep(step)];
}
```

`routes.js` re-exports only `ONBOARDING_STEPS, DEFAULT_ONBOARDING_STEP, isOnboardingRoute, normaliseStep`. Grep for the removed names (`grep -rn "STORABLE_STEPS\|isStorableStep\|stepIndex\|nextStep\|prevStep" frontend/src`) and delete their test cases.

- [ ] **Step 4: `lib/clients.js`, the Claude row** (spec section 6, "The Claude row")

```js
  {
    // The id predates the rename: stored picks and tests use it.
    id: "claude-desktop",
    name: "Claude",
    slug: "claude",
    mark: hasMark("claude"),
    kind: "steps",
    // claude.ai and the desktop app share an account's connectors. Checked
    // against https://claude.com/docs/connectors/custom/remote-mcp, 2026-10-01.
    install: () => [
      "In Claude, open Customize, then Connectors.",
      "Choose Add custom connector, and paste the address below.",
      "Choose Add. Claude opens MyGist for you to sign in. Approve it, and keep the permission to suggest changes.",
    ],
    note:
      "On a Team or Enterprise plan, an Owner adds it in Organization settings, then Connectors. " +
      "The Free plan allows one custom connector.",
  },
```

- [ ] **Step 5: `ClientPicker.jsx`** (rewrite; keep a short header saying rows are choices now, one per screen)

```jsx
import { AppWindow, ChevronRight, MoreHorizontal, Terminal } from "lucide-react";

import { MagicCard } from "@/components/ui/magic-card";

const EFFORT = {
  deeplink: "One click",
  command: "One command",
  steps: "A few steps",
  other: "Paste a prompt, or use a token",
};

// A client with no logo file gets an icon for how it installs, not a letter
// in a box, which read as a placeholder.
const KIND_ICON = { command: Terminal, steps: AppWindow, deeplink: AppWindow, other: MoreHorizontal };

function Mark({ client }) {
  if (client.mark) {
    return <img src={`/landing/logos/${client.slug}.svg`} alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />;
  }
  const Icon = KIND_ICON[client.kind];
  return <Icon aria-hidden="true" className="h-5 w-6 shrink-0 text-muted-foreground" />;
}

export function ClientPicker({ clients, onChoose }) {
  return (
    <ul className="space-y-2">
      {clients.map((client) => (
        <li key={client.id}>
          <MagicCard>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-3 text-left coarse:min-h-14"
              onClick={() => onChoose(client.id)}
            >
              <Mark client={client} />
              <span className="flex-1 text-sm font-medium">{client.name}</span>
              <span className="text-xs text-muted-foreground">{EFFORT[client.kind]}</span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </MagicCard>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: `StepAssistant.jsx`**

```jsx
/**
 * Which assistant do you use? The first of the three Connect screens.
 *
 * Connect used to ask three things at once (which assistant, how to connect
 * it, who fills it in) with eleven actions and no filled button. This asks the
 * first, and choosing a row is the answer, so the screen needs no button of
 * its own.
 */
import { Button } from "@/components/ui/button";
import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";

import { ClientPicker } from "./ClientPicker";

// The last row: the paste-in prompt and the token route. Sentences name it
// "your assistant", never "Something else".
export const OTHER_CLIENT = { id: "other", name: "Something else", kind: "other" };

// Every listed assistant is a desktop app or a terminal tool (lib/clients.js).
const onPhone = () => !!globalThis.matchMedia?.("(pointer: coarse) and (max-width: 639px)").matches;

export function StepAssistant({ onChoose, onTypeMyself, onSkip }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Which assistant do you use?</h1>
        <p className="max-w-prose text-muted-foreground">
          Connect it once, and it can read your persona and suggest what to add for you to approve.
        </p>
      </div>
      {onPhone() && (
        <p className="text-sm text-muted-foreground">
          Most assistants connect from a computer. Open {window.location.host} there, or type the
          basics here for now.
        </p>
      )}
      <ClientPicker clients={[...INSTALLABLE_CLIENTS, OTHER_CLIENT]} onChoose={onChoose} />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onTypeMyself}>
          I'll type it myself
        </Button>
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: `OnboardingFlow.jsx`** (rewrite; keep the header's "no app shell" and "one write path" paragraphs)

```jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api.js";
import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";
import { NEEDS_CLIENT, PHASE_COUNT, normaliseStep, phaseOf } from "@/lib/onboardingSteps.js";
import { useWatchtower } from "@/lib/watchtower.js";
import { getAt, setAt } from "@/renderers/paths";

import { OTHER_CLIENT, StepAssistant } from "./StepAssistant";
import { StepConnect } from "./StepConnect";
import { StepHandover } from "./StepHandover";
import { StepAboutYou } from "./StepAboutYou";
import { StepHowYouLike } from "./StepHowYouLike";
import { StepComplete } from "./StepComplete";

// The editor's debounce, from App.jsx, so the saving rhythm is the same.
const SAVE_DELAY_MS = 1500;
// Kept for the tab, so a reload on Connect still knows which assistant.
const CLIENT_KEY = "mygist_onboarding_client";
const COMMUNICATION = ["communication", "default"];

const clientById = (id) => [...INSTALLABLE_CLIENTS, OTHER_CLIENT].find((c) => c.id === id) || null;

function browserLocale() {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(navigator.language) || null;
  } catch {
    return null;
  }
}

/**
 * What you typed in this flow: fields that differ from what was loaded and are
 * not empty, plus anything added on Complete. A default the server filled in
 * (British English) was there before you arrived, so it does not count.
 */
export function countAdded(before, after) {
  const changed = (a = {}, b = {}) =>
    Object.keys(b).filter((k) => typeof b[k] !== "object" && String(b[k] ?? "").trim() && b[k] !== a[k]).length;
  const grew = (a, b) => Math.max(0, (b?.length || 0) - (a?.length || 0));
  return (
    changed(before?.profile, after?.profile) +
    changed(getAt(before?.preferences || {}, COMMUNICATION), getAt(after?.preferences || {}, COMMUNICATION)) +
    grew(before?.projects?.top_of_mind, after?.projects?.top_of_mind) +
    grew(before?.goals?.goals, after?.goals?.goals)
  );
}

export default function OnboardingFlow({ step, onNavigate, onLeave }) {
  const reduce = useReducedMotion();
  const [clientId, setClientId] = useState(() => sessionStorage.getItem(CLIENT_KEY));
  const client = clientById(clientId);
  const requested = normaliseStep(step);
  const current = NEEDS_CLIENT.has(requested) && !client ? "assistant" : requested;
  const report = useWatchtower({ active: NEEDS_CLIENT.has(current) });

  const [data, setData] = useState(null);
  const [packs, setPacks] = useState([]);
  const [saveState, setSaveState] = useState(null);
  const loaded = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api("/all").catch(() => ({ data: {} })),
      api("/settings").catch(() => ({ packs: [] })),
    ]).then(([all, settings]) => {
      if (cancelled) return;
      loaded.current = all?.data || {};
      setData(all?.data || {});
      setPacks(settings?.packs || []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dataRef = useRef(data);
  dataRef.current = data;

  // One timer per section key, so editing profile and then preferences does
  // not cancel the first write. `failed` is what Retry sends again.
  const timers = useRef({});
  const failed = useRef(new Set());
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const send = useCallback((key) => {
    const payload = dataRef.current?.[key];
    if (payload === undefined) return;
    setSaveState("saving");
    api(`/files/${key}`, { method: "PUT", body: JSON.stringify({ data: payload }) }).then(
      () => {
        failed.current.delete(key);
        setSaveState(failed.current.size ? "error" : "saved");
      },
      () => {
        failed.current.add(key);
        setSaveState("error");
      },
    );
  }, []);

  const write = useCallback(
    (key, next) => {
      dataRef.current = { ...(dataRef.current || {}), [key]: next };
      setData(dataRef.current);
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        delete timers.current[key];
        send(key);
      }, SAVE_DELAY_MS);
    },
    [send],
  );

  // Moving on cannot outrun the debounce and lose the last thing typed.
  const flush = useCallback(() => {
    for (const [key, timer] of Object.entries(timers.current)) {
      clearTimeout(timer);
      delete timers.current[key];
      send(key);
    }
  }, [send]);

  const retry = useCallback(() => [...failed.current].forEach(send), [send]);

  // Prepends, matching the list editor, through the same debounce.
  const append = useCallback(
    (key, path, item) => {
      const section = dataRef.current?.[key] || {};
      const list = getAt(section, path);
      write(key, setAt(section, path, [item, ...(Array.isArray(list) ? list : [])]));
    },
    [write],
  );

  const go = (to, leave) => {
    flush();
    if (to) onNavigate(to);
    else onLeave(leave);
  };

  const choose = (id) => {
    sessionStorage.setItem(CLIENT_KEY, id);
    setClientId(id);
    go("connect");
  };

  if (data === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  // The locale starts from the browser's language while it is still the
  // manifest default, and is written when you continue, so a value you saw and
  // kept is saved and one you never saw is not.
  const defaultLocale = packs.find((p) => p.key === "preferences")?.defaults?.communication?.default?.locale;
  const storedLocale = getAt(data.preferences || {}, [...COMMUNICATION, "locale"]);
  const suggested = browserLocale();
  const shownLocale = defaultLocale && storedLocale === defaultLocale && suggested && suggested !== defaultLocale ? suggested : null;

  const phase = phaseOf(current);
  // Typing it yourself never passes through Connect, so its segment stays empty.
  const skippedConnect = !client && phase > 0;

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-10 sm:py-16">
        <div className="mb-8">
          <span className="sr-only">Step {phase + 1} of {PHASE_COUNT}</span>
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: PHASE_COUNT }, (_, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full origin-left bg-primary transition-transform duration-300 ease-standard motion-reduce:transition-none ${
                    i <= phase && !(skippedConnect && i === 0) ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </span>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current}
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
          >
            {current === "assistant" && (
              <StepAssistant onChoose={choose} onTypeMyself={() => go("about-you")} onSkip={() => go(null)} />
            )}
            {current === "connect" && (
              <StepConnect client={client} report={report} onBack={() => go("assistant")} onContinue={() => go("handover")} />
            )}
            {current === "handover" && (
              <StepHandover
                client={client}
                report={report}
                onReview={() => go(null, { to: "review" })}
                onTypeMyself={() => go("about-you")}
                onLater={() => go(null)}
              />
            )}
            {current === "about-you" && (
              <StepAboutYou
                packs={packs}
                data={data.profile || {}}
                onChange={(next) => write("profile", next)}
                saveState={saveState}
                onRetry={retry}
                onOfferAssistant={() => go("assistant")}
                onBack={() => go(client ? "handover" : "assistant")}
                onLater={() => go(null)}
                onContinue={() => {
                  if (shownLocale) {
                    write("preferences", setAt(data.preferences || {}, [...COMMUNICATION, "locale"], shownLocale));
                  }
                  go("complete");
                }}
              >
                <StepHowYouLike
                  packs={packs}
                  data={data.preferences || {}}
                  locale={shownLocale}
                  onChange={(next) => write("preferences", next)}
                />
              </StepAboutYou>
            )}
            {current === "complete" && (
              <StepComplete
                added={countAdded(loaded.current, data)}
                report={report}
                onAdd={append}
                onDone={() => go(null, { tour: true })}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
```

Until Tasks 5 to 7 land, `StepConnect`, `StepHandover`, `StepAboutYou` and `StepComplete` ignore the new props they do not know yet; create `StepHandover.jsx` here as `export function StepHandover() { return null; }` so the import resolves, and Task 6 fills it.

- [ ] **Step 8: `App.jsx`**

```jsx
// state, beside the other useState calls
const [tourPending, setTourPending] = useState(null); // null | "first" | "force"

// the onboarding branch
<OnboardingFlow
  step={step}
  onNavigate={(next) => navigate("onboarding", next)}
  onLeave={({ to, tour } = {}) => {
    if (tour) setTourPending("first");
    navigate(to || "profile", null);
  }}
/>
```

Task 9 consumes `tourPending`. The card's `onStart` becomes `onStart={(step) => navigate("onboarding", step)}` in Task 7.

- [ ] **Step 9: Run the tests**

Run: `cd frontend && npx vitest run`
Expected: PASS except tests owned by Tasks 5 to 7 that assert the old Connect, About you or Complete copy; delete or rewrite those in their tasks. Note any other failure and fix it here.

- [ ] **Step 10: Commit**

```bash
git add -A frontend/src
git commit -m "feat: onboarding opens on the choice of assistant, on two paths"
```

---

### Task 5: Connect the chosen assistant

**Files:**
- Rewrite: `frontend/src/components/onboarding/StepConnect.jsx`, `StepConnect.test.jsx`
- Modify: `frontend/src/components/onboarding/InstallCard.jsx` (ledes, `note`, wrapping), `InstallCard.test.jsx`

**Interfaces:**
- Consumes: report shape (Task 1), `atStart` (Task 3), `OTHER_CLIENT` (Task 4), `startTour` (Task 8, which lands first).
- Produces: `StepConnect({client, report, onBack, onContinue})`; `StatusLine({state: "done"|"waiting"|"warn", children})` exported for Task 6.

- [ ] **Step 1: Write the failing tests** (`StepConnect.test.jsx`, replacing the old file)

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getInstanceMock = vi.hoisted(() => vi.fn());
const createTokenMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api.js", async (orig) => ({
  ...(await orig()),
  getInstance: getInstanceMock,
  createToken: createTokenMock,
  mcpUrl: () => "https://example.test/mcp",
}));
vi.mock("@/lib/guide.js", () => ({ startTour: vi.fn(async () => false) }));

const { StepConnect } = await import("./StepConnect");
const { INSTALLABLE_CLIENTS } = await import("@/lib/clients.js");
const { OTHER_CLIENT } = await import("./StepAssistant");
const cursor = INSTALLABLE_CLIENTS.find((c) => c.id === "cursor");

const report = (state, extra = {}) => ({ connection: { state, name: null, can_propose: true, ...extra }, assistant: {}, pending: { total: 0 } });
const renderStep = (props) => render(<StepConnect client={cursor} report={null} onBack={vi.fn()} onContinue={vi.fn()} {...props} />);

beforeEach(() => {
  getInstanceMock.mockReset().mockResolvedValue({ mcp_oauth: true });
  createTokenMock.mockReset().mockResolvedValue({ token: "mg_secret_value" });
});

describe("StepConnect", () => {
  it("names the assistant you chose and waits for it", async () => {
    renderStep();
    expect(await screen.findByRole("heading", { name: "Connect Cursor" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Cursor to connect…");
    expect(screen.getByRole("button", { name: "Continue without waiting" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
  });

  it("says so once it is connected, by the name it connected with", async () => {
    const onContinue = vi.fn();
    renderStep({ report: report("connected", { name: "Cursor (work)" }), onContinue });
    expect(await screen.findByRole("status")).toHaveTextContent("Cursor (work) is connected.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("warns when the connection can only read", async () => {
    renderStep({ report: report("connected", { can_propose: false }) });
    expect(await screen.findByRole("status")).toHaveTextContent(/can only read/);
  });

  it("shows the token route on an instance without sign-in", async () => {
    getInstanceMock.mockResolvedValue({ mcp_oauth: false });
    renderStep();
    expect(await screen.findByRole("button", { name: "Create a token" })).toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it("Something else offers the prompt, then a token that keeps its steps", async () => {
    const user = userEvent.setup();
    renderStep({ client: OTHER_CLIENT });
    expect(await screen.findByRole("heading", { name: "Connect your assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy prompt" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "My assistant needs a token" }));
    await user.click(screen.getByRole("button", { name: "Create a token" }));
    expect(await screen.findByText("mg_secret_value")).toBeInTheDocument();
    expect(screen.getByText("Copy the token now")).toBeInTheDocument();
    expect(screen.getByText(/add an MCP server with the address below/)).toBeInTheDocument();
    expect(createTokenMock).toHaveBeenCalledWith("my assistant", ["persona:propose"]);
    await user.click(screen.getByRole("button", { name: "I've copied it" }));
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for your assistant to connect…");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/components/onboarding/StepConnect.test.jsx`
Expected: FAIL (old component)

- [ ] **Step 3: `InstallCard.jsx`**

- Deeplink lede: `This opens {client.name} and adds MyGist. Sign in when it asks, and keep the permission to suggest changes.`
- Command lede: `Run this in a terminal. {client.name} then opens MyGist in your browser for you to sign in.`
- Ledes and the Steps list move from `text-xs` to `text-sm`, with `max-w-prose`.
- After the steps block: `{client.note && <p className="max-w-prose text-sm text-muted-foreground">{client.note}</p>}`.
- The Terminal gets `className="[&_pre]:whitespace-pre-wrap [&_code]:break-all"`, so a command wraps on a phone instead of cutting off.
Update `InstallCard.test.jsx`'s copy assertions to match.

- [ ] **Step 4: `StepConnect.jsx`** (rewrite)

```jsx
/**
 * Connect the assistant you chose: the second Connect screen.
 *
 * One assistant, full width, then a status line that follows it. The line is
 * watchtower's (backend/watchtower.py): connected means a call was seen, so
 * signing in from another window is noticed here without a reload, and a
 * connection that can only read says so.
 *
 * Something else holds the two routes the list cannot: a prompt for an
 * assistant that can add a server itself, and a token for one that cannot sign
 * in. The token's three steps stay beside it once it is shown, because that is
 * the moment someone needs to know where it goes. An instance without
 * assistant sign-in (AUTH_MCP_RESOURCE unset) has only the token route.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createToken, docsUrl, getInstance, mcpUrl } from "@/lib/api.js";
import { startTour } from "@/lib/guide.js";
import { cn } from "@/lib/utils";
import { atStart } from "@/lib/watchtower.js";

import { AddressRow, CopyButton, InstallCard, Steps } from "./InstallCard";
import { installPrompt } from "./installPrompt";

// Suggest, and not write: the first connection from here can only propose.
// persona:read is added server-side (db.create_token).
const FIRST_TOKEN_SCOPES = ["persona:propose"];

const TOKEN_STEPS = [
  "Create a token. It can read your persona and suggest changes, and it cannot change anything without your approval.",
  "In your assistant, add an MCP server with the address below.",
  "Paste the token where it asks for one. Some assistants call it an API key.",
];

const ICON = { done: Check, waiting: Loader2, warn: AlertTriangle };

/** One line that says where things stand, and fades when it changes. */
export function StatusLine({ state, children }) {
  const Icon = ICON[state];
  return (
    <p role="status" className="flex items-start gap-2 text-sm">
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          state === "done" && "text-success",
          state === "waiting" && "animate-spin text-muted-foreground motion-reduce:animate-none",
          state === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      />
      <span key={String(children)} className="animate-in fade-in duration-200 motion-reduce:animate-none">
        {children}
      </span>
    </p>
  );
}

function CopyRow({ id, label, value }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <output id={id} className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
          {value}
        </output>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

export function StepConnect({ client, report, onBack, onContinue }) {
  const [tokenOnly, setTokenOnly] = useState(null);
  const [wantsToken, setWantsToken] = useState(false);
  const [token, setToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getInstance()
      .then((i) => !cancelled && setTokenOnly(!i?.mcp_oauth))
      .catch(() => !cancelled && setTokenOnly(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    startTour("guide:token", [
      {
        element: '[data-guide="token"]',
        popover: { title: "Copy the token now", description: "It's shown once. Paste it into your assistant before you continue." },
      },
    ]);
  }, [token]);

  if (tokenOnly === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  const other = client.kind === "other";
  const chosen = other ? null : client.name;
  const address = mcpUrl();
  const connection = report?.connection;
  const connected = connection?.state === "connected";
  const name = (connected && connection.name) || chosen;
  const tokenRoute = tokenOnly || (other && wantsToken);
  const showStatus = connected || !tokenRoute || copied;

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      setToken((await createToken("my assistant", FIRST_TOKEN_SCOPES)).token);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{other ? "Connect your assistant" : `Connect ${chosen}`}</h1>

      {!tokenRoute && !other && <InstallCard client={client} url={address} />}

      {!tokenRoute && other && (
        <div className="space-y-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            If your assistant can add an MCP server, paste this into it and it sets MyGist up itself.
          </p>
          <p className="rounded-md bg-muted p-3 text-sm leading-relaxed">{installPrompt(address)}</p>
          <CopyButton value={installPrompt(address)} label="Copy prompt" variant="default">
            Copy prompt
          </CopyButton>
        </div>
      )}

      {other && !tokenOnly && (
        <button
          type="button"
          aria-expanded={wantsToken}
          className="tap-target text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => setWantsToken((v) => !v)}
        >
          My assistant needs a token
        </button>
      )}

      {tokenRoute && (
        <div className="space-y-4">
          <Steps items={TOKEN_STEPS} />
          {!token ? (
            <>
              <Button onClick={generate} disabled={generating} aria-label={generating ? "Creating a token" : undefined}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Create a token"}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </>
          ) : (
            <>
              <AddressRow id="onboarding-address" url={address} />
              <div data-guide="token">
                <CopyRow id="onboarding-token" label="Token" value={token} />
              </div>
              <div role="note" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="font-medium">Copy the token now</p>
                  <p className="text-muted-foreground">It's shown once. If you lose it, create another in Settings → Connections.</p>
                </div>
              </div>
              {!copied && <Button onClick={() => setCopied(true)}>I've copied it</Button>}
            </>
          )}
        </div>
      )}

      {showStatus &&
        (connected && connection.can_propose ? (
          <StatusLine state="done">{atStart(name)} is connected.</StatusLine>
        ) : connected ? (
          <StatusLine state="warn">
            {atStart(name)} is connected, but it can only read. Reconnect it and keep "Suggest changes for your approval" ticked.
          </StatusLine>
        ) : (
          <StatusLine state="waiting">Waiting for {name || "your assistant"} to connect…</StatusLine>
        ))}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button variant="ghost" className="-ml-3" onClick={onBack}>
          Back
        </Button>
        {connected ? (
          <Button onClick={onContinue}>Continue</Button>
        ) : (
          <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onContinue}>
            Continue without waiting
          </Button>
        )}
      </div>

      <a
        href={docsUrl(tokenRoute ? "/use/clients/#connecting-with-a-token" : "/use/clients/#connecting-over-oauth")}
        target="_blank"
        rel="noreferrer"
        className="tap-target flex w-fit items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Need help connecting {name || "your assistant"}?
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </div>
  );
}
```

`InstallCard.jsx` must export `AddressRow` (it defines it; add `export` if missing) and `CopyButton` must accept `variant` (it already passes it through for Copy link; check).

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run src/components/onboarding`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/components/onboarding
git commit -m "feat: Connect shows one assistant and follows it until it calls"
```

---

### Task 6: Hand it over

**Files:**
- Rewrite: `frontend/src/components/onboarding/StepHandover.jsx`
- Modify: `frontend/src/components/onboarding/autofillPrompt.js`
- Test: `frontend/src/components/onboarding/StepHandover.test.jsx`

**Interfaces:**
- Consumes: `StatusLine` (Task 5), `atStart` (Task 3), `AUTOFILL_PROMPT`.
- Produces: `StepHandover({client, report, onReview, onTypeMyself, onLater})`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/guide.js", () => ({ startTour: vi.fn(async () => false) }));
const { StepHandover } = await import("./StepHandover");
const { INSTALLABLE_CLIENTS } = await import("@/lib/clients.js");
const codex = INSTALLABLE_CLIENTS.find((c) => c.id === "codex");

const report = ({ read = false, pending = 0, can_propose = true } = {}) => ({
  connection: { state: "connected", name: null, can_propose },
  assistant: { read },
  pending: { total: pending },
});
const renderStep = (props) =>
  render(<StepHandover client={codex} report={report()} onReview={vi.fn()} onTypeMyself={vi.fn()} onLater={vi.fn()} {...props} />);

describe("StepHandover", () => {
  it("asks you to copy the prompt, then to paste it", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    renderStep();
    expect(screen.getByRole("heading", { name: "Let Codex fill it in" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(screen.getByRole("status")).toHaveTextContent("Paste it into Codex. Suggestions appear here as they arrive.");
  });

  it("says when the assistant is reading", () => {
    renderStep({ report: report({ read: true }) });
    expect(screen.getByRole("status")).toHaveTextContent("Codex is reading your persona…");
  });

  it("shows waiting suggestions before anything is copied", async () => {
    const onReview = vi.fn();
    renderStep({ report: report({ pending: 3 }), onReview });
    expect(screen.getByRole("status")).toHaveTextContent("3 suggestions waiting.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Review 3 suggestions" }));
    expect(onReview).toHaveBeenCalled();
  });

  it("explains a connection that can only read, and offers no prompt", () => {
    renderStep({ report: report({ can_propose: false }) });
    expect(screen.getByRole("status")).toHaveTextContent(/can only read your persona/);
    expect(screen.queryByRole("button", { name: "Copy prompt" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/components/onboarding/StepHandover.test.jsx`
Expected: FAIL (the stub renders nothing)

- [ ] **Step 3: `autofillPrompt.js`** — the constant becomes:

```js
export const AUTOFILL_PROMPT =
  "Read my MyGist persona. Then propose updates for anything you know about me " +
  "that is missing or wrong. If you can see the project I'm working in, include " +
  "my stack and tools from it. Send one proposal per fact, include only the " +
  "fields that change, and give a one-sentence reason for each.";
```

- [ ] **Step 4: `StepHandover.jsx`**

```jsx
/**
 * Let your assistant fill it in: the Fill in screen on the assistant path.
 *
 * The flow used to end here with "Done, my assistant will fill it in", offered
 * before anything had happened, and then send you to a form. Now the screen
 * stays until the assistant's suggestions arrive, and its one filled button
 * becomes the way to Review. That approval is the moment the product is for.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { atStart } from "@/lib/watchtower.js";

import { AUTOFILL_PROMPT } from "./autofillPrompt";
import { StatusLine } from "./StepConnect";

const suggestions = (n) => `${n} ${n === 1 ? "suggestion" : "suggestions"}`;

export function StepHandover({ client, report, onReview, onTypeMyself, onLater }) {
  const [copied, setCopied] = useState(false);
  const connection = report?.connection;
  const name = (connection?.state === "connected" && connection.name) || (client.kind === "other" ? null : client.name);
  const mid = name || "your assistant";
  const pending = report?.pending?.total ?? 0;
  const readOnly = connection?.state === "connected" && !connection.can_propose;

  const status =
    pending > 0 ? ["done", `${suggestions(pending)} waiting.`]
    : report?.assistant?.read ? ["waiting", `${atStart(mid)} is reading your persona…`]
    : copied ? ["waiting", `Paste it into ${mid}. Suggestions appear here as they arrive.`]
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Let {mid} fill it in</h1>
        {!readOnly && (
          <p className="max-w-prose text-muted-foreground">
            Paste this into {mid}, and it suggests what to add from what it knows about you. Nothing is saved until you approve it.
          </p>
        )}
      </div>

      {readOnly ? (
        <StatusLine state="warn">
          {atStart(mid)} can only read your persona, so it can't suggest anything. Reconnect it with permission to suggest, in Settings → Connections.
        </StatusLine>
      ) : (
        <div className="space-y-4">
          <p className="rounded-md bg-muted p-3 text-sm leading-relaxed">{AUTOFILL_PROMPT}</p>
          {status && <StatusLine state={status[0]}>{status[1]}</StatusLine>}
          {pending > 0 ? (
            <Button onClick={onReview}>Review {suggestions(pending)}</Button>
          ) : (
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(AUTOFILL_PROMPT);
                setCopied(true);
              }}
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? "Copied" : "Copy prompt"}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onTypeMyself}>
          I'd rather type it myself
        </Button>
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onLater}>
          Finish later
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run src/components/onboarding`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/components/onboarding
git commit -m "feat: handover waits for the first suggestions and leads to Review"
```

---

### Task 7: About you, Complete, the card, and honest status everywhere

**Files:**
- Modify: `StepAboutYou.jsx`, `StepHowYouLike.jsx`, `StepComplete.jsx` (+ `StepComplete.test.jsx`)
- Rewrite: `frontend/src/components/GettingStartedCard.jsx` (+ `GettingStartedCard.test.jsx`)
- Modify: `frontend/src/components/AddEmailBanner.jsx` (export the key), `frontend/src/App.jsx` (card props, banner on Profile), `frontend/src/components/settings/AccountPanel.jsx:183-189`, `frontend/src/components/ProposalsPanel.jsx:262-282, 724-748`
- Delete: `frontend/src/components/onboarding/connectionStatus.js`, `connectionStatus.test.js`

**Interfaces:**
- Consumes: `useWatchtower`, `getWatchtower`, `atStart` (Task 3), `countAdded` (Task 4).
- Produces: `GettingStartedCard({profile, onStart(step), onReview, onAddEmail, onShownChange(bool)})`; `StepComplete({added, report, onAdd, onDone})`; `StepAboutYou({packs, data, onChange, saveState, onRetry, onOfferAssistant, onBack, onLater, onContinue, children})`; `StepHowYouLike({packs, data, onChange, locale})`; `export const DISMISSED_KEY` from `AddEmailBanner.jsx`.

- [ ] **Step 1: Write the failing tests**

`StepComplete.test.jsx` (replace):

```js
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepComplete } from "./StepComplete";
import { countAdded } from "./OnboardingFlow";

const connected = { connection: { state: "connected", name: "Cursor" } };

describe("StepComplete", () => {
  it("counts what you typed, not what was already there", () => {
    const before = { profile: { name: "" }, preferences: { communication: { default: { locale: "British English" } } } };
    const after = { profile: { name: "Ada", current_role: "Engineer" }, preferences: before.preferences };
    expect(countAdded(before, after)).toBe(2);
    expect(countAdded(before, before)).toBe(0);
  });

  it("says who can read it now", () => {
    render(<StepComplete added={3} report={connected} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText("You've added 3 things. Cursor can read them now.")).toBeInTheDocument();
  });

  it("is honest about nothing", () => {
    render(<StepComplete added={0} report={null} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText("Nothing added yet. Fill it in whenever you like, or let an assistant do it.")).toBeInTheDocument();
  });

  it("confirms an extra where it was added", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete added={0} report={null} onAdd={onAdd} onDone={vi.fn()} />);
    await user.type(screen.getByLabelText("A goal you're working towards"), "Learn Rust{Enter}");
    expect(onAdd).toHaveBeenCalledWith("goals", ["goals"], { title: "Learn Rust" });
    expect(screen.getByRole("status")).toHaveTextContent("Added to Goals");
  });
});
```

`GettingStartedCard.test.jsx` (replace; mock `@/lib/watchtower.js` `useWatchtower` to return a fixture, `@/lib/onboarding.js` `getOnboarding`/`saveOnboarding`, `@/lib/session.js` `getSession` resolving `{ user: { email: "x@placeholder.invalid" } }` and `isPlaceholderEmail: () => true`, `@/lib/guide.js` `showHint`):

```js
it("ticks only what really happened", async () => {
  watchtower = { connection: { state: "waiting", name: "my assistant", can_propose: true }, assistant: { suggested: false }, pending: { total: 0 } };
  render(<GettingStartedCard profile={{ name: "Ada" }} onStart={vi.fn()} onReview={vi.fn()} onAddEmail={vi.fn()} />);
  expect(await screen.findByText("1 of 3")).toBeInTheDocument();       // basics only
  expect(screen.getByText("Waiting for my assistant…")).toBeInTheDocument();
});

it("sends each step to its own screen", async () => {
  const onStart = vi.fn();
  watchtower = { connection: { state: "none" }, assistant: {}, pending: { total: 0 } };
  const user = userEvent.setup();
  render(<GettingStartedCard profile={{}} onStart={onStart} onReview={vi.fn()} onAddEmail={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Connect" }));
  await user.click(screen.getByRole("button", { name: "Fill in" }));
  expect(onStart.mock.calls).toEqual([["assistant"], ["about-you"]]);
});

it("ticks the first suggestion and links to what is waiting", async () => {
  const onReview = vi.fn();
  watchtower = { connection: { state: "connected", name: "Cursor", can_propose: true }, assistant: { suggested: true }, pending: { total: 2 } };
  render(<GettingStartedCard profile={{ name: "Ada" }} onStart={vi.fn()} onReview={onReview} onAddEmail={vi.fn()} />);
  expect(await screen.findByText("3 of 3")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Review 2" }));
  expect(onReview).toHaveBeenCalled();
});

it("carries the email nudge", async () => {
  watchtower = { connection: { state: "none" }, assistant: {}, pending: { total: 0 } };
  render(<GettingStartedCard profile={{}} onStart={vi.fn()} onReview={vi.fn()} onAddEmail={vi.fn()} />);
  expect(await screen.findByText("Add an email so you can reset your password")).toBeInTheDocument();
});
```

`AccountPanel.test.jsx`: change the restore assertion to expect `saveOnboarding` called with `{ dismissed: false, steps: <the loaded steps>, seen: <the loaded seen> }`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/components`
Expected: FAIL on the new assertions

- [ ] **Step 3: `StepAboutYou.jsx`**

- Drop `BlurFade` (the flow animates every step now).
- Lede: `Type what's useful and leave the rest. It saves as you go, and you can change all of it later.`
- Leave nationality out: `const shown = node && { ...node, element: { ...node.element, fields: node.element.fields.filter((f) => f.name !== "nationality") } };` and render `shown`.
- Under the heading, the save mark:

```jsx
function SaveMark({ state, onRetry }) {
  return (
    <p role="status" className="h-5 text-sm text-muted-foreground">
      {state === "saving" && "Saving…"}
      {state === "saved" && <span className="animate-in fade-in duration-200 motion-reduce:animate-none">Saved</span>}
      {state === "error" && (
        <>
          Couldn't save.{" "}
          <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </p>
  );
}
```

- The footer moves in from OnboardingFlow: `Back` (ghost, `-ml-3`) on the left; `Finish later` (ghost) and `Continue` (filled) on the right, calling `onBack`, `onLater`, `onContinue`. The "Let my assistant fill this in instead" link stays, calling `onOfferAssistant`.

`StepHowYouLike.jsx`: lede `Every assistant you connect follows these.`; takes `locale` and renders `value={locale ? { ...stored, locale } : stored}` where `stored = getAt(data || {}, COMMUNICATION_DEFAULT) || {}`.

- [ ] **Step 4: `StepComplete.jsx`**

- Props `{ added, report, onAdd, onDone }`; drop `filledCount` and the `Confetti` (it moves to the first approval, Task 9).
- Body:

```jsx
const connection = report?.connection;
const things = `${added} ${added === 1 ? "thing" : "things"}`;
const line =
  added === 0
    ? "Nothing added yet. Fill it in whenever you like, or let an assistant do it."
    : connection?.state === "connected"
      ? `You've added ${things}. ${atStart(connection.name)} can read them now.`
      : `You've added ${things}. Connect an assistant and it can read them and suggest the rest.`;
```

- Extras heading `Two more, if you like`; labels `What's on your mind at the moment?` and `A goal you're working towards`; `OneLineAdd` takes a `place` prop ("Top of mind", "Goals") and after a submit shows `<p role="status" className="text-sm text-muted-foreground">Added to {place}</p>` until the next keystroke.

- [ ] **Step 5: `GettingStartedCard.jsx`** (rewrite)

```jsx
/**
 * The card on Profile: three steps, and it routes rather than collects.
 *
 * Every tick is a fact. Connected means watchtower saw a call; the basics are
 * done when a basics field holds something; the first suggestion is ticked
 * when the assistant has made one. None of it is a stored claim that could
 * disagree with what happened.
 *
 * While it shows, it carries the email nudge, so Profile has one banner and
 * not two (App hides AddEmailBanner there).
 */
import { useEffect, useState } from "react";
import { Check, Clock, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DISMISSED_KEY } from "@/components/AddEmailBanner";
import { showHint } from "@/lib/guide.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import { getSession, isPlaceholderEmail } from "@/lib/session.js";
import { atStart, useWatchtower } from "@/lib/watchtower.js";

import { AUTOFILL_PROMPT } from "./onboarding/autofillPrompt";

const BASICS = ["name", "preferred_name", "current_role", "organisation", "location", "bio"];

function Mark({ done, waiting, n }) {
  if (done) return <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />;
  if (waiting) return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">{n}</span>;
}

export function GettingStartedCard({ profile, disabledSections = [], onStart, onReview, onAddEmail, onShownChange }) {
  const [state, setState] = useState(null);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const report = useWatchtower();

  useEffect(() => {
    let cancelled = false;
    getOnboarding()
      .then((saved) => !cancelled && setState(saved))
      // Hidden rather than wrong: "0 of 3" to someone who finished is a lie.
      .catch(() => !cancelled && setState({ dismissed: true, steps: {}, seen: [] }));
    if (localStorage.getItem(DISMISSED_KEY) !== "1") {
      getSession()
        .then((s) => !cancelled && setNeedsEmail(!!s?.user && isPlaceholderEmail(s.user.email)))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = !!state && !state.dismissed;
  useEffect(() => onShownChange?.(shown), [shown, onShownChange]);
  if (!shown) return null;

  const connection = report?.connection;
  const connected = connection?.state === "connected";
  const waiting = connection?.state === "waiting";
  const basics = BASICS.some((k) => String(profile?.[k] ?? "").trim());
  const suggested = !!report?.assistant?.suggested;
  const pending = report?.pending?.total ?? 0;
  const done = [connected, basics, suggested].filter(Boolean).length;

  const dismiss = () => {
    const next = { ...state, dismissed: true };
    setState(next);
    saveOnboarding(next, disabledSections).catch(() => {});
  };

  const row = "flex items-center justify-between gap-3 text-sm";
  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Getting started</p>
            <p className="text-xs text-muted-foreground">{done} of 3</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label="Hide getting started" onClick={dismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ol className="space-y-3">
          <li className={row}>
            <span className="flex min-w-0 items-center gap-2">
              <Mark done={connected} waiting={waiting} n={1} />
              <span className="truncate">Connect an assistant</span>
            </span>
            {connected && <span className="shrink-0 text-xs text-muted-foreground">{atStart(connection.name)} connected</span>}
            {waiting && <span className="shrink-0 text-xs text-muted-foreground">Waiting for {connection.name || "your assistant"}…</span>}
            {!connected && !waiting && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => onStart("assistant")}>Connect</Button>
            )}
          </li>
          <li className={row}>
            <span className="flex min-w-0 items-center gap-2">
              <Mark done={basics} n={2} />
              <span className="truncate">Fill in the basics</span>
            </span>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => onStart("about-you")}>
              {basics ? "Edit" : "Fill in"}
            </Button>
          </li>
          <li className={row}>
            <span className="flex min-w-0 items-center gap-2">
              <Mark done={suggested} n={3} />
              <span className="truncate">Get a first suggestion</span>
            </span>
            {pending > 0 ? (
              <Button variant="outline" size="sm" className="shrink-0" onClick={onReview}>Review {pending}</Button>
            ) : connected && connection.can_propose ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                data-guide="copy-prompt"
                onClick={() => {
                  navigator.clipboard?.writeText(AUTOFILL_PROMPT);
                  setCopied(true);
                  showHint("hint:paste-prompt", {
                    element: '[data-guide="copy-prompt"]',
                    title: `Paste it into ${connection.name || "your assistant"}`,
                    description: "Your assistant reads your persona and sends its suggestions to Review.",
                  });
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? "Copied" : "Copy prompt"}
              </Button>
            ) : null}
          </li>
          {needsEmail && (
            <li className={row}>
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span className="w-4 shrink-0" aria-hidden="true" />
                <span>Add an email so you can reset your password</span>
              </span>
              <Button variant="outline" size="sm" className="shrink-0" onClick={onAddEmail}>Add email</Button>
            </li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}
```

`AddEmailBanner.jsx`: `export const DISMISSED_KEY = ...`.

- [ ] **Step 6: `App.jsx`, `AccountPanel.jsx`, `ProposalsPanel.jsx`**

App:

```jsx
const [cardShown, setCardShown] = useState(false);
// the banner wrapper
{!(activeSection === "profile" && cardShown) && (
  <div className="mb-4 empty:mb-0"><AddEmailBanner onAddEmail={...unchanged} /></div>
)}
// the card
<GettingStartedCard
  profile={packData.profile}
  disabledSections={disabledSections}
  onStart={(step) => navigate("onboarding", step)}
  onReview={() => navigate("review", null)}
  onAddEmail={() => { setAddEmailRequest((n) => n + 1); openSettings("account"); }}
  onShownChange={setCardShown}
/>
```

AccountPanel restore:

```js
const restoreGettingStarted = () => {
  setOnboardingDismissed(false);
  // Brings the card back as it was, progress included.
  getOnboarding()
    .then((saved) => saveOnboarding({ ...saved, dismissed: false }, disabledSections))
    .catch(() => {});
};
```

ProposalsPanel empty state: replace the `Promise.all([listTokens(), listConnectedApps()])` effect body with `getWatchtower().then((r) => !cancelled && setConnection(r.connection)).catch(() => {})`, and in the messages read `connection.can_propose` (was `canPropose`). The waiting line becomes `{atStart(connection.name, "your token")} is set up but hasn't been used yet. Suggestions arrive once it makes its first call.` Drop the `connectionStatus` and unused `listTokens`/`listConnectedApps` imports; update `ProposalsPanel.test.jsx` to mock `getWatchtower` instead.

Then: `grep -rn "connectionStatus" frontend/src` must print nothing but the two files; delete them.

- [ ] **Step 7: Run the tests**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src
git commit -m "fix: every tick and count says what really happened"
```

---

### Task 8: `lib/guide.js` on driver.js

**Files:**
- Modify: `frontend/package.json`, `package-lock.json` (`npm install driver.js@^1.8.0`)
- Create: `frontend/src/lib/guide.js`, `frontend/src/lib/guide.test.js`
- Modify: `frontend/src/styles/globals.css` (or wherever `globals.css` lives; `grep -rn "front-toast-height" frontend/src` finds it)

**Interfaces:**
- Consumes: `getOnboarding`, `markSeen` (Task 2).
- Produces: `startTour(key, steps, {force}) -> Promise<boolean>`, `showHint(key, {element, title, description}) -> Promise<boolean>`, `celebrateFirst() -> Promise<void>`, `visible(selector) -> Element|null`, `resetSeen()`, `TOURS = {editor, firstSuggestion}`, `HINTS = {promote}` (copy from the spec's Guides table).

- [ ] **Step 1: Install**

Run: `cd frontend && npm install driver.js@^1.8.0`
Then read `node_modules/driver.js/dist/hints.d.ts` and `hints.mjs` to confirm `hints({...}).show()`, the `onDismiss`/`onButtonClick` hook signatures, and whether the button dismisses on its own. Adjust Step 3's `showHint` to what the source does.

- [ ] **Step 2: Write the failing tests**

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const drive = vi.fn();
const driverMock = vi.hoisted(() => vi.fn());
const getOnboardingMock = vi.hoisted(() => vi.fn());
const markSeenMock = vi.hoisted(() => vi.fn());
vi.mock("driver.js", () => ({ driver: driverMock }));
vi.mock("driver.js/hints", () => ({ hints: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })) }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("./onboarding.js", () => ({ getOnboarding: getOnboardingMock, markSeen: markSeenMock }));

const { startTour, resetSeen, visible, celebrateFirst } = await import("./guide.js");
const confetti = (await import("canvas-confetti")).default;

const media = (reduce) => (globalThis.matchMedia = vi.fn((q) => ({ matches: reduce && q.includes("reduce") })));

beforeEach(() => {
  resetSeen();
  driverMock.mockReset().mockImplementation((config) => ({ drive: () => { drive(config); config.onDestroyed?.(); } }));
  getOnboardingMock.mockReset().mockResolvedValue({ seen: [] });
  markSeenMock.mockReset().mockResolvedValue(undefined);
  document.body.innerHTML = '<button data-guide="a">A</button>';
  // jsdom lays nothing out; say this element is visible.
  document.querySelector('[data-guide="a"]').getClientRects = () => [{}];
  media(false);
});

const steps = [
  { element: '[data-guide="a"]', popover: { title: "A", description: "a" } },
  { element: '[data-guide="missing"]', popover: { title: "B", description: "b" } },
];

describe("startTour", () => {
  it("runs once, drops missing steps, and remembers it on the server", async () => {
    expect(await startTour("guide:x", steps)).toBe(true);
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(1);
    expect(markSeenMock).toHaveBeenCalledWith("guide:x");
    expect(await startTour("guide:x", steps)).toBe(false);
    expect(await startTour("guide:x", steps, { force: true })).toBe(true);
  });

  it("does not start with nothing to point at", async () => {
    expect(await startTour("guide:y", [steps[1]])).toBe(false);
    expect(driverMock).not.toHaveBeenCalled();
  });

  it("does not animate under reduced motion", async () => {
    media(true);
    await startTour("guide:z", steps);
    expect(driverMock.mock.calls[0][0]).toMatchObject({ animate: false, smoothScroll: false });
  });

  it("skips a guide already seen on another device", async () => {
    getOnboardingMock.mockResolvedValue({ seen: ["guide:x"] });
    expect(await startTour("guide:x", steps)).toBe(false);
  });
});

describe("visible", () => {
  it("points at the visible element", () => {
    document.body.innerHTML = '<nav data-guide="s" id="hidden"></nav><nav data-guide="s" id="shown"></nav>';
    document.getElementById("hidden").getClientRects = () => [];
    document.getElementById("shown").getClientRects = () => [{}];
    expect(visible('[data-guide="s"]').id).toBe("shown");
  });
});

describe("celebrateFirst", () => {
  it("fires once, and never under reduced motion", async () => {
    await celebrateFirst();
    await celebrateFirst();
    expect(confetti).toHaveBeenCalledTimes(1);
    resetSeen();
    confetti.mockClear();
    media(true);
    await celebrateFirst();
    expect(confetti).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to see them fail, then write `lib/guide.js`**

Run: `cd frontend && npx vitest run src/lib/guide.test.js` (FAIL: no module). Then:

```js
/**
 * Guided tours and one-off hints, on driver.js.
 *
 * Each is shown once per account, not per device: what has been seen is kept
 * on the server in onboarding.seen (settings_store.py). Elements are found by
 * `data-guide` attributes, never by class names or text, and a step whose
 * element is not laid out is dropped rather than pointed at nothing.
 *
 * driver.js ignores prefers-reduced-motion, so this does it: no animation, no
 * smooth scrolling, and no confetti.
 *
 * The copy for every tour and hint is here, in one place, so the house-style
 * checks have one file to read. It is the spec's Guides table, verbatim.
 */
import { driver } from "driver.js";
import { hints } from "driver.js/hints";
import "driver.js/dist/driver.css";
import "driver.js/dist/hints.css";
import confetti from "canvas-confetti";

import { getOnboarding, markSeen } from "./onboarding.js";

const matches = (q) => !!globalThis.matchMedia?.(q).matches;
const reduced = () => matches("(prefers-reduced-motion: reduce)");
const narrow = () => matches("(max-width: 639px)");
const SEARCH_KEY = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "") ? "⌘K" : "Ctrl K";

export const TOURS = {
  firstSuggestion: [
    { element: '[data-guide="approve"]', popover: { title: "Approve to save it", description: "Approving adds this to your persona. Until you do, nothing has changed." } },
    { element: '[data-guide="reject"]', popover: { title: "Not quite right?", description: "Edit it before approving, or reject it. A rejected suggestion is never raised again." } },
  ],
  editor: [
    { element: '[data-guide="sections"]', popover: { title: "Your persona, by section", description: "Profile, goals, projects and the rest. Turn sections on or off in Manage sections." } },
    { element: "#main-content input, #main-content textarea", popover: { title: "Type to change anything", description: "Changes save as you type, and the header says Saved when they're in." } },
    { element: '[data-guide="history"]', popover: { title: "Undo with History", description: "Every change to a section is kept, and a restore can itself be undone." } },
    { element: '[data-guide="search"]', popover: { title: "Find anything", description: `Search your whole persona with ${SEARCH_KEY}.` } },
  ],
};

export const HINTS = {
  promote: {
    element: '[data-guide="promote"]',
    title: "Give it a home",
    description: "An observation doesn't belong to a section yet. Promote it to file it as an entry you can edit.",
  },
};

let seen = null;
function loadSeen() {
  seen ??= getOnboarding()
    .then((s) => new Set(s.seen || []))
    .catch(() => new Set());
  return seen;
}

async function remember(key) {
  (await loadSeen()).add(key);
  // At worst a lost write shows the guide once more on another device.
  markSeen(key).catch(() => {});
}

/** Tests only: forget the cached set. */
export function resetSeen() {
  seen = null;
}

/** The first match that is laid out: the rail is in the DOM on a phone, only hidden. */
export function visible(selector) {
  return [...document.querySelectorAll(selector)].find((el) => el.getClientRects().length > 0) || null;
}

function place(step) {
  const element = visible(step.element);
  if (!element) return null;
  return { ...step, element, popover: { ...step.popover, ...(narrow() ? { side: "bottom", align: "center" } : {}) } };
}

const THEME = {
  popoverClass: "mygist-guide",
  overlayOpacity: 0.35,
  stagePadding: 6,
  stageRadius: 10,
  nextBtnText: "Next",
  prevBtnText: "Back",
  doneBtnText: "Done",
  onPopoverRender: (popover) => popover.closeButton?.setAttribute("aria-label", "Close guide"),
};

/** A tour of `steps`, once per `key` unless `force`. Resolves true if it started. */
export async function startTour(key, steps, { force = false } = {}) {
  if (!force && (await loadSeen()).has(key)) return false;
  const live = steps.map(place).filter(Boolean);
  if (!live.length) return false;
  driver({
    ...THEME,
    animate: !reduced(),
    smoothScroll: !reduced(),
    showProgress: live.length > 1,
    progressText: "{{current}} of {{total}}",
    steps: live,
    onDestroyed: () => remember(key),
  }).drive();
  return true;
}

/** A pulsing dot on one element that opens a short note when tapped, once per `key`. */
export async function showHint(key, { element, title, description }) {
  if ((await loadSeen()).has(key)) return false;
  const target = visible(element);
  if (!target) return false;
  const done = () => {
    remember(key);
    hint.hide();
  };
  const hint = hints({
    popoverClass: "mygist-guide",
    beacon: { animate: !reduced() },
    hints: [{ id: key, element: target, popover: { title, description, showButton: true, buttonText: "Got it" } }],
    onDismiss: done,
    onButtonClick: done,
  });
  hint.show();
  return true;
}

/** Confetti for the first approval ever, and only that one. */
export async function celebrateFirst() {
  const key = "moment:first-approval";
  if ((await loadSeen()).has(key)) return;
  remember(key);
  if (!reduced()) confetti({ particleCount: 90, spread: 70, origin: { y: 0.75 } });
}
```

- [ ] **Step 4: Theme in `globals.css`**

```css
/* driver.js, in the app's own surface. lib/guide.js sets the class. */
.driver-popover.mygist-guide {
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: 0.75rem;
  box-shadow: 0 10px 30px -12px hsl(0 0% 0% / 0.25);
  font-family: inherit;
  max-width: 20rem;
  padding: 1rem;
}
.driver-popover.mygist-guide .driver-popover-title { font-size: 0.9375rem; font-weight: 600; }
.driver-popover.mygist-guide .driver-popover-description { font-size: 0.875rem; color: hsl(var(--muted-foreground)); line-height: 1.5; }
.driver-popover.mygist-guide .driver-popover-progress-text { font-size: 0.75rem; color: hsl(var(--muted-foreground)); }
.driver-popover.mygist-guide .driver-popover-footer button {
  text-shadow: none; font: inherit; font-size: 0.8125rem; font-weight: 500;
  border-radius: 0.5rem; padding: 0.375rem 0.75rem;
  border: 1px solid hsl(var(--border)); background: hsl(var(--background)); color: hsl(var(--foreground));
}
.driver-popover.mygist-guide .driver-popover-next-btn { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: transparent; }
.driver-popover.mygist-guide button:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
.driver-popover.mygist-guide .driver-popover-arrow-side-bottom { border-bottom-color: hsl(var(--card)); }
.driver-popover.mygist-guide .driver-popover-arrow-side-top { border-top-color: hsl(var(--card)); }
.driver-popover.mygist-guide .driver-popover-arrow-side-left { border-left-color: hsl(var(--card)); }
.driver-popover.mygist-guide .driver-popover-arrow-side-right { border-right-color: hsl(var(--card)); }
```

Check the class names against `node_modules/driver.js/dist/driver.css` and `hints.css`, and give the hint beacon `background: hsl(var(--primary))`.

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run src/lib && npm run build`
Expected: PASS, and the build succeeds (CSS imports resolve)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/guide.js frontend/src/lib/guide.test.js frontend/src/styles
git commit -m "feat: guides and hints on driver.js, shown once per account"
```

---

### Task 9: Guides where they belong

**Files:**
- Modify: `frontend/src/components/InboxRow.jsx:245-262` (`data-guide="approve"`, `data-guide="reject"`), `ObservationCard.jsx:~60` (`data-guide="promote"`), `ProposalsPanel.jsx` (tour, hint, confetti), `shell/Rail.jsx:85` and `shell/SectionMenu.jsx:84` (`data-guide="sections"`), `shell/Header.jsx` (`data-guide="search"`, **Show me around**), `App.jsx` (`data-guide="history"`, the editor tour, `onConnect` to Settings), `settings/SettingsPage.jsx` + `ConnectionsPanel.jsx` (button), `settings/AppsPanel.jsx` + `ConnectedApps.jsx` (`data-guide="app"`, hint)
- Test: `ProposalsPanel.test.jsx`, `Header.test.jsx`, `settings/AppsPanel.test.jsx` (one case each)

**Interfaces:**
- Consumes: `startTour`, `showHint`, `celebrateFirst`, `TOURS`, `HINTS` (Task 8); `tourPending` (Task 4).
- Produces: Header prop `onShowMeAround`; SettingsPage and ConnectionsPanel prop `onConnect`.

- [ ] **Step 1: Write the failing tests** (mock `@/lib/guide.js` in each file with `vi.fn(async () => true)` exports and `TOURS`/`HINTS` objects)

```js
// ProposalsPanel.test.jsx
it("starts the first-suggestion guide when suggestions are listed", async () => {
  renderPanelWithRows([entityRow]);            // the file's existing helper and fixture
  await screen.findByRole("button", { name: /^approve /i });
  expect(startTour).toHaveBeenCalledWith("guide:first-suggestion", TOURS.firstSuggestion);
});

it("celebrates the first approval", async () => {
  renderPanelWithRows([entityRow]);
  await userEvent.setup().click(await screen.findByRole("button", { name: /^approve /i }));
  expect(celebrateFirst).toHaveBeenCalled();
});

// Header.test.jsx
it("offers Show me around in the account menu", async () => {
  const onShowMeAround = vi.fn();
  const user = userEvent.setup();
  render(<Header onShowMeAround={onShowMeAround} />);
  await user.click(screen.getByRole("button", { name: /account/i }));
  await user.click(screen.getByRole("menuitem", { name: "Show me around" }));
  expect(onShowMeAround).toHaveBeenCalled();
});

// AppsPanel.test.jsx
it("explains the first app once", async () => {
  listConnectedApps.mockResolvedValue([{ id: "g1", clientId: "c", clientName: "Cursor", scopes: ["persona:propose"] }]);
  render(<AppsPanel isOpen />);
  await screen.findByText("Cursor");
  expect(showHint).toHaveBeenCalledWith("hint:first-app", expect.objectContaining({
    title: "What Cursor can do",
    description: "It can read your persona and suggest changes for your approval. Disconnect it here whenever you like.",
  }));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/components/ProposalsPanel.test.jsx src/shell/Header.test.jsx src/components/settings/AppsPanel.test.jsx`
Expected: FAIL

- [ ] **Step 3: Wire them**

ProposalsPanel (import `{ startTour, showHint, celebrateFirst, TOURS, HINTS }`):

```js
// Once something is on screen to point at: the approve loop on the first
// suggestion, Promote on the first observation. Each runs once per account.
const anyRows = rows.length > 0;
useEffect(() => {
  if (!loaded || !anyRows) return;
  if (kind === "entity") startTour("guide:first-suggestion", TOURS.firstSuggestion);
  if (kind === "note") showHint("hint:promote", HINTS.promote);
}, [loaded, anyRows, kind]);
```

and the first line of `approveLater`: `celebrateFirst();`.

InboxRow: `data-guide="approve"` on the Approve button, `data-guide="reject"` on Reject. ObservationCard: `data-guide="promote"` on Promote. Rail `<nav>` and SectionMenu's root: `data-guide="sections"`. Header search button: `data-guide="search"`; the account menu gets, after Help and docs:

```jsx
<DropdownMenuItem onSelect={() => onShowMeAround?.()}>
  <Compass className="h-4 w-4" aria-hidden="true" />
  Show me around
</DropdownMenuItem>
```

App: the History button gets `data-guide="history"`; `<Header onShowMeAround={() => { if (!activePack) navigate("profile", null); setTourPending("force"); }} ... />`; and

```js
// After onboarding's Complete, once, and from Show me around, always. Waits a
// beat so the section has laid out the elements the tour points at.
useEffect(() => {
  if (!tourPending || !activePack) return undefined;
  const timer = setTimeout(() => {
    startTour("guide:editor", TOURS.editor, { force: tourPending === "force" });
    setTourPending(null);
  }, 400);
  return () => clearTimeout(timer);
}, [tourPending, activePack]);
```

Settings: `SettingsPage` passes `onConnect` through to `ConnectionsPanel`, which renders above Connected apps:

```jsx
<Button variant="outline" size="sm" onClick={onConnect}>
  <Plus className="h-4 w-4" aria-hidden="true" />
  Connect an assistant
</Button>
```

and App passes `onConnect={() => navigate("onboarding", "assistant")}`.

AppsPanel, after grants load:

```js
useEffect(() => {
  const first = grants?.[0];
  if (!first) return;
  const scopes = first.scopes || [];
  const can = scopes.includes("persona:write")
    ? " and change it directly"
    : scopes.includes("persona:propose") ? " and suggest changes for your approval" : "";
  showHint("hint:first-app", {
    element: '[data-guide="app"]',
    title: `What ${first.clientName || "this app"} can do`,
    description: `It can read your persona${can}. Disconnect it here whenever you like.`,
  });
}, [grants]);
```

ConnectedApps: `data-guide="app"` on each row's `<li>`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat: guide the first suggestion, the editor, and first-time controls"
```

---

### Task 10: Sign-in copy and the house-style pass

**Files:**
- Modify: `frontend/src/components/WelcomeAuth.jsx:121-130` (`COPY.app`)
- Modify: tests asserting the old copy (`grep -rln "portable personal context\|every AI client you use" frontend/src`)

- [ ] **Step 1: Copy**

```js
signin: {
  title: "Welcome to MyGist",
  description: "Explain yourself once. Every assistant you connect reads the same persona.",
},
signup: {
  title: "Create your account",
  description: "One persona for every assistant you use. Assistants suggest additions for you to approve.",
},
```

- [ ] **Step 2: Mechanical checks on the built bundle** (house-style: the bundle, not the source)

```bash
cd frontend && npm run build
B=$(ls dist/assets/*.js)
for s in "Which assistant do you use?" "Let " "Paste it into" "Approve to save it" "Show me around" "Explain yourself once."; do grep -c -F "$s" $B | paste -sd+ | bc; done
grep -o -E "Which assistant[^\"]{0,200}|Paste it into[^\"]{0,120}|Approve to save it[^\"]{0,120}" $B | grep -c "—"   # expect 0
grep -o -i -E "\b(seamless|effortless|leverage|empower|supercharge|robust)\b" $B | sort | uniq -c   # expect nothing new
```

Expected: every new string present; zero em dashes in them; no banned words.

- [ ] **Step 3: Run the tests and commit**

Run: `cd frontend && npx vitest run`

```bash
git add -A frontend/src
git commit -m "copy: sign-in in the product's own words"
```

---

### Task 11: Docs, changelog, and 0.3.0

**Files:**
- Modify: `docs-site/content/docs/use/quick-start.mdx` (the first-run section), `use/clients.mdx` (the Claude row), `run/troubleshooting.mdx:84-87` (`/api/watchtower`), `changelog.mdx` (0.3.0 entry), `frontend/package.json` + lock (`0.3.0`), `backend/main.py` (`FastAPI(version="0.3.0")`)

- [ ] **Step 1: Write the docs**

- quick-start: the five screens in order, each in one or two sentences, with the two paths; screenshots `onboarding-assistant.png`, `onboarding-connect.png`, `onboarding-handover.png`, `review-first-suggestion.png` (taken in Task 12).
- clients.mdx: the Claude section's steps and plan note, verbatim from `lib/clients.js`, citing Claude's page.
- troubleshooting: `/api/watchtower` in the prose and the curl; one sentence that `connection` and `assistant` now summarise the rows, and that `/api/usage` still answers in 0.3.x.
- changelog `## 0.3.0`: onboarding ends on your first approval; Connect in three screens; one source for connection status (`/api/watchtower`, `/api/usage` deprecated); guides and hints; Claude's connector steps corrected; locale from your browser.

- [ ] **Step 2: Check and commit**

```bash
cd docs-site && rm -rf out .next && npm run build && npm run check:links
cd .. && grep -c "—" docs-site/content/docs/use/quick-start.mdx   # at most 2
git add -A docs-site frontend/package.json frontend/package-lock.json backend/main.py
git commit -m "docs: 0.3.0, the new first run, and /api/watchtower"
```

---

### Task 12: Verify in the running app

- [ ] **Step 1: Suites**

Run: `cd backend && pytest -q` and `cd frontend && npx vitest run && npm run build`
Expected: all PASS

- [ ] **Step 2: Preview on the branch, with sign-in**

Run: `PORT=1120 AUTH_MCP_RESOURCE=http://localhost:1120/mcp ./scripts/local-preview.sh`

- [ ] **Step 3: Walk both paths** (Playwright from `frontend/node_modules/playwright`, scripts in the scratchpad), 1440×900 and 390×844 touch, throwaway account `onboard-verify`:
  - Assistant path: choose Codex → Connect shows "Waiting for Codex to connect…". Mint a token in the container for the account, then send JSON-RPC `initialize`, `tools/call get_context`, and two `tools/call propose_update` to `/mcp` with it (memory: verify-mcp-against-running-preview). The status line moves to connected, then reading, then "2 suggestions waiting"; **Review 2 suggestions** opens Review with the first-suggestion guide; Approve fires confetti once.
  - Manual path: I'll type it myself → About you shows Saved after typing, no nationality, locale from the browser → Complete counts only what was typed → Profile runs the editor tour; Show me around replays it.
  - Something else → token: steps stay beside the token, the spotlight shows, **I've copied it** reveals the status.
  - Take the docs screenshots named in Task 11.
- [ ] **Step 4: Detector and clean-up**

```bash
/Users/khantthura/.claude/skills/impeccable/scripts/impeccable detect --json frontend/src/components/onboarding frontend/src/components/GettingStartedCard.jsx frontend/src/lib/guide.js
```

Delete `onboard-verify` (Settings → Account → Delete account), confirm `select count(*) from users where username like 'onboard-verify%'` is 0, and restart the preview without the branch-only env if needed.

- [ ] **Step 5: Commit the screenshots**

```bash
git add docs-site/public/screenshots
git commit -m "docs: screenshots of the new first run"
```
