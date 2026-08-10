import { describe, expect, it, vi } from "vitest";

import type { AudioImportState } from "@typenotes/shared/types";

import {
  audioFileExtension,
  audioFileLabel,
  audioMimeType,
  describeImportOutcome,
  fileUriToPath,
  importAudioFiles,
  isSupportedAudioFile,
  type AudioImportDeps,
} from "./audio-import";

const doneStatus = (overrides: Partial<AudioImportState> = {}): AudioImportState => ({
  running: false,
  done: true,
  total: 1,
  processed: 1,
  imported: 1,
  failed: 0,
  current: "",
  target_folder: "Feed",
  error: null,
  errors: [],
  ...overrides,
});

const makeDeps = (overrides: Partial<AudioImportDeps> = {}): AudioImportDeps => ({
  supportsPathImport: () => true,
  importByPath: vi.fn(async () => {}),
  pollStatus: vi.fn(async () => doneStatus()),
  readBase64: vi.fn(async () => "YXVkaW8="),
  saveRecording: vi.fn(async () => {}),
  discard: vi.fn(async () => {}),
  wait: async () => {},
  ...overrides,
});

describe("file identification", () => {
  it("reads the extension off URLs, paths, and bare names", () => {
    expect(audioFileExtension("file:///var/Inbox/memo.m4a")).toBe("m4a");
    expect(audioFileExtension("/var/Inbox/memo.M4A")).toBe("m4a");
    expect(audioFileExtension("memo.mp3")).toBe("mp3");
    expect(audioFileExtension("file:///a/memo.wav?x=1#y")).toBe("wav");
    expect(audioFileExtension("/var/Inbox/no-extension")).toBe("");
    // A dot in the directory must not be read as the file's extension.
    expect(audioFileExtension("/var/my.folder/memo")).toBe("");
  });

  it("accepts audio Type can transcribe and rejects everything else", () => {
    expect(isSupportedAudioFile("New Recording 3.m4a")).toBe(true);
    expect(isSupportedAudioFile("file:///a/b.MP3")).toBe(true);
    expect(isSupportedAudioFile("note.md")).toBe(false);
    expect(isSupportedAudioFile("photo.jpg")).toBe(false);
    expect(isSupportedAudioFile("type2://sync?remote=x")).toBe(false);
  });

  it("maps extensions to the MIME type the core turns back into a file name", () => {
    expect(audioMimeType("memo.m4a")).toBe("audio/mp4");
    expect(audioMimeType("memo.mp3")).toBe("audio/mpeg");
    expect(audioMimeType("memo.wav")).toBe("audio/wav");
    // The iPhone default, for anything unrecognized that got this far.
    expect(audioMimeType("memo.unknown")).toBe("audio/mp4");
  });
});

describe("fileUriToPath", () => {
  it("strips the scheme and decodes escapes", () => {
    expect(fileUriToPath("file:///var/Inbox/New%20Recording%203.m4a")).toBe(
      "/var/Inbox/New Recording 3.m4a"
    );
  });

  it("passes plain paths through", () => {
    expect(fileUriToPath("/var/Inbox/memo.m4a")).toBe("/var/Inbox/memo.m4a");
  });

  it("keeps the raw path when the escapes are malformed", () => {
    expect(fileUriToPath("file:///var/Inbox/100%.m4a")).toBe("/var/Inbox/100%.m4a");
  });

  it("labels a file by name, falling back to the last path segment", () => {
    expect(audioFileLabel({ uri: "file:///a/b.m4a", name: "Memo.m4a" })).toBe("Memo.m4a");
    expect(audioFileLabel({ uri: "file:///a/New%20Memo.m4a" })).toBe("New Memo.m4a");
  });
});

