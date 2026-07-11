import { describe, expect, it } from "vitest";
import type { TreeItem } from "./types";
import { DROP_PREFIX, ROOT_ID } from "./tree-dnd";
import {
  arraysEqual,
  getNodeById,
  getTopLevelSelected,
  isDescendantOf,
  parseDropTargetId,
  reorderList,
  sortIdsByTreeOrder,
} from "./tree-ops";

const leaf = (id: string, name = id): TreeItem => ({
  id,
  name,
  noteCount: 0,
  notes: [],
  children: [],
});

// a ─┬─ a/b ── a/b/c
//    └─ a/d
const tree: TreeItem[] = [
  { ...leaf("a"), children: [{ ...leaf("a/b"), children: [leaf("a/b/c")] }, leaf("a/d")] },
];

describe("arraysEqual", () => {
  it("compares element-wise", () => {
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(arraysEqual(["a"], ["a", "b"])).toBe(false);
    expect(arraysEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("treats matching references and both-undefined as equal", () => {
    const ref = ["x"];
    expect(arraysEqual(ref, ref)).toBe(true);
    expect(arraysEqual(undefined, undefined)).toBe(true);
    expect(arraysEqual(["x"], undefined)).toBe(false);
  });
});

describe("reorderList", () => {
  it("moves an item to just before the target", () => {
    expect(reorderList(["a", "b", "c", "d"], ["b"], "d")).toEqual(["a", "c", "b", "d"]);
  });

  it("moves a contiguous group, preserving its internal order", () => {
    expect(reorderList(["a", "b", "c", "d"], ["a", "c"], "d")).toEqual(["b", "a", "c", "d"]);
  });

  it("appends to the end when the target is not found", () => {
    expect(reorderList(["a", "b", "c"], ["a"], "missing")).toEqual(["b", "c", "a"]);
  });
});

describe("sortIdsByTreeOrder", () => {
  it("orders ids by their position in the reference list", () => {
    expect(sortIdsByTreeOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("getNodeById / isDescendantOf", () => {
  it("finds a node at any depth", () => {
    expect(getNodeById(tree, "a/b/c")?.name).toBe("a/b/c");
    expect(getNodeById(tree, "nope")).toBeNull();
  });

  it("detects descendants but not the node itself or siblings", () => {
    expect(isDescendantOf(tree, "a", "a/b/c")).toBe(true);
    expect(isDescendantOf(tree, "a/b", "a/d")).toBe(false);
    expect(isDescendantOf(tree, "a", "a")).toBe(false);
  });
});

describe("getTopLevelSelected", () => {
  it("drops descendants whose ancestor is also selected", () => {
    const parentById = { a: null, "a/b": "a", "a/b/c": "a/b", "a/d": "a" };
    expect(getTopLevelSelected(["a", "a/b", "a/b/c"], parentById)).toEqual(["a"]);
    expect(getTopLevelSelected(["a/b", "a/d"], parentById).sort()).toEqual(["a/b", "a/d"]);
  });
});

describe("parseDropTargetId", () => {
  it("parses an item drop target", () => {
    expect(parseDropTargetId(`${DROP_PREFIX}:a/b:before`)).toEqual({
      type: "item",
      itemId: "a/b",
      position: "before",
    });
  });

  it("parses the root inside-drop and rejects root before/after", () => {
    expect(parseDropTargetId(`${DROP_PREFIX}:${ROOT_ID}:inside`)).toEqual({
      type: "root",
      position: "inside",
    });
    expect(parseDropTargetId(`${DROP_PREFIX}:${ROOT_ID}:before`)).toBeNull();
  });

  it("rejects malformed ids and non-strings", () => {
    expect(parseDropTargetId("a/b:before")).toBeNull();
    expect(parseDropTargetId(`${DROP_PREFIX}:a/b:sideways`)).toBeNull();
    expect(parseDropTargetId(42)).toBeNull();
    expect(parseDropTargetId(null)).toBeNull();
  });
});
