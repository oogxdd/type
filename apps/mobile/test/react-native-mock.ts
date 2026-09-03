// Minimal stand-in for the "react-native" package, used only by
// vitest.config.ts's resolve alias.
//
// vitest's Vite-based transform cannot parse react-native's real package
// entry (`node_modules/react-native/index.js` does `import typeof * as
// ReactNativePublicAPI from "...index.js.flow"`, which is Flow-only syntax).
// Nothing under vitest's pure-logic test scope (see AGENTS.md) needs the real
// native implementation - so far only `Platform.OS`, transitively through
// `expo-file-system/legacy`. Extend this file if a future test's import graph
// needs more of the surface; don't try to make vitest load the real package.
export const Platform = {
  OS: "ios" as const,
  select: <T,>(spec: { ios?: T; android?: T; native?: T; default?: T }): T | undefined =>
    spec.ios ?? spec.native ?? spec.default,
};
