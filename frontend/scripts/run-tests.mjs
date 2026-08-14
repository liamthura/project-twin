#!/usr/bin/env node
/**
 * Runs vitest with a wall clock, and in its own process group.
 *
 * This exists because a test run once spun a core at 100% for two and a half
 * days. `rowRemovalConfirmation.test.jsx` hung before the Radix dedupe in
 * 61f349f; the run was killed, but only the npm wrapper died -- the vitest
 * worker fork was orphaned onto launchd and kept going until it was found by
 * accident. A laptop got hot for three days over a test that takes 217ms.
 *
 * Two things go wrong, and `--testTimeout` fixes neither:
 *
 *   1. A SYNCHRONOUS hang cannot be timed out from inside. Vitest enforces
 *      testTimeout with a timer on the same thread, so a busy loop blocks the
 *      event loop and the timer never fires. The run that hung had
 *      `--testTimeout=20000` on it and ignored it completely. Only something
 *      outside the process can stop that, which is the wall clock below.
 *
 *   2. Killing the wrapper does not kill the workers. Vitest's pool forks child
 *      processes; kill the parent and they are reparented, not stopped. So this
 *      puts the whole run in its own process group and signals the GROUP --
 *      including when this script is itself interrupted, which is what makes
 *      Ctrl-C safe.
 *
 * Watch mode deliberately does not go through here: it is meant to run until
 * you stop it, and it reads the terminal. See `test:watch`.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Generous against the real numbers: the whole suite is ~100s locally and CI's
// two-core runner is slower, but nothing legitimate approaches this. It is a
// runaway backstop, not a performance budget.
const DEFAULT_WALL_CLOCK_SECONDS = 900;
// How long a doomed run gets to print its summary before the group is killed
// outright. A merely-slow run exits here; a spinning one cannot, and gets
// SIGKILL, which it has no way to ignore.
const GRACE_MS = 5000;

const wallClockSeconds = Number(
  process.env.VITEST_WALL_CLOCK_SECONDS || DEFAULT_WALL_CLOCK_SECONDS,
);
if (!Number.isFinite(wallClockSeconds) || wallClockSeconds <= 0) {
  console.error(
    `run-tests: VITEST_WALL_CLOCK_SECONDS must be a positive number, got "${process.env.VITEST_WALL_CLOCK_SECONDS}"`,
  );
  process.exit(2);
}

// Resolved rather than taken from PATH: `npm run` puts node_modules/.bin there,
// but running this script directly does not, and a wall clock that only works
// under npm is a wall clock someone will step around.
const require = createRequire(import.meta.url);
const vitestBin = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const child = spawn(process.execPath, [vitestBin, "run", ...process.argv.slice(2)], {
  // Its own process group, so the whole tree can be signalled at once.
  detached: true,
  // stdin is ignored rather than inherited: a detached child that reads the
  // terminal takes SIGTTIN and stops. `vitest run` never needs it.
  stdio: ["ignore", "inherit", "inherit"],
  env: process.env,
  shell: false,
  cwd: process.cwd(),
});

let killing = false;

/** Signal the whole group, not just the leader. Negative pid means group. */
function killGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone, or never started. Either way there is nothing to signal.
  }
}

function shutDown(reason, exitCode) {
  if (killing) return;
  killing = true;
  console.error(`\nrun-tests: ${reason}`);
  killGroup("SIGTERM");
  const graceTimer = setTimeout(() => {
    console.error("run-tests: it did not stop, sending SIGKILL to the process group");
    killGroup("SIGKILL");
    process.exit(exitCode);
  }, GRACE_MS);
  // If it does go quietly, do not sit through the grace period.
  child.once("exit", () => {
    clearTimeout(graceTimer);
    process.exit(exitCode);
  });
}

const wallClock = setTimeout(() => {
  shutDown(
    `no result after ${wallClockSeconds}s -- killing the run. A hang that ignores ` +
      "--testTimeout is usually a synchronous loop; the last test to start is the suspect.",
    1,
  );
}, wallClockSeconds * 1000);

// Interrupting this script must take the workers with it. This is the case that
// created the three-day orphan.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    clearTimeout(wallClock);
    shutDown(`received ${signal} -- stopping the run and its workers`, 130);
  });
}

child.on("error", (err) => {
  clearTimeout(wallClock);
  console.error(`run-tests: could not start vitest: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  clearTimeout(wallClock);
  if (killing) return; // shutDown owns the exit code in that case.
  // Re-report a signal death as a failure rather than as success, which a bare
  // `code ?? 0` would do.
  if (signal) {
    console.error(`run-tests: vitest was killed by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
