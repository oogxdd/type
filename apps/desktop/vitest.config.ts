import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone config for unit tests. The suite is pure logic by default, so it
// deliberately skips the React/Tailwind plugins and Tauri dev server from
// vite.config.ts and only mirrors the `@/` path alias. The few tests that need
// a document (a real ProseMirror view) opt in per file with
// `// @vitest-environment jsdom`.
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
