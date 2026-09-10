import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { blockAnchors, validTag, type SelectionTag } from "@typenotes/shared/selection-tags";

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

