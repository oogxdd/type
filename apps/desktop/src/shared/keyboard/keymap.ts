/**
 * Every modified keystroke the app claims, in one table.
 *
 * The dispatcher in `use-global-shortcuts` is the only listener for these, and
 * it runs in the capture phase (some chords have to beat Tiptap's own keymap),
 * so a chord listed here is taken away from every other handler in the app.
 * That is exactly how the command palette lost ⌘K: the pane listener claimed
 * the chord in passing and stopped its propagation. `keymap.test.ts` now fails
 * on a duplicate, which is the machine-checkable version of that bug.
 *
 * Unmodified navigation keys (`j`, `k`, `h`, `l`, Enter, Tab) are deliberately
 * not here: they are scoped to whichever pane owns focus and are handled there.
 * Vim's grammar is likewise its own layer, inside the ProseMirror view.
 *
 * The user-facing half of this table is the keyboard contract in
 * `docs/KEYBOARD_NAVIGATION_EXPERIENCE.md`. Keep them in step.
 */

import { chordFromEvent, chordMatches, parseChord, type Chord } from "./chord";

export type ShortcutId =
  | "open-command-palette"
  | "toggle-sidebar-rail"
  | "toggle-sidebar"
  | "toggle-navigation-focus"
  | "cycle-panes"
  | "new-note"
  | "trash-selection"
  | "delete-selection"
  | "font-size-up"
  | "font-size-down"
  | "font-size-reset"
  | "lock-app";

export type ShortcutBinding = {
  id: ShortcutId;
  /** See `parseChord`. */
  chord: string;
  /** What the shortcut does, for hints and for reading this table. */
  label: string;
  /**
   * Who wins while a text editor owns focus. `"editor"` hands the keystroke to
   * the editor's own keymap — Ctrl chords inside the editor belong to Vim, and
   * the keyboard contract says modal keys are handled before pane shortcuts.
   * Everything else is app-level and works in every mode.
   */
  owner?: "app" | "editor";
};

export const SHORTCUTS: readonly ShortcutBinding[] = [
  { id: "open-command-palette", chord: "Meta+KeyK", label: "Open the command palette" },
  { id: "toggle-sidebar-rail", chord: "Mod+KeyB", label: "Show or hide the sidebar rail" },
  { id: "toggle-sidebar", chord: "Mod+KeyT", label: "Collapse or expand the navigation sidebar" },
  { id: "toggle-navigation-focus", chord: "Mod+KeyW", label: "Toggle focus between navigation and content" },
  { id: "cycle-panes", chord: "Mod+KeyJ", label: "Cycle focus through the panes", owner: "editor" },
  { id: "new-note", chord: "Mod+KeyN", label: "Create a note" },
  { id: "trash-selection", chord: "Mod+Backspace", label: "Move the selection to Trash" },
  { id: "delete-selection", chord: "Mod+Shift+Backspace", label: "Delete the selection" },
  { id: "font-size-up", chord: "Mod+Equal", label: "Increase the editor font size" },
  { id: "font-size-up", chord: "Mod+NumpadAdd", label: "Increase the editor font size" },
  { id: "font-size-down", chord: "Mod+Minus", label: "Decrease the editor font size" },
  { id: "font-size-down", chord: "Mod+NumpadSubtract", label: "Decrease the editor font size" },
  { id: "font-size-reset", chord: "Mod+Digit0", label: "Reset the editor font size" },
  { id: "font-size-reset", chord: "Mod+Numpad0", label: "Reset the editor font size" },
  { id: "lock-app", chord: "Mod+Shift+KeyL", label: "Lock the app" },
];

const BINDINGS = SHORTCUTS.map((binding) => ({
  ...binding,
  parsed: parseChord(binding.chord),
}));

export function shortcutChords(id: ShortcutId): Chord[] {
  return BINDINGS.filter((binding) => binding.id === id).map((binding) => binding.parsed);
}

/**
 * The shortcut an event triggers, or null. `editorFocused` only matters for
 * bindings the editor owns; it never turns an app-level chord off.
 */
export function matchShortcut(
  event: KeyboardEvent,
  { editorFocused }: { editorFocused: boolean }
): ShortcutId | null {
  // A held key repeats; none of these shortcuts wants to fire per repeat.
  if (event.repeat) return null;
  const chord = chordFromEvent(event);
  if (!chord.modifier) return null;
  const binding = BINDINGS.find((candidate) => chordMatches(candidate.parsed, chord));
  if (!binding) return null;
  // ⌘ chords never reach a contenteditable as editing input, so only the Ctrl
  // spelling of an editor-owned chord has to stand down.
  if (binding.owner === "editor" && editorFocused && event.ctrlKey && !event.metaKey) {
    return null;
  }
  return binding.id;
}
