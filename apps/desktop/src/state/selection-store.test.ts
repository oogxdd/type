import { beforeEach, describe, expect, it } from "vitest";

import {
  resetSelection,
  selectFolder,
  selectNote,
  setActiveNote,
  setSelectedNotes,
  useSelection,
} from "./selection-store";

describe("selection store", () => {
  beforeEach(() => {
    resetSelection();
  });

  it("selects a folder atomically, dropping the note selection", () => {
    setActiveNote("Feed/old.md");
    selectFolder("Projects");

    const state = useSelection.getState();
    expect(state.activeFolder).toBe("Projects");
    expect(state.selectedFolders).toEqual(new Set(["Projects"]));
    expect(state.lastSelectedFolder).toBe("Projects");
    expect(state.activeNote).toBeNull();
    expect(state.selectedNotes).toEqual(new Set());
    expect(state.lastSelectedNote).toBe("");
  });

  it("accepts a range override while keeping the clicked folder active", () => {
    selectFolder("b", new Set(["a", "b", "c"]));

    const state = useSelection.getState();
    expect(state.activeFolder).toBe("b");
    expect(state.selectedFolders).toEqual(new Set(["a", "b", "c"]));
    expect(state.lastSelectedFolder).toBe("b");
  });

  it("selects a note and derives its parent folder", () => {
    selectNote("Projects/example.md");

    const state = useSelection.getState();
    expect(state.activeFolder).toBe("Projects");
    expect(state.selectedFolders).toEqual(new Set(["Projects"]));
    expect(state.activeNote).toBe("Projects/example.md");
    expect(state.selectedNotes).toEqual(new Set(["Projects/example.md"]));
    expect(state.lastSelectedNote).toBe("Projects/example.md");
  });

  it("selects a note under an explicit parent with a range override", () => {
    selectNote("Feed/two.md", "Feed", new Set(["Feed/one.md", "Feed/two.md"]));

    const state = useSelection.getState();
    expect(state.activeFolder).toBe("Feed");
    expect(state.selectedNotes).toEqual(new Set(["Feed/one.md", "Feed/two.md"]));
    expect(state.activeNote).toBe("Feed/two.md");
    expect(state.lastSelectedNote).toBe("Feed/two.md");
  });

  it("supports functional selection updates", () => {
    setSelectedNotes(new Set(["Feed/one.md"]));
    setSelectedNotes((current) => {
      const next = new Set(current);
      next.add("Feed/two.md");
      return next;
    });

    expect(useSelection.getState().selectedNotes).toEqual(
      new Set(["Feed/one.md", "Feed/two.md"])
    );
  });
});
