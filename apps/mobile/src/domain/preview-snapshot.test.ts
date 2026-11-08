import { describe, expect, it } from "vitest";

import { formatNoteDateLabel, type NotePreview } from "@typenotes/shared/format";

import {
  PREVIEW_SNAPSHOT_FORMAT,
  parsePreviewSnapshot,
  serializePreviewSnapshot,
  type VersionedPreview,
} from "./preview-snapshot";

const preview = (title: string, updatedMs: number): NotePreview => ({
  title,
  tags: ["work"],
  dateLabel: "a label from the day it was saved",
  secondLine: "second line",
  createdMs: updatedMs - 1000,
  updatedMs,
  archivedMs: null,
  reviewedMs: null,
  isArchived: false,
  isReviewed: false,
  isRecording: false,
  isHandwriting: false,
  recordingAudioPath: null,
  handwritingAttachmentPath: null,
  transcriptionStatus: null,
  ocrStatus: null,
});

describe("preview snapshot", () => {
  it("round-trips previews with the versions they were read at", () => {
    const updatedMs = Date.UTC(2025, 6, 1, 8, 30);
    const notes = new Map<string, VersionedPreview>([
      ["_system/stream/a.md", { version: "v1", preview: preview("first", updatedMs) }],
      ["Work/b.md", { version: "v2", preview: preview("second", updatedMs + 1) }],
    ]);

    const restored = parsePreviewSnapshot(serializePreviewSnapshot(notes));

    expect([...restored.keys()]).toEqual(["_system/stream/a.md", "Work/b.md"]);
    expect(restored.get("Work/b.md")?.version).toBe("v2");
    expect(restored.get("_system/stream/a.md")?.preview).toEqual({
      ...preview("first", updatedMs),
      dateLabel: formatNoteDateLabel(updatedMs),
    });
  });

  it("recomputes the relative date label instead of storing it", () => {
    // "10:15" saved today must read "yesterday" tomorrow.
    const raw = serializePreviewSnapshot(
      new Map([["a.md", { version: "v1", preview: preview("a", Date.now()) }]])
    );
    expect(raw).not.toContain("a label from the day it was saved");
  });

  it("treats a corrupt or foreign snapshot as no snapshot", () => {
    expect(parsePreviewSnapshot("{ not json").size).toBe(0);
    expect(parsePreviewSnapshot("null").size).toBe(0);
    expect(
      parsePreviewSnapshot(JSON.stringify({ format: PREVIEW_SNAPSHOT_FORMAT + 1, notes: {} })).size
    ).toBe(0);
    const mixed = JSON.stringify({
      format: PREVIEW_SNAPSHOT_FORMAT,
      notes: {
        "ok.md": ["v1", { title: "ok", updatedMs: null }],
        "no-version.md": [null, { title: "x" }],
        "not-an-entry.md": "v1",
      },
    });
    expect([...parsePreviewSnapshot(mixed).keys()]).toEqual(["ok.md"]);
  });
});