describe("importAudioFiles — native path import", () => {
  it("hands the core plain absolute paths and reports the final counts", async () => {
    const deps = makeDeps({
      pollStatus: vi.fn(async () => doneStatus({ total: 2, imported: 2 })),
    });

    const outcome = await importAudioFiles(
      [
        { uri: "file:///var/Inbox/New%20Recording.m4a" },
        { uri: "file:///var/Inbox/other.mp3" },
      ],
      deps
    );

    expect(deps.importByPath).toHaveBeenCalledWith([
      "/var/Inbox/New Recording.m4a",
      "/var/Inbox/other.mp3",
    ]);
    expect(outcome).toEqual({ imported: 2, failed: 0, errors: [] });
    expect(deps.readBase64).not.toHaveBeenCalled();
  });

  it("polls until the background copy reports done", async () => {
    const pollStatus = vi
      .fn<() => Promise<AudioImportState>>()
      .mockResolvedValueOnce(doneStatus({ running: true, done: false, processed: 0, imported: 0 }))
      .mockResolvedValueOnce(doneStatus());
    const deps = makeDeps({ pollStatus });

    const outcome = await importAudioFiles([{ uri: "/var/memo.m4a" }], deps);

    expect(pollStatus).toHaveBeenCalledTimes(2);
    expect(outcome.imported).toBe(1);
  });

  it("gives up rather than polling forever when the worker never finishes", async () => {
    let clock = 0;
    const deps = makeDeps({
      pollStatus: vi.fn(async () => doneStatus({ running: true, done: false })),
      // Each wait advances the clock past the poll timeout.
      wait: async () => {
        clock += 60_000;
      },
      now: () => clock,
    });

    await expect(importAudioFiles([{ uri: "/var/memo.m4a" }], deps)).rejects.toThrow(
      /taking too long/i
    );
  });

  it("surfaces a run that aborted, keeping whatever landed first", async () => {
    const deps = makeDeps({
      pollStatus: vi.fn(async () =>
        doneStatus({ total: 3, imported: 1, error: "Notes folder is missing." })
      ),
    });

    const outcome = await importAudioFiles(
      [{ uri: "/a.m4a" }, { uri: "/b.m4a" }, { uri: "/c.m4a" }],
      deps
    );

    expect(outcome.imported).toBe(1);
    expect(outcome.failed).toBe(2);
    expect(outcome.errors[0]).toBe("Notes folder is missing.");
  });

  it("discards only a private picker copy after a fully successful import", async () => {
    const imported = makeDeps();
    await importAudioFiles(
      [{ uri: "file:///cache/memo.m4a", discardAfterImport: true }],
      imported
    );
    expect(imported.discard).toHaveBeenCalledWith("file:///cache/memo.m4a");

    const sharedOriginal = makeDeps();
    await importAudioFiles(
      [{ uri: "file:///provider/memo.m4a" }],
      sharedOriginal
    );
    expect(sharedOriginal.discard).not.toHaveBeenCalled();

    const nothing = makeDeps({
      pollStatus: vi.fn(async () => doneStatus({ imported: 0, failed: 1, errors: ["nope"] })),
    });
    await importAudioFiles(
      [{ uri: "file:///cache/memo.m4a", discardAfterImport: true }],
      nothing
    );
    expect(nothing.discard).not.toHaveBeenCalled();
  });

  it("keeps all temporary copies when a bulk import only partly succeeds", async () => {
    const partial = makeDeps({
      pollStatus: vi.fn(async () =>
        doneStatus({ total: 2, imported: 1, failed: 1, errors: ["bad.m4a: nope"] })
      ),
    });

    await importAudioFiles(
      [
        { uri: "file:///cache/good.m4a", discardAfterImport: true },
        { uri: "file:///cache/bad.m4a", discardAfterImport: true },
      ],
      partial
    );

    expect(partial.discard).not.toHaveBeenCalled();
  });
});

