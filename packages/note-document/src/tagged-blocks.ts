import { Node, Mark } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { ResolvedPos } from "@tiptap/pm/model";
import { liftTarget } from "@tiptap/pm/transform";
import { emptyTagAttrs, parseTagAttrs, formatTagAttrs, mergeTagAttrs } from "@typenotes/shared/tags";

const attributes = () => ({
  tags: { default: [], rendered: false },
  flags: { default: {}, rendered: false },
  unterminated: { default: false, rendered: false },
});
const read = (element: HTMLElement) => ({
  ...(parseTagAttrs(element.getAttribute("data-tag-attrs") ?? "") ?? emptyTagAttrs()),
  unterminated: element.hasAttribute("data-tag-unterminated"),
});
const render = (attrs: ReturnType<typeof read>) => ({
  "data-tag-attrs": formatTagAttrs(attrs),
  "data-tag-names": formatTagAttrs(attrs),
  title: formatTagAttrs(attrs),
  ...(attrs.unterminated ? { "data-tag-unterminated": "true" } : {}),
});

// Find the nearest container whose first/last descendant owns this caret.
const edgeContainer = ($pos: ResolvedPos, end: boolean) => {
  for (let depth = $pos.depth - 1; depth > 0; depth--) {
    if ($pos.index(depth) !== (end ? $pos.node(depth).childCount - 1 : 0)) return null;
    if ($pos.node(depth).type.name === "tagBlock") return depth;
  }
  return null;
};

export const TagBlock = Node.create({
  name: "tagBlock", group: "block", content: "block+", defining: true,
  addAttributes: attributes,
  parseHTML: () => [{ tag: "div[data-tag-attrs]", getAttrs: read }],
  renderHTML: ({ node }) => ["div", render(node.attrs as ReturnType<typeof read>), 0],
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || !$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size) return false;
        const depth = edgeContainer($from, true);
        if (depth === null) return false;
        const pos = $from.after(depth);
        const next = state.doc.nodeAt(pos);
        const tr = next?.type.name === "paragraph" && !next.content.size ? state.tr : state.tr.insert(pos, state.schema.nodes.paragraph.create());
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
        return true;
      },
      Backspace: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        const depth = edgeContainer($from, false);
        if (!empty || $from.parentOffset !== 0 || depth === null) return false;
        const range = state.doc.resolve($from.start(depth)).blockRange(state.doc.resolve($from.end(depth)));
        const target = range && liftTarget(range);
        if (!range || target == null) return false;
        view.dispatch(state.tr.lift(range, target).scrollIntoView());
        return true;
      },
    };
  },
});
export const TagSpan = Mark.create({
  name: "tagSpan", inclusive: false,
  addAttributes: attributes,
  parseHTML: () => [{ tag: "span[data-tag-attrs]", getAttrs: (element) => {
    let attrs = read(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches("span[data-tag-attrs]")) attrs = { ...attrs, ...mergeTagAttrs(read(parent), attrs) };
    }
    return attrs;
  } }],
  renderHTML: ({ mark }) => ["span", render(mark.attrs as ReturnType<typeof read>), 0],
});
