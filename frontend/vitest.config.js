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
