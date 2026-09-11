import { describe, expect, it } from "vitest";
import { paneShortcutFor } from "./pane-shortcuts";

describe("global pane shortcuts", () => {
  it("leaves ⌘K to the command palette", () => {
    // The listener stops propagation, so claiming KeyK here keeps the palette
    // from opening at all — it did, until this test existed.
    expect(paneShortcutFor("KeyK", { shiftKey: false })).toBeNull();
  });

  it("cycles panes with ⌘J", () => {
    expect(paneShortcutFor("KeyJ", { shiftKey: false })).toBe("cycle-panes");
  });

  it("locks only with Shift held", () => {
    expect(paneShortcutFor("KeyL", { shiftKey: false })).toBeNull();
    expect(paneShortcutFor("KeyL", { shiftKey: true })).toBe("lock-app");
  });

  it("separates trashing from deleting", () => {
    expect(paneShortcutFor("Backspace", { shiftKey: false })).toBe("trash-selection");
    expect(paneShortcutFor("Backspace", { shiftKey: true })).toBe("delete-selection");
  });

  it("claims nothing else", () => {
    for (const code of ["KeyA", "KeyK", "Escape", "Enter", "KeyV"]) {
      if (code === "KeyK") continue;
      expect(paneShortcutFor(code, { shiftKey: false })).toBeNull();
    }
  });
});
