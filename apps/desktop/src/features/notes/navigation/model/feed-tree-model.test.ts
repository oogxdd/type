import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotePreview } from "@typenotes/shared/format";
import type { NoteEntry } from "@typenotes/shared/types";
import {
  buildFeedTree,
  type FeedTreeNode,
  findFeedNode,
  getLatestFeedTargetTimestamp,
} from "./feed-tree-model";

// Thursday, so "This week" (the running ISO week minus today and yesterday) is
// non-empty. The feed splits this NOW as:
//   Today      Thu Dec 31
//   Yesterday  Wed Dec 30
//   This week  Mon Dec 28 - Tue Dec 29   (ISO week 53)
//   Last week  Mon Dec 21 - Sun Dec 27   (ISO week 52)
//   calendar   everything before Mon Dec 21
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

// Mirrors getWeekLabel: "Week <iso> · Nov 30 - Dec 6" (or "· Dec 14 - 20" when
// the week stays inside one month).
const weekLabel = (isoWeek: number, start: Date, end: Date) => {
  const formatDay = (value: Date) =>
    value.toLocaleDateString([], { month: "short", day: "numeric" });
  const range =
    start.getMonth() === end.getMonth()
      ? `${formatDay(start)} - ${end.getDate()}`
      : `${formatDay(start)} - ${formatDay(end)}`;
  return `Week ${isoWeek} · ${range}`;
};

// Mirrors getDayLabel: "Monday 14".
const dayLabel = (date: Date) =>
  `${date.toLocaleDateString([], { weekday: "long" })} ${date.getDate()}`;

const walkFeed = (nodes: FeedTreeNode[]): FeedTreeNode[] =>
  nodes.flatMap((node) => [node, ...walkFeed(node.children)]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildFeedTree relative buckets", () => {
  it("filters notes by archived and reviewed flags", () => {
    const notes = [note("active.md"), note("reviewed.md"), note("archived.md")];
    const previews: Record<string, NotePreview> = {
      "active.md": preview(NOW),
      "reviewed.md": {
        ...preview(NOW),
        isReviewed: true,
        reviewedMs: NOW.getTime(),
      },
      "archived.md": {
        ...preview(NOW),
        isArchived: true,
        archivedMs: NOW.getTime(),
      },
    };

    const pathsFor = (
      filter: "active" | "reviewed" | "unreviewed" | "archived"
    ) =>
      walkFeed(buildFeedTree(notes, previews, filter).treeData).flatMap((node) =>
        node.notes.map((entry) => entry.path)
      );

    expect(pathsFor("active")).toEqual(
      expect.arrayContaining(["active.md", "reviewed.md"])
    );
    expect(pathsFor("active")).not.toContain("archived.md");
    expect(pathsFor("reviewed")).toEqual(["reviewed.md"]);
    expect(pathsFor("unreviewed")).toEqual(
      expect.arrayContaining(["active.md", "archived.md"])
    );
    expect(pathsFor("archived")).toEqual(["archived.md"]);
  });

  it("splits the last two weeks into Today, Yesterday, This week, and Last week", () => {
    const { treeData } = buildTree({
      "dec-31.md": new Date(2026, 11, 31, 8),
      "dec-30.md": new Date(2026, 11, 30, 8),
      "dec-29.md": new Date(2026, 11, 29, 8),
      "dec-28.md": new Date(2026, 11, 28, 8),
      "dec-27.md": new Date(2026, 11, 27, 8),
      "dec-21.md": new Date(2026, 11, 21, 8),
    });

    expect(treeData.map((node) => node.id)).toEqual([
      "feed:today",
      "feed:yesterday",
      "feed:this-week",
      "feed:last-week",
    ]);

    expect(findFeedNode(treeData, "feed:today")).toMatchObject({
      rangeStartMs: startOfDayMs(NOW),
      rangeEndMs: NOW.getTime(),
    });
    expect(findFeedNode(treeData, "feed:yesterday")).toMatchObject({
      rangeStartMs: startOfDayMs(new Date(2026, 11, 30)),
      rangeEndMs: endOfDayMs(new Date(2026, 11, 30)),
    });
    expect(findFeedNode(treeData, "feed:this-week")).toMatchObject({
      noteCount: 2,
      rangeStartMs: startOfDayMs(new Date(2026, 11, 28)),
      rangeEndMs: startOfDayMs(new Date(2026, 11, 30)) - 1,
    });
    expect(findFeedNode(treeData, "feed:last-week")).toMatchObject({
      noteCount: 2,
      rangeStartMs: startOfDayMs(new Date(2026, 11, 21)),
      rangeEndMs: endOfDayMs(new Date(2026, 11, 27)),
    });
  });

  it("orders day rows inside a relative bucket newest first", () => {
    const { treeData } = buildTree({
      "dec-21.md": new Date(2026, 11, 21, 8),
      "dec-24.md": new Date(2026, 11, 24, 8),
      "dec-27.md": new Date(2026, 11, 27, 8),
    });

    const lastWeek = findFeedNode(treeData, "feed:last-week");
    expect(lastWeek?.children.map((day) => day.id)).toEqual([
      "feed:last-week:day:27",
      "feed:last-week:day:24",
      "feed:last-week:day:21",
    ]);
    expect(lastWeek?.children.map((day) => day.name)).toEqual([
      dayLabel(new Date(2026, 11, 27)),
      dayLabel(new Date(2026, 11, 24)),
      dayLabel(new Date(2026, 11, 21)),
    ]);
  });

  it("puts the whole previous ISO week in Last week and everything older in the calendar", () => {
    const { treeData } = buildTree({
      "dec-21.md": new Date(2026, 11, 21, 8),
      "dec-20.md": new Date(2026, 11, 20, 8),
    });

    // Mon Dec 21 is the cutoff: at or after it the note is relative, before it
    // the note is calendar. The two halves must never claim the same day.
    expect(findFeedNode(treeData, "feed:last-week")?.noteCount).toBe(1);
    expect(
      findFeedNode(treeData, "feed:last-week:day:21")?.notes[0]?.path
    ).toBe("dec-21.md");
    expect(
      findFeedNode(treeData, "feed:month:2026:12:week:51:day:20")?.notes[0]?.path
    ).toBe("dec-20.md");
    expect(findFeedNode(treeData, "feed:month:2026:12:week:52")).toBeNull();
  });
});

