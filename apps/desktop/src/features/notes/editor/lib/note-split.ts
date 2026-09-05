// Splitting a note at the caret: everything from the top-level block the
// cursor sits in, to the end of the document, becomes the new note.
import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { htmlToMarkdown } from "./markdown-editor";

export type NoteSplit = {
  /** Document range that moves out of the current note. */
  from: number;
  to: number;
  markdown: string;
};

/**
 * The document range starting at the block boundary above the caret. Null when
 * the caret sits in the first block (splitting there would empty the original
 * note) or when there is nothing after it.
 */
const resolveSplitRange = (editor: Editor) => {
  const { doc, selection } = editor.state;
  const $from = doc.resolve(Math.min(selection.from, doc.content.size));
  const from = $from.depth === 0 ? $from.pos : $from.before(1);
  const to = doc.content.size;
  if (from <= 0 || from >= to) {
    return null;
  }
  return { from, to };
};

export const canSplitNoteAtCursor = (editor: Editor) =>
  resolveSplitRange(editor) !== null;

export const getNoteSplitAtCursor = (editor: Editor): NoteSplit | null => {
  const range = resolveSplitRange(editor);
  if (!range) {
    return null;
  }
  const { doc } = editor.state;
  const serializer = DOMSerializer.fromSchema(doc.type.schema);
  const container = document.createElement("div");
  container.appendChild(serializer.serializeFragment(doc.slice(range.from, range.to).content));
  const markdown = htmlToMarkdown(container.innerHTML).trim();
  if (!markdown) {
    return null;
  }
  return { ...range, markdown };
};
