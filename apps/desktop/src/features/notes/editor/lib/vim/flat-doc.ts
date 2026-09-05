/**
 * Projects a ProseMirror document onto Vim's flat "buffer of lines" model.
 *
 * Every textblock contributes one line (hard breaks split a block into
 * several), lines are joined with `\n`, and each flat character index maps back
 * to a document position. That mapping is what lets the pure motions in
 * `text-motions.ts` drive a rich-text editor.
 *
 * Non-textblock leaves (horizontal rules) contribute no line, so motions step
 * over them.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type VimLine = {
  /** Index of this line's first character in `VimDoc.text`. */
  flatStart: number;
  /** Index one past this line's last character (the newline is not included). */
  flatEnd: number;
  /** Document position of the first character. */
  from: number;
  /** Document position one past the last character. */
  to: number;
  /** Document position of the enclosing textblock node. */
  blockPos: number;
  /** Document position one past the enclosing textblock node. */
  blockEnd: number;
  /** False when a hard break splits the block into several lines. */
  wholeBlock: boolean;
};

export type VimDoc = {
  text: string;
  lines: VimLine[];
  /** Document position -> flat character index. */
  toIndex: (pos: number) => number;
  /** Flat character index -> document position. */
  toPos: (index: number) => number;
  lineNumberAt: (index: number) => number;
  lineAt: (index: number) => VimLine;
};

const OBJECT_REPLACEMENT = "￼";

const blockFlatText = (node: ProseMirrorNode) => {
  let text = "";
  node.forEach((child) => {
    if (child.isText) {
      text += child.text ?? "";
      return;
    }
    // Inline leaves occupy exactly one position, so a single placeholder
    // character keeps flat offsets and document positions aligned.
    text +=
      child.type.name === "hardBreak"
        ? "\n"
        : OBJECT_REPLACEMENT.repeat(Math.max(1, child.nodeSize));
  });
  return text;
};

export const buildVimDoc = (doc: ProseMirrorNode): VimDoc => {
  const lines: VimLine[] = [];
  const lineTexts: string[] = [];
  let flatCursor = 0;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    const contentStart = pos + 1;
    const segments = blockFlatText(node).split("\n");
    let offset = 0;
    segments.forEach((segment) => {
      lineTexts.push(segment);
      lines.push({
        flatStart: flatCursor,
        flatEnd: flatCursor + segment.length,
        from: contentStart + offset,
        to: contentStart + offset + segment.length,
        blockPos: pos,
        blockEnd: pos + node.nodeSize,
        wholeBlock: segments.length === 1,
      });
      flatCursor += segment.length + 1;
      offset += segment.length + 1;
    });
    return false;
  });

  if (lines.length === 0) {
    lineTexts.push("");
    lines.push({
      flatStart: 0,
      flatEnd: 0,
      from: 1,
      to: 1,
      blockPos: 0,
      blockEnd: doc.nodeSize,
      wholeBlock: true,
    });
  }

  const text = lineTexts.join("\n");

  const lineNumberAt = (index: number) => {
    const clamped = Math.max(0, Math.min(text.length, index));
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lines[middle].flatStart <= clamped) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  };

  const toPos = (index: number) => {
    const line = lines[lineNumberAt(index)];
    const clamped = Math.max(0, Math.min(text.length, index));
    return Math.min(line.to, line.from + (clamped - line.flatStart));
  };

  const toIndex = (pos: number) => {
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lines[middle].from <= pos) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    const line = lines[low];
    if (pos < line.from) {
      return line.flatStart;
    }
    return line.flatStart + Math.min(line.flatEnd - line.flatStart, pos - line.from);
  };

  return {
    text,
    lines,
    toIndex,
    toPos,
    lineNumberAt,
    lineAt: (index: number) => lines[lineNumberAt(index)],
  };
};
