/**
 * Executes a parsed `VimCommand` against a ProseMirror view.
 *
 * The flow is always the same: project the document with `buildVimDoc`, resolve
 * the command to a flat-index range using the pure motions, then translate that
 * range back into document positions and dispatch a transaction.
 *
 * Everything that needs layout (visual-line `j`/`k`, half-page scrolling,
 * centring the cursor) or Tiptap (list indentation, splitting, history) is
 * injected through `VimHost`, so this module stays free of React and of the
 * editor instance.
 *
 * `VimHost` is a live object: `setMode`/`setVisualAnchor` must update the
 * corresponding fields synchronously, because a single command routinely reads
 * back what it just set (`visualOperator` leaves Visual mode and then places the
 * cursor as Normal mode would).
 */

import { Fragment, type Mark, type Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { buildVimDoc, type VimDoc } from "./flat-doc";
import {
  isInclusiveMotion,
  isLinewiseMotion,
  type VimAction,
  type VimCommand,
  type VimMode,
  type VimMotion,
  type VimOperator,
  type VimTextObject,
} from "./keys";
import { readRegister, writeRegister, type VimRegisterValue } from "./registers";
import {
  bracketObject,
  findCharInLine,
  firstNonBlankIndex,
  lastNonBlankIndex,
  lineEndIndex,
  lineStartIndex,
  matchingBracket,
  paragraphBackward,
  paragraphForward,
  paragraphObject,
  quoteObject,
  wordBackward,
  wordEndBackward,
  wordEndForward,
  wordForward,
  wordObject,
} from "./text-motions";

export type VimFind = { char: string; forward: boolean; till: boolean };

export type VimLastChange = {
  command: VimCommand;
  insertedText: string | null;
};

export type VimHost = {
  view: EditorView;
  mode: VimMode;
  setMode: (mode: VimMode) => void;
  /** Visual-mode anchor, as a flat character index. */
  visualAnchor: number | null;
  setVisualAnchor: (index: number | null) => void;
  /**
   * Visual-mode cursor, as a flat character index. Charwise Visual selects the
   * character *under* the cursor, so the ProseMirror selection head sits one
   * position past it — reading the cursor back from the selection would drift
   * by one on every move. This is the authoritative head while Visual is active.
   */
  visualHead: number | null;
  setVisualHead: (index: number | null) => void;
  lastVisual: { anchor: number; head: number; mode: VimMode } | null;
  setLastVisual: (value: { anchor: number; head: number; mode: VimMode }) => void;
  lastFind: VimFind | null;
  setLastFind: (value: VimFind) => void;
  lastChange: VimLastChange | null;
  setLastChange: (value: VimLastChange) => void;
  /** Geometry-aware visual-line movement; returns the resulting document position. */
  moveVisualLines: (direction: -1 | 1, lineCount: number) => number;
  /** How many visual lines fit in half the viewport. */
  halfPageLines: () => number;
  scrollCursor: (placement: "center" | "top" | "bottom") => void;
  /** Tiptap list indent/outdent for `>` and `<`; false when not in a list. */
  indentSelection: (direction: 1 | -1) => boolean;
  /** What Enter does — splits a list item when in a list, a block otherwise. */
  splitBlock: () => boolean;
  undo: () => void;
  redo: () => void;
  /** Starts a new undo group, so one Insert session undoes as one step. */
  closeHistoryPoint: () => void;
  /** Tells the hook to start recording typed text for `.`. */
  beginInsertCapture: () => void;
};

const JUMP_LINES = 10;

type VimRange = {
  linewise: boolean;
  /** Inclusive flat start index. */
  startIndex: number;
  /** Exclusive flat end index. */
  endIndex: number;
  startLine: number;
  endLine: number;
};

const swapCase = (value: string) =>
  value.replace(/\p{L}/gu, (character) =>
    character === character.toLowerCase()
      ? character.toUpperCase()
      : character.toLowerCase()
  );

const CASE_TRANSFORMS: Record<"gu" | "gU" | "g~", (value: string) => string> = {
  gu: (value) => value.toLowerCase(),
  gU: (value) => value.toUpperCase(),
  "g~": swapCase,
};

const clampIndex = (doc: VimDoc, index: number) =>
  Math.max(0, Math.min(doc.text.length, index));

/**
 * Vim's Normal-mode cursor sits *on* a character, never past the end of the
 * line. Insert mode and operator ranges are the exceptions.
 */
const clampToLine = (doc: VimDoc, index: number) => {
  const start = lineStartIndex(doc.text, index);
  const end = lineEndIndex(doc.text, index);
  return Math.max(start, Math.min(index, Math.max(start, end - 1)));
};

const cursorIndex = (doc: VimDoc, view: EditorView) =>
  doc.toIndex(view.state.selection.head);

/** The Vim cursor: the tracked Visual head, or the selection head otherwise. */
const vimIndex = (host: VimHost, doc: VimDoc) =>
  (host.mode === "visual" || host.mode === "visual-line") &&
  host.visualHead !== null
    ? clampIndex(doc, host.visualHead)
    : cursorIndex(doc, host.view);

const makeRange = (
  doc: VimDoc,
  startIndex: number,
  endIndex: number,
  linewise: boolean
): VimRange => {
  const from = clampIndex(doc, Math.min(startIndex, endIndex));
  const to = clampIndex(doc, Math.max(startIndex, endIndex));
  return {
    linewise,
    startIndex: from,
    endIndex: to,
    startLine: doc.lineNumberAt(from),
    endLine: doc.lineNumberAt(to > from ? to - 1 : from),
  };
};

const lineRange = (doc: VimDoc, firstLine: number, lastLine: number): VimRange => {
  const start = Math.max(0, Math.min(firstLine, lastLine));
  const end = Math.min(doc.lines.length - 1, Math.max(firstLine, lastLine));
  return {
    linewise: true,
    startIndex: doc.lines[start].flatStart,
    endIndex: doc.lines[end].flatEnd,
    startLine: start,
    endLine: end,
  };
};

/** Resolves a motion to a flat index, or null when it cannot move. */
const resolveMotion = (
  host: VimHost,
  doc: VimDoc,
  index: number,
  motion: VimMotion,
  count: number
): number | null => {
  const text = doc.text;
  switch (motion.type) {
    case "left":
      return Math.max(lineStartIndex(text, index), index - count);
    case "right":
      return Math.min(lineEndIndex(text, index), index + count);
    case "down":
    case "up":
    case "jumpDown":
    case "jumpUp":
    case "halfPageDown":
    case "halfPageUp": {
      const direction: -1 | 1 =
        motion.type === "down" ||
        motion.type === "jumpDown" ||
        motion.type === "halfPageDown"
          ? 1
          : -1;
      const lines =
        motion.type === "jumpDown" || motion.type === "jumpUp"
          ? JUMP_LINES * count
          : motion.type === "halfPageDown" || motion.type === "halfPageUp"
            ? host.halfPageLines() * count
            : count;
      return doc.toIndex(host.moveVisualLines(direction, lines));
    }
    case "wordForward": {
      let cursor = index;
      for (let step = 0; step < count; step += 1) {
        cursor = wordForward(text, cursor, motion.big);
      }
      return cursor;
    }
    case "wordBackward": {
      let cursor = index;
      for (let step = 0; step < count; step += 1) {
        cursor = wordBackward(text, cursor, motion.big);
      }
      return cursor;
    }
    case "wordEnd": {
      let cursor = index;
      for (let step = 0; step < count; step += 1) {
        cursor = wordEndForward(text, cursor, motion.big);
      }
      return cursor;
    }
    case "wordEndBackward": {
      let cursor = index;
      for (let step = 0; step < count; step += 1) {
        cursor = wordEndBackward(text, cursor, motion.big);
      }
      return cursor;
    }
    case "lineStart":
      return lineStartIndex(text, index);
    case "firstNonBlank":
      return firstNonBlankIndex(text, index);
    case "lineEnd": {
      let cursor = index;
      for (let step = 1; step < count; step += 1) {
        cursor = Math.min(text.length, lineEndIndex(text, cursor) + 1);
      }
      return lineEndIndex(text, cursor);
    }
    case "lastNonBlank":
      return lastNonBlankIndex(text, index);
    case "gotoLine": {
      const target =
        motion.line === "last"
          ? doc.lines.length - 1
          : Math.max(0, Math.min(doc.lines.length - 1, motion.line - 1));
      return firstNonBlankIndex(text, doc.lines[target].flatStart);
    }
    case "findChar": {
      host.setLastFind({
        char: motion.char,
        forward: motion.forward,
        till: motion.till,
      });
      return findCharInLine(text, index, motion.char, {
        forward: motion.forward,
        till: motion.till,
        count,
      });
    }
    case "repeatFind": {
      const find = host.lastFind;
      if (!find) {
        return null;
      }
      return findCharInLine(text, index, find.char, {
        forward: motion.reverse ? !find.forward : find.forward,
        till: find.till,
        count,
      });
    }
    case "paragraphForward": {
      let cursor = index;
      for (let step = 0; step < count; step += 1) {
        cursor = paragraphForward(text, cursor);
      }
      return cursor;
    }
    case "paragraphBackward": {
      let cursor = index;
      for (let step = 0; step < count; step += 1) {
        cursor = paragraphBackward(text, cursor);
      }
      return cursor;
    }
    case "matchBracket":
      return matchingBracket(text, index);
    default:
      return null;
  }
};

const motionRange = (
  host: VimHost,
  doc: VimDoc,
  index: number,
  motion: VimMotion,
  count: number,
  operator: VimOperator
): VimRange | null => {
  if (isLinewiseMotion(motion)) {
    const currentLine = doc.lineNumberAt(index);
    if (motion.type === "gotoLine") {
      const target =
        motion.line === "last"
          ? doc.lines.length - 1
          : Math.max(0, Math.min(doc.lines.length - 1, motion.line - 1));
      return lineRange(doc, currentLine, target);
    }
    const step =
      motion.type === "jumpDown" || motion.type === "jumpUp"
        ? JUMP_LINES * count
        : motion.type === "halfPageDown" || motion.type === "halfPageUp"
          ? host.halfPageLines() * count
          : count;
    const direction =
      motion.type === "down" ||
      motion.type === "jumpDown" ||
      motion.type === "halfPageDown"
        ? 1
        : -1;
    return lineRange(doc, currentLine, currentLine + direction * step);
  }

  // `cw` on a non-blank behaves like `ce`: it changes the word, not the space
  // that follows it.
  const effective: VimMotion =
    operator === "c" &&
    motion.type === "wordForward" &&
    !/\s/.test(doc.text[index] ?? " ")
      ? { type: "wordEnd", big: motion.big }
      : motion;

  const target = resolveMotion(host, doc, index, effective, count);
  if (target === null) {
    return null;
  }
  const inclusive = isInclusiveMotion(effective);
  const start = Math.min(index, target);
  let end = Math.max(index, target) + (inclusive ? 1 : 0);

  // `dw` on the last word of a line stops at the line break rather than
  // swallowing it, which is what makes `dw` safe at the end of a paragraph.
  if (
    (operator === "d" || operator === "c") &&
    effective.type === "wordForward" &&
    target > index
  ) {
    const stop = lineEndIndex(doc.text, index);
    if (end > stop && index <= stop) {
      end = stop;
    }
  }
  if (end <= start) {
    end = Math.min(doc.text.length, start + (inclusive ? 1 : 0));
  }
  return makeRange(doc, start, end, false);
};

const textObjectRange = (
  doc: VimDoc,
  index: number,
  object: VimTextObject
): VimRange | null => {
  const text = doc.text;
  const inner = object.inner;
  if (object.kind === "word") {
    const found = wordObject(text, index, { inner, big: object.big ?? false });
    return found ? makeRange(doc, found.start, found.end, false) : null;
  }
  if (object.kind === "quote") {
    const found = quoteObject(text, index, object.quote ?? '"', { inner });
    return found ? makeRange(doc, found.start, found.end, false) : null;
  }
  if (object.kind === "bracket") {
    const found = bracketObject(
      text,
      index,
      object.open ?? "(",
      object.close ?? ")",
      { inner }
    );
    return found ? makeRange(doc, found.start, found.end, false) : null;
  }
  const paragraph = paragraphObject(text, index, { inner });
  return lineRange(
    doc,
    doc.lineNumberAt(paragraph.start),
    doc.lineNumberAt(paragraph.end)
  );
};

const rangePositions = (doc: VimDoc, range: VimRange) =>
  range.linewise
    ? { from: doc.lines[range.startLine].from, to: doc.lines[range.endLine].to }
    : { from: doc.toPos(range.startIndex), to: doc.toPos(range.endIndex) };

const rangeText = (doc: VimDoc, range: VimRange) =>
  range.linewise
    ? doc.text.slice(
        doc.lines[range.startLine].flatStart,
        doc.lines[range.endLine].flatEnd
      )
    : doc.text.slice(range.startIndex, range.endIndex);

const captureRegister = (
  host: VimHost,
  doc: VimDoc,
  range: VimRange,
  register: string | null
) => {
  const pmDoc = host.view.state.doc;
  const text = rangeText(doc, range);
  let slice: Slice | undefined;
  if (range.linewise) {
    const first = doc.lines[range.startLine];
    const last = doc.lines[range.endLine];
    if (first.wholeBlock && last.wholeBlock) {
      slice = pmDoc.slice(first.blockPos, last.blockEnd);
    }
  } else {
    const { from, to } = rangePositions(doc, range);
    slice = pmDoc.slice(from, to);
  }
  writeRegister(register, { text, linewise: range.linewise, slice });
};

/**
 * Deletes a range and returns the document position the cursor should land on,
 * or null when there was nothing to delete.
 */
const deleteRange = (
  host: VimHost,
  doc: VimDoc,
  range: VimRange,
  keepEmptyLine: boolean
): number | null => {
  const { state } = host.view;
  const tr = state.tr;
  if (!range.linewise) {
    const { from, to } = rangePositions(doc, range);
    if (to <= from) {
      return null;
    }
    tr.delete(from, to);
    host.view.dispatch(tr.scrollIntoView());
    return from;
  }

  const first = doc.lines[range.startLine];
  const last = doc.lines[range.endLine];

  if (keepEmptyLine || !first.wholeBlock || !last.wholeBlock) {
    // Either the caller wants an empty line left behind (`cc`), or hard breaks
    // mean these lines are not whole blocks — delete the text, not the nodes.
    if (last.to <= first.from) {
      return first.from;
    }
    tr.delete(first.from, last.to);
    host.view.dispatch(tr.scrollIntoView());
    return first.from;
  }

  if (first.blockPos <= 0 && last.blockEnd >= state.doc.content.size) {
    // Deleting every block would leave an invalid document.
    const paragraph = state.schema.nodes.paragraph.createAndFill();
    if (!paragraph) {
      return null;
    }
    tr.replaceWith(0, state.doc.content.size, paragraph);
    host.view.dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(1))).scrollIntoView()
    );
    return 1;
  }

  tr.delete(first.blockPos, last.blockEnd);
  const landing = Math.max(1, Math.min(first.blockPos + 1, tr.doc.content.size));
  host.view.dispatch(
    tr.setSelection(TextSelection.near(tr.doc.resolve(landing))).scrollIntoView()
  );
  return landing;
};

