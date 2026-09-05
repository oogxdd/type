/**
 * Pure text motions and text objects.
 *
 * Everything here works on a flat string plus a character index, exactly like
 * Vim's buffer model. `flat-doc.ts` is what maps a ProseMirror document onto
 * that model, so these functions stay free of any editor dependency and are
 * cheap to test.
 *
 * Indices are character offsets into `text`. Ranges are half-open
 * (`[start, end)`) unless a doc comment says otherwise.
 */

export type CharClass = "blank" | "word" | "punct";

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/**
 * Vim's three character classes. In "big word" mode (`W`, `B`, `E`) everything
 * that is not blank counts as one class, which is what makes `W` jump over
 * `foo.bar(baz)` in a single step.
 */
export const classOf = (character: string | undefined, big = false): CharClass => {
  if (character === undefined || character === "" || /\s/.test(character)) {
    return "blank";
  }
  if (big) {
    return "word";
  }
  return WORD_CHARACTER.test(character) ? "word" : "punct";
};

const clampIndex = (text: string, index: number) =>
  Math.max(0, Math.min(text.length, index));

/** Start index of the line containing `index`. */
export const lineStartIndex = (text: string, index: number) => {
  const from = clampIndex(text, index);
  if (from === 0) {
    return 0;
  }
  const newline = text.lastIndexOf("\n", from - 1);
  return newline === -1 ? 0 : newline + 1;
};

/** Index of the line's terminating newline (or `text.length` on the last line). */
export const lineEndIndex = (text: string, index: number) => {
  const newline = text.indexOf("\n", clampIndex(text, index));
  return newline === -1 ? text.length : newline;
};

