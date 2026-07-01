import { beforeEach, describe, expect, it } from "vitest";

import { useSelection } from "./selection-store";

describe("selection store", () => {
  beforeEach(() => {
    useSelection.getState().resetSelection();
  });

  it("selects a mobile folder atomically", () => {
    useSelection.getState().setActiveNote("Feed/old.md");
    useSelection.getState().selectFolderForMobile("Projects");

    const state = useSelection.getState();
    expect(state.activeFolder).toBe("Projects");
    expect(state.selectedFolders).toEqual(new Set(["Projects"]));
    expect(state.activeNote).toBeNull();
    expect(state.selectedNotes).toEqual(new Set());
  });

  it("selects a mobile note and its parent folder", () => {
    useSelection.getState().selectNoteForMobile("Projects/example.md");

    const state = useSelection.getState();
    expect(state.activeFolder).toBe("Projects");
    expect(state.selectedFolders).toEqual(new Set(["Projects"]));
    expect(state.activeNote).toBe("Projects/example.md");
    expect(state.selectedNotes).toEqual(new Set(["Projects/example.md"]));
  });

  it("supports functional selection updates", () => {
    useSelection.getState().setSelectedNotes(new Set(["Feed/one.md"]));
    useSelection.getState().setSelectedNotes((current) => {
      const next = new Set(current);
      next.add("Feed/two.md");
      return next;
    });

    expect(useSelection.getState().selectedNotes).toEqual(
      new Set(["Feed/one.md", "Feed/two.md"])
    );
  });
});
