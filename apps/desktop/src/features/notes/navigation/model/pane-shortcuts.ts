/**
 * Which ⌘/Ctrl chords the global pane listener claims.
 *
 * `usePaneShortcuts` listens in the capture phase and calls `stopPropagation`,
 * so anything named here is taken away from every other handler in the app —
 * including the command palette's ⌘K and the editor's own keymap. Adding a code
 * here silently disables whatever else owns that chord.
 */
export type PaneShortcut =
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

export function paneShortcutFor(
  code: string,
  modifiers: { shiftKey: boolean }
): PaneShortcut | null {
  switch (code) {
    case "KeyT":
      return "toggle-sidebar";
    case "KeyW":
      return "toggle-navigation-focus";
    case "KeyJ":
      return "cycle-panes";
    case "KeyN":
      return "new-note";
    case "Backspace":
      return modifiers.shiftKey ? "delete-selection" : "trash-selection";
    case "Equal":
    case "NumpadAdd":
      return "font-size-up";
    case "Minus":
    case "NumpadSubtract":
      return "font-size-down";
    case "Digit0":
    case "Numpad0":
      return "font-size-reset";
    case "KeyL":
      return modifiers.shiftKey ? "lock-app" : null;
    default:
      return null;
  }
}
