import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { joinFrontmatter, splitFrontmatter } from "@typenotes/shared/frontmatter";
import { stripInlineAnnotationMetadata } from "@typenotes/shared/annotation-metadata";
import {
  appendRawLensBackmatterBlock,
  splitLensBackmatterBlock,
} from "@typenotes/shared/lens-backmatter";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown-editor";

type NoteEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
};

type VimMode = "normal" | "insert" | "visual";

const VIM_JUMP_LINES = 10;

const clampDocumentPosition = (view: EditorView, position: number) =>
  Math.max(1, Math.min(view.state.doc.content.size, position));

const getVerticalPosition = (
  view: EditorView,
  position: number,
  direction: -1 | 1,
  lineCount: number
) => {
  try {
    const coords = view.coordsAtPos(position);
    const measuredLineHeight = coords.bottom - coords.top;
    const computedLineHeight = Number.parseFloat(
      window.getComputedStyle(view.dom).lineHeight
    );
    const lineHeight =
      measuredLineHeight > 0
        ? measuredLineHeight
        : Number.isFinite(computedLineHeight)
          ? computedLineHeight
          : 24;
    const target = view.posAtCoords({
      left: coords.left,
      top: (coords.top + coords.bottom) / 2 + direction * lineHeight * lineCount,
    });
    if (target) {
      return clampDocumentPosition(view, target.pos);
    }
  } catch {
    // Geometry can be unavailable during a document/layout transition.
  }
  return direction < 0 ? 1 : view.state.doc.content.size;
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
  const [vimMode, setVimModeState] = useState<VimMode>("normal");
  const vimModeRef = useRef<VimMode>("normal");
  const visualAnchorRef = useRef<number | null>(null);
  const isSyncing = useRef(false);
  const latestMarkdown = useRef(markdown);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialContentRef = useRef(splitEditorMarkdown(markdown));
  const frontmatterRef = useRef<string | null>(initialContentRef.current.frontmatterBlock);
  const backmatterRef = useRef<string | null>(initialContentRef.current.backmatterBlock);

  const setVimMode = useCallback((mode: VimMode) => {
    vimModeRef.current = mode;
    visualAnchorRef.current = null;
    setVimModeState(mode);
  }, []);

  const moveVimSelection = useCallback(
    (view: EditorView, targetPosition: number) => {
      const target = clampDocumentPosition(view, targetPosition);
      const normalizedHead = TextSelection.near(
        view.state.doc.resolve(target)
      ).head;
      const selection =
        vimModeRef.current === "visual"
          ? TextSelection.create(
              view.state.doc,
              visualAnchorRef.current ?? view.state.selection.anchor,
              normalizedHead
            )
          : TextSelection.near(view.state.doc.resolve(normalizedHead));
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    },
    []
  );

  const handleVimKeyDown = useCallback(
    (view: EditorView, event: KeyboardEvent) => {
      const mode = vimModeRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const head = view.state.selection.head;
        setVimMode("normal");
        moveVimSelection(view, head);
        return true;
      }
      if (mode === "insert") {
        return false;
      }
      if (event.metaKey || event.altKey) {
        return false;
      }

      const key = event.key.toLowerCase();
      const direction = key === "j" ? 1 : key === "k" ? -1 : null;
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        const lineCount = event.ctrlKey ? VIM_JUMP_LINES : 1;
        moveVimSelection(
          view,
          getVerticalPosition(view, view.state.selection.head, direction, lineCount)
        );
        return true;
      }
      if (event.ctrlKey) {
        return false;
      }
      if (key === "h" || key === "l") {
        event.preventDefault();
        event.stopPropagation();
        moveVimSelection(
          view,
          view.state.selection.head + (key === "h" ? -1 : 1)
        );
        return true;
      }
      if (key === "v") {
        event.preventDefault();
        event.stopPropagation();
        if (mode === "visual") {
          const head = view.state.selection.head;
          setVimMode("normal");
          moveVimSelection(view, head);
        } else {
          visualAnchorRef.current = view.state.selection.head;
          vimModeRef.current = "visual";
          setVimModeState("visual");
        }
        return true;
      }
      if (key === "i" || key === "a") {
        event.preventDefault();
        event.stopPropagation();
        if (key === "a") {
          moveVimSelection(view, view.state.selection.head + 1);
        }
        setVimMode("insert");
        return true;
      }

      // Normal/Visual modes are navigation-only. Block printable text and
      // destructive editing until the user explicitly enters Insert mode.
      if (
        event.key.length === 1 ||
        event.key === "Enter" ||
        event.key === "Backspace" ||
        event.key === "Delete"
      ) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      return false;
    },
    [moveVimSelection, setVimMode]
  );

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
        "aria-label": "Note editor",
      },
      handleKeyDown: handleVimKeyDown,
      handleTextInput: () => vimModeRef.current !== "insert",
      handlePaste: () => vimModeRef.current !== "insert",
    },
    onFocus: () => setVimMode("normal"),
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
      >
        <EditorContent editor={editor} />
      </div>
      <div className="vim-mode-indicator" aria-live="polite">
        {vimMode.toUpperCase()}
      </div>
    </div>
  );
}
