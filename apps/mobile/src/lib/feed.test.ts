import { describe, expect, it } from "vitest";

import type { FolderNode, NotePreviewEntry } from "@typenotes/shared/types";

import { collectNotePaths, findFolder, folderNoteRows, previewsByPath } from "./feed";

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

  it("collects every note path", () => {
    expect(collectNotePaths(tree)).toEqual([
      "Feed/old.md",
      "Feed/new.md",
      "Feed/archived.md",
      "Projects/plan.md",
    ]);
  });

  it("orders rows newest-first and parses titles", () => {
    const previews = previewsByPath(entries);
    const rows = folderNoteRows(findFolder(tree, "Feed"), previews);
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
    const rows = folderNoteRows(findFolder(tree, "Feed"), previews, {
      hideArchived: true,
    });
    expect(rows.map((row) => row.path)).toEqual(["Feed/new.md", "Feed/old.md"]);
  });
});
