import path from "node:path";
import { defineConfig } from "vitest/config";

// The suite targets pure logic (see AGENTS.md), so this only needs to fix up
// module resolution, not add a DOM/React plugin pipeline.
export default defineConfig({
  resolve: {
    alias: {
      // react-native's real package entry uses Flow-only syntax vitest's
      // Vite-based transform can't parse. See test/react-native-mock.ts.
      "react-native": path.resolve(__dirname, "./test/react-native-mock.ts"),
      // The real module needs expo-modules-core's native bridge, which
      // doesn't exist under vitest. See test/expo-file-system-legacy-mock.ts.
      "expo-file-system/legacy": path.resolve(
        __dirname,
        "./test/expo-file-system-legacy-mock.ts"
      ),
    },
  },
});