/** `^` — first non-blank character of the current line. */
export const firstNonBlankIndex = (text: string, index: number) => {
  const start = lineStartIndex(text, index);
  const end = lineEndIndex(text, index);
  let cursor = start;
  while (cursor < end && /[ \t]/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
};

/** `g_` — last non-blank character of the current line. */
export const lastNonBlankIndex = (text: string, index: number) => {
  const start = lineStartIndex(text, index);
  const end = lineEndIndex(text, index);
  let cursor = end - 1;
  while (cursor > start && /[ \t]/.test(text[cursor])) {
    cursor -= 1;
  }
  return Math.max(start, cursor);
};

/** `w` / `W` — start of the next word. */
export const wordForward = (text: string, index: number, big = false) => {
  const length = text.length;
  let cursor = clampIndex(text, index);
  if (cursor >= length) {
    return length;
  }
  const startClass = classOf(text[cursor], big);
  if (startClass !== "blank") {
    while (cursor < length && classOf(text[cursor], big) === startClass) {
      cursor += 1;
    }
  }
  while (cursor < length && classOf(text[cursor], big) === "blank") {
    // An empty line is a word of its own, and `w` stops on it.
    if (text[cursor] === "\n" && (cursor + 1 >= length || text[cursor + 1] === "\n")) {
      return Math.min(cursor + 1, length);
    }
    cursor += 1;
  }
  return cursor;
};

/** `b` / `B` — start of the previous word. */
export const wordBackward = (text: string, index: number, big = false) => {
  let cursor = clampIndex(text, index) - 1;
  if (cursor < 0) {
    return 0;
  }
  while (cursor >= 0 && classOf(text[cursor], big) === "blank") {
    if (text[cursor] === "\n" && cursor > 0 && text[cursor - 1] === "\n") {
      return cursor;
    }
    cursor -= 1;
  }
  if (cursor < 0) {
    return 0;
  }
  const runClass = classOf(text[cursor], big);
  while (cursor > 0 && classOf(text[cursor - 1], big) === runClass) {
    cursor -= 1;
  }
  return cursor;
};

/** `e` / `E` — last character of the current or next word (inclusive motion). */
export const wordEndForward = (text: string, index: number, big = false) => {
  const length = text.length;
  let cursor = clampIndex(text, index) + 1;
  while (cursor < length && classOf(text[cursor], big) === "blank") {
    cursor += 1;
  }
  if (cursor >= length) {
    return Math.max(0, length - 1);
  }
  const runClass = classOf(text[cursor], big);
  while (cursor + 1 < length && classOf(text[cursor + 1], big) === runClass) {
    cursor += 1;
  }
  return cursor;
};

/** `ge` / `gE` — last character of the previous word (inclusive motion). */
export const wordEndBackward = (text: string, index: number, big = false) => {
  let cursor = clampIndex(text, index) - 1;
  while (cursor >= 0 && classOf(text[cursor], big) === "blank") {
    cursor -= 1;
  }
  return Math.max(0, cursor);
};

export type FindCharOptions = {
  forward: boolean;
  till: boolean;
  count?: number;
};

/**
 * `f` / `F` / `t` / `T` — character search inside the current line. Returns
 * `null` when the character is not there, so the caller can leave the cursor
 * alone instead of guessing.
 */
export const findCharInLine = (
  text: string,
  index: number,
  target: string,
  { forward, till, count = 1 }: FindCharOptions
): number | null => {
  const start = lineStartIndex(text, index);
  const end = lineEndIndex(text, index);
  let cursor = clampIndex(text, index);
  for (let step = 0; step < Math.max(1, count); step += 1) {
    // `t`/`T` repeated from the resting position would find the same character
    // again, so the scan starts one character past the offset it produced.
    let scan = forward ? cursor + (till && step > 0 ? 2 : 1) : cursor - (till && step > 0 ? 2 : 1);
    let found: number | null = null;
    while (forward ? scan < end : scan >= start) {
      if (text[scan] === target) {
        found = scan;
        break;
      }
      scan += forward ? 1 : -1;
    }
    if (found === null) {
      return null;
    }
    cursor = found;
  }
  if (!till) {
    return cursor;
  }
  return forward ? cursor - 1 : cursor + 1;
};

/** `}` — start of the next blank line (paragraph boundary). */
export const paragraphForward = (text: string, index: number) => {
  const length = text.length;
  let cursor = lineEndIndex(text, index);
  let sawContent = !isBlankLineAt(text, index);
  while (cursor < length) {
    cursor += 1;
    const blank = isBlankLineAt(text, cursor);
    if (blank && sawContent) {
      return cursor;
    }
    if (!blank) {
      sawContent = true;
    }
    cursor = lineEndIndex(text, cursor);
  }
  return length;
};

/** `{` — start of the previous blank line (paragraph boundary). */
export const paragraphBackward = (text: string, index: number) => {
  let cursor = lineStartIndex(text, index);
  let sawContent = !isBlankLineAt(text, index);
  while (cursor > 0) {
    cursor = lineStartIndex(text, cursor - 1);
    const blank = isBlankLineAt(text, cursor);
    if (blank && sawContent) {
      return cursor;
    }
    if (!blank) {
      sawContent = true;
    }
  }
  return 0;
};

const isBlankLineAt = (text: string, index: number) => {
  const start = lineStartIndex(text, index);
  const end = lineEndIndex(text, index);
  return text.slice(start, end).trim() === "";
};

const BRACKET_PAIRS: Record<string, { match: string; forward: boolean }> = {
  "(": { match: ")", forward: true },
  ")": { match: "(", forward: false },
  "[": { match: "]", forward: true },
  "]": { match: "[", forward: false },
  "{": { match: "}", forward: true },
  "}": { match: "{", forward: false },
};

/**
 * `%` — jump to the matching bracket. Like Vim, when the cursor is not on a
 * bracket the rest of the line is scanned for the first one.
 */
export const matchingBracket = (text: string, index: number): number | null => {
  const lineEnd = lineEndIndex(text, index);
  let origin = clampIndex(text, index);
  while (origin < lineEnd && !BRACKET_PAIRS[text[origin]]) {
    origin += 1;
  }
  const pair = BRACKET_PAIRS[text[origin]];
  if (!pair) {
    return null;
  }
  const open = text[origin];
  let depth = 0;
  let cursor = origin;
  while (cursor >= 0 && cursor < text.length) {
    if (text[cursor] === open) {
      depth += 1;
    } else if (text[cursor] === pair.match) {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
    cursor += pair.forward ? 1 : -1;
  }
  return null;
};

export type TextRange = { start: number; end: number };

/** `iw` / `aw` / `iW` / `aW`. */
export const wordObject = (
  text: string,
  index: number,
  { inner, big }: { inner: boolean; big: boolean }
): TextRange | null => {
  if (text.length === 0) {
    return null;
  }
  const cursor = Math.min(index, text.length - 1);
  if (text[cursor] === "\n") {
    return { start: cursor, end: cursor };
  }
  const runClass = classOf(text[cursor], big);
  let start = cursor;
  let end = cursor + 1;
  while (start > 0 && text[start - 1] !== "\n" && classOf(text[start - 1], big) === runClass) {
    start -= 1;
  }
  while (end < text.length && text[end] !== "\n" && classOf(text[end], big) === runClass) {
    end += 1;
  }
  if (inner) {
    return { start, end };
  }
  // `aw` takes the trailing whitespace, falling back to the leading run when
  // the word ends the line.
  let trailing = end;
  while (trailing < text.length && /[ \t]/.test(text[trailing])) {
    trailing += 1;
  }
  if (trailing > end) {
    return { start, end: trailing };
  }
  let leading = start;
  while (leading > 0 && /[ \t]/.test(text[leading - 1])) {
    leading -= 1;
  }
  return { start: leading, end };
};

/** `i"` / `a"` and friends, scoped to the current line like Vim. */
export const quoteObject = (
  text: string,
  index: number,
  quote: string,
  { inner }: { inner: boolean }
): TextRange | null => {
  const lineStart = lineStartIndex(text, index);
  const lineEnd = lineEndIndex(text, index);
  const positions: number[] = [];
  for (let cursor = lineStart; cursor < lineEnd; cursor += 1) {
    if (text[cursor] === quote && text[cursor - 1] !== "\\") {
      positions.push(cursor);
    }
  }
  for (let pair = 0; pair + 1 < positions.length; pair += 2) {
    const open = positions[pair];
    const close = positions[pair + 1];
    if (index <= close) {
      return inner
        ? { start: open + 1, end: close }
        : { start: open, end: close + 1 };
    }
  }
  return null;
};

/** `i(` / `a{` / … — nesting-aware, spans lines. */
export const bracketObject = (
  text: string,
  index: number,
  open: string,
  close: string,
  { inner }: { inner: boolean }
): TextRange | null => {
  const cursor = clampIndex(text, index);
  let depth = 0;
  let start = -1;
  for (let scan = cursor; scan >= 0; scan -= 1) {
    if (text[scan] === close && scan !== cursor) {
      depth += 1;
    } else if (text[scan] === open) {
      if (depth === 0) {
        start = scan;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) {
    return null;
  }
  depth = 0;
  let end = -1;
  for (let scan = start + 1; scan < text.length; scan += 1) {
    if (text[scan] === open) {
      depth += 1;
    } else if (text[scan] === close) {
      if (depth === 0) {
        end = scan;
        break;
      }
      depth -= 1;
    }
  }
  if (end === -1) {
    return null;
  }
  return inner ? { start: start + 1, end } : { start, end: end + 1 };
};

/** `ip` / `ap` — a run of non-blank lines, plus the blank run for `ap`. */
export const paragraphObject = (
  text: string,
  index: number,
  { inner }: { inner: boolean }
): TextRange => {
  const startsBlank = isBlankLineAt(text, index);
  let start = lineStartIndex(text, index);
  while (start > 0) {
    const previous = lineStartIndex(text, start - 1);
    if (isBlankLineAt(text, previous) !== startsBlank) {
      break;
    }
    start = previous;
  }
  let end = lineEndIndex(text, index);
  while (end < text.length) {
    const next = end + 1;
    if (isBlankLineAt(text, next) !== startsBlank) {
      break;
    }
    end = lineEndIndex(text, next);
  }
  if (inner) {
    return { start, end };
  }
  let extended = end;
  while (extended < text.length) {
    const next = extended + 1;
    if (isBlankLineAt(text, next) === startsBlank) {
      break;
    }
    extended = lineEndIndex(text, next);
  }
  return { start, end: extended > end ? extended : end };
};
