// The note editor is mounted deep inside the right pane, but a few workflows
// (splitting a note at the caret) need the live ProseMirror selection from
// outside it. Passing an editor instance through the provider tree would make
// every context consumer re-render on editor churn, so the editor registers
// itself here instead.
import type { Editor } from "@tiptap/react";

let activeEditor: Editor | null = null;

export const setActiveNoteEditor = (editor: Editor | null) => {
  activeEditor = editor;
};

export const getActiveNoteEditor = () => activeEditor;
