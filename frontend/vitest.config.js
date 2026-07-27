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
