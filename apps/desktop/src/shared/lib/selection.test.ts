import { describe, expect, it } from "vitest";
import { computeRangeSelection, resolveTargetPaths } from "./selection";

const NONE = { shiftKey: false, metaKey: false, ctrlKey: false };
const order = ["a", "b", "c", "d"];

describe("computeRangeSelection", () => {
  it("plain click selects only the clicked item", () => {
    const next = computeRangeSelection(NONE, new Set(["a", "b"]), order, "a", "c");
    expect([...next]).toEqual(["c"]);
  });

  it("cmd/ctrl click toggles the clicked item into the selection", () => {
    const next = computeRangeSelection(
      { ...NONE, metaKey: true },
      new Set(["a"]),
      order,
      "a",
      "b"
    );
    expect(next).toEqual(new Set(["a", "b"]));
  });

  it("cmd/ctrl click toggles an already-selected item out", () => {
    const next = computeRangeSelection(
      { ...NONE, ctrlKey: true },
      new Set(["a", "b"]),
      order,
      "b",
      "a"
    );
    expect(next).toEqual(new Set(["b"]));
  });

  it("shift click selects the inclusive range from the last selection", () => {
    const next = computeRangeSelection({ ...NONE, shiftKey: true }, new Set(["b"]), order, "b", "d");
    expect([...next].sort()).toEqual(["b", "c", "d"]);
  });

  it("shift click resolves the range regardless of click direction", () => {
    const next = computeRangeSelection({ ...NONE, shiftKey: true }, new Set(["d"]), order, "d", "b");
    expect([...next].sort()).toEqual(["b", "c", "d"]);
  });

  it("shift click falls back to a single selection when an anchor is missing from order", () => {
    const next = computeRangeSelection(
      { ...NONE, shiftKey: true },
      new Set(["x"]),
      order,
      "x",
      "c"
    );
    expect([...next]).toEqual(["c"]);
  });

  it("shift click with no prior selection behaves like a plain click", () => {
    const next = computeRangeSelection({ ...NONE, shiftKey: true }, new Set(), order, null, "c");
    expect([...next]).toEqual(["c"]);
  });
});

describe("resolveTargetPaths", () => {
  it("targets the whole selection when right-clicking inside a multi-selection", () => {
    expect(resolveTargetPaths(new Set(["a", "b", "c"]), "b").sort()).toEqual(["a", "b", "c"]);
  });

  it("targets only the clicked item when it is outside the selection", () => {
    expect(resolveTargetPaths(new Set(["a", "b"]), "z")).toEqual(["z"]);
  });

  it("targets only the clicked item for a single selection", () => {
    expect(resolveTargetPaths(new Set(["a"]), "a")).toEqual(["a"]);
  });
});
