import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import pkg from "./package.json";

// Commit hash for the version label: explicit APP_COMMIT wins, then the
// vars deployment platforms inject at build time, then a local git probe.
const envCommit =
  process.env.APP_COMMIT ||
  process.env.SOURCE_COMMIT ||
  process.env.GIT_COMMIT ||
  process.env.COMMIT_SHA;
let commit = envCommit ? envCommit.slice(0, 7) : "dev";
if (!envCommit) {
  try {
    commit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {}
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  plugins: [react()],
  resolve: {
    alias: {
      // Not __dirname: package.json sets "type": "module", so this file is an
      // ES module and __dirname only resolved because Vite 5 bundles the
      // config through esbuild and shims it. Vite 6+ changed config loading.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    extensions: [".mjs", ".js", ".jsx", ".ts", ".tsx", ".json"],
  },
  // Environment variables exposed to client
  // VITE_API_URL - Backend API URL (optional, defaults to /api)
  // VITE_API_TOKEN - Default API token (optional, can be set in UI)
  server: {
    port: 3000,
    // In production one origin serves all of these. Proxying them in dev
    // keeps the local shape identical to deployed.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:1120",
        changeOrigin: true,
      },
      "/mcp": {
        target: "http://127.0.0.1:1120",
        changeOrigin: true,
      },
      "/docs": {
        target: "http://127.0.0.1:1120",
        changeOrigin: true,
      },
      // Better Auth, proxied by FastAPI in production (backend/auth_proxy.py).
      // Proxied here too so the session cookie is same-origin in development --
      // pointing the browser straight at the auth service would make it
      // cross-site, and the cookie would be dropped.
      "/auth": {
        target: "http://127.0.0.1:1120",
        changeOrigin: true,
      },
    },
  },
  // Build options for production
  build: {
    outDir: "dist",
    sourcemap: false,
    // Vite 7 defaults to "baseline-widely-available" (safari16, chrome107)
    // where Vite 5 defaulted to "modules" (safari14, chrome87). Pinned so the
    // toolchain upgrade ships no behaviour change; raising the browser floor
    // is a separate, deliberate decision.
    //
    // Not the literal string "modules": Vite 5 special-cased that string to
    // this exact esbuild target list internally (constants.js
    // ESBUILD_MODULES_TARGET), but Vite 7 dropped that alias -- only
    // "baseline-widely-available" is special-cased now -- so "modules"
    // passed straight through fails as an unrecognised esbuild target.
    // Spelling out the array is what actually reproduces Vite 5's default.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
  },
});
