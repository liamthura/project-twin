import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
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
