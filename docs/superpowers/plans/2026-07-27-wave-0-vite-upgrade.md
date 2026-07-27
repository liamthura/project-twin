# Wave 0: Vite Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the frontend build from Vite 5 to Vite 7 on a supported Node runtime, so wave 1 can add Vitest 4 and Storybook 10, with no change to what the app does.

**Architecture:** Three independent changes, each verified by a real build before the next lands: make the Vite config ESM-safe, move the toolchain to Node 22, then upgrade Vite itself. The gate is the production container — the single-container merge means a broken frontend build blocks backend deploys too, so the image is built and smoke-tested before this ships.

**Tech Stack:** Vite 7.3.6, `@vitejs/plugin-react` 4.7.0, Node 22 (alpine), npm, Docker, GitHub Actions.

## Global Constraints

- Vite target version: **7.3.6**. Not Vite 8 — it moves to Rolldown and requires `@vitejs/plugin-react@6`, a larger change than this project needs.
- `@vitejs/plugin-react` stays on the **4.x** line (`^4.7.0`), which supports `vite ^4.2 || ^5 || ^6 || ^7`.
- Vite 7 requires Node `^20.19.0 || >=22.12.0`.
- **No behaviour change.** No source file under `frontend/src/` is modified in this wave. The only frontend file that changes is `vite.config.js`.
- Tailwind stays on 3.4. Upgrading it is an explicit non-goal of the spec.
- Branch: `chore/vite-7-upgrade`, branched from `main`. Pushes use the `liamthura` account.
- This wave must be **merged and deployed to production** before wave 1 begins, so any build regression is attributable to the upgrade alone.

## Deviation from the spec

The spec (§ Wave 0 detail) says to pin Node to `20.19` in the `Dockerfile` and CI. This plan uses **Node 22** instead.

Node 20 reached end of life in April 2026 and no longer receives security updates. Pinning a build stage to an EOL runtime purely to satisfy a version floor is the wrong trade, and 20.19 sits one patch above Vite 7's minimum with no headroom. Node 22 is a supported LTS, is already what the developer runs locally (22.18.0), and puts the floor (22.12) comfortably in the past — so `node:22-alpine` can keep floating for security patches without risking the floor, which was the spec's actual concern.

---

### Task 1: Make the Vite config ESM-safe

`frontend/package.json` sets `"type": "module"`, so `vite.config.js` is an ES module, where `__dirname` does not exist. It currently works only because Vite 5 bundles the config through esbuild and injects a shim. Vite 6 changed config loading, and this is the most likely single point of failure in the upgrade — if the `@` alias breaks, every import in the app fails to resolve.

Fixing it separately, while still on Vite 5, proves the config change is sound in isolation.

**Files:**
- Modify: `frontend/vite.config.js:4` (the `path` import) and `frontend/vite.config.js:29` (the alias)

**Interfaces:**
- Consumes: nothing.
- Produces: a `vite.config.js` whose `resolve.alias["@"]` resolves to the absolute path of `frontend/src` without relying on a CJS shim. Tasks 2 and 3 depend on this alias continuing to work.

- [ ] **Step 1: Record the current build output as the baseline**

The app has no tests yet — wave 1 adds them — so the baseline for "nothing changed" is the built bundle.

```bash
cd frontend
npm ci
npm run build
ls -1 dist/assets/ | sort > /tmp/wave0-baseline-assets.txt
cat /tmp/wave0-baseline-assets.txt
```

Expected: one `index-<hash>.js` and one `index-<hash>.css`. Keep this file; Task 3 compares against it.

- [ ] **Step 2: Replace `__dirname` with an ESM-native equivalent**

`import.meta.dirname` is available from Node 20.11, and this plan targets Node 22, so no `fileURLToPath` dance is needed.

In `frontend/vite.config.js`, replace the `path` import on line 4:

```js
import path from "path";
```

with:

```js
import { fileURLToPath } from "node:url";
```

and change the alias block (lines 27-32) from:

```js
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    extensions: [".mjs", ".js", ".jsx", ".ts", ".tsx", ".json"],
  },
```

to:

```js
  resolve: {
    alias: {
      // Not __dirname: package.json sets "type": "module", so this file is an
      // ES module and __dirname only resolved because Vite 5 bundles the
      // config through esbuild and shims it. Vite 6+ changed config loading.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    extensions: [".mjs", ".js", ".jsx", ".ts", ".tsx", ".json"],
  },
```

Use `fileURLToPath` rather than `new URL(...).pathname` — the latter yields `/C:/...` on Windows and percent-encodes spaces in the path. `path` has no other use in the file, so its import goes.

