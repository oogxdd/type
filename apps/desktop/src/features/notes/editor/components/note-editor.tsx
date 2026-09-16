import { TagColors } from "@/features/tags/lib/tag-colors";
import { useTagColors } from "@/features/tags/hooks/use-tag-colors";
import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createPortal } from "react-dom";
import type { VimMode } from "../lib/vim/keys";
import { EditorToolbar } from "./editor-toolbar";
import type { EditorSurface, EditorSurfaceHandle } from "../lib/editor-surface";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { joinFrontmatter, splitFrontmatter } from "@typenotes/shared/frontmatter";
import { stripInlineAnnotationMetadata } from "@typenotes/shared/annotation-metadata";
import {
  appendRawLensBackmatterBlock,
  splitLensBackmatterBlock,
} from "@typenotes/shared/lens-backmatter";
import { consumeNoteEditorFocusRequest, NOTE_EDITOR_FOCUS_EVENT, consumeNoteEditorInsertRequest, NOTE_EDITOR_ENTER_INSERT_EVENT } from "../lib/editor-events";
import { getActiveNoteEditor, setActiveNoteEditor } from "../lib/editor-bridge";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown-editor";
import { useVim } from "../hooks/use-vim";
import { useAppearance } from "@/app/state/appearance-store";
import { TagBlock, TagSpan } from "@/features/selection-tags/lib/tagged-blocks";
import { registerTagSurface } from "@/features/selection-tags/lib/selection-surfaces";

type NoteEditorProps = {
  documentKey: string | null;
  markdown: string;
  onChange: (markdown: string) => void;
  surface?: EditorSurface;
};

const splitEditorMarkdown = (markdown: string) => {
  const split = splitFrontmatter(markdown);
  const lensSplit = splitLensBackmatterBlock(split.body);
  return {
    frontmatterBlock: split.frontmatterBlock,
    backmatterBlock: lensSplit.rawBlock,
    body: stripInlineAnnotationMetadata(lensSplit.content),
  };
};

