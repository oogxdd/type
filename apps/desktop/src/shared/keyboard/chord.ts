/**
 * One way to describe and match a modified keystroke.
 *
 * Bindings are written against `event.code`, the physical key, so `Cmd+K` stays
 * `Cmd+K` on a Cyrillic layout — the rule the keyboard contract in
 * `docs/KEYBOARD_NAVIGATION_EXPERIENCE.md` states for every modified shortcut.
 * `Mod` means ⌘ on macOS and Ctrl elsewhere; a binding written once matches
 * both, because no surface in this app wants to tell them apart.
 *
 * Matching is exact on every modifier. Shortcuts used to be recognised with
 * hand-written conditions that each forgot a different modifier, so `Alt+Cmd+K`
 * opened the palette and `Shift+Cmd+B` toggled the sidebar.
 */

export type Chord = {
  /** `KeyK`, `Digit0`, `Backspace`, `NumpadAdd`, … */
  code: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
};

const MODIFIERS = new Set(["Mod", "Shift", "Alt"]);

/** Parses `"Mod+KeyK"`, `"Mod+Shift+KeyL"`, `"Mod+Backspace"`. */
export function parseChord(spec: string): Chord {
  const parts = spec.split("+");
  const code = parts.pop();
  if (!code || MODIFIERS.has(code)) {
    throw new Error(`Chord "${spec}" names no key`);
  }
  const chord: Chord = { code, mod: false, shift: false, alt: false };
  for (const part of parts) {
    if (part === "Mod") chord.mod = true;
    else if (part === "Shift") chord.shift = true;
    else if (part === "Alt") chord.alt = true;
    else throw new Error(`Chord "${spec}" has an unknown modifier "${part}"`);
  }
  return chord;
}

export function chordFromEvent(event: KeyboardEvent): Chord {
  return {
    code: event.code,
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

/** Canonical string for a chord — equal ids mean the same keystroke. */
export function chordId(chord: Chord): string {
  return [
    chord.mod ? "Mod" : "",
    chord.shift ? "Shift" : "",
    chord.alt ? "Alt" : "",
    chord.code,
  ]
    .filter(Boolean)
    .join("+");
}

export const chordMatches = (a: Chord, b: Chord) =>
  a.code === b.code && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;

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
    chord.mod ? (isMac ? "⌘" : "Ctrl") : "",
    chord.alt ? (isMac ? "⌥" : "Alt") : "",
    chord.shift ? (isMac ? "⇧" : "Shift") : "",
    keyLabel(chord.code),
  ].filter(Boolean);
  return isMac ? parts.join("") : parts.join("+");
}
