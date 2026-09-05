/**
 * The React side of Vim mode: mode state, the pending-key buffer, the block
 * cursor's geometry, and the `VimHost` that lets `lib/vim/commands` reach
 * Tiptap and the layout.
 *
 * All Vim state that a command reads back within the same keystroke lives in
 * refs, not React state — `setMode` has to be visible to the very next line of
 * `executeVimCommand`. The `useState` mirrors exist only for rendering.
 */

import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import type { EditorView } from "@tiptap/pm/view";
import {
  executeVimCommand,
  placeCursor,
  vimHeadIndex,
  type VimFind,
  type VimHost,
  type VimLastChange,
} from "../lib/vim/commands";
import { resolveVimKeyEvent } from "../lib/vim/key-event";
import {
  describePending,
  emptyPending,
  parseVimKey,
  type VimMode,
  type VimPending,
} from "../lib/vim/keys";
import {
  getAdjacentTextblockVerticalPosition,
  getLineHeight,
  getVerticalPosition,
} from "../lib/vim/vertical-motion";

export type VimCursorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type UseVimOptions = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

const MODE_LABELS: Record<VimMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  "visual-line": "V-LINE",
};

export function useVim({ scrollRef }: UseVimOptions) {
  const [mode, setModeState] = useState<VimMode>("normal");
  const [pendingLabel, setPendingLabel] = useState("");
  const [cursorRect, setCursorRect] = useState<VimCursorRect | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const modeRef = useRef<VimMode>("normal");
  const pendingRef = useRef<VimPending>(emptyPending());
  const visualAnchorRef = useRef<number | null>(null);
  const visualHeadRef = useRef<number | null>(null);
  const lastVisualRef = useRef<VimHost["lastVisual"]>(null);
  const lastFindRef = useRef<VimFind | null>(null);
  const lastChangeRef = useRef<VimLastChange | null>(null);
  const insertCaptureRef = useRef<{ start: number } | null>(null);
  const verticalGoalLeftRef = useRef<number | null>(null);
  const isVerticalMotionRef = useRef(false);

  const attachEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);

  const setMode = useCallback((next: VimMode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);

  const setPending = useCallback((next: VimPending) => {
    pendingRef.current = next;
    setPendingLabel(describePending(next));
  }, []);

  /** Re-measures the block cursor. Cheap enough to run on every selection change. */
  const updateCursor = useCallback(
    (view: EditorView) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement || !view.hasFocus()) {
        setCursorRect(null);
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
          width: Math.max(
            7,
            Math.min(fontSize * 1.2, measuredWidth || fontSize * 0.62)
          ),
          height: Math.max(14, coords.bottom - coords.top),
        };
        setCursorRect((current) =>
          current &&
          Math.abs(current.left - nextRect.left) < 0.5 &&
          Math.abs(current.top - nextRect.top) < 0.5 &&
          Math.abs(current.width - nextRect.width) < 0.5 &&
          Math.abs(current.height - nextRect.height) < 0.5
            ? current
            : nextRect
        );
      } catch {
        setCursorRect(null);
      }
    },
    [scrollRef]
  );

  const clearCursor = useCallback(() => setCursorRect(null), []);

  /** Called from `onSelectionUpdate` — see `moveVisualLines` for the flag. */
  const noteSelectionChanged = useCallback(() => {
    if (!isVerticalMotionRef.current) {
      verticalGoalLeftRef.current = null;
    }
  }, []);

  const buildHost = useCallback(
    (view: EditorView): VimHost => ({
      view,
      get mode() {
        return modeRef.current;
      },
      setMode,
      get visualAnchor() {
        return visualAnchorRef.current;
      },
      setVisualAnchor: (index) => {
        visualAnchorRef.current = index;
      },
      get visualHead() {
        return visualHeadRef.current;
      },
      setVisualHead: (index) => {
        visualHeadRef.current = index;
      },
      get lastVisual() {
        return lastVisualRef.current;
      },
      setLastVisual: (value) => {
        lastVisualRef.current = value;
      },
      get lastFind() {
        return lastFindRef.current;
      },
      setLastFind: (value) => {
        lastFindRef.current = value;
      },
      get lastChange() {
        return lastChangeRef.current;
      },
      setLastChange: (value) => {
        lastChangeRef.current = value;
      },
      moveVisualLines: (direction, lineCount) => {
        const head = view.state.selection.head;
        let goalLeft = verticalGoalLeftRef.current;
        if (goalLeft === null) {
          try {
            goalLeft = view.coordsAtPos(head, 1).left + 1;
          } catch {
            goalLeft = 0;
          }
          verticalGoalLeftRef.current = goalLeft;
        }
        // Held until the command finishes so the dispatch it triggers does not
        // clear the desired column in `noteSelectionChanged`.
        isVerticalMotionRef.current = true;
        const adjacent =
          lineCount === 1
            ? getAdjacentTextblockVerticalPosition(view, head, direction)
            : null;
        return (
          adjacent ??
          getVerticalPosition(view, head, direction, lineCount, goalLeft)
        );
      },
      halfPageLines: () => {
        const height = scrollRef.current?.clientHeight ?? 0;
        const lineHeight = getLineHeight(view, view.state.selection.head);
        return Math.max(1, Math.floor(height / lineHeight / 2));
      },
      scrollCursor: (placement) => {
        const scrollElement = scrollRef.current;
        if (!scrollElement) {
          return;
        }
        try {
          const coords = view.coordsAtPos(view.state.selection.head, 1);
          const rect = scrollElement.getBoundingClientRect();
          const lineHeight = coords.bottom - coords.top;
          const offsetTop = coords.top - rect.top + scrollElement.scrollTop;
          const target =
            placement === "center"
              ? offsetTop - scrollElement.clientHeight / 2 + lineHeight / 2
              : placement === "top"
                ? offsetTop - lineHeight
                : offsetTop - scrollElement.clientHeight + lineHeight * 2;
          scrollElement.scrollTop = Math.max(
            0,
            Math.min(
              scrollElement.scrollHeight - scrollElement.clientHeight,
              target
            )
          );
        } catch {
          // Layout is unavailable mid-transition; leaving the scroll alone is fine.
        }
      },
      indentSelection: (direction) => {
        const editor = editorRef.current;
        if (!editor) {
          return false;
        }
        return direction > 0
          ? editor.commands.sinkListItem("listItem")
          : editor.commands.liftListItem("listItem");
      },
      splitBlock: () => {
        const editor = editorRef.current;
        if (!editor) {
          return false;
        }
        // Same order Enter uses, so `o` continues a list instead of breaking it.
        return editor.commands.splitListItem("listItem") ||
          editor.commands.splitBlock();
      },
      undo: () => {
        editorRef.current?.commands.undo();
      },
      redo: () => {
        editorRef.current?.commands.redo();
      },
      closeHistoryPoint: () => {
        view.dispatch(closeHistory(view.state.tr));
      },
      beginInsertCapture: () => {
        insertCaptureRef.current = { start: view.state.selection.head };
      },
    }),
    [scrollRef, setMode]
  );

  /**
   * Records what was typed during an Insert session so `.` can replay it.
   * Only a single-block insertion is captured; anything else leaves `.`
   * repeating the command without the typing.
   */
  const finishInsertCapture = useCallback((view: EditorView) => {
    const capture = insertCaptureRef.current;
    insertCaptureRef.current = null;
    const change = lastChangeRef.current;
    if (!capture || !change) {
      return;
    }
    const head = view.state.selection.head;
    if (head <= capture.start || capture.start > view.state.doc.content.size) {
      return;
    }
    const from = view.state.doc.resolve(capture.start);
    const to = view.state.doc.resolve(head);
    if (!from.sameParent(to)) {
      return;
    }
    change.insertedText = view.state.doc.textBetween(capture.start, head);
  }, []);

  const handleEscape = useCallback(
    (view: EditorView) => {
      const host = buildHost(view);
      const previous = modeRef.current;
      setPending(emptyPending());
      verticalGoalLeftRef.current = null;

      if (previous === "insert") {
        finishInsertCapture(view);
        host.closeHistoryPoint();
        setMode("normal");
        // Vim steps one character left when leaving Insert mode.
        placeCursor(host, Math.max(0, vimHeadIndex(host) - 1));
        return;
      }
      if (previous === "visual" || previous === "visual-line") {
        const head = vimHeadIndex(host);
        if (visualAnchorRef.current !== null) {
          lastVisualRef.current = {
            anchor: visualAnchorRef.current,
            head,
            mode: previous,
          };
        }
        visualAnchorRef.current = null;
        visualHeadRef.current = null;
        setMode("normal");
        placeCursor(host, head);
        return;
      }
      setMode("normal");
      placeCursor(host, vimHeadIndex(host));
    },
    [buildHost, finishInsertCapture, setMode, setPending]
  );

  const handleKeyDown = useCallback(
    (view: EditorView, event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleEscape(view);
        return true;
      }
      if (modeRef.current === "insert") {
        return false;
      }
      // Leave OS and browser shortcuts (⌘C, ⌥→, …) to the platform.
      if (event.metaKey || event.altKey) {
        return false;
      }
      if (event.key === "Shift" || event.key === "Control") {
        return false;
      }

      const keyEvent = resolveVimKeyEvent(event);
      const result = parseVimKey(pendingRef.current, keyEvent, modeRef.current);

      if (result.kind === "pending") {
        event.preventDefault();
        event.stopPropagation();
        setPending(result.pending);
        return true;
      }

      if (result.kind === "unhandled") {
        setPending(emptyPending());
        // Normal and Visual modes are not text entry: swallow anything that
        // would otherwise reach the document.
        if (
          keyEvent.char !== null ||
          event.key === "Enter" ||
          event.key === "Backspace" ||
          event.key === "Delete" ||
          event.key === "Tab"
        ) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      setPending(result.pending);
      try {
        executeVimCommand(result.command, buildHost(view));
      } finally {
        isVerticalMotionRef.current = false;
      }
      return true;
    },
    [buildHost, handleEscape, setPending]
  );

  /** Puts the editor into a known state when a different note is opened. */
  const resetForDocument = useCallback(
    (next: VimMode) => {
      setPending(emptyPending());
      visualAnchorRef.current = null;
      visualHeadRef.current = null;
      insertCaptureRef.current = null;
      verticalGoalLeftRef.current = null;
      setMode(next);
    },
    [setMode, setPending]
  );

  return {
    mode,
    modeRef,
    modeLabel: MODE_LABELS[mode],
    pendingLabel,
    cursorRect,
    attachEditor,
    handleKeyDown,
    updateCursor,
    clearCursor,
    noteSelectionChanged,
    resetForDocument,
    setVimMode: setMode,
  };
}
