import type { Editor } from "@tiptap/react";
import { documentTagNames, type TagSelectionRange } from "./tagged-blocks";

export type TagSurface = { editor: Editor; path: string; editable: boolean };
export type CapturedTagSelection = { surface: TagSurface; blocks: TagSelectionRange[]; doc: Editor["state"]["doc"] };
const surfaces = new Set<TagSurface>();

export function registerTagSurface(surface: TagSurface) {
  surfaces.add(surface);
  return () => { surfaces.delete(surface); };
}
export const isTagSurfaceCurrent = (surface: TagSurface) => surfaces.has(surface) && !surface.editor.isDestroyed;

export const openDocumentTags = () => [...surfaces].filter(surface => !surface.editor.isDestroyed).flatMap(surface => documentTagNames(surface.editor.state.doc));

/** Capture before Cmd+K moves focus and replaces the browser selection. */
export function captureTagSelection(): CapturedTagSelection[] {
  const selection = window.getSelection();
  const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const result: CapturedTagSelection[] = [];
  for (const surface of surfaces) {
    if (surface.editor.isDestroyed) continue;
    const { editor } = surface;
    let from: number, to: number;
    if (surface.editable && editor.view.hasFocus()) {
      if (editor.state.selection.empty) continue;
      ({ from, to } = editor.state.selection);
    } else {
      if (!range || !range.intersectsNode(editor.view.dom)) continue;
      const local = document.createRange();
      local.selectNodeContents(editor.view.dom);
      if (range.compareBoundaryPoints(Range.START_TO_START, local) > 0) local.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, local) < 0) local.setEnd(range.endContainer, range.endOffset);
      if (local.collapsed || !local.toString()) continue;
      from = editor.view.posAtDOM(local.startContainer, local.startOffset);
      to = editor.view.posAtDOM(local.endContainer, local.endOffset);
    }
    const $from = editor.state.doc.resolve(from), $to = editor.state.doc.resolve(to);
    const block = !$from.sameParent($to) || (from === $from.start() && to === $to.end());
    result.push({ surface, blocks: [{ from, to, block }], doc: editor.state.doc });
  }
  return result;
}
