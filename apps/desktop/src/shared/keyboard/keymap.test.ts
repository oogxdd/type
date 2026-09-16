import { describe, expect, it } from "vitest";
import { chordId, formatChord, parseChord } from "./chord";
import { matchShortcut, SHORTCUTS, shortcutChords } from "./keymap";

const press = (init: Partial<KeyboardEvent> & { code: string }) =>
  ({ repeat: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

const match = (event: KeyboardEvent, editorFocused = false) =>
  matchShortcut(event, { editorFocused });

describe("the global keymap", () => {
  it("gives every chord to exactly one shortcut", () => {
    // The command palette lost ⌘K to a pane shortcut that claimed the chord in
    // passing. Two owners for one keystroke is always a bug, never a choice.
    const owners = new Map<string, string>();
    for (const binding of SHORTCUTS) {
      const id = chordId(parseChord(binding.chord));
      const existing = owners.get(id);
      expect(existing ?? binding.id, `${id} is claimed twice`).toBe(binding.id);
      owners.set(id, binding.id);
    }
  });

  it("opens the palette only on ⌘K", () => {
    expect(match(press({ code: "KeyK", metaKey: true }))).toBe("open-command-palette");
    expect(match(press({ code: "KeyK", ctrlKey: true }))).toBeNull();
    expect(match(press({ code: "KeyK", ctrlKey: true }), true)).toBeNull();
    expect(match(press({ code: "KeyK", metaKey: true, ctrlKey: true }))).toBeNull();
  });

  it("matches modifiers exactly", () => {
    expect(match(press({ code: "KeyK", metaKey: true, altKey: true }))).toBeNull();
    expect(match(press({ code: "KeyK", metaKey: true, shiftKey: true }))).toBeNull();
    expect(match(press({ code: "KeyK" }))).toBeNull();
  });

  it("separates trashing from deleting by Shift", () => {
    expect(match(press({ code: "Backspace", metaKey: true }))).toBe("trash-selection");
    expect(match(press({ code: "Backspace", metaKey: true, shiftKey: true }))).toBe("delete-selection");
  });

  it("locks only with Shift held", () => {
    expect(match(press({ code: "KeyL", metaKey: true }))).toBeNull();
    expect(match(press({ code: "KeyL", metaKey: true, shiftKey: true }))).toBe("lock-app");
  });

  it("ignores auto-repeat", () => {
    expect(match(press({ code: "KeyN", metaKey: true, repeat: true }))).toBeNull();
  });

  it("hands Ctrl+J back to the editor's own keymap, but not ⌘J", () => {
    expect(match(press({ code: "KeyJ", ctrlKey: true }), true)).toBeNull();
    expect(match(press({ code: "KeyJ", ctrlKey: true }), false)).toBe("cycle-panes");
    expect(match(press({ code: "KeyJ", metaKey: true }), true)).toBe("cycle-panes");
  });

  it("accepts both spellings of a shortcut with several chords", () => {
    expect(match(press({ code: "Equal", metaKey: true }))).toBe("font-size-up");
    expect(match(press({ code: "NumpadAdd", metaKey: true }))).toBe("font-size-up");
    expect(shortcutChords("font-size-up")).toHaveLength(2);
  });

  it("renders a chord for each platform", () => {
    expect(formatChord(parseChord("Mod+Shift+KeyL"), true)).toBe("⌘⇧L");
    expect(formatChord(parseChord("Mod+Shift+KeyL"), false)).toBe("Ctrl+Shift+L");
    expect(formatChord(parseChord("Mod+Backspace"), true)).toBe("⌘⌫");
    expect(formatChord(shortcutChords("open-command-palette")[0], true)).toBe("⌘K");
  });

  it("rejects a malformed binding", () => {
    expect(() => parseChord("Mod+Meta+KeyK")).toThrow();
    expect(() => parseChord("Mod")).toThrow();
  });
});
