// Minimal stand-in for "expo-file-system/legacy", used only by
// vitest.config.ts's resolve alias.
//
// The real module bottoms out in expo-modules-core's native bridge
// (`globalThis.expo.EventEmitter`, …), which only exists inside an actual
// Expo runtime - not under vitest/node. Nothing under vitest's pure-logic
// test scope (see AGENTS.md) exercises real file IO through this; callers
// (diagnostics-store.ts) already treat a failed read/write as "no
// persistence this run" via try/catch, so rejecting is a faithful stand-in.
// Extend this file if a future test needs more of the surface.
export const documentDirectory = "/mock-document-directory/";

const unavailable = (name: string) => () =>
  Promise.reject(new Error(`expo-file-system mock: ${name} is not implemented for tests`));

export const makeDirectoryAsync = unavailable("makeDirectoryAsync");
export const writeAsStringAsync = unavailable("writeAsStringAsync");
export const readAsStringAsync = unavailable("readAsStringAsync");
