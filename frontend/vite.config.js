import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import pkg from "./package.json";

let commit = process.env.APP_COMMIT || "dev";
if (!process.env.APP_COMMIT) {
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
