import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotePreview } from "./format";
import type { NoteEntry } from "./types";
import {
  buildFeedTree,
  findFeedNode,
  getFirstFeedGroupId,
  getLatestFeedTargetTimestamp,
  isCurrentWeekFeedNode,
} from "./feed-tree-model";

// Friday. The current Monday–Sunday week crosses the Aug/Sep boundary.
const NOW = new Date(2026, 8, 4, 12);
const note = (path: string): NoteEntry => ({ name: path, path });
const preview = (created: Date): NotePreview => ({
  title: "", dateLabel: "", secondLine: "", createdMs: created.getTime(),
  updatedMs: null, archivedMs: null, reviewedMs: null, isArchived: false,
  isReviewed: false, isRecording: false, isHandwriting: false,
  recordingAudioPath: null, handwritingAttachmentPath: null,
  transcriptionStatus: null, ocrStatus: null,
});
const buildTree = (datesByPath: Record<string, Date>) => {
  const notes = Object.keys(datesByPath).map(note);
  const previews = Object.fromEntries(
    Object.entries(datesByPath).map(([path, date]) => [path, preview(date)])
  );
  return buildFeedTree(notes, previews, false);
};
const startOfDayMs = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const endOfDayMs = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("buildFeedTree current-week pseudo-folders", () => {
  it("always emits every Monday–Sunday day, including empty and future days", () => {
    const { treeData } = buildTree({});
    expect(treeData).toHaveLength(7);
    expect(treeData.every(isCurrentWeekFeedNode)).toBe(true);
    expect(treeData.map((node) => node.name)).toEqual([
      "Monday · 31 Aug", "Tuesday · 1 Sep", "Wednesday · 2 Sep",
      "Thursday · 3 Sep", "Friday · 4 Sep", "Saturday · 5 Sep", "Sunday · 6 Sep",
    ]);
    expect(treeData.map((node) => node.noteCount)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("routes notes to their date and selects today as the initial feed group", () => {
    const { treeData } = buildTree({
      "monday.md": new Date(2026, 7, 31, 9),
      "today.md": new Date(2026, 8, 4, 9),
    });
    expect(treeData[0].notes.map((entry) => entry.path)).toEqual(["monday.md"]);
    expect(treeData[4].notes.map((entry) => entry.path)).toEqual(["today.md"]);
    expect(getFirstFeedGroupId(treeData)).toBe(treeData[4].id);
    expect(treeData[4].rangeEndMs).toBe(NOW.getTime());
  });

  it("starts a new current week on Monday and files Sunday under Earlier", () => {
    vi.setSystemTime(new Date(2026, 8, 7, 10));
    const { treeData } = buildTree({
      "monday.md": new Date(2026, 8, 7, 8),
      "sunday.md": new Date(2026, 8, 6, 8),
    });
    expect(treeData.slice(0, 7).map((node) => node.name)).toEqual([
      "Monday · 7 Sep", "Tuesday · 8 Sep", "Wednesday · 9 Sep",
      "Thursday · 10 Sep", "Friday · 11 Sep", "Saturday · 12 Sep", "Sunday · 13 Sep",
    ]);
    expect(treeData[0].notes[0]?.path).toBe("monday.md");
    expect(findFeedNode(treeData, "feed:month:2026:9:week:36")?.notes).toEqual([]);
    expect(findFeedNode(treeData, "feed:month:2026:9:week:36:day:6")?.notes[0]?.path)
      .toBe("sunday.md");
  });
});

describe("buildFeedTree Earlier hierarchy", () => {
  it("places earlier notes under flat month pseudo-folders, newest first", () => {
    const { treeData } = buildTree({
      "aug.md": new Date(2026, 7, 17, 8),
      "jul.md": new Date(2026, 6, 13, 8),
      "jun.md": new Date(2026, 5, 15, 8),
    });
    expect(treeData.slice(7).map((node) => node.name)).toEqual(["August", "July", "June"]);
    expect(treeData.slice(7).map((node) => node.kind)).toEqual(["month", "month", "month"]);
  });

  it("numbers weeks within their owning month and formats an en-dash range", () => {
    const { treeData } = buildTree({
      "aug-03.md": new Date(2026, 7, 3, 8),
      "aug-09.md": new Date(2026, 7, 9, 8),
      "aug-10.md": new Date(2026, 7, 10, 8),
      "aug-30.md": new Date(2026, 7, 30, 8),
    });
    const august = findFeedNode(treeData, "feed:month:2026:8");
    expect(august?.children.map((week) => week.name)).toEqual([
      "Week 4 · (24–30 Aug)", "Week 2 · (10–16 Aug)", "Week 1 · (3–9 Aug)",
    ]);
    expect(findFeedNode(treeData, "feed:month:2026:8:week:32")?.noteCount).toBe(2);
  });

  it("keeps a boundary week whole under the month containing Thursday", () => {
    const { treeData } = buildTree({
      "jul-31.md": new Date(2026, 6, 31, 8),
      "aug-02.md": new Date(2026, 7, 2, 8),
      "aug-03.md": new Date(2026, 7, 3, 8),
    });
    expect(findFeedNode(treeData, "feed:month:2026:7:week:31")).toMatchObject({
      name: "Week 5 · (27 Jul–2 Aug)", noteCount: 2,
    });
    expect(findFeedNode(treeData, "feed:month:2026:8:week:32")).toMatchObject({
      name: "Week 1 · (3–9 Aug)", noteCount: 1,
    });
  });

  it("adds the year to older month labels", () => {
    const { treeData } = buildTree({
      "dec-2025.md": new Date(2025, 11, 15, 8),
      "jan-2026.md": new Date(2026, 0, 12, 8),
    });
    expect(treeData.slice(7).map((node) => node.name)).toEqual(["January", "December 2025"]);
  });
});

describe("feed filters and target timestamps", () => {
  it("keeps empty week days while filtering earlier notes", () => {
    const archived = note("archived.md");
    const active = note("active.md");
    const previews = {
      [archived.path]: {
        ...preview(new Date(2026, 7, 3, 8)), isArchived: true,
        archivedMs: new Date(2026, 7, 3, 8).getTime(),
      },
      [active.path]: preview(new Date(2026, 6, 3, 8)),
    };
    const { treeData } = buildFeedTree([archived, active], previews, "active");
    expect(treeData.slice(0, 7).every(isCurrentWeekFeedNode)).toBe(true);
    expect(treeData.slice(7).map((node) => node.name)).toEqual(["July"]);
  });

  it("uses now for today, the end of a past day, and no time for future days", () => {
    const { treeData } = buildTree({});
    expect(getLatestFeedTargetTimestamp(treeData[0], NOW)).toBe(endOfDayMs(new Date(2026, 7, 31)));
    expect(getLatestFeedTargetTimestamp(treeData[4], NOW)).toBe(NOW.getTime());
    expect(getLatestFeedTargetTimestamp(treeData[5], NOW)).toBeNull();
    expect(treeData[0].rangeStartMs).toBe(startOfDayMs(new Date(2026, 7, 31)));
  });
});