describe("buildFeedTree calendar hierarchy", () => {
  it("keeps an ISO week whole across a month boundary", () => {
    const { treeData } = buildTree({
      "nov-30.md": new Date(2026, 10, 30, 8),
      "dec-01.md": new Date(2026, 11, 1, 8),
      "dec-06.md": new Date(2026, 11, 6, 8),
    });

    // Mon Nov 30 - Sun Dec 6 is one ISO week. Its Thursday (Dec 3) is in
    // December, so the whole week hangs under December instead of being cut in
    // two — and no November node is created at all.
    expect(treeData.map((node) => node.id)).toEqual(["feed:month:2026:12"]);
    const week = findFeedNode(treeData, "feed:month:2026:12:week:49");
    expect(week).toMatchObject({
      kind: "week",
      noteCount: 3,
      name: weekLabel(49, new Date(2026, 10, 30), new Date(2026, 11, 6)),
      rangeStartMs: startOfDayMs(new Date(2026, 10, 30)),
      rangeEndMs: endOfDayMs(new Date(2026, 11, 6)),
    });
    expect(week?.children.map((day) => day.id)).toEqual([
      "feed:month:2026:12:week:49:day:6",
      "feed:month:2026:12:week:49:day:1",
      "feed:month:2026:12:week:49:day:30",
    ]);
  });

  it("orders months, weeks, and days newest first", () => {
    const { treeData } = buildTree({
      "feb-09.md": new Date(2026, 1, 9, 8),
      "feb-10.md": new Date(2026, 1, 10, 8),
      "feb-16.md": new Date(2026, 1, 16, 8),
      "oct-01.md": new Date(2026, 9, 1, 8),
    });

    expect(treeData.map((node) => node.id)).toEqual([
      "feed:month:2026:10",
      "feed:month:2026:2",
    ]);
    const february = findFeedNode(treeData, "feed:month:2026:2");
    expect(february?.children.map((week) => week.id)).toEqual([
      "feed:month:2026:2:week:8",
      "feed:month:2026:2:week:7",
    ]);
    expect(
      findFeedNode(treeData, "feed:month:2026:2:week:7")?.children.map(
        (day) => day.id
      )
    ).toEqual([
      "feed:month:2026:2:week:7:day:10",
      "feed:month:2026:2:week:7:day:9",
    ]);
  });

  it("never emits a bucket without notes", () => {
    const { treeData } = buildTree({
      "dec-31.md": new Date(2026, 11, 31, 8),
      "dec-01.md": new Date(2026, 11, 1, 8),
      "mar-04.md": new Date(2026, 2, 4, 8),
      "jun-15-2024.md": new Date(2024, 5, 15, 8),
    });

    expect(walkFeed(treeData).every((node) => node.noteCount > 0)).toBe(true);
    // One note in a month yields exactly one week and one day beneath it.
    expect(findFeedNode(treeData, "feed:month:2026:3")?.children).toHaveLength(1);
  });

  it("preserves the year, quarter, and month nesting for older years", () => {
    const { treeData } = buildTree({
      "jun-15-2024.md": new Date(2024, 5, 15, 8),
      "jan-08-2025.md": new Date(2025, 0, 8, 8),
    });

    expect(treeData.map((node) => node.id)).toEqual([
      "feed:year:2025",
      "feed:year:2024",
    ]);
    expect(
      findFeedNode(treeData, "feed:year:2024")?.children.map((q) => q.id)
    ).toEqual(["feed:year:2024:quarter:2"]);
    expect(
      findFeedNode(treeData, "feed:year:2024:quarter:2:month:6:week:24:day:15")
        ?.notes[0]?.path
    ).toBe("jun-15-2024.md");
  });

  it("files a year-straddling week under the month owning its Thursday", () => {
    const { treeData } = buildTree({
      "dec-29-2025.md": new Date(2025, 11, 29, 8),
      "jan-02-2026.md": new Date(2026, 0, 2, 8),
    });

    // Mon Dec 29 2025 - Sun Jan 4 2026 is ISO week 1 of 2026 and its Thursday
    // (Jan 1 2026) is in January, so both notes share one week under January of
    // the running year. Nothing is filed under 2025.
    expect(treeData.map((node) => node.id)).toEqual(["feed:month:2026:1"]);
    const week = findFeedNode(treeData, "feed:month:2026:1:week:1");
    expect(week).toMatchObject({
      noteCount: 2,
      name: weekLabel(1, new Date(2025, 11, 29), new Date(2026, 0, 4)),
    });
    expect(week?.children.map((day) => day.id)).toEqual([
      "feed:month:2026:1:week:1:day:2",
      "feed:month:2026:1:week:1:day:29",
    ]);
  });
});

describe("getLatestFeedTargetTimestamp", () => {
  it("clamps a running-period bucket to now and a past day to its end", () => {
    const { treeData } = buildTree({
      "dec-01.md": new Date(2026, 11, 1, 8),
    });
    const december = findFeedNode(treeData, "feed:month:2026:12");
    const decemberFirst = findFeedNode(
      treeData,
      "feed:month:2026:12:week:49:day:1"
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