- [ ] **Step 3: Verify the alias still resolves and the build is byte-identical**

```bash
cd frontend
rm -rf dist
npm run build
ls -1 dist/assets/ | sort > /tmp/wave0-after-task1-assets.txt
diff /tmp/wave0-baseline-assets.txt /tmp/wave0-after-task1-assets.txt && echo "IDENTICAL"
```

Expected: `IDENTICAL`. The content hashes in the asset filenames are derived from the bundle contents, so identical filenames prove the alias resolved to the same files and the output did not change.

If the build fails with `Failed to resolve import "@/..."`, the alias is wrong — check that `new URL("./src", import.meta.url).pathname` points at `frontend/src` and not `frontend/src/`-relative-to-cwd.

- [ ] **Step 4: Verify the dev server still starts**

```bash
cd frontend
timeout 15 npm run dev 2>&1 | head -20
```

Expected: `VITE v5.x.x ready in ...` and a `Local: http://localhost:3000/` line, with no resolve errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.js
git commit -m "chore: make vite config ESM-safe ahead of the Vite 7 upgrade

package.json sets type: module, so __dirname only worked because Vite 5
bundles the config through esbuild and shims it. Vite 6 changed config
loading, which would have broken the @ alias and with it every import."
```

---

### Task 2: Move the build toolchain to Node 22

**Files:**
- Modify: `Dockerfile:15` (`FROM node:20-alpine AS web`)
- Modify: `.github/workflows/ci.yml:81` (`node-version: "20"`)

**Interfaces:**
- Consumes: the ESM-safe config from Task 1.
- Produces: a build environment satisfying Vite 7's `^20.19.0 || >=22.12.0` engine requirement. Task 3 depends on this.

- [ ] **Step 1: Update the Docker web stage**

In `Dockerfile`, change line 15 from:

```dockerfile
FROM node:20-alpine AS web
```

to:

```dockerfile
# Node 20 went EOL in April 2026. 22 is LTS and clears Vite's >=22.12 floor
# with room to spare, so the tag can keep floating for security patches.
FROM node:22-alpine AS web
```

- [ ] **Step 2: Update CI**

In `.github/workflows/ci.yml`, change line 81 from:

```yaml
          node-version: "20"
```

to:

```yaml
          node-version: "22"
```

The adjacent comment on line 80 reads `# Matches the web build stage in the root Dockerfile.` — it stays accurate and needs no edit.

- [ ] **Step 3: Verify the image still builds on Node 22, still on Vite 5**

This isolates the runtime change from the Vite change.

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
docker build -t mygist:wave0-node22 .
```

Expected: build succeeds. Watch the `npm ci` step for `EBADENGINE` warnings — there should be none, since every current dependency supports Node 22.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .github/workflows/ci.yml
git commit -m "chore: build the frontend on Node 22

Node 20 reached EOL in April 2026, and Vite 7 needs ^20.19 || >=22.12.
Pinning to 20.19 would sit one patch above the floor on an unsupported
runtime; 22 clears it with headroom and is already what we run locally."
```

---

### Task 3: Upgrade Vite 5 to Vite 7

**Files:**
- Modify: `frontend/package.json` (the `vite` and `@vitejs/plugin-react` devDependencies)
- Modify: `frontend/package-lock.json` (regenerated by npm)

**Interfaces:**
- Consumes: the ESM-safe config (Task 1) and Node 22 (Task 2).
- Produces: `vite@7.3.6` in `frontend/package-lock.json`. Wave 1 depends on this to install `vitest@4`, whose peer range is `vite ^6 || ^7 || ^8`.

- [ ] **Step 1: Install Vite 7**

```bash
cd frontend
npm install --save-dev vite@^7.3.6 @vitejs/plugin-react@^4.7.0
```

- [ ] **Step 2: Confirm the resolved versions and check for peer conflicts**

```bash
cd frontend
npm ls vite @vitejs/plugin-react
```

Expected: `vite@7.3.6` and `@vitejs/plugin-react@4.7.0`, with no `UNMET PEER DEPENDENCY` lines. If npm reports a peer conflict, stop and report it rather than reaching for `--legacy-peer-deps` — a genuine conflict here means the version matrix in the spec is wrong and should be re-derived.

- [ ] **Step 3: Build and compare against the Task 1 baseline**

```bash
cd frontend
rm -rf dist
npm run build
ls -1 dist/assets/ | sort > /tmp/wave0-after-vite7-assets.txt
diff /tmp/wave0-baseline-assets.txt /tmp/wave0-after-vite7-assets.txt || true
```