/** Rewrites the text in a document range while preserving its marks. */
const replaceTextInRange = (
  host: VimHost,
  from: number,
  to: number,
  transform: (value: string) => string
) => {
  const { state } = host.view;
  const edits: { from: number; to: number; text: string; marks: readonly Mark[] }[] =
    [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (end <= start) {
      return;
    }
    const current = node.text.slice(start - pos, end - pos);
    const next = transform(current);
    if (next !== current) {
      edits.push({ from: start, to: end, text: next, marks: node.marks });
    }
  });
  if (edits.length === 0) {
    return false;
  }
  const tr = state.tr;
  // Applying back to front keeps the untouched earlier positions valid.
  edits.reverse().forEach((edit) => {
    tr.replaceWith(
      edit.from,
      edit.to,
      state.schema.text(edit.text, edit.marks as Mark[])
    );
  });
  host.view.dispatch(tr);
  return true;
};

/** Moves the head, extending the selection while a Visual mode is active. */
const applySelection = (host: VimHost, headPos: number) => {
  const { state } = host.view;
  const clamped = Math.max(0, Math.min(state.doc.content.size, headPos));
  const head = TextSelection.near(state.doc.resolve(clamped)).head;
  if (host.mode !== "visual" && host.mode !== "visual-line") {
    host.view.dispatch(
      state.tr
        .setSelection(TextSelection.near(state.doc.resolve(head)))
        .scrollIntoView()
    );
    return;
  }
  if (host.visualAnchor === null) {
    host.view.dispatch(
      state.tr
        .setSelection(TextSelection.near(state.doc.resolve(head)))
        .scrollIntoView()
    );
    return;
  }
  const doc = buildVimDoc(state.doc);
  const anchorIndex = clampIndex(doc, host.visualAnchor);
  const headIndex = doc.toIndex(head);
  let anchorPos = doc.toPos(anchorIndex);
  let headPosition = head;
  if (host.mode === "visual-line") {
    const anchorLine = doc.lines[doc.lineNumberAt(anchorIndex)];
    const headLine = doc.lines[doc.lineNumberAt(headIndex)];
    if (headIndex >= anchorIndex) {
      anchorPos = anchorLine.from;
      headPosition = headLine.to;
    } else {
      anchorPos = anchorLine.to;
      headPosition = headLine.from;
    }
  } else if (headIndex >= anchorIndex) {
    // Charwise Visual includes the character under the cursor.
    headPosition = doc.toPos(Math.min(doc.text.length, headIndex + 1));
  }
  host.view.dispatch(
    state.tr
      .setSelection(TextSelection.create(state.doc, anchorPos, headPosition))
      .scrollIntoView()
  );
};

