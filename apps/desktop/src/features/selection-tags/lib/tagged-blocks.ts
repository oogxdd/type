import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import {
  blockAnchors, mergeTag, resolveBlockAnchor, validTag,
  type BlockAnchor, type SelectionTag, type TaggedBlock,
} from "@typenotes/shared/selection-tags";

export const TaggedBlocks = Extension.create({
  name: "taggedBlocks",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading", "codeBlock"], attributes: {
      selectionTags: {
        default: [],
        // Pasted HTML cannot introduce persistent tags into another note.
        parseHTML: () => [],
        renderHTML: (attributes) => {
          const tags = (attributes.selectionTags as SelectionTag[]).filter(validTag);
          if (!tags.length) return {};
          const colors = tags.map((tag) => tag.color);
          const background = colors.map((color, i) => `${color}1a ${i * 100 / colors.length}%, ${color}1a ${(i + 1) * 100 / colors.length}%`).join(", ");
          return {
            "data-selection-tagged": "true",
            "data-selection-tag-names": tags.map((tag) => tag.name).join(", "),
            title: tags.map((tag) => tag.name).join(" · "),
            style: `--selection-tag-color: ${colors[colors.length - 1]}; background: linear-gradient(90deg, ${background});`,
          };
        },
      },
    } }];
  },
});

export function documentBlocks(doc: ProseMirrorNode) {
  const entries: { node: ProseMirrorNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && "selectionTags" in node.attrs) entries.push({ node, pos });
  });
  // Explicit hard breaks contribute to the fingerprint too.
  const anchors = blockAnchors(entries.map(({ node }) => node.textBetween(0, node.content.size, "\n", "\n")));
  return entries.map((entry, index) => ({ ...entry, anchor: anchors[index] }));
}

export function snapshotTaggedBlocks(doc: ProseMirrorNode): TaggedBlock[] {
  return documentBlocks(doc).flatMap(({ node, anchor }) => {
    const tags = (node.attrs.selectionTags as SelectionTag[]).filter(validTag);
    return tags.length ? [{ ...anchor, tags }] : [];
  });
}

/** Restoring node attributes on load must never create an undo step. */
export function restoreTaggedBlocks(editor: Editor, saved: TaggedBlock[]): TaggedBlock[] {
  const blocks = documentBlocks(editor.state.doc);
  const anchors = blocks.map((block) => block.anchor);
  const unresolved: TaggedBlock[] = [];
  const byIndex = new Map<number, SelectionTag[]>();
  for (const entry of saved) {
    const index = resolveBlockAnchor(entry, anchors);
    if (index === null) { unresolved.push(entry); continue; }
    let tags = byIndex.get(index) ?? [];
    for (const tag of entry.tags) tags = mergeTag(tags, tag);
    byIndex.set(index, tags);
  }
  const tr = editor.state.tr.setMeta("addToHistory", false);
  for (const { node, pos, anchor } of blocks) {
    const tags = byIndex.get(anchor.index) ?? [];
    if (JSON.stringify(node.attrs.selectionTags) !== JSON.stringify(tags)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, selectionTags: tags });
    }
  }
  if (tr.docChanged) editor.view.dispatch(tr);
  return unresolved;
}

export function assignEditorTag(editor: Editor, selected: BlockAnchor[], tag: SelectionTag) {
  const blocks = documentBlocks(editor.state.doc);
  const anchors = blocks.map((block) => block.anchor);
  const indices = selected.map((anchor) => resolveBlockAnchor(anchor, anchors));
  if (indices.some((index) => index === null)) throw new Error("The selected text changed. Select it again before assigning a tag.");
  const tr = closeHistory(editor.state.tr);
  for (const index of new Set(indices)) {
    const { node, pos } = blocks[index!];
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, selectionTags: mergeTag(node.attrs.selectionTags, tag) });
  }
  editor.view.dispatch(tr);
  // Keep the next keystroke separate from the tag assignment in Undo.
  editor.view.dispatch(closeHistory(editor.state.tr));
}
