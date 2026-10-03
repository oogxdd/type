import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotePreview } from "@typenotes/shared/format";
import type { FolderNode } from "@typenotes/shared/types";
import { feedNoteRows, groupNoteRowsByDate } from "./feed";
import { processNoteJob, type PreviewChange } from "./note-processing";

const scope = "synthetic";
const preview = (title: string, date: number): NotePreview => ({
  title, secondLine: "", dateLabel: "", tags: [], createdMs: date, updatedMs: date,
  archivedMs: null, reviewedMs: null, isArchived: false, isReviewed: false,
  isRecording: false, isHandwriting: false, recordingAudioPath: null,
  handwritingAttachmentPath: null, transcriptionStatus: null, ocrStatus: null,
});

describe("note worker contracts", () => {
  beforeEach(() => { processNoteJob({ kind: "reset", scope }); });

  it("sorts 10,000 notes once, then returns only changed date sections", () => {
    const now = Date.now();
    const folder: FolderNode = { name: "stream", path: "_system/stream", children: [], notes: [] };
    const changes: PreviewChange[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      const path = `_system/stream/${index}.md`;
      folder.notes.push({ path, name: `${index}.md`, version: "v1" });
      changes.push([path, { version: "v1", preview: preview(`note ${index}`, now - index * 3_600_000) }]);
    }
    processNoteJob({ kind: "update", scope, changes, removed: [] });
    const first = processNoteJob({ kind: "feed", scope, key: "menu", notes: folder.notes, filter: "all", now });
    expect(first.sections).toEqual(groupNoteRowsByDate(feedNoteRows(folder, new Map(changes.map(([path, value]) => [path, value.preview])))));

    const sort = vi.spyOn(Array.prototype, "sort");
    try {
      processNoteJob({ kind: "update", scope, changes: [["Work/elsewhere.md", { version: "v1", preview: preview("outside Stream", now) }]], removed: [] });
      expect(processNoteJob({ kind: "feed", scope, key: "menu", filter: "all", now }).sections).toEqual([]);
      const [path, value] = changes[9999];
      processNoteJob({ kind: "update", scope, changes: [[path, { version: "v2", preview: { ...value.preview, title: "edited" } }]], removed: [] });
      const updated = processNoteJob({ kind: "feed", scope, key: "menu", filter: "all", now });
      expect(updated.sections).toHaveLength(1);
      expect(updated.sections![0].data.find((row) => row.path === path)?.preview.title).toBe("edited");
      expect(sort).not.toHaveBeenCalled();
    } finally { sort.mockRestore(); }
  });

  it("moves changed dates, applies filters, and keeps missing previews visible", () => {
    const now = Date.now();
    const notes = [{ path: "a.md", name: "a.md" }, { path: "b.md", name: "b.md" }, { path: "c.md", name: "c.md" }];
    processNoteJob({ kind: "update", scope, changes: [["a.md", { version: "v1", preview: preview("old", now - 30 * 86_400_000) }], ["b.md", { version: "v1", preview: preview("recent", now) }]], removed: [] });
    const initial = processNoteJob({ kind: "feed", scope, key: "test", notes, filter: "all", now });
    expect(initial.sections!.flatMap((section) => section.data.map((row) => row.path))).toEqual(["b.md", "a.md", "c.md"]);
    processNoteJob({ kind: "update", scope, changes: [["a.md", { version: "v2", preview: { ...preview("moved", now + 1000), isArchived: true, archivedMs: now } }]], removed: [] });
    const all = processNoteJob({ kind: "feed", scope, key: "test", filter: "all", now });
    expect(all.sections![0].data.map((row) => row.path)).toEqual(["a.md", "b.md"]);
    const archived = processNoteJob({ kind: "feed", scope, key: "test", filter: "archived", now });
    expect(archived.sectionTitles).toEqual(["Today", "Undated"]);
    expect(archived.sections!.flatMap((section) => section.data.map((row) => row.path))).toEqual(["a.md"]);
  });

  it("round-trips snapshots and refuses results belonging to an old scope", () => {
    processNoteJob({ kind: "update", scope, changes: [["a.md", { version: "v1", preview: preview("a", Date.now()) }]], removed: [] });
    const raw = processNoteJob({ kind: "snapshot", scope }).raw!;
    processNoteJob({ kind: "reset", scope: "next" });
    processNoteJob({ kind: "update", scope, changes: [["secret.md", { version: "v1", preview: preview("secret", 1) }]], removed: [] });
    expect(processNoteJob({ kind: "snapshot", scope: "next" }).raw).not.toContain("secret");
    expect(processNoteJob({ kind: "restore", scope: "next", raw }).changes![0][1].preview.title).toBe("a");
    expect(processNoteJob({ kind: "restore", scope: "next", raw: "{bad" }).changes).toEqual([]);
    expect(processNoteJob({ kind: "restore", scope: "next", raw: '{"format":2,"notes":{"x":["v",{}]}}' }).changes).toEqual([]);
  });

  it("updates changed text even with an unchanged or unavailable file version", () => {
    const now = Date.now();
    const notes = [{ path: "a.md", name: "a.md" }];
    const update = (title: string, version: string | null) => processNoteJob({ kind: "update", scope, changes: [["a.md", { version, preview: preview(title, now) }]], removed: [] });
    update("first", "same-version");
    processNoteJob({ kind: "feed", scope, key: "test", notes, filter: "all", now });
    update("second", "same-version");
    expect(processNoteJob({ kind: "feed", scope, key: "test", filter: "all", now }).sections![0].data[0].preview.title).toBe("second");
    update("unversioned", null);
    const row = processNoteJob({ kind: "feed", scope, key: "test", filter: "all", now }).sections![0].data[0];
    expect(row.preview.title).toBe("unversioned");
    expect(row.pending).toBe(false);
    expect(processNoteJob({ kind: "snapshot", scope }).raw).not.toContain("unversioned");
  });

  it("does not restore previews after the same profile changes its notes root", () => {
    processNoteJob({ kind: "reset", scope, workspace: "/first-root" });
    processNoteJob({ kind: "update", scope, changes: [["a.md", { version: "v1", preview: preview("first root", 1) }]], removed: [] });
    const raw = processNoteJob({ kind: "snapshot", scope }).raw!;
    processNoteJob({ kind: "reset", scope: "new-root", workspace: "/second-root" });
    expect(processNoteJob({ kind: "restore", scope: "new-root", raw }).changes).toEqual([]);
  });
});
