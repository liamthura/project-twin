import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
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
      "@": path.resolve(__dirname, "./src"),
    },
    extensions: [".mjs", ".js", ".jsx", ".ts", ".tsx", ".json"],
  },
  // Environment variables exposed to client
  // VITE_API_URL - Backend API URL (optional, defaults to /api)
  // VITE_API_TOKEN - Default API token (optional, can be set in UI)
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  // Build options for production
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
