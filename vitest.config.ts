import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone config for unit tests. The suite targets pure logic (no DOM), so
// it deliberately skips the React/Tailwind plugins and Tauri dev server from
// vite.config.ts and only mirrors the `@/` path alias.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
