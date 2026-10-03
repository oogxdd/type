import { transformFileSync } from "@babel/core";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("serializes into an isolated worker without capturing application modules", () => {
  const { code } = transformFileSync(fileURLToPath(new URL("./note-processing.ts", import.meta.url)), {
    configFile: false,
    babelrc: false,
    plugins: ["@babel/plugin-transform-typescript", "react-native-worklets/plugin"],
  });
  const rn = vm.createContext({});
  vm.runInContext("global = globalThis", rn);
  const original = vm.runInContext(code.replace(/^export /gm, "") + "\nprocessNoteJob", rn);
  expect(original.__workletHash).toBeTruthy();
  expect(Object.keys(original.__closure)).toEqual([]);
  const worker = vm.runInNewContext(`(${original.__initData.code})`, {});
  worker({ kind: "reset", scope: "serialized" });
  const preview = {
    title: "Привет 🦀", secondLine: "", createdMs: Date.now(), updatedMs: Date.now(),
    isArchived: false, isReviewed: false, isRecording: false, isHandwriting: false,
    archivedMs: null, reviewedMs: null, recordingAudioPath: null,
    handwritingAttachmentPath: null, transcriptionStatus: null, ocrStatus: null,
  };
  worker({ kind: "update", scope: "serialized", changes: [["a.md", { version: "v1", preview }]], removed: [] });
  const feed = worker({ kind: "feed", scope: "serialized", key: "menu", notes: [{ path: "a.md", name: "a.md" }], filter: "all", now: Date.now() });
  expect(feed.sections[0].data[0].preview.title).toBe(preview.title);
  const raw = worker({ kind: "snapshot", scope: "serialized" }).raw;
  worker({ kind: "reset", scope: "next" });
  const restored = worker({ kind: "restore", scope: "next", raw });
  expect(restored.changes[0][1].preview.title).toBe(preview.title);
});
