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
          // Hard stops, so several tags on one block read as equal bands of
          // colour rather than a blend nobody can name. The stylesheet paints
          // these behind the text and inside the badge; it never sets a colour
          // of its own, so a tag always looks the same wherever it is rendered.
          const band = (alpha: string) =>
            `linear-gradient(90deg, ${colors
              .map((color, index) => `${color}${alpha} ${(index * 100) / colors.length}%, ${color}${alpha} ${((index + 1) * 100) / colors.length}%`)
              .join(", ")})`;
          const names = tags.map((tag) => tag.name);
          return {
            "data-selection-tagged": "true",
            "data-selection-tag-names": names.join(" · "),
            title: names.join(" · "),
            style: [
              `--selection-tag-color: ${colors[colors.length - 1]}`,
              // The fill is the block's wash; the line is the same colours at
              // the 60% the rules have always used. The badge reuses both.
              `--selection-tag-fill: ${band("1a")}`,
              `--selection-tag-line: ${band("99")}`,
            ].join("; "),
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

