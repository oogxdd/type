import type { EditorPool } from "../hooks/use-retained-editor";
import type { Editor } from "@tiptap/react";
import type { RefObject } from "react";
import { TextSelection } from "@tiptap/pm/state";
import type { VimMode } from "./vim/keys";
import { getAdjacentTextblockVerticalPosition, getVerticalPosition } from "./vim/vertical-motion";

export type EditorSurfaceHandle = {
  editor: Editor;
  path: string;
  focus: (position: number, mode: VimMode) => void;
};
export type EditorSurface = {
  editorPool: EditorPool;
  scrollRef: RefObject<HTMLDivElement | null>;
  register: (handle: EditorSurfaceHandle) => () => void;
  activate: (handle: EditorSurfaceHandle) => void;
  focusStart: (multipleOnly?: boolean) => boolean;
  revealStart: (handle: EditorSurfaceHandle) => void;
  status: (handle: EditorSurfaceHandle, mode: string, pending: string) => void;
  moveVertical: (handle: EditorSurfaceHandle, direction: -1 | 1, count: number, mode: VimMode) => boolean;
};

/** Bare vertical navigation may cross documents. Operators and visual ranges never do. */
export function moveBetweenEditors(
  handles: EditorSurfaceHandle[], start: EditorSurfaceHandle,
  direction: -1 | 1, count: number, mode: VimMode, goalLeft: number,
  onBoundary?: (remaining: number) => void,
) {
  let index = handles.indexOf(start);
  if (index < 0 || (mode !== "normal" && mode !== "insert")) return false;
  const limit = Math.min(count, handles.reduce((sum, handle) => sum + handle.editor.state.doc.nodeSize, 0));
  for (let step = 0; step < limit; step++) {
    const handle = handles[index];
    const { view, state } = handle.editor;
    const head = state.selection.head;
    const adjacent = getAdjacentTextblockVerticalPosition(view, head, direction);
    const edge = direction > 0 ? TextSelection.atEnd(state.doc) : TextSelection.atStart(state.doc);
    if (state.selection.$head.sameParent(edge.$head) && view.endOfTextblock(direction > 0 ? "down" : "up")) {
      const next = handles[index + direction];
      if (!next) { onBoundary?.(count - step); break; }
      index += direction;
      const landing = direction > 0 ? TextSelection.atStart(next.editor.state.doc) : TextSelection.atEnd(next.editor.state.doc);
      next.focus(landing.head, mode);
      const coords = next.editor.view.coordsAtPos(landing.head);
      const hit = next.editor.view.posAtCoords({ left: goalLeft, top: (coords.top + coords.bottom) / 2 });
      if (hit) {
        const target = TextSelection.near(next.editor.state.doc.resolve(hit.pos), direction);
        next.focus(target.head, mode);
      }
    } else {
      const position = adjacent ?? getVerticalPosition(view, head, direction, 1, goalLeft);
      const selection = TextSelection.near(state.doc.resolve(Math.max(0, Math.min(state.doc.content.size, position))), direction);
      handle.focus(selection.head, mode);
    }
  }
  return true;
}

/** Browser drag/Shift selections may span sibling contenteditables. Keep the anchor's note. */
export function constrainSelection(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return;
  const element = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement;
  const editor = element?.closest<HTMLElement>(".tiptap-content[contenteditable=true]");
  if (!editor || !root.contains(editor) || editor.contains(selection.focusNode)) return;
  const backwards = Boolean(editor.compareDocumentPosition(selection.focusNode) & Node.DOCUMENT_POSITION_PRECEDING);
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(backwards);
  selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, range.startContainer, range.startOffset);
}
