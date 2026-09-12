import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { findWrapping } from "@tiptap/pm/transform";
import { DEFAULT_TAG_COLOR, mergeTagAttrs, type TagAttrs } from "@typenotes/shared/tags";
import type { SelectionTag } from "@typenotes/shared/selection-tags";
export { TagBlock, TagSpan } from "@typenotes/note-document/tagged-blocks";
export type TagSelectionRange = { from: number; to: number; block: boolean };

export function documentTagNames(doc: ProseMirrorNode): SelectionTag[] {
  const names = new Set<string>();
  doc.descendants(node => {
    if (node.type.name === "tagBlock") for (const name of node.attrs.tags) names.add(name);
    for (const mark of node.marks) if (mark.type.name === "tagSpan") for (const name of mark.attrs.tags) names.add(name);
  });
  return [...names].map(name => ({ name, color: DEFAULT_TAG_COLOR }));
}

export function assignEditorTag(editor: Editor, selected: TagSelectionRange[], tag: SelectionTag) {
  const tr = closeHistory(editor.state.tr);
  const extra = { tags: [tag.name], flags: {} };
  for (const selection of selected) {
    const from = tr.mapping.map(selection.from), to = tr.mapping.map(selection.to);
    if (from < 0 || to > tr.doc.content.size || from >= to) throw new Error("The selected text changed. Select it again.");
    if (!selection.block) {
      const segments: { from: number; to: number; attrs: TagAttrs }[] = [];
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return;
        const mark = node.marks.find(mark => mark.type.name === "tagSpan");
        segments.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), attrs: mergeTagAttrs(mark?.attrs as TagAttrs ?? { tags: [], flags: {} }, extra) });
      });
      for (const segment of segments) tr.addMark(segment.from, segment.to, editor.schema.marks.tagSpan.create(segment.attrs));
    } else {
      const range = tr.doc.resolve(from).blockRange(tr.doc.resolve(to));
      if (!range) throw new Error("Select a block of text.");
      if (range.parent.type.name === "tagBlock" && range.startIndex === 0 && range.endIndex === range.parent.childCount) {
        tr.setNodeMarkup(tr.doc.resolve(from).before(range.depth), undefined, { ...range.parent.attrs, ...mergeTagAttrs(range.parent.attrs as TagAttrs, extra) });
        continue;
      }
      const wrapping = findWrapping(range, editor.schema.nodes.tagBlock, extra);
      if (!wrapping) throw new Error("This selection cannot be wrapped. Select its containing blocks.");
      tr.wrap(range, wrapping);
    }
  }
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
}
