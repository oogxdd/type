import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingRecording } from "./recording-session";

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map((part) => typeof part === "string" ? part : part.uri).join("/"); }
    get name() { return this.uri.split("/").pop()!; }
    get exists() { return disk.has(this.uri); }
    write(text: string) { disk.set(this.uri, text); }
    textSync() { if (!this.exists) throw new Error("missing"); return disk.get(this.uri)!; }
    delete() { disk.delete(this.uri); }
    moveSync(other: File) {
      if (other.exists) throw new Error("destination exists");
      disk.set(other.uri, this.textSync()); disk.delete(this.uri); this.uri = other.uri;
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join("/"); }
    create() {}
    list() { return [...disk.keys()].filter((path) => path.startsWith(`${this.uri}/`)).map((path) => new File(path)); }
  }
  return { File, Directory, Paths: { document: "file:///documents" } };
});
import { forgetRecording, pendingRecordings, rememberRecording } from "./recording-journal";

const clip: PendingRecording = {
  id: "test", profileId: "fixture", notesRoot: "/fixture", uri: "file:///documents/ExpoAudio/recording-abc.wav",
  mimeType: "audio/wav", startedAt: 100,
};
beforeEach(() => disk.clear());
describe("durable recording journal", () => {
  it("recovers only the original profile and root", () => {
    rememberRecording(clip);
    expect(pendingRecordings("fixture", "/fixture")).toEqual([clip]);
    expect(pendingRecordings("other", "/fixture")).toEqual([]);
    expect(pendingRecordings("fixture", "/changed-root")).toEqual([]);
  });
  it("persists saved receipts without replacing the original recovery entry", () => {
    rememberRecording(clip);
    const original = [...disk.values()][0];
    rememberRecording({ ...clip, notePath: "saved.md" });
    expect([...disk.values()]).toContain(original);
    expect(pendingRecordings("fixture", "/fixture")[0].notePath).toBe("saved.md");
    rememberRecording({ ...clip, notePath: "saved.md" });
    expect(disk.size).toBe(2);
  });
  it("ignores incomplete writes and preserves corrupt entries", () => {
    disk.set("file:///documents/typenotes/pending-recordings/test.tmp", JSON.stringify(clip));
    disk.set("file:///documents/typenotes/pending-recordings/broken.json", "{");
    expect(pendingRecordings("fixture", "/fixture")).toEqual([]);
    expect(disk.size).toBe(2);
  });
  it("removes temporary audio and journal only after a saved receipt", () => {
    rememberRecording(clip); rememberRecording({ ...clip, notePath: "saved.md" });
    disk.set(clip.uri, "samples");
    forgetRecording({ ...clip, notePath: "saved.md" });
    expect(disk.size).toBe(0);
  });
  it("preserves Android's Audio directory", () => {
    const android = { ...clip, uri: "file:///android/files/Audio/recording-abc.m4a", mimeType: "audio/mp4" };
    rememberRecording(android);
    expect(pendingRecordings("fixture", "/fixture")[0].uri).toBe(android.uri);
  });
  it("finds the audio after iOS relocates the app container", () => {
    rememberRecording({ ...clip, uri: "file:///old/Documents/ExpoAudio/recording-abc.wav" });
    expect(pendingRecordings("fixture", "/fixture")[0].uri).toBe(clip.uri);
  });
});
