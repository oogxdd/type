import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DEFAULT_TAG_COLOR, formatTagAttrs, tagKey, validTagColor } from "@typenotes/shared/tags";
export const tagColorsKey = new PluginKey<Map<string, string>>("tagColors");
const styles = (names: string[], colors: Map<string, string>) => {
  const values = names.length ? names.map(name => colors.get(tagKey(name)) ?? DEFAULT_TAG_COLOR) : [DEFAULT_TAG_COLOR];
  const band = (alpha: string) => `linear-gradient(90deg, ${values.map((color, i) => `${color}${alpha} ${i * 100 / values.length}%, ${color}${alpha} ${(i + 1) * 100 / values.length}%`).join(", ")})`;
  return `--selection-tag-color: ${values[values.length - 1]}; --selection-tag-fill: ${band("1a")}; --selection-tag-line: ${band("99")}`;
};
export const TagColors = Extension.create({
  name: "tagColors",
  addProseMirrorPlugins() { return [new Plugin({
    key: tagColorsKey,
    state: {
      init: () => new Map<string, string>(),
      apply(tr, colors) {
        const update = tr.getMeta(tagColorsKey) as Map<string, string> | undefined;
        return update ? new Map([...update].filter(([, color]) => validTagColor(color))) : colors;
      },
    },
    props: { decorations(state) {
      const colors = tagColorsKey.getState(state) ?? new Map();
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === "tagBlock") decorations.push(Decoration.node(pos, pos + node.nodeSize, { style: styles(node.attrs.tags, colors) }));
        if (node.isInline) for (const mark of node.marks) if (mark.type.name === "tagSpan") decorations.push(Decoration.inline(pos, pos + node.nodeSize, { style: styles(mark.attrs.tags, colors), "data-tag-inline": formatTagAttrs(mark.attrs as import("@typenotes/shared/tags").TagAttrs) }));
      });
      return DecorationSet.create(state.doc, decorations);
    } },
  })]; },
});
