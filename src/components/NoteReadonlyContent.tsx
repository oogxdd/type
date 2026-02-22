import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { markdownToHtml } from "../utils/markdownEditor";

type NoteReadonlyContentProps = {
  markdown: string;
};

export function NoteReadonlyContent({ markdown }: NoteReadonlyContentProps) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
    ],
    []
  );

  const editor = useEditor({
    extensions,
    editable: false,
    autofocus: false,
    content: markdownToHtml(markdown),
    editorProps: {
      attributes: {
        class: "tiptap-content tiptap-content-readonly",
      },
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.commands.setContent(markdownToHtml(markdown), { emitUpdate: false });
  }, [editor, markdown]);

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--ui-muted)]">
        Loading note...
      </div>
    );
  }

  return (
    <div className="tiptap-readonly-shell">
      <EditorContent editor={editor} />
    </div>
  );
}
