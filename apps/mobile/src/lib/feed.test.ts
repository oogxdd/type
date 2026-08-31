import { describe, expect, it } from "vitest";

import type { FolderNode, NotePreviewEntry } from "@typenotes/shared/types";

import {
  browsableFolders,
  collectNotePaths,
  feedNoteRows,
  findFolder,
  folderNoteCount,
  folderNoteRows,
  previewsByPath,
} from "./feed";

const tree: FolderNode = {
  name: "",
  path: "",
  children: [
    {
      name: "Feed",
      path: "Feed",
      children: [],
      notes: [
        { name: "old.md", path: "Feed/old.md" },
        { name: "new.md", path: "Feed/new.md" },
        { name: "archived.md", path: "Feed/archived.md" },
      ],
    },
    {
      name: "Projects",
      path: "Projects",
      children: [
        { name: "Home", path: "Projects/Home", children: [], notes: [] },
      ],
      notes: [{ name: "plan.md", path: "Projects/plan.md" }],
    },
    {
      name: "Archieve",
      path: "Archieve",
      children: [],
      notes: [{ name: "gone.md", path: "Archieve/gone.md" }],
    },
    { name: ".type", path: ".type", children: [], notes: [] },
  ],
  notes: [],
};

const entries: NotePreviewEntry[] = [
  {
    path: "Feed/old.md",
    content: "Old note",
    meta: { created_ms: 1_000, updated_ms: 1_000 },
  },
  {
    path: "Feed/new.md",
    content: "New note\nwith a second line",
    meta: { created_ms: 2_000, updated_ms: 3_000 },
  },
  {
    path: "Feed/archived.md",
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
    // Archieve used to show up as an ordinary folder here, unlike on desktop.
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
      "Feed/old.md",
      "Feed/new.md",
      "Feed/archived.md",
      "Projects/plan.md",
      "Archieve/gone.md",
    ]);
  });

  it("orders feed rows newest-first and parses titles", () => {
    const previews = previewsByPath(entries);
    const rows = feedNoteRows(findFolder(tree, "Feed"), previews);
    expect(rows.map((row) => row.path)).toEqual([
      "Feed/new.md",
      "Feed/archived.md",
      "Feed/old.md",
    ]);
    expect(rows[0].preview.title).toBe("New note");
    expect(rows[0].preview.secondLine).toBe("with a second line");
  });

  it("can hide archived rows", () => {
    const previews = previewsByPath(entries);
    const rows = feedNoteRows(findFolder(tree, "Feed"), previews, {
      hideArchived: true,
    });
    expect(rows.map((row) => row.path)).toEqual(["Feed/new.md", "Feed/old.md"]);
  });

  it("applies a feed filter, but never to a note it has not read", () => {
    const previews = previewsByPath(entries);
    previews.delete("Feed/old.md");
    const rows = feedNoteRows(findFolder(tree, "Feed"), previews, {
      keep: (preview) => !preview.isArchived,
    });
    // archived.md is filtered out; old.md has no preview to judge, so it stays.
    expect(rows.map((row) => row.path)).toEqual(["Feed/new.md", "Feed/old.md"]);
  });

  it("keeps a folder's own order instead of re-sorting by time", () => {
    // The core already applied .notes-order.json; re-sorting by timestamp made
    // every folder look different on the phone than on the desktop.
    const previews = previewsByPath(entries);
    const rows = folderNoteRows(findFolder(tree, "Feed"), previews);
    expect(rows.map((row) => row.path)).toEqual([
      "Feed/old.md",
      "Feed/new.md",
      "Feed/archived.md",
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
