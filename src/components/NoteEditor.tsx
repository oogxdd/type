import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import TurndownService from "turndown";

type NoteEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

const markdownToHtml = (markdown: string) => {
  const parsed = marked.parse(markdown || "", { breaks: true, gfm: true });
  return typeof parsed === "string" ? parsed : "";
};

const htmlToMarkdown = (html: string) => turndown.turndown(html).trimEnd();

const toolbarButton =
  "rounded-md border border-transparent px-2 py-1 text-xs font-medium text-[var(--ui-muted)] transition-colors hover:border-[var(--ui-border)] hover:bg-[var(--ui-select)] hover:text-[var(--ui-text)]";

export function NoteEditor({ markdown, onChange }: NoteEditorProps) {
  const isSyncing = useRef(false);
  const latestMarkdown = useRef(markdown);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: "What's on your mind",
      }),
    ],
    []
  );

  const editor = useEditor({
    extensions,
    autofocus: false,
    content: markdownToHtml(markdown),
    editorProps: {
      attributes: {
        class: "tiptap-content",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (isSyncing.current) {
        return;
      }
      const nextMarkdown = htmlToMarkdown(currentEditor.getHTML());
      latestMarkdown.current = nextMarkdown;
      onChange(nextMarkdown);
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (markdown === latestMarkdown.current) {
      return;
    }
    const currentMarkdown = htmlToMarkdown(editor.getHTML());
    if (currentMarkdown === markdown) {
      latestMarkdown.current = markdown;
      return;
    }
    isSyncing.current = true;
    editor.commands.setContent(markdownToHtml(markdown), { emitUpdate: false });
    isSyncing.current = false;
    latestMarkdown.current = markdown;
  }, [editor, markdown]);

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--ui-muted)]">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="tiptap-editor">
      <div className="tiptap-toolbar">
        <button
          type="button"
          className={`${toolbarButton}${editor.isActive("bold") ? " is-active" : ""}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          className={`${toolbarButton}${editor.isActive("italic") ? " is-active" : ""}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          className={`${toolbarButton}${editor.isActive("heading", { level: 1 }) ? " is-active" : ""}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </button>
        <button
          type="button"
          className={`${toolbarButton}${editor.isActive("heading", { level: 2 }) ? " is-active" : ""}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <button
          type="button"
          className={`${toolbarButton}${editor.isActive("bulletList") ? " is-active" : ""}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          List
        </button>
        <button
          type="button"
          className={`${toolbarButton}${editor.isActive("blockquote") ? " is-active" : ""}`}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </button>
        <button
          type="button"
          className={toolbarButton}
          onClick={() => editor.chain().focus().undo().run()}
        >
          Undo
        </button>
        <button
          type="button"
          className={toolbarButton}
          onClick={() => editor.chain().focus().redo().run()}
        >
          Redo
        </button>
      </div>
      <EditorContent editor={editor} className="tiptap-scroll" />
    </div>
  );
}
