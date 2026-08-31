import { describe, expect, it } from "vitest";

import type { FolderNode } from "@typenotes/shared/types";

import { allFolderPaths, flattenFolderTree, toggleExpanded } from "./folder-tree";

const note = (path: string) => ({ name: path.split("/").pop()!, path });

const tree: FolderNode = {
  name: "",
  path: "",
  children: [
    { name: "Feed", path: "Feed", children: [], notes: [note("Feed/a.md")] },
    { name: "Archieve", path: "Archieve", children: [], notes: [] },
    { name: ".type", path: ".type", children: [], notes: [] },
    {
      name: "Work",
      path: "Work",
      children: [
        {
          name: "Q3",
          path: "Work/Q3",
          children: [
            {
              name: "Deep",
              path: "Work/Q3/Deep",
              children: [],
              notes: [note("Work/Q3/Deep/d.md")],
            },
          ],
          notes: [note("Work/Q3/c.md")],
        },
      ],
      notes: [],
    },
  ],
  notes: [],
};

describe("flattenFolderTree", () => {
  it("shows only top-level folders when nothing is expanded", () => {
    const rows = flattenFolderTree(tree, new Set());
    expect(rows.map((row) => row.folder.path)).toEqual(["Work"]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[0].isExpanded).toBe(false);
  });

  it("counts notes from every folder below", () => {
    // Work holds no notes of its own; a direct-children count read as empty.
    expect(flattenFolderTree(tree, new Set())[0].noteCount).toBe(2);
  });

  it("reveals children of expanded folders, with their depth", () => {
    const rows = flattenFolderTree(tree, new Set(["Work", "Work/Q3"]));
    expect(rows.map((row) => [row.folder.path, row.depth])).toEqual([
      ["Work", 0],
      ["Work/Q3", 1],
      ["Work/Q3/Deep", 2],
    ]);
  });

  it("does not reveal grandchildren of a collapsed parent", () => {
    const rows = flattenFolderTree(tree, new Set(["Work/Q3"]));
    expect(rows.map((row) => row.folder.path)).toEqual(["Work"]);
  });

  it("never lists system or dot folders", () => {
    const rows = flattenFolderTree(tree, new Set(["Work", "Work/Q3"]));
    const paths = rows.map((row) => row.folder.path);
    expect(paths).not.toContain("Feed");
    expect(paths).not.toContain("Archieve");
    expect(paths).not.toContain(".type");
  });

  it("handles an empty tree", () => {
    expect(flattenFolderTree(null, new Set())).toEqual([]);
  });
});

describe("toggleExpanded", () => {
  it("opens and shuts without mutating the input", () => {
    const first = new Set<string>();
    const opened = toggleExpanded(first, "Work");
    expect(first.size).toBe(0);
    expect([...opened]).toEqual(["Work"]);
    expect([...toggleExpanded(opened, "Work")]).toEqual([]);
  });
});

describe("allFolderPaths", () => {
  it("lists every folder as a move destination, system folders included", () => {
    expect(allFolderPaths(tree)).toEqual([
      "Feed",
      "Archieve",
      "Work",
      "Work/Q3",
      "Work/Q3/Deep",
    ]);
  });
});