Expected: the build succeeds and emits one JS and one CSS asset. **The hashes will differ from the baseline, and that is correct** — Vite 7's default build target is `baseline-widely-available`, where Vite 5's was `modules`, so the emitted code genuinely changes. What matters is that the file *count* and *kinds* match. A new chunk appearing, or the CSS vanishing, is a real problem.

- [ ] **Step 4: Verify the version stamp and API defaults survived**

`vite.config.js` injects `__APP_VERSION__` and `__APP_COMMIT__` via `define`, and reads `./package.json` as a JSON import — both are config-loader-sensitive.

```bash
cd frontend
grep -o '2\.0\.0' dist/assets/*.js | head -1
```

Expected: one match. The version label is rendered in `App.jsx` as `v${__APP_VERSION__}`, so an empty result means `define` silently produced `undefined` and the JSON import broke.

- [ ] **Step 5: Verify the dev server and its proxies**

The proxy config for `/api`, `/mcp` and `/docs` is what keeps local development shaped like production.

```bash
cd frontend
timeout 15 npm run dev 2>&1 | head -20
```

Expected: `VITE v7.3.6 ready in ...` and `Local: http://localhost:3000/`.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: upgrade Vite 5 to 7

Required by Vitest 4 (peer: vite ^6 || ^7 || ^8), which wave 1 needs for
Storybook's addon-vitest. Not Vite 8 -- it moves to Rolldown and requires
plugin-react 6, which is more change than this needs.

Asset hashes shift because Vite 7 defaults to the baseline-widely-available
build target rather than modules. No source file changed."
```

---

### Task 4: Verify the production container end-to-end

The single-container merge means the frontend build and the backend ship as one image, so a frontend regression blocks backend deploys. This task is the real gate on the wave.

The security headers added in PR #11 compute CSP `script-src` hashes at startup by scanning the *built* HTML. Vite minifies the inline theme script in `frontend/index.html:8-16` during build, so its hash depends on the bundler's output — which just changed. The hashing is designed to be self-correcting, but that has never been exercised across a Vite major, so it gets checked explicitly here.

**Files:**
- No files modified. This is verification only.

**Interfaces:**
- Consumes: the image produced from Tasks 1-3.
- Produces: evidence the wave is safe to deploy.

- [ ] **Step 1: Build and run the image**

**Point this at the local test database, never at `backend/.env`.** The image's
`CMD` runs `alembic upgrade head` on startup, so handing it the production
`DATABASE_URL` would run migrations against live persona data from a throwaway
container. The local test database already exists on port 5433 — the same one
`backend/tests/conftest.py:7` uses.

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
docker build -t mygist:wave0 .
docker run -d --name mygist-wave0 -p 8099:8000 \
  -e DATABASE_URL="postgresql://mygist:mygist@host.docker.internal:5433/mygist_test" \
  mygist:wave0
```

Wait for the container to report healthy:

```bash
until [ "$(docker inspect -f '{{.State.Health.Status}}' mygist-wave0)" = "healthy" ]; do
  sleep 2; echo "waiting..."
done; echo "healthy"
```

Expected: `healthy` within roughly 30 seconds. If it never becomes healthy, `docker logs mygist-wave0` — an Alembic failure here is unrelated to this wave and means the `DATABASE_URL` above pointed somewhere unexpected.

- [ ] **Step 2: Verify every inline script in the served HTML is covered by the CSP**

This is the check that matters. If a hash is missing, the theme script is blocked and the app flashes light-then-dark on every load, with nothing failing loudly.

```bash
python3 - <<'PY'
import re, hashlib, base64, urllib.request
resp = urllib.request.urlopen("http://localhost:8099/")
html = resp.read().decode()
csp = resp.headers.get("Content-Security-Policy", "")
inline = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)
print(f"inline scripts found: {len(inline)}")
ok = True
for body in inline:
    h = "sha256-" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    present = h in csp
    ok &= present
    print(f"  {'OK  ' if present else 'MISS'} {h}")
print("RESULT:", "PASS" if ok and inline else "FAIL")
PY
```

Expected: `inline scripts found: 1`, one `OK` line, `RESULT: PASS`.

- [ ] **Step 3: Verify caching, compression and the API**

