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
import { useAppearance } from "@/app/state/appearance-store";

type NoteEditorProps = {
  documentKey: string | null;
  markdown: string;
  onChange: (markdown: string) => void;
};

type VimMode = "normal" | "insert" | "visual";

type VimCursorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const VIM_JUMP_LINES = 10;

const clampDocumentPosition = (view: EditorView, position: number) =>
  Math.max(1, Math.min(view.state.doc.content.size, position));

const getEmptyParagraphVerticalPosition = (
  view: EditorView,
  position: number,
  direction: -1 | 1
) => {
  try {
    const resolved = view.state.doc.resolve(position);
    if (!view.endOfTextblock(direction > 0 ? "down" : "up")) {
      return null;
    }
    const boundary = direction > 0 ? resolved.after() : resolved.before();
    const adjacent = TextSelection.near(
      view.state.doc.resolve(boundary),
      direction
    );

    // Coordinate-based movement can skip an empty paragraph because it has no
    // glyph to hit-test. Use the document structure when either side of the
    // move is empty, while retaining visual-line movement for normal/wrapped
    // text.
    if (
      resolved.parent.content.size === 0 ||
      adjacent.$head.parent.content.size === 0
    ) {
      return adjacent.head;
    }
  } catch {
    // Fall through to geometry-based movement at unusual nested boundaries.
  }
  return null;
};

