import type { Editor } from "@tiptap/react";
import type { BlockAnchor } from "@typenotes/shared/selection-tags";
import { documentBlocks } from "./tagged-blocks";

export type TagSurface = { editor: Editor; path: string; editable: boolean };
export type CapturedTagSelection = { surface: TagSurface; blocks: BlockAnchor[] };
const surfaces = new Set<TagSurface>();

export function registerTagSurface(surface: TagSurface) {
  surfaces.add(surface);
  return () => { surfaces.delete(surface); };
}
export const isTagSurfaceCurrent = (surface: TagSurface) => surfaces.has(surface) && !surface.editor.isDestroyed;

/** Capture before Cmd+K moves focus and replaces the browser selection. */
export function captureTagSelection(): CapturedTagSelection[] {
  const selection = window.getSelection();
  const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const result: CapturedTagSelection[] = [];
  for (const surface of surfaces) {
    if (surface.editor.isDestroyed) continue;
    const { editor } = surface;
    const selected = documentBlocks(editor.state.doc).filter(({ node, pos }) => {
      if (surface.editable && editor.view.hasFocus()) {
        const { from, to, empty } = editor.state.selection;
        return !empty && from < pos + node.nodeSize - 1 && to > pos + 1;
      }
      if (!range) return false;
      const dom = editor.view.nodeDOM(pos);
      if (!dom || !range.intersectsNode(dom)) return false;
      const intersection = document.createRange();
      intersection.selectNodeContents(dom);
      if (range.compareBoundaryPoints(Range.START_TO_START, intersection) > 0) intersection.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, intersection) < 0) intersection.setEnd(range.endContainer, range.endOffset);
      return !intersection.collapsed && intersection.toString().length > 0;
    });
    if (selected.length) result.push({ surface, blocks: selected.map((block) => block.anchor) });
  }
  return result;
}
