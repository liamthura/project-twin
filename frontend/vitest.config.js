import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";
import { playwright } from "@vitest/browser-playwright";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { fileURLToPath } from "node:url";

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
            // Pinned so date rendering is deterministic instead of a
            // property of whoever's laptop ran the suite. Deliberately NOT
            // UTC: several display paths format through local-time getters,
            // and at UTC+0 an offset bug and correct code produce identical
            // output -- which is exactly how the `display_formats: "date"`
            // off-by-one day survived wave 3. America/New_York is negative
            // year-round and observes DST, so it catches both an unhandled
            // offset and anything that assumes a fixed one.
            env: { TZ: "America/New_York" },
          },
        },
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
      ],
    },
  })
);
