/**
 * One way to describe and match a modified keystroke.
 *
 * Bindings are written against `event.code`, the physical key, so `Cmd+K` stays
 * `Cmd+K` on a Cyrillic layout — the rule the keyboard contract in
 * `docs/KEYBOARD_NAVIGATION_EXPERIENCE.md` states for every modified shortcut.
 * `Mod` means ⌘ on macOS and Ctrl elsewhere; a binding written once matches
 * both. `Meta` explicitly requires ⌘, as the command palette does.
 *
 * Matching is exact on every modifier. Shortcuts used to be recognised with
 * hand-written conditions that each forgot a different modifier, so `Alt+Cmd+K`
 * opened the palette and `Shift+Cmd+B` toggled the sidebar.
 */

export type Chord = {
  /** `KeyK`, `Digit0`, `Backspace`, `NumpadAdd`, … */
  code: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  modifier: "Mod" | "Meta" | "Ctrl" | "Meta+Ctrl" | null;
  shift: boolean;
  alt: boolean;
};

const MODIFIERS = new Set(["Mod", "Meta", "Ctrl", "Shift", "Alt"]);

/** Parses `"Mod+KeyK"`, `"Mod+Shift+KeyL"`, `"Mod+Backspace"`. */
export function parseChord(spec: string): Chord {
  const parts = spec.split("+");
  const code = parts.pop();
  if (!code || MODIFIERS.has(code)) {
    throw new Error(`Chord "${spec}" names no key`);
  }
  const chord: Chord = { code, modifier: null, shift: false, alt: false };
  for (const part of parts) {
    if (part === "Mod" || part === "Meta" || part === "Ctrl") {
      if (chord.modifier) throw new Error(`Chord "${spec}" mixes primary modifiers`);
      chord.modifier = part;
    }
    else if (part === "Shift") chord.shift = true;
    else if (part === "Alt") chord.alt = true;
    else throw new Error(`Chord "${spec}" has an unknown modifier "${part}"`);
  }
  return chord;
}

export function chordFromEvent(event: KeyboardEvent): Chord {
  return {
    code: event.code,
    modifier: event.metaKey ? (event.ctrlKey ? "Meta+Ctrl" : "Meta") : event.ctrlKey ? "Ctrl" : null,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

/** Canonical string for a chord — equal ids mean the same keystroke. */
export function chordId(chord: Chord): string {
  return [
    chord.modifier ?? "",
    chord.shift ? "Shift" : "",
    chord.alt ? "Alt" : "",
    chord.code,
  ]
    .filter(Boolean)
    .join("+");
}

/** Matches a binding against an event; Mod accepts either sole primary modifier. */
export const chordMatches = (binding: Chord, event: Chord) =>
  binding.code === event.code && binding.shift === event.shift && binding.alt === event.alt &&
  (binding.modifier === "Mod"
    ? event.modifier === "Meta" || event.modifier === "Ctrl" || event.modifier === "Mod"
    : binding.modifier === event.modifier);

const KEY_LABELS: Record<string, string> = {
  Backspace: "⌫",
  Equal: "+",
  Minus: "−",
  NumpadAdd: "+",
  NumpadSubtract: "−",
};

const keyLabel = (code: string) =>
  KEY_LABELS[code] ??
  code.replace(/^(Key|Digit|Numpad)/, "") ??
  code;

/** For menus and palette hints: `⌘⇧L` on macOS, `Ctrl+Shift+L` elsewhere. */
export function formatChord(chord: Chord, isMac: boolean): string {
  const parts = [
    chord.modifier === "Mod" ? (isMac ? "⌘" : "Ctrl") :
      chord.modifier === "Meta" ? (isMac ? "⌘" : "Meta") : chord.modifier ?? "",
    chord.alt ? (isMac ? "⌥" : "Alt") : "",
    chord.shift ? (isMac ? "⇧" : "Shift") : "",
    keyLabel(chord.code),
  ].filter(Boolean);
  return isMac ? parts.join("") : parts.join("+");
}
