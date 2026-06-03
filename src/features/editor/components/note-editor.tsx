import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { joinFrontmatter, splitFrontmatter } from "@/shared/lib/frontmatter";
import {
  appendRawLensBackmatterBlock,
  splitLensBackmatterBlock,
} from "../lib/lens-backmatter";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown-editor";
import { stripInlineAnnotationMetadata } from "../lib/note-annotations";

type NoteEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
};

const toolbarButton =
  "rounded-md border border-transparent px-2 py-1 text-xs font-medium text-[var(--ui-muted)] transition-colors hover:border-[var(--ui-border)] hover:bg-[var(--ui-select)] hover:text-[var(--ui-text)]";

const splitEditorMarkdown = (markdown: string) => {
  const split = splitFrontmatter(markdown);
  const lensSplit = splitLensBackmatterBlock(split.body);
  return {
    frontmatterBlock: split.frontmatterBlock,
    backmatterBlock: lensSplit.rawBlock,
    body: stripInlineAnnotationMetadata(lensSplit.content),
  };
};

export function NoteEditor({ markdown, onChange }: NoteEditorProps) {
  const isSyncing = useRef(false);
  const latestMarkdown = useRef(markdown);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialContentRef = useRef(splitEditorMarkdown(markdown));
  const frontmatterRef = useRef<string | null>(initialContentRef.current.frontmatterBlock);
  const backmatterRef = useRef<string | null>(initialContentRef.current.backmatterBlock);

  const keepCaretBreathingRoom = (currentEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }
    const position = currentEditor.state.selection.$anchor.pos;
    let coords: { top: number; bottom: number };
    try {
      coords = currentEditor.view.coordsAtPos(position);
    } catch {
      return;
    }
    const rect = scrollEl.getBoundingClientRect();
    const bottomLimit = rect.bottom - rect.height * 0.2;
    if (coords.bottom <= bottomLimit) {
      return;
    }
    const delta = coords.bottom - bottomLimit;
    const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    scrollEl.scrollTop = Math.min(maxScrollTop, scrollEl.scrollTop + delta);
  };

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: "What's on your mind?",
      }),
    ],
    []
  );

  const editor = useEditor({
    extensions,
    autofocus: false,
    enableInputRules: false,
    content: markdownToHtml(initialContentRef.current.body),
    editorProps: {
      attributes: {
        class: "tiptap-content",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (isSyncing.current) {
        return;
      }
      const nextBodyMarkdown = htmlToMarkdown(currentEditor.getHTML());
      const frontmatterJoined = joinFrontmatter(frontmatterRef.current, nextBodyMarkdown);
      const nextMarkdown = appendRawLensBackmatterBlock(
        frontmatterJoined,
        backmatterRef.current
      );
      latestMarkdown.current = nextMarkdown;
      onChange(nextMarkdown);
      requestAnimationFrame(() => keepCaretBreathingRoom(currentEditor));
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (markdown === latestMarkdown.current) {
      return;
    }
    const incoming = splitEditorMarkdown(markdown);
    frontmatterRef.current = incoming.frontmatterBlock;
    backmatterRef.current = incoming.backmatterBlock;
    const currentBodyMarkdown = htmlToMarkdown(editor.getHTML());
    if (currentBodyMarkdown === incoming.body) {
      latestMarkdown.current = markdown;
      return;
    }
    isSyncing.current = true;
    editor.commands.setContent(markdownToHtml(incoming.body), { emitUpdate: false });
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
      <div
        className="tiptap-scroll"
        ref={(node) => {
          scrollRef.current = node;
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