describe("importAudioFiles — base64 fallback", () => {
  it("saves each file through the recording path when import-by-path is missing", async () => {
    const deps = makeDeps({ supportsPathImport: () => false });

    const outcome = await importAudioFiles(
      [{ uri: "file:///a/memo.m4a" }, { uri: "file:///a/talk.mp3" }],
      deps
    );

    expect(deps.importByPath).not.toHaveBeenCalled();
    expect(deps.saveRecording).toHaveBeenCalledWith("YXVkaW8=", "audio/mp4");
    expect(deps.saveRecording).toHaveBeenCalledWith("YXVkaW8=", "audio/mpeg");
    expect(outcome).toEqual({ imported: 2, failed: 0, errors: [] });
  });

  it("keeps importing after one file fails, and names the one that did", async () => {
    const deps = makeDeps({
      supportsPathImport: () => false,
      readBase64: vi.fn(async (uri: string) => {
        if (uri.includes("broken")) {
          throw new Error("File not found");
        }
        return "YXVkaW8=";
      }),
    });

    const outcome = await importAudioFiles(
      [{ uri: "/a/broken.m4a" }, { uri: "/a/good.m4a" }],
      deps
    );

    expect(outcome.imported).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.errors[0]).toBe("broken.m4a: File not found");
  });

  it("treats an empty read as a failure instead of saving a silent note", async () => {
    const deps = makeDeps({
      supportsPathImport: () => false,
      readBase64: vi.fn(async () => ""),
    });

    const outcome = await importAudioFiles([{ uri: "/a/memo.m4a" }], deps);

    expect(deps.saveRecording).not.toHaveBeenCalled();
    expect(outcome.failed).toBe(1);
  });
});

describe("importAudioFiles — rejection", () => {
  it("never sends unsupported files to the core", async () => {
    const deps = makeDeps();

    const outcome = await importAudioFiles(
      [{ uri: "/a/notes.md" }, { uri: "/a/memo.m4a" }],
      deps
    );

    expect(deps.importByPath).toHaveBeenCalledWith(["/a/memo.m4a"]);
    expect(outcome.imported).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.errors[0]).toMatch(/notes\.md/);
  });

  it("does not start an import run at all when nothing is supported", async () => {
    const deps = makeDeps();

    const outcome = await importAudioFiles([{ uri: "/a/photo.jpg" }], deps);

    expect(deps.importByPath).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      imported: 0,
      failed: 1,
      errors: ["photo.jpg: not an audio file Type can read."],
    });
  });
});

describe("describeImportOutcome", () => {
  const ok = { imported: 1, failed: 0, errors: [] };

  it("names what happens next, per transcription mode", () => {
    expect(describeImportOutcome(ok, "assemblyai")).toBe(
      "Imported recording — transcribing via AssemblyAI"
    );
    expect(describeImportOutcome({ ...ok, imported: 3 }, "native")).toBe(
      "Imported 3 recordings — transcribing on this device"
    );
    expect(describeImportOutcome(ok, "desktop")).toBe(
      "Imported recording — your desktop will transcribe after sync"
    );
    expect(describeImportOutcome(ok, "off")).toBe("Imported recording");
  });

  it("reports a queueing failure without hiding that the import worked", () => {
    expect(describeImportOutcome(ok, "assemblyai", "No API key")).toBe(
      "Imported recording, but queueing failed: No API key"
    );
  });

  it("leads with the failure when only some files landed", () => {
    expect(
      describeImportOutcome(
        { imported: 1, failed: 1, errors: ["b.m4a: File is empty."] },
        "assemblyai"
      )
    ).toBe("Imported recording, 1 failed — b.m4a: File is empty.");
  });

  it("shows just the error when nothing landed", () => {
    expect(
      describeImportOutcome({ imported: 0, failed: 1, errors: ["boom"] }, "assemblyai")
    ).toBe("boom");
    expect(describeImportOutcome({ imported: 0, failed: 0, errors: [] }, "off")).toBe(
      "Nothing to import."
    );
  });
});
