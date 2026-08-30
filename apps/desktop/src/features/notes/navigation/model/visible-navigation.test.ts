import { describe, expect, it, vi } from "vitest";

import type { NavigationNode } from "./types";
import {
  buildVisibleNavigationItems,
  findPostDeletionNavigationTarget,
  navigateVisibleItems,
  type NavigateVisibleItemsDeps,
  type NavigationKey,
} from "./visible-navigation";

const note = (path: string) => ({ name: path.split("/").pop() || path, path });

const tree: NavigationNode[] = [
  {
    id: "personal",
    name: "personal",
    children: [
      { id: "personal/journal", name: "journal", children: [], notes: [note("personal/journal/a.md")] },
    ],
    notes: [note("personal/todo.md")],
  },
  { id: "work", name: "work", children: [], notes: [] },
];

describe("buildVisibleNavigationItems", () => {
  it("lists only top-level folders when nothing is expanded", () => {
    const items = buildVisibleNavigationItems(tree, new Set(), true);
    expect(items.map((item) => item.id)).toEqual(["personal", "work"]);
  });

  it("interleaves notes before child folders for expanded branches", () => {
    const items = buildVisibleNavigationItems(
      tree,
      new Set(["personal", "personal/journal"]),
      true
    );
    expect(items.map((item) => `${item.type}:${item.id}`)).toEqual([
      "folder:personal",
      "note:personal/todo.md",
      "folder:personal/journal",
      "note:personal/journal/a.md",
      "folder:work",
    ]);
    expect(items[1].parentId).toBe("personal");
  });

  it("emits folder-only rows when notes are excluded", () => {
    const items = buildVisibleNavigationItems(tree, new Set(["personal"]), false);
    expect(items.map((item) => item.id)).toEqual([
      "personal",
      "personal/journal",
      "work",
    ]);
    expect(items.every((item) => item.type === "folder")).toBe(true);
  });

  it("does not descend into an expanded folder with no visible rows", () => {
    const items = buildVisibleNavigationItems(tree, new Set(["work"]), false);
    expect(items.map((item) => item.id)).toEqual(["personal", "work"]);
  });
});

describe("findPostDeletionNavigationTarget", () => {
  const items = buildVisibleNavigationItems(
    tree,
    new Set(["personal", "personal/journal"]),
    true
  );

  it("selects the row that takes the deleted row's place", () => {
    expect(
      findPostDeletionNavigationTarget(
        items,
        new Set(["personal/todo.md"])
      )?.id
    ).toBe("personal/journal");
  });

  it("falls back to the previous row when deleting the final row", () => {
    expect(
      findPostDeletionNavigationTarget(items, new Set(["work"]))?.id
    ).toBe("personal/journal/a.md");
  });

  it("handles deletion of multiple visible rows", () => {
    expect(
      findPostDeletionNavigationTarget(
        items,
        new Set(["personal/todo.md", "personal/journal"])
      )?.id
    ).toBe("personal/journal/a.md");
  });
});

describe("navigateVisibleItems", () => {
  type DepsOverrides = Partial<
    Pick<NavigateVisibleItemsDeps, "items" | "preferredIds" | "expanded">
  >;

  const makeDeps = (overrides: DepsOverrides = {}) => ({
    items: buildVisibleNavigationItems(tree, new Set(["personal"]), true),
    preferredIds: [] as Array<string | null>,
    expanded: new Set(["personal"]),
    hasNestedItems: (id: string) => id === "personal" || id === "personal/journal",
    expand: vi.fn<(folderId: string) => void>(),
    collapse: vi.fn<(folderId: string) => void>(),
    selectFolder: vi.fn<(folderId: string) => void>(),
    selectNote: vi.fn<(notePath: string, parentId: string) => void>(),
    ...overrides,
  });

  const navigate = (key: NavigationKey, deps: NavigateVisibleItemsDeps) =>
    navigateVisibleItems(key, deps);

  it("starts from the first matching preferred id", () => {
    const deps = makeDeps({
      preferredIds: [null, "missing", "personal/journal"],
    });
    navigate("ArrowDown", deps);
    expect(deps.selectFolder).toHaveBeenCalledWith("work");
  });

  it("falls back to the first row and clamps at the top edge", () => {
    const deps = makeDeps();
    navigate("ArrowUp", deps);
    expect(deps.selectFolder).toHaveBeenCalledWith("personal");
  });

  it("moves down onto a note row", () => {
    const deps = makeDeps({ preferredIds: ["personal"] });
    navigate("ArrowDown", deps);
    expect(deps.selectNote).toHaveBeenCalledWith("personal/todo.md", "personal");
  });

  it("expands a collapsed folder on ArrowRight", () => {
    const deps = makeDeps({
      items: buildVisibleNavigationItems(tree, new Set(), true),
      expanded: new Set(),
      preferredIds: ["personal"],
    });
    navigate("ArrowRight", deps);
    expect(deps.expand).toHaveBeenCalledWith("personal");
    expect(deps.selectFolder).not.toHaveBeenCalled();
  });

  it("enters the first child of an expanded folder on ArrowRight", () => {
    const deps = makeDeps({ preferredIds: ["personal"] });
    navigate("ArrowRight", deps);
    expect(deps.selectNote).toHaveBeenCalledWith("personal/todo.md", "personal");
  });

  it("ignores ArrowRight on a folder without nested rows", () => {
    const deps = makeDeps({ preferredIds: ["work"] });
    navigate("ArrowRight", deps);
    expect(deps.expand).not.toHaveBeenCalled();
    expect(deps.selectFolder).not.toHaveBeenCalled();
    expect(deps.selectNote).not.toHaveBeenCalled();
  });

  it("jumps from a note back to its parent folder on ArrowLeft", () => {
    const deps = makeDeps({ preferredIds: ["personal/todo.md"] });
    navigate("ArrowLeft", deps);
    expect(deps.selectFolder).toHaveBeenCalledWith("personal");
    expect(deps.collapse).not.toHaveBeenCalled();
  });

  it("collapses an expanded folder on ArrowLeft", () => {
    const deps = makeDeps({ preferredIds: ["personal"] });
    navigate("ArrowLeft", deps);
    expect(deps.collapse).toHaveBeenCalledWith("personal");
    expect(deps.selectFolder).not.toHaveBeenCalled();
  });

  it("climbs to the parent, collapsing it, when the folder itself has no open rows", () => {
    const deps = makeDeps({ preferredIds: ["personal/journal"] });
    navigate("ArrowLeft", deps);
    expect(deps.collapse).toHaveBeenCalledWith("personal");
    expect(deps.selectFolder).toHaveBeenCalledWith("personal");
  });

  it("does nothing on ArrowLeft at a collapsed top-level folder", () => {
    const deps = makeDeps({
      items: buildVisibleNavigationItems(tree, new Set(), true),
      expanded: new Set(),
      preferredIds: ["personal"],
    });
    navigate("ArrowLeft", deps);
    expect(deps.collapse).not.toHaveBeenCalled();
    expect(deps.selectFolder).not.toHaveBeenCalled();
  });
});