const setCursor = (host: VimHost, doc: VimDoc, index: number, clamp = true) => {
  const target = clamp ? clampToLine(doc, index) : clampIndex(doc, index);
  applySelection(host, doc.toPos(target));
  if (host.mode === "visual" || host.mode === "visual-line") {
    host.setVisualHead(target);
  }
  return target;
};

/** The range currently covered by Visual mode. */
const visualRange = (host: VimHost, doc: VimDoc): VimRange | null => {
  if (host.visualAnchor === null) {
    return null;
  }
  const head = vimIndex(host, doc);
  const anchor = clampIndex(doc, host.visualAnchor);
  if (host.mode === "visual-line") {
    return lineRange(doc, doc.lineNumberAt(anchor), doc.lineNumberAt(head));
  }
  return makeRange(
    doc,
    Math.min(anchor, head),
    Math.min(doc.text.length, Math.max(anchor, head) + 1),
    false
  );
};

const enterInsert = (host: VimHost) => {
  host.closeHistoryPoint();
  host.setVisualAnchor(null);
  host.setVisualHead(null);
  host.setMode("insert");
  host.beginInsertCapture();
};

const leaveVisual = (host: VimHost, headIndex: number) => {
  if (host.visualAnchor !== null) {
    host.setLastVisual({
      anchor: host.visualAnchor,
      head: headIndex,
      mode: host.mode,
    });
  }
  host.setVisualAnchor(null);
  host.setVisualHead(null);
  host.setMode("normal");
};