```bash
echo "--- SPA shell should not be cached ---"
curl -sI http://localhost:8099/ | grep -i 'cache-control'
echo "--- hashed asset should be immutable ---"
ASSET=$(curl -s http://localhost:8099/ | grep -o '/assets/[^"]*\.js' | head -1)
echo "asset: $ASSET"
curl -sI "http://localhost:8099$ASSET" | grep -i 'cache-control'
echo "--- gzip ---"
curl -sI -H 'Accept-Encoding: gzip' "http://localhost:8099$ASSET" | grep -i 'content-encoding'
echo "--- api ---"
curl -s -o /dev/null -w 'health:%{http_code}\n' http://localhost:8099/api/health
curl -s -o /dev/null -w 'files(401 expected):%{http_code}\n' http://localhost:8099/api/files
curl -s -o /dev/null -w 'docs:%{http_code}\n' http://localhost:8099/api/docs
```

Expected: `no-cache` on `/`; `public, max-age=31536000, immutable` on the asset; `gzip`; `health:200`; `files(401 expected):401`; `docs:200`.

- [ ] **Step 4: Load the app in a browser and confirm it renders**

```bash
open http://localhost:8099/
```

Check by eye: the app renders, the theme matches your system setting with no flash, the section tabs are present, and the version label at the bottom of the tab strip reads `v2.0.0 (<commit>)` rather than `vundefined`. Open the browser console and confirm there are no CSP violation errors.

- [ ] **Step 5: Tear down**

```bash
docker rm -f mygist-wave0
```

- [ ] **Step 6: Commit nothing, but record the result**

There is no code change in this task. If every check passed, proceed to Task 5. If any failed, stop and diagnose before opening the PR — use `superpowers:systematic-debugging`, and do not layer a fix on top of a partially-understood failure.

---

### Task 5: Ship it

**Files:**
- No files modified.

**Interfaces:**
- Consumes: verified commits from Tasks 1-4.
- Produces: `main` containing Vite 7, deployed to production. Wave 1 is blocked until this completes.

- [ ] **Step 1: Push the branch**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git push -u origin chore/vite-7-upgrade
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "chore: upgrade the frontend build to Vite 7 on Node 22" --body "$(cat <<'EOF'
Wave 0 of the section editor consolidation
(`docs/superpowers/specs/2026-07-27-section-editor-consolidation-design.md`).

Vitest 4 requires Vite 6+, and Storybook 10's `addon-vitest` requires
Vitest 4, so wave 1's test harness is blocked until the build moves up.

Three changes, no source file touched:

- `vite.config.js` no longer relies on `__dirname`. `package.json` sets
  `type: module`, so that only ever worked because Vite 5 bundles the
  config through esbuild and shims it. Vite 6 changed config loading —
  left alone, this would have broken the `@` alias and every import.
- Build stage moves from Node 20 to 22. Node 20 went EOL in April 2026;
  the spec called for pinning 20.19, but that is one patch above Vite 7's
  floor on an unsupported runtime.
- Vite 5 → 7.3.6. Not 8, which moves to Rolldown and needs plugin-react 6.

Asset hashes change because Vite 7 defaults to the
`baseline-widely-available` build target rather than `modules`. Output is
still one JS and one CSS chunk.

Verified against the built container: CSP `script-src` still covers the
inline theme script (hashes are computed from built HTML at startup, so
they self-correct across the bundler change — checked explicitly, not
assumed), SPA shell `no-cache`, hashed assets `immutable`, gzip on,
`/api/health` 200, `/api/files` 401, `/api/docs` 200, version label
renders.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI**

```bash
gh pr checks --watch
```

Expected: the `backend` matrix jobs and `frontend build` all pass. The frontend job now runs on Node 22.

- [ ] **Step 4: Merge**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Deploy and verify production**

Trigger the Coolify deploy for `mygist.thuradev.qzz.io`, then:

```bash
curl -s -o /dev/null -w 'health:%{http_code}\n' https://mygist.thuradev.qzz.io/api/health
curl -sI https://mygist.thuradev.qzz.io/ | grep -i 'content-security-policy' | head -c 200; echo
```

Then load `https://mygist.thuradev.qzz.io/` in a browser, confirm it renders with no console CSP errors, and confirm the version label shows the new commit.

**This deploy is the gate on wave 1.** Do not start the test-harness work until production is confirmed healthy on Vite 7.

---

## Rollback

If production breaks after deploy, revert the squashed merge commit and redeploy:

```bash
git revert -m 1 <merge-sha>
git push origin main
```

Nothing in this wave touches the database, stored persona data, or the backend, so a revert is a clean return to the previous image with no data considerations.

## What this wave does not do

- Add any test. Wave 1 does that; wave 0 is verified by builds and container smoke tests, which is why its tasks have verification steps rather than TDD cycles.
- Touch anything under `frontend/src/`.
- Upgrade Tailwind, or any dependency other than `vite` and `@vitejs/plugin-react`.
