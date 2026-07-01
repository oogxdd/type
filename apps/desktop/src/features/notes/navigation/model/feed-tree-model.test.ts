import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotePreview } from "@/shared/lib/format";
import type { NoteEntry } from "@/shared/types";
import {
  buildFeedTree,
  findFeedNode,
  getLatestFeedTargetTimestamp,
} from "./feed-tree-model";

const NOW = new Date(2026, 11, 31, 12);

const note = (path: string): NoteEntry => ({
  name: path,
  path,
});

const preview = (created: Date): NotePreview => ({
  title: "",
  dateLabel: "",
  secondLine: "",
  createdMs: created.getTime(),
  updatedMs: null,
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

const weekRangeLabel = (
  week: number,
  year: number,
  month: number,
  startDay: number,
  endDay: number
) => {
  const formatDate = (day: number) =>
    new Date(year, month, day).toLocaleDateString([], {
      month: "long",
      day: "numeric",
    });
  return `Week ${week} (${formatDate(startDay)} - ${formatDate(endDay)})`;
};

const monthStartRangeLabel = (
  year: number,
  month: number,
  startDay: number,
  endDay: number
) => {
  const formatDate = (day: number) =>
    new Date(year, month, day).toLocaleDateString([], {
      month: "long",
      day: "numeric",
    });
  return `Month start (${formatDate(startDay)} - ${formatDate(endDay)})`;
};

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
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  ).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildFeedTree calendar hierarchy", () => {
  it("nests current-year month notes under seven-day week buckets and day nodes", () => {
    const { treeData } = buildTree({
      "may-01.md": new Date(2026, 4, 1, 9),
      "may-04.md": new Date(2026, 4, 4, 9),
      "may-07.md": new Date(2026, 4, 7, 9),
      "may-08.md": new Date(2026, 4, 8, 9),
      "may-31.md": new Date(2026, 4, 31, 9),
    });

    const may = findFeedNode(treeData, "feed:month:2026:5");
    expect(may).toMatchObject({
      kind: "month",
      notes: [],
      noteCount: 5,
      rangeStartMs: new Date(2026, 4, 1).getTime(),
      rangeEndMs: endOfDayMs(new Date(2026, 4, 31)),
    });
    expect(may?.children.map((week) => week.id)).toEqual([
      "feed:month:2026:5:week:0",
      "feed:month:2026:5:week:1",
      "feed:month:2026:5:week:2",
      "feed:month:2026:5:week:3",
      "feed:month:2026:5:week:4",
    ]);
    expect(may?.children.map((week) => week.name)).toEqual([
      monthStartRangeLabel(2026, 4, 1, 3),
      weekRangeLabel(1, 2026, 4, 4, 10),
      weekRangeLabel(2, 2026, 4, 11, 17),
      weekRangeLabel(3, 2026, 4, 18, 24),
      weekRangeLabel(4, 2026, 4, 25, 31),
    ]);
    expect(may?.children.every((week) => week.notes.length === 0)).toBe(true);

    const weekOne = may?.children[1];
    expect(weekOne).toMatchObject({
      rangeStartMs: new Date(2026, 4, 4).getTime(),
      rangeEndMs: endOfDayMs(new Date(2026, 4, 10)),
    });
    expect(weekOne?.children.map((day) => day.id)).toEqual([
      "feed:month:2026:5:week:1:day:4",
      "feed:month:2026:5:week:1:day:5",
      "feed:month:2026:5:week:1:day:6",
      "feed:month:2026:5:week:1:day:7",
      "feed:month:2026:5:week:1:day:8",
      "feed:month:2026:5:week:1:day:9",
      "feed:month:2026:5:week:1:day:10",
    ]);
    expect(weekOne?.children.every((day) => day.kind === "day")).toBe(true);
    expect(weekOne?.children.map((day) => day.notes[0]?.path ?? null)).toEqual([
      "may-04.md",
      null,
      null,
      "may-07.md",
      "may-08.md",
      null,
      null,
    ]);
    expect(weekOne?.children[0]).toMatchObject({
      rangeStartMs: startOfDayMs(new Date(2026, 4, 4)),
      rangeEndMs: endOfDayMs(new Date(2026, 4, 4)),
    });
    expect(findFeedNode(treeData, "feed:month:2026:5:week:0:day:1")?.notes[0]?.path).toBe(
      "may-01.md"
    );
  });

  it("orders current-year months newest first while weeks and days stay chronological", () => {
    const { treeData } = buildTree({
      "feb-14.md": new Date(2026, 1, 14, 9),
      "feb-08.md": new Date(2026, 1, 8, 9),
      "oct-01.md": new Date(2026, 9, 1, 9),
    });

    expect(treeData.map((node) => node.id)).toEqual([
      "feed:month:2026:10",
      "feed:month:2026:2",
    ]);
    const february = findFeedNode(treeData, "feed:month:2026:2");
    expect(february?.children.map((week) => week.id)).toEqual([
      "feed:month:2026:2:week:0",
      "feed:month:2026:2:week:1",
      "feed:month:2026:2:week:2",
      "feed:month:2026:2:week:3",
      "feed:month:2026:2:week:4",
    ]);
    expect(february?.children[1]?.children.map((day) => day.id)).toEqual([
      "feed:month:2026:2:week:1:day:2",
      "feed:month:2026:2:week:1:day:3",
      "feed:month:2026:2:week:1:day:4",
      "feed:month:2026:2:week:1:day:5",
      "feed:month:2026:2:week:1:day:6",
      "feed:month:2026:2:week:1:day:7",
      "feed:month:2026:2:week:1:day:8",
    ]);
  });

  it("clips week ranges at short and long month boundaries", () => {
    const { treeData } = buildTree({
      "feb-28.md": new Date(2026, 1, 28, 9),
      "apr-30.md": new Date(2026, 3, 30, 9),
      "may-31.md": new Date(2026, 4, 31, 9),
    });

    expect(
      findFeedNode(treeData, "feed:month:2026:2:week:4")?.name
    ).toBe(weekRangeLabel(4, 2026, 1, 23, 28));
    expect(
      findFeedNode(treeData, "feed:month:2026:4:week:4")?.name
    ).toBe(weekRangeLabel(4, 2026, 3, 27, 30));
    expect(
      findFeedNode(treeData, "feed:month:2026:5:week:5")?.name
    ).toBeUndefined();
  });

  it("preserves the historical year, quarter, and month hierarchy", () => {
    const { treeData } = buildTree({
      "dec-29-2025.md": new Date(2025, 11, 29, 9),
      "dec-31-2025.md": new Date(2025, 11, 31, 9),
      "jan-01-2025.md": new Date(2025, 0, 1, 9),
      "jun-15-2024.md": new Date(2024, 5, 15, 9),
    });

    expect(treeData.map((node) => node.id)).toEqual([
      "feed:year:2025",
      "feed:year:2024",
    ]);

    const year2025 = findFeedNode(treeData, "feed:year:2025");
    expect(year2025?.children.map((quarter) => quarter.id)).toEqual([
      "feed:year:2025:quarter:4",
      "feed:year:2025:quarter:1",
    ]);
    expect(year2025?.children[0]?.children.map((month) => month.id)).toEqual([
      "feed:year:2025:quarter:4:month:12",
    ]);

    const finalDecemberWeek = findFeedNode(
      treeData,
      "feed:year:2025:quarter:4:month:12:week:5"
    );
    expect(finalDecemberWeek).toMatchObject({
      kind: "week",
      name: weekRangeLabel(5, 2025, 11, 29, 31),
      notes: [],
      noteCount: 2,
      rangeStartMs: new Date(2025, 11, 29).getTime(),
      rangeEndMs: endOfDayMs(new Date(2025, 11, 31)),
    });
    expect(finalDecemberWeek?.children.map((day) => day.id)).toEqual([
      "feed:year:2025:quarter:4:month:12:week:5:day:29",
      "feed:year:2025:quarter:4:month:12:week:5:day:30",
      "feed:year:2025:quarter:4:month:12:week:5:day:31",
    ]);

    expect(year2025).toMatchObject({
      rangeStartMs: new Date(2025, 0, 1).getTime(),
      rangeEndMs: endOfDayMs(new Date(2025, 11, 31)),
    });
    expect(year2025?.children[0]).toMatchObject({
      rangeStartMs: new Date(2025, 9, 1).getTime(),
      rangeEndMs: endOfDayMs(new Date(2025, 11, 31)),
    });
  });

  it("assigns coherent ranges to Today, Yesterday, and Last week", () => {
    const { treeData } = buildTree({
      "today.md": new Date(2026, 11, 31, 8),
      "yesterday.md": new Date(2026, 11, 30, 8),
      "last-week.md": new Date(2026, 11, 27, 8),
    });

    expect(findFeedNode(treeData, "feed:today")).toMatchObject({
      rangeStartMs: startOfDayMs(NOW),
      rangeEndMs: NOW.getTime(),
    });
    expect(findFeedNode(treeData, "feed:yesterday")).toMatchObject({
      rangeStartMs: startOfDayMs(new Date(2026, 11, 30)),
      rangeEndMs: endOfDayMs(new Date(2026, 11, 30)),
    });
    expect(findFeedNode(treeData, "feed:last-week")).toMatchObject({
      rangeStartMs: startOfDayMs(new Date(2026, 11, 25)),
      rangeEndMs: endOfDayMs(new Date(2026, 11, 29)),
    });
  });

  it("clamps current calendar endpoints and exposes the latest valid target timestamp", () => {
    const { treeData } = buildTree({
      "dec-01.md": new Date(2026, 11, 1, 8),
    });
    const december = findFeedNode(treeData, "feed:month:2026:12");
    const decemberFirst = findFeedNode(
      treeData,
      "feed:month:2026:12:week:0:day:1"
    );

    expect(december).toMatchObject({
      rangeStartMs: new Date(2026, 11, 1).getTime(),
      rangeEndMs: NOW.getTime(),
    });
    expect(getLatestFeedTargetTimestamp(december, NOW)).toBe(NOW.getTime());
    expect(getLatestFeedTargetTimestamp(decemberFirst, NOW)).toBe(
      endOfDayMs(new Date(2026, 11, 1))
    );
  });

  it("returns no target timestamp for an undated bucket", () => {
    const undatedNote = note("undated.md");
    const undatedPreview = {
      ...preview(new Date(2026, 0, 1)),
      createdMs: null,
      updatedMs: null,
    };
    const { treeData } = buildFeedTree(
      [undatedNote],
      { [undatedNote.path]: undatedPreview },
      false
    );
    const undated = findFeedNode(treeData, "feed:undated");

    expect(undated).toMatchObject({
      rangeStartMs: null,
      rangeEndMs: null,
    });
    expect(getLatestFeedTargetTimestamp(undated, NOW)).toBeNull();
  });
});
