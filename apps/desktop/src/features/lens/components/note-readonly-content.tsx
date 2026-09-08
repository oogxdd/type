import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { markdownToHtml } from "@/features/notes/editor/lib/markdown-editor";
import { TaggedBlocks, restoreTaggedBlocks } from "@/features/selection-tags/lib/tagged-blocks";
import { registerTagSurface } from "@/features/selection-tags/lib/selection-surfaces";
import { readSelectionTags } from "@typenotes/shared/selection-tags";

type NoteReadonlyContentProps = {
  markdown: string;
  rawMarkdown?: string;
  notePath?: string;
};

export function NoteReadonlyContent({ markdown, rawMarkdown, notePath }: NoteReadonlyContentProps) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaggedBlocks,
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
    restoreTaggedBlocks(editor, readSelectionTags(rawMarkdown ?? markdown));
  }, [editor, markdown, rawMarkdown]);

  useEffect(() => {
    if (!editor || !notePath) return;
    return registerTagSurface({ editor, path: notePath, editable: false });
  }, [editor, notePath]);

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
