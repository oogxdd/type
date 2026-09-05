import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { joinFrontmatter, splitFrontmatter } from "@typenotes/shared/frontmatter";
import { stripInlineAnnotationMetadata } from "@typenotes/shared/annotation-metadata";
import {
  appendRawLensBackmatterBlock,
  splitLensBackmatterBlock,
} from "@typenotes/shared/lens-backmatter";
import { NOTE_EDITOR_ENTER_INSERT_EVENT } from "../lib/editor-events";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown-editor";
import { useVim } from "../hooks/use-vim";
import { useAppearance } from "@/app/state/appearance-store";

type NoteEditorProps = {
  documentKey: string | null;
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

export function NoteEditor({ documentKey, markdown, onChange }: NoteEditorProps) {
  const showVimModeIndicator = useAppearance(
    (state) => state.showVimModeIndicator
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const {
    mode: vimMode,
    modeRef: vimModeRef,
    modeLabel,
    pendingLabel,
    cursorRect,
    attachEditor,
    handleKeyDown,
    updateCursor,
    clearCursor,
    noteSelectionChanged,
    resetForDocument,
    setVimMode,
  } = useVim({ scrollRef });

  const lastDocumentKeyRef = useRef<string | null>(null);
  const pendingInsertDocumentKeyRef = useRef<string | null>(null);
  const isSyncing = useRef(false);
  const latestMarkdown = useRef(markdown);
  const initialContentRef = useRef(splitEditorMarkdown(markdown));
  const frontmatterRef = useRef<string | null>(
    initialContentRef.current.frontmatterBlock
  );
  const backmatterRef = useRef<string | null>(
    initialContentRef.current.backmatterBlock
  );

  const keepCaretBreathingRoom = (
    currentEditor: NonNullable<ReturnType<typeof useEditor>>
  ) => {
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
        "aria-label": "Note editor",
      },
      handleKeyDown: handleKeyDown,
      handleTextInput: () => vimModeRef.current !== "insert",
      handlePaste: () => vimModeRef.current !== "insert",
    },
    onFocus: ({ editor: currentEditor }) => {
      setVimMode("normal");
      requestAnimationFrame(() => updateCursor(currentEditor.view));
    },
    onBlur: () => clearCursor(),
    onSelectionUpdate: ({ editor: currentEditor }) => {
      noteSelectionChanged();
      updateCursor(currentEditor.view);
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (isSyncing.current) {
        return;
      }
      const nextBodyMarkdown = htmlToMarkdown(currentEditor.getHTML());
      const frontmatterJoined = joinFrontmatter(
        frontmatterRef.current,
        nextBodyMarkdown
      );
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
    attachEditor(editor ?? null);
    return () => attachEditor(null);
  }, [attachEditor, editor]);

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
    editor.commands.setContent(markdownToHtml(incoming.body), {
      emitUpdate: false,
    });
    isSyncing.current = false;
    latestMarkdown.current = markdown;
  }, [editor, markdown]);

  useEffect(() => {
    const handleInsertRequest = (event: Event) => {
      const notePath = (event as CustomEvent<string>).detail;
      if (notePath) {
        pendingInsertDocumentKeyRef.current = notePath;
      }
    };
    window.addEventListener(NOTE_EDITOR_ENTER_INSERT_EVENT, handleInsertRequest);
    return () =>
      window.removeEventListener(
        NOTE_EDITOR_ENTER_INSERT_EVENT,
        handleInsertRequest
      );
  }, []);

  useEffect(() => {
    if (!editor || !documentKey || documentKey === lastDocumentKeyRef.current) {
      return;
    }
    lastDocumentKeyRef.current = documentKey;
    const shouldEnterInsertMode =
      pendingInsertDocumentKeyRef.current === documentKey;
    if (shouldEnterInsertMode) {
      pendingInsertDocumentKeyRef.current = null;
    }

    // Promoting a focused draft to a persisted note is not navigation: keep
    // the insertion point so background note creation never interrupts typing.
    if (
      !shouldEnterInsertMode &&
      editor.view.hasFocus() &&
      vimModeRef.current === "insert"
    ) {
      return;
    }

    resetForDocument(shouldEnterInsertMode ? "insert" : "normal");
    editor.view.dispatch(
      editor.view.state.tr
        .setSelection(TextSelection.atStart(editor.view.state.doc))
        .scrollIntoView()
    );
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
    requestAnimationFrame(() => {
      if (shouldEnterInsertMode) {
        editor.commands.focus("start");
      } else {
        updateCursor(editor.view);
      }
    });
  }, [documentKey, editor, resetForDocument, updateCursor, vimModeRef]);

  useEffect(() => {
    if (!editor || !scrollRef.current) {
      return;
    }
    const observer = new ResizeObserver(() => updateCursor(editor.view));
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [editor, updateCursor]);

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--ui-muted)]">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="tiptap-editor" data-vim-mode={vimMode}>
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
        onClick={() => {
          editor.commands.focus();
          setVimMode("insert");
        }}
      >
        <EditorContent editor={editor} />
        {vimMode !== "insert" && cursorRect ? (
          <span
            className="vim-block-cursor"
            aria-hidden="true"
            style={cursorRect}
          />
        ) : null}
      </div>
      {showVimModeIndicator ? (
        <div className="vim-mode-indicator" aria-live="polite">
          {modeLabel}
          {pendingLabel ? (
            <span className="vim-pending-keys">{pendingLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