const pasteValue = (
  host: VimHost,
  doc: VimDoc,
  value: VimRegisterValue,
  count: number,
  before: boolean
) => {
  const { state } = host.view;
  const index = cursorIndex(doc, host.view);
  const tr = state.tr;

  if (value.linewise) {
    const line = doc.lines[doc.lineNumberAt(index)];
    const insertAt = before ? line.blockPos : line.blockEnd;
    const copy = value.slice
      ? value.slice.content
      : Fragment.fromArray(
          value.text.split("\n").map((lineText) =>
            state.schema.nodes.paragraph.create(
              null,
              lineText ? state.schema.text(lineText) : null
            )
          )
        );
    let fragment = Fragment.empty;
    for (let step = 0; step < count; step += 1) {
      fragment = fragment.append(copy);
    }
    tr.insert(insertAt, fragment);
    const landing = Math.min(insertAt + 1, tr.doc.content.size);
    host.view.dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(landing))).scrollIntoView()
    );
    return;
  }

  const at = doc.toPos(before ? index : Math.min(doc.text.length, index + 1));
  if (value.slice) {
    let position = at;
    for (let step = 0; step < count; step += 1) {
      tr.replace(position, position, value.slice);
      position += value.slice.size;
    }
    const landing = Math.max(at, Math.min(position - 1, tr.doc.content.size));
    host.view.dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(landing))).scrollIntoView()
    );
    return;
  }
  const text = value.text.repeat(count);
  tr.insertText(text, at);
  const landing = Math.max(at, Math.min(at + text.length - 1, tr.doc.content.size));
  host.view.dispatch(
    tr.setSelection(TextSelection.near(tr.doc.resolve(landing))).scrollIntoView()
  );
};