export function NoteEditor({ documentKey, markdown, onChange, surface }: NoteEditorProps) {
  const showVimModeIndicator = useAppearance(
    (state) => state.showVimModeIndicator
  );
  const ownScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = surface?.scrollRef ?? ownScrollRef;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const handleRef = useRef<EditorSurfaceHandle | null>(null);
  const focusModeRef = useRef<VimMode | null>(null);
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
  } = useVim({ scrollRef, onDocumentStart: () => surfaceRef.current?.focusStart(true) ?? false, onVerticalMove: (direction, count, mode) => {
    const handle = handleRef.current;
    return !!(handle && surfaceRef.current?.moveVertical(handle, direction, count, mode));
  } });

  const lastDocumentKeyRef = useRef<string | null>(null);
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
        trailingNode: { notAfter: ["tagBlock"] },
      }),
      Placeholder.configure({
        placeholder: "What's on your mind?",
      }),
      TagBlock, TagSpan, TagColors,
    ],
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
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
      setVimMode(focusModeRef.current ?? "normal");
      focusModeRef.current = null;
      setActiveNoteEditor(currentEditor, documentKey);
      if (handleRef.current) surfaceRef.current?.activate(handleRef.current);
      requestAnimationFrame(() => { if (!currentEditor.isDestroyed) updateCursor(currentEditor.view); });
    },
    onBlur: () => clearCursor(),
    onSelectionUpdate: ({ editor: currentEditor }) => {
      noteSelectionChanged();
      if (handleRef.current) surfaceRef.current?.revealStart(handleRef.current);
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
      frontmatterRef.current = splitFrontmatter(nextMarkdown).frontmatterBlock;
      latestMarkdown.current = nextMarkdown;
      onChange(nextMarkdown);
      requestAnimationFrame(() => keepCaretBreathingRoom(currentEditor));
    },
  });

  useTagColors(editor);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !documentKey) return;
    return registerTagSurface({ editor, path: documentKey, editable: true });
  }, [documentKey, editor]);

  useEffect(() => {
    attachEditor(editor ?? null);
    if (!surfaceRef.current) setActiveNoteEditor(editor ?? null, documentKey);
    return () => {
      attachEditor(null);
      if (getActiveNoteEditor() === editor) setActiveNoteEditor(null);
    };
  }, [attachEditor, editor, documentKey]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !documentKey || !surface) return;
    const handle: EditorSurfaceHandle = {
      editor, path: documentKey,
      focus: (position, mode) => {
        if (!editor.view.hasFocus()) focusModeRef.current = mode;
        editor.view.focus();
        setVimMode(mode);
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)).scrollIntoView());
        setActiveNoteEditor(editor, documentKey);
        surfaceRef.current?.activate(handle);
        requestAnimationFrame(() => { if (!editor.isDestroyed) updateCursor(editor.view); });
      },
    };
    handleRef.current = handle;
    const unregister = surface.register(handle);
    return () => { handleRef.current = null; unregister(); };
  }, [editor, documentKey, surface, setVimMode, updateCursor]);

  useEffect(() => {
    if (handleRef.current) surfaceRef.current?.status(handleRef.current, modeLabel, pendingLabel);
  }, [modeLabel, pendingLabel]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
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
    const handleInsertRequest = () => {
      if (!editor || editor.isDestroyed || !documentKey) return;
      const request = consumeNoteEditorInsertRequest(documentKey);
      if (!request) return;
      focusModeRef.current = "insert";
      editor.view.focus();
      const selection = request === "end" ? TextSelection.atEnd(editor.state.doc) : TextSelection.atStart(editor.state.doc);
      editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
      setVimMode("insert");
    };
    window.addEventListener(NOTE_EDITOR_ENTER_INSERT_EVENT, handleInsertRequest);
    return () => window.removeEventListener(NOTE_EDITOR_ENTER_INSERT_EVENT, handleInsertRequest);
  }, [editor, documentKey, setVimMode]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !documentKey || documentKey === lastDocumentKeyRef.current) {
      return;
    }
    lastDocumentKeyRef.current = documentKey;
    const insertRequest = consumeNoteEditorInsertRequest(documentKey);
    const shouldEnterInsertMode = Boolean(insertRequest);

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
    const transaction = editor.state.tr.setSelection(TextSelection.atStart(editor.state.doc));
    editor.view.dispatch(surfaceRef.current && !shouldEnterInsertMode ? transaction : transaction.scrollIntoView());
    if (scrollRef.current && !surfaceRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      if (shouldEnterInsertMode) {
        focusModeRef.current = "insert";
        editor.view.focus();
        const selection = insertRequest === "end" ? TextSelection.atEnd(editor.state.doc) : TextSelection.atStart(editor.state.doc);
        editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
        setVimMode("insert");
      } else {
        updateCursor(editor.view);
      }
    });
  }, [documentKey, editor, resetForDocument, updateCursor, vimModeRef]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !documentKey) return;
    let frame = 0;
    const focusRequested = () => {
      cancelAnimationFrame(frame);
      // Run after the list click / context-menu focus restoration has finished.
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed || !consumeNoteEditorFocusRequest(documentKey)) return;
        if (surfaceRef.current?.focusStart()) return;
        focusModeRef.current = "normal";
        editor.view.focus();
        resetForDocument("normal");
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atStart(editor.state.doc)).scrollIntoView());
        setActiveNoteEditor(editor, documentKey);
        if (handleRef.current) surfaceRef.current?.activate(handleRef.current);
        updateCursor(editor.view);
      });
    };
    window.addEventListener(NOTE_EDITOR_FOCUS_EVENT, focusRequested);
    focusRequested();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(NOTE_EDITOR_FOCUS_EVENT, focusRequested);
    };
  }, [documentKey, editor, resetForDocument, updateCursor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollRef.current) {
      return;
    }
    const observer = new ResizeObserver(() => updateCursor(editor.view));
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [editor, updateCursor]);

  if (!editor || editor.isDestroyed) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--ui-muted)]">
        Loading editor...
      </div>
    );
  }

  return (
    <div className={`tiptap-editor${surface ? " tiptap-editor-embedded" : ""}`} data-note-editor={documentKey ?? undefined} data-vim-mode={vimMode}>
      {!surface ? <EditorToolbar editor={editor} /> : null}
      <div
        className={surface ? "tiptap-embedded-body" : "tiptap-scroll"}
        ref={(node) => {
          if (!surface) ownScrollRef.current = node;
        }}
        onMouseDownCapture={() => {
          if (!editor.view.hasFocus()) focusModeRef.current = "insert";
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!editor.view.hasFocus()) {
            focusModeRef.current = "insert";
            editor.view.focus();
          }
          setVimMode("insert");
        }}
      >
        <EditorContent editor={editor} />
        {vimMode !== "insert" && cursorRect ? (
          surface && scrollRef.current ? createPortal(
            <span className="vim-block-cursor" aria-hidden="true" style={cursorRect} />, scrollRef.current
          ) : <span className="vim-block-cursor" aria-hidden="true" style={cursorRect} />
        ) : null}
      </div>
      {!surface && showVimModeIndicator ? (
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
