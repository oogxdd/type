/**
 * Geometry-based vertical movement for `j` / `k`.
 *
 * Vim moves by logical lines, but a note is mostly long wrapped paragraphs, so
 * a logical `j` would jump whole paragraphs. These helpers therefore move by
 * *visual* line, the way `gj`/`gk` do. Everything linewise (`dd`, `V`, `dj`,
 * `yy`) still works on logical lines — see `commands.ts`.
 */

import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const clampDocumentPosition = (view: EditorView, position: number) =>
  Math.max(1, Math.min(view.state.doc.content.size, position));

/**
 * Once the cursor is at the first/last visual line of a text block, move
 * through the document structure. Hit-testing coordinates at a paragraph
 * boundary is asymmetric in ProseMirror: moving down usually resolves to the
 * next block, while moving up can resolve back into the current one. The parent
 * offset retains Vim's desired column and naturally becomes 0 for an empty
 * paragraph.
 */
export const getAdjacentTextblockVerticalPosition = (
  view: EditorView,
  position: number,
  direction: -1 | 1
) => {
  try {
    const resolved = view.state.doc.resolve(position);
    if (!view.endOfTextblock(direction > 0 ? "down" : "up")) {
      return null;
    }
    const boundary = direction > 0 ? resolved.after() : resolved.before();
    const adjacent = TextSelection.near(
      view.state.doc.resolve(boundary),
      direction
    );
    if (resolved.sameParent(adjacent.$head)) {
      return null;
    }
    return (
      adjacent.$head.start() +
      Math.min(resolved.parentOffset, adjacent.$head.parent.content.size)
    );
  } catch {
    // Fall through to geometry-based movement at unusual nested boundaries.
  }
  return null;
};

export const getLineHeight = (view: EditorView, position: number) => {
  try {
    const coords = view.coordsAtPos(position, 1);
    const measured = coords.bottom - coords.top;
    if (measured > 0) {
      return measured;
    }
  } catch {
    // Fall through to the computed style below.
  }
  const computed = Number.parseFloat(window.getComputedStyle(view.dom).lineHeight);
  return Number.isFinite(computed) && computed > 0 ? computed : 24;
};

export const getVerticalPosition = (
  view: EditorView,
  position: number,
  direction: -1 | 1,
  lineCount: number,
  goalLeft: number
) => {
  try {
    // side=1 is important at the first character of a line/block. Without it,
    // ProseMirror may measure the same document position as the end of the
    // previous line, which makes `k` jump to that line's final character.
    const coords = view.coordsAtPos(position, 1);
    const lineHeight = getLineHeight(view, position);
    const startCenter = (coords.top + coords.bottom) / 2;
    const scanStep = Math.max(3, lineHeight / 4);
    const maxDistance = lineHeight * (lineCount * 4 + 4);
    let lastLineCenter = startCenter;
    let linesMoved = 0;
    let lastPosition: number | null = null;

    // Scan through layout space instead of assuming adjacent text blocks have
    // no margin. This avoids resolving a point in the gap between paragraphs
    // to the end of the previous line.
    for (let distance = scanStep; distance <= maxDistance; distance += scanStep) {
      const target = view.posAtCoords({
        left: goalLeft,
        top: startCenter + direction * distance,
      });
      if (!target) {
        continue;
      }
      const targetCoords = view.coordsAtPos(target.pos, 1);
      const targetCenter = (targetCoords.top + targetCoords.bottom) / 2;
      const crossedLine =
        direction * (targetCenter - lastLineCenter) >
        Math.max(3, lineHeight * 0.35);
      if (!crossedLine) {
        continue;
      }
      linesMoved += 1;
      lastLineCenter = targetCenter;
      lastPosition = clampDocumentPosition(view, target.pos);
      if (linesMoved >= lineCount) {
        return lastPosition;
      }
    }
    if (lastPosition !== null) {
      return lastPosition;
    }
  } catch {
    // Geometry can be unavailable during a document/layout transition.
  }
  return direction < 0 ? 1 : view.state.doc.content.size;
};