const applyOperator = (
  host: VimHost,
  doc: VimDoc,
  operator: VimOperator,
  range: VimRange,
  register: string | null
): boolean => {
  if (operator === "y") {
    captureRegister(host, doc, range, register);
    setCursor(
      host,
      doc,
      range.linewise ? doc.lines[range.startLine].flatStart : range.startIndex
    );
    return true;
  }

  if (operator === ">" || operator === "<") {
    const { from, to } = rangePositions(doc, range);
    host.view.dispatch(
      host.view.state.tr.setSelection(
        TextSelection.create(host.view.state.doc, from, to)
      )
    );
    host.indentSelection(operator === ">" ? 1 : -1);
    const refreshed = buildVimDoc(host.view.state.doc);
    setCursor(
      host,
      refreshed,
      firstNonBlankIndex(refreshed.text, range.startIndex)
    );
    return true;
  }

  if (operator === "gu" || operator === "gU" || operator === "g~") {
    const { from, to } = rangePositions(doc, range);
    replaceTextInRange(host, from, to, CASE_TRANSFORMS[operator]);
    const refreshed = buildVimDoc(host.view.state.doc);
    setCursor(host, refreshed, range.startIndex);
    return true;
  }

  captureRegister(host, doc, range, register);
  const change = operator === "c";
  const landing = deleteRange(host, doc, range, change && range.linewise);
  if (landing === null) {
    return false;
  }
  if (change) {
    host.view.dispatch(
      host.view.state.tr.setSelection(
        TextSelection.near(host.view.state.doc.resolve(landing))
      )
    );
    enterInsert(host);
    return true;
  }
  const refreshed = buildVimDoc(host.view.state.doc);
  setCursor(host, refreshed, refreshed.toIndex(landing));
  return true;
};