const getVerticalPosition = (
  view: EditorView,
  position: number,
  direction: -1 | 1,
  lineCount: number,
  goalLeft: number
) => {
  try {
    // side=1 is important at the first character of a line/block. Without it,
    // ProseMirror may measure the same document position as the end of the
    // previous line, which makes `k` jump to that line's final character.
    const coords = view.coordsAtPos(position, 1);
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
    const startCenter = (coords.top + coords.bottom) / 2;
    const scanStep = Math.max(3, lineHeight / 4);
    const maxDistance = lineHeight * (lineCount * 4 + 4);
    let lastLineCenter = startCenter;
    let linesMoved = 0;
    let lastPosition: number | null = null;

    // Scan through layout space instead of assuming adjacent text blocks have
    // no margin. This avoids resolving a point in the gap between paragraphs
    // to the end of the previous line.
    for (let distance = scanStep; distance <= maxDistance; distance += scanStep) {
      const target = view.posAtCoords({
        left: goalLeft,
        top: startCenter + direction * distance,
      });
      if (!target) {
        continue;
      }
      const targetCoords = view.coordsAtPos(target.pos, 1);
      const targetCenter = (targetCoords.top + targetCoords.bottom) / 2;
      const crossedLine =
        direction * (targetCenter - lastLineCenter) > Math.max(3, lineHeight * 0.35);
      if (!crossedLine) {
        continue;
      }
      linesMoved += 1;
      lastLineCenter = targetCenter;
      lastPosition = clampDocumentPosition(view, target.pos);
      if (linesMoved >= lineCount) {
        return lastPosition;
      }
    }
    if (lastPosition !== null) {
      return lastPosition;
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

export function NoteEditor({ documentKey, markdown, onChange }: NoteEditorProps) {
  const showVimModeIndicator = useAppearance(
    (state) => state.showVimModeIndicator
  );
  const [vimMode, setVimModeState] = useState<VimMode>("normal");
  const [vimCursorRect, setVimCursorRect] = useState<VimCursorRect | null>(null);
  const vimModeRef = useRef<VimMode>("normal");
  const visualAnchorRef = useRef<number | null>(null);
  const verticalGoalLeftRef = useRef<number | null>(null);
  const isVerticalMotionRef = useRef(false);
  const lastDocumentKeyRef = useRef<string | null>(null);
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

  const updateVimCursor = useCallback((view: EditorView) => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !view.hasFocus()) {
      setVimCursorRect(null);
      return;
    }
    try {
      const position = view.state.selection.head;
      const coords = view.coordsAtPos(position, 1);
      const nextPosition = Math.min(view.state.doc.content.size, position + 1);
      const nextCoords = view.coordsAtPos(nextPosition, -1);
      const computedStyle = window.getComputedStyle(view.dom);
      const fontSize = Number.parseFloat(computedStyle.fontSize) || 16;
      const measuredWidth =
        Math.abs(nextCoords.top - coords.top) < 2
          ? nextCoords.left - coords.left
          : 0;
      const scrollRect = scrollElement.getBoundingClientRect();
      const nextRect = {
        left: coords.left - scrollRect.left + scrollElement.scrollLeft,
        top: coords.top - scrollRect.top + scrollElement.scrollTop,
        width: Math.max(7, Math.min(fontSize * 1.2, measuredWidth || fontSize * 0.62)),
        height: Math.max(14, coords.bottom - coords.top),
      };
      setVimCursorRect((current) =>
        current &&
        Math.abs(current.left - nextRect.left) < 0.5 &&
        Math.abs(current.top - nextRect.top) < 0.5 &&
        Math.abs(current.width - nextRect.width) < 0.5 &&
        Math.abs(current.height - nextRect.height) < 0.5
          ? current
          : nextRect
      );
    } catch {
      setVimCursorRect(null);
    }
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
        verticalGoalLeftRef.current = null;
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

      const code = event.code;
      const direction = code === "KeyJ" ? 1 : code === "KeyK" ? -1 : null;
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        const lineCount = event.ctrlKey ? VIM_JUMP_LINES : 1;
        const currentCoords = view.coordsAtPos(view.state.selection.head, 1);
        const goalLeft =
          verticalGoalLeftRef.current ?? currentCoords.left + 1;
        verticalGoalLeftRef.current = goalLeft;
        isVerticalMotionRef.current = true;
        const emptyParagraphTarget =
          lineCount === 1
            ? getEmptyParagraphVerticalPosition(
                view,
                view.state.selection.head,
                direction
              )
            : null;
        moveVimSelection(
          view,
          emptyParagraphTarget ??
            getVerticalPosition(
              view,
              view.state.selection.head,
              direction,
              lineCount,
              goalLeft
            )
        );
        isVerticalMotionRef.current = false;
        return true;
      }
      if (event.ctrlKey) {
        return false;
      }
      if (code === "KeyH" || code === "KeyL") {
        event.preventDefault();
        event.stopPropagation();
        verticalGoalLeftRef.current = null;
        moveVimSelection(
          view,
          view.state.selection.head + (code === "KeyH" ? -1 : 1)
        );
        return true;
      }
      if (code === "KeyV") {
        event.preventDefault();
        event.stopPropagation();
        verticalGoalLeftRef.current = null;
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
      if (code === "KeyI" || code === "KeyA") {
        event.preventDefault();
        event.stopPropagation();
        verticalGoalLeftRef.current = null;
        if (code === "KeyA") {
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
    onFocus: ({ editor: currentEditor }) => {
      setVimMode("normal");
      requestAnimationFrame(() => updateVimCursor(currentEditor.view));
    },
    onBlur: () => setVimCursorRect(null),
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (!isVerticalMotionRef.current) {
        verticalGoalLeftRef.current = null;
      }
      updateVimCursor(currentEditor.view);
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

  useEffect(() => {
    if (!editor || !documentKey || documentKey === lastDocumentKeyRef.current) {
      return;
    }
    lastDocumentKeyRef.current = documentKey;

    // Promoting a focused draft to a persisted note is not navigation: keep
    // the insertion point so background note creation never interrupts typing.
    if (editor.view.hasFocus() && vimModeRef.current === "insert") {
      return;
    }

    verticalGoalLeftRef.current = null;
    setVimMode("normal");
    editor.view.dispatch(
      editor.view.state.tr
        .setSelection(TextSelection.atStart(editor.view.state.doc))
        .scrollIntoView()
    );
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
    requestAnimationFrame(() => updateVimCursor(editor.view));
  }, [documentKey, editor, setVimMode, updateVimCursor]);

  useEffect(() => {
    if (!editor || !scrollRef.current) {
      return;
    }
    const observer = new ResizeObserver(() => updateVimCursor(editor.view));
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [editor, updateVimCursor]);

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
        {vimMode !== "insert" && vimCursorRect ? (
          <span
            className="vim-block-cursor"
            aria-hidden="true"
            style={vimCursorRect}
          />
        ) : null}
      </div>
      {showVimModeIndicator ? (
        <div className="vim-mode-indicator" aria-live="polite">
          {vimMode.toUpperCase()}
        </div>
      ) : null}
    </div>
  );
}
