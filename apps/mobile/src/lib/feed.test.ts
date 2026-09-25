import { describe, expect, it } from "vitest";

import type { FolderNode, NotePreviewEntry } from "@typenotes/shared/types";

import {
  browsableFolders,
  collectNotePaths,
  feedNoteRows,
  findFolder,
  folderNoteCount,
  folderNoteRows,
  groupNoteRowsByDate,
  previewsByPath,
} from "./feed";

const tree: FolderNode = {
  name: "",
  path: "",
  children: [
    {
      name: "_system",
      path: "_system",
      children: [
        {
          name: "stream",
          path: "_system/stream",
          children: [],
          notes: [
            { name: "old.md", path: "_system/stream/old.md" },
            { name: "new.md", path: "_system/stream/new.md" },
            { name: "archived.md", path: "_system/stream/archived.md" },
          ],
        },
        {
          name: "archive",
          path: "_system/archive",
          children: [],
          notes: [{ name: "gone.md", path: "_system/archive/gone.md" }],
        },
      ],
      notes: [],
    },
    {
      name: "Projects",
      path: "Projects",
      children: [
        { name: "Home", path: "Projects/Home", children: [], notes: [] },
      ],
      notes: [{ name: "plan.md", path: "Projects/plan.md" }],
    },
    { name: ".type", path: ".type", children: [], notes: [] },
  ],
  notes: [],
};

const entries: NotePreviewEntry[] = [
  {
    path: "_system/stream/old.md",
    content: "Old note",
    meta: { created_ms: 1_000, updated_ms: 1_000 },
  },
  {
    path: "_system/stream/new.md",
    content: "New note\nwith a second line",
    meta: { created_ms: 2_000, updated_ms: 3_000 },
  },
  {
    path: "_system/stream/archived.md",
    content: "Filed away",
    meta: { created_ms: 1_500, updated_ms: 1_500, archived_ms: 1_600 },
  },
];

describe("feed model", () => {
  it("finds folders by path", () => {
    expect(findFolder(tree, "Projects/Home")?.name).toBe("Home");
    expect(findFolder(tree, "Nope")).toBeNull();
  });

  it("hides both system folders and dot-folders from browsable folders", () => {
    // `_system` used to be two root-level folders that showed up here as
    // ordinary ones, unlike on desktop.
    expect(browsableFolders(tree).map((folder) => folder.name)).toEqual([
      "Projects",
    ]);
    expect(browsableFolders(null)).toEqual([]);
  });

  it("counts notes in subfolders too", () => {
    const nested: FolderNode = {
      name: "Work",
      path: "Work",
      children: [
        {
          name: "Deep",
          path: "Work/Deep",
          children: [],
          notes: [
            { name: "a.md", path: "Work/Deep/a.md" },
            { name: "b.md", path: "Work/Deep/b.md" },
          ],
        },
      ],
      // A folder of nothing but subfolders read as empty before.
      notes: [],
    };
    expect(folderNoteCount(nested)).toBe(2);
    expect(folderNoteCount(findFolder(tree, "Projects"))).toBe(1);
    expect(folderNoteCount(null)).toBe(0);
  });

  it("collects every note path", () => {
    expect(collectNotePaths(tree)).toEqual([
      "_system/stream/old.md",
      "_system/stream/new.md",
      "_system/stream/archived.md",
      "_system/archive/gone.md",
      "Projects/plan.md",
    ]);
  });

  it("orders feed rows newest-first and parses titles", () => {
    const previews = previewsByPath(entries);
    const rows = feedNoteRows(findFolder(tree, "_system/stream"), previews);
    expect(rows.map((row) => row.path)).toEqual([
      "_system/stream/new.md",
      "_system/stream/archived.md",
      "_system/stream/old.md",
    ]);
    expect(rows[0].preview.title).toBe("New note");
    expect(rows[0].preview.secondLine).toBe("with a second line");
  });

  it("can hide archived rows", () => {
    const previews = previewsByPath(entries);
    const rows = feedNoteRows(findFolder(tree, "_system/stream"), previews, {
      hideArchived: true,
    });
    expect(rows.map((row) => row.path)).toEqual(["_system/stream/new.md", "_system/stream/old.md"]);
  });

  it("applies a feed filter, but never to a note it has not read", () => {
    const previews = previewsByPath(entries);
    previews.delete("_system/stream/old.md");
    const rows = feedNoteRows(findFolder(tree, "_system/stream"), previews, {
      keep: (preview) => !preview.isArchived,
    });
    // archived.md is filtered out; old.md has no preview to judge, so it stays.
    expect(rows.map((row) => row.path)).toEqual(["_system/stream/new.md", "_system/stream/old.md"]);
  });

  it("keeps a folder's own order instead of re-sorting by time", () => {
    // The core already applied .notes-order.json; re-sorting by timestamp made
    // every folder look different on the phone than on the desktop.
    const previews = previewsByPath(entries);
    const rows = folderNoteRows(findFolder(tree, "_system/stream"), previews);
    expect(rows.map((row) => row.path)).toEqual([
      "_system/stream/old.md",
      "_system/stream/new.md",
      "_system/stream/archived.md",
    ]);
  });

  it("keeps a row for a note whose preview has not loaded", () => {
    const rows = folderNoteRows(findFolder(tree, "Projects"), new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].pending).toBe(true);
    expect(rows[0].preview.title).toBe("plan");
  });

  it("builds a placeholder title from a prefixed file name", () => {
    const folder: FolderNode = {
      name: "Work",
      path: "Work",
      children: [],
      notes: [
        {
          name: "2026-08-31T10-00-00Z-quarterly-review.md",
          path: "Work/2026-08-31T10-00-00Z-quarterly-review.md",
        },
      ],
    };
    expect(folderNoteRows(folder, new Map())[0].preview.title).toBe(
      "quarterly review"
    );
  });
});

describe("placeholder rows", () => {
  it("are dated from the file name until the preview arrives", () => {
    // While a large folder's previews load in the background, the Feed must
    // already be in date order and date sections, not one "Undated" heap.
    const uuidV7 = "01890a5d-ac96-774b-bcce-b302099a8057";
    const stream: FolderNode = {
      name: "stream",
      path: "_system/stream",
      children: [],
      notes: [
        "2024-03-05T10-00-00Z-older.md",
        "2025-07-01T08-30-00Z-newer.md",
        `${uuidV7}.md`,
        "plain.md",
      ].map((name) => ({ name, path: `_system/stream/${name}` })),
    };

    const rows = feedNoteRows(stream, new Map());

    expect(rows.every((row) => row.pending)).toBe(true);
    expect(rows.map((row) => row.preview.createdMs)).toEqual([
      Date.UTC(2025, 6, 1, 8, 30, 0),
      Date.UTC(2024, 2, 5, 10, 0, 0),
      parseInt("01890a5dac96", 16),
      null,
    ]);
    const undated = groupNoteRowsByDate(rows).filter((section) => section.title === "Undated");
    expect(undated.flatMap((section) => section.data.map((row) => row.path))).toEqual([
      "_system/stream/plain.md",
    ]);
  });
});