/** Commands worth remembering for `.`. */
const isChangeCommand = (command: VimCommand) => {
  switch (command.type) {
    case "motion":
    case "textObject":
      return command.operator !== null && command.operator !== "y";
    case "lineOperator":
    case "visualOperator":
      return command.operator !== "y";
    case "replaceChar":
      return true;
    case "action":
      return (
        command.action !== "undo" &&
        command.action !== "redo" &&
        command.action !== "yankLine" &&
        command.action !== "repeatChange" &&
        !command.action.startsWith("visual") &&
        !command.action.startsWith("scroll")
      );
    default:
      return false;
  }
};

/**
 * Runs one parsed command. Returns false when nothing could be done, so the
 * caller can still swallow the key without pretending it did something.
 */
export const executeVimCommand = (
  command: VimCommand,
  host: VimHost,
  isReplay = false
): boolean => {
  const doc = buildVimDoc(host.view.state.doc);
  const index = vimIndex(host, doc);

  if (!isReplay && isChangeCommand(command)) {
    host.setLastChange({ command, insertedText: null });
  }

  switch (command.type) {
    case "motion": {
      if (command.operator) {
        const range = motionRange(
          host,
          doc,
          index,
          command.motion,
          command.count,
          command.operator
        );
        return range
          ? applyOperator(host, doc, command.operator, range, command.register)
          : false;
      }
      const target = resolveMotion(host, doc, index, command.motion, command.count);
      if (target === null) {
        return true;
      }
      setCursor(host, doc, target);
      return true;
    }

    case "textObject": {
      const range = textObjectRange(doc, index, command.object);
      if (!range) {
        return false;
      }
      if (command.operator) {
        return applyOperator(host, doc, command.operator, range, command.register);
      }
      // In Visual mode a bare text object extends the selection over it.
      host.setVisualAnchor(range.startIndex);
      setCursor(host, doc, Math.max(range.startIndex, range.endIndex - 1), false);
      return true;
    }

    case "lineOperator": {
      const currentLine = doc.lineNumberAt(index);
      const range = lineRange(doc, currentLine, currentLine + command.count - 1);
      return applyOperator(host, doc, command.operator, range, command.register);
    }

    case "visualOperator": {
      const range = visualRange(host, doc);
      if (!range) {
        return false;
      }
      leaveVisual(host, index);
      if (command.operator !== "p") {
        return applyOperator(host, doc, command.operator, range, command.register);
      }
      const value = readRegister(command.register);
      if (!value) {
        return false;
      }
      // The replaced text becomes the new unnamed-register content, as in Vim.
      captureRegister(host, doc, range, null);
      const landing = deleteRange(host, doc, range, false);
      if (landing === null) {
        return false;
      }
      pasteValue(host, buildVimDoc(host.view.state.doc), value, 1, true);
      return true;
    }

    case "replaceChar": {
      const line = doc.lines[doc.lineNumberAt(index)];
      const end = Math.min(line.flatEnd, index + command.count);
      if (end <= index) {
        return false;
      }
      host.view.dispatch(
        host.view.state.tr.insertText(
          command.char.repeat(end - index),
          doc.toPos(index),
          doc.toPos(end)
        )
      );
      setCursor(host, buildVimDoc(host.view.state.doc), end - 1);
      return true;
    }

    case "action":
      return executeAction(
        command.action,
        command.count,
        command.register,
        host,
        doc,
        index,
        isReplay
      );

    default:
      return false;
  }
};

