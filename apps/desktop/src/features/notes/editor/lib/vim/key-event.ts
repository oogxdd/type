/**
 * Turns a browser `KeyboardEvent` into the two things the Vim grammar needs.
 *
 * - `key` is the *command* key, normalised to the US layout via `event.code`.
 *   Without this, `dd` on a Cyrillic layout would arrive as `вв` and nothing
 *   would work. This is why the original implementation matched on `event.code`.
 * - `char` is the literal character the user typed, which is what `f`, `t` and
 *   `r` must search for and insert — those have to follow the layout, not fight
 *   it.
 */

import type { VimKeyEvent } from "./keys";

/** `[unshifted, shifted]` for every US key that produces punctuation. */
const US_LAYOUT: Record<string, [string, string]> = {
  Digit1: ["1", "!"],
  Digit2: ["2", "@"],
  Digit3: ["3", "#"],
  Digit4: ["4", "$"],
  Digit5: ["5", "%"],
  Digit6: ["6", "^"],
  Digit7: ["7", "&"],
  Digit8: ["8", "*"],
  Digit9: ["9", "("],
  Digit0: ["0", ")"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Backquote: ["`", "~"],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
};

const ASCII_PRINTABLE = /^[\x20-\x7e]$/;

export const resolveVimKeyEvent = (event: KeyboardEvent): VimKeyEvent => {
  const char = event.key.length === 1 ? event.key : null;
  const ctrl = event.ctrlKey;

  if (char && ASCII_PRINTABLE.test(char)) {
    return { key: char, char, ctrl };
  }

  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (letter) {
    return {
      key: event.shiftKey ? letter : letter.toLowerCase(),
      char,
      ctrl,
    };
  }

  const punctuation = US_LAYOUT[event.code];
  if (punctuation) {
    return { key: punctuation[event.shiftKey ? 1 : 0], char, ctrl };
  }

  return { key: event.key, char, ctrl };
};