const executeAction = (
  action: VimAction,
  count: number,
  register: string | null,
  host: VimHost,
  doc: VimDoc,
  index: number,
  isReplay: boolean
): boolean => {
  const text = doc.text;
  const line = doc.lines[doc.lineNumberAt(index)];

  switch (action) {
    case "insertBefore":
      setCursor(host, doc, index);
      enterInsert(host);
      return true;
    case "insertAfter":
      setCursor(host, doc, Math.min(lineEndIndex(text, index), index + 1), false);
      enterInsert(host);
      return true;
    case "insertLineStart":
      setCursor(host, doc, firstNonBlankIndex(text, index), false);
      enterInsert(host);
      return true;
    case "insertLineEnd":
      setCursor(host, doc, lineEndIndex(text, index), false);
      enterInsert(host);
      return true;

    case "openBelow":
    case "openAbove": {
      const below = action === "openBelow";
      host.closeHistoryPoint();
      setCursor(
        host,
        doc,
        below ? lineEndIndex(text, index) : lineStartIndex(text, index),
        false
      );
      if (!host.splitBlock()) {
        return false;
      }
      // The split shifted every position, so find the new line by number: `o`
      // lands on the line after the original, `O` on the one that took its slot.
      const refreshed = buildVimDoc(host.view.state.doc);
      const lineNumber = Math.min(
        refreshed.lines.length - 1,
        doc.lineNumberAt(index) + (below ? 1 : 0)
      );
      setCursor(host, refreshed, refreshed.lines[lineNumber].flatStart, false);
      enterInsert(host);
      return true;
    }

    case "deleteChar":
    case "deleteCharBefore": {
      const forward = action === "deleteChar";
      const start = forward ? index : Math.max(line.flatStart, index - count);
      const end = forward ? Math.min(line.flatEnd, index + count) : index;
      if (end <= start) {
        return false;
      }
      const range = makeRange(doc, start, end, false);
      captureRegister(host, doc, range, register);
      deleteRange(host, doc, range, false);
      setCursor(host, buildVimDoc(host.view.state.doc), start);
      return true;
    }

    case "deleteToLineEnd":
    case "changeToLineEnd": {
      const range = makeRange(doc, index, lineEndIndex(text, index), false);
      captureRegister(host, doc, range, register);
      deleteRange(host, doc, range, false);
      const refreshed = buildVimDoc(host.view.state.doc);
      if (action === "changeToLineEnd") {
        setCursor(host, refreshed, index, false);
        enterInsert(host);
        return true;
      }
      setCursor(host, refreshed, index);
      return true;
    }

    case "yankLine": {
      const lineNumber = doc.lineNumberAt(index);
      captureRegister(
        host,
        doc,
        lineRange(doc, lineNumber, lineNumber + count - 1),
        register
      );
      return true;
    }

    case "substituteChar": {
      const range = makeRange(doc, index, Math.min(line.flatEnd, index + count), false);
      captureRegister(host, doc, range, register);
      deleteRange(host, doc, range, false);
      setCursor(host, buildVimDoc(host.view.state.doc), index, false);
      enterInsert(host);
      return true;
    }

    case "substituteLine": {
      const lineNumber = doc.lineNumberAt(index);
      return applyOperator(
        host,
        doc,
        "c",
        lineRange(doc, lineNumber, lineNumber + count - 1),
        register
      );
    }

    case "paste":
    case "pasteBefore": {
      const value = readRegister(register);
      if (!value) {
        return false;
      }
      host.closeHistoryPoint();
      pasteValue(host, doc, value, count, action === "pasteBefore");
      return true;
    }

    case "undo":
      for (let step = 0; step < count; step += 1) {
        host.undo();
      }
      return true;
    case "redo":
      for (let step = 0; step < count; step += 1) {
        host.redo();
      }
      return true;

    case "joinLines": {
      // `3J` joins three lines, which is two joins; bare `J` is one.
      for (let step = 0; step < Math.max(1, count - 1); step += 1) {
        if (!joinLineBelow(host)) {
          break;
        }
      }
      return true;
    }

    case "toggleCase": {
      const end = Math.min(line.flatEnd, index + count);
      if (end <= index) {
        return false;
      }
      replaceTextInRange(host, doc.toPos(index), doc.toPos(end), swapCase);
      setCursor(host, buildVimDoc(host.view.state.doc), end);
      return true;
    }

    case "visualChar":
    case "visualLine": {
      const wanted: VimMode = action === "visualChar" ? "visual" : "visual-line";
      if (host.mode === wanted) {
        leaveVisual(host, index);
        setCursor(host, doc, index);
        return true;
      }
      if (host.mode === "normal") {
        host.setVisualAnchor(index);
      }
      host.setMode(wanted);
      setCursor(host, doc, index, false);
      return true;
    }

    case "visualSwapEnds": {
      if (host.visualAnchor === null) {
        return false;
      }
      const anchor = host.visualAnchor;
      host.setVisualAnchor(index);
      setCursor(host, doc, anchor, false);
      return true;
    }

    case "visualReselect": {
      const last = host.lastVisual;
      if (!last) {
        return false;
      }
      host.setVisualAnchor(clampIndex(doc, last.anchor));
      host.setMode(last.mode === "visual-line" ? "visual-line" : "visual");
      setCursor(host, doc, clampIndex(doc, last.head), false);
      return true;
    }

    case "scrollCenter":
      host.scrollCursor("center");
      return true;
    case "scrollTop":
      host.scrollCursor("top");
      return true;
    case "scrollBottom":
      host.scrollCursor("bottom");
      return true;

    case "repeatChange": {
      const last = host.lastChange;
      if (!last || isReplay) {
        return false;
      }
      const handled = executeVimCommand(last.command, host, true);
      if (!handled || !last.insertedText) {
        return handled;
      }
      // The replayed command left us in Insert mode; replay the typing too.
      const at = host.view.state.selection.head;
      host.view.dispatch(
        host.view.state.tr.insertText(last.insertedText, at).scrollIntoView()
      );
      host.setMode("normal");
      const refreshed = buildVimDoc(host.view.state.doc);
      setCursor(
        host,
        refreshed,
        Math.max(0, refreshed.toIndex(host.view.state.selection.head) - 1)
      );
      return true;
    }

    default:
      return false;
  }
};

/** `J` — pulls the next line up, separated by a single space. */
const joinLineBelow = (host: VimHost) => {
  const doc = buildVimDoc(host.view.state.doc);
  const index = cursorIndex(doc, host.view);
  const lineNumber = doc.lineNumberAt(index);
  const current = doc.lines[lineNumber];
  const next = doc.lines[lineNumber + 1];
  if (!next) {
    return false;
  }
  // Vim drops the joined line's indentation and separates with one space.
  const nextText = doc.text.slice(next.flatStart, next.flatEnd);
  const leading = nextText.length - nextText.trimStart().length;
  const needsSpace = current.to > current.from && nextText.trim().length > 0;
  const { state } = host.view;
  try {
    const tr = state.tr;
    tr.replaceWith(
      current.to,
      next.from + leading,
      needsSpace ? state.schema.text(" ") : Fragment.empty
    );
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(current.to, tr.doc.content.size)))
    );
    host.view.dispatch(tr.scrollIntoView());
    return true;
  } catch {
    return false;
  }
};

/** Places the Normal-mode cursor at a flat index (used by Escape handling). */
export const placeCursor = (host: VimHost, index: number, clamp = true) =>
  setCursor(host, buildVimDoc(host.view.state.doc), index, clamp);

/** The Vim cursor's current flat index, Visual-aware. */
export const vimHeadIndex = (host: VimHost) =>
  vimIndex(host, buildVimDoc(host.view.state.doc));
