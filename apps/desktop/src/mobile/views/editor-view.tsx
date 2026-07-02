import { NoteEditor } from "@/features/notes/editor/components/note-editor";
import { useRef, useState } from "react";
import { RecordingNoteHeader } from "@/features/recording/components/recording-note-header";
import { HandwritingNoteHeader } from "@/features/handwriting/components/handwriting-note-header";
import type { NotePreview } from "@typenotes/shared/format";
import { sanitizeRecordingEditorContent } from "@typenotes/shared/format";

type MobileEditorScreenProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  notePath?: string | null;
  notePreview?: NotePreview;
  hasActiveNote: boolean;
  saveError: string | null;
  keyboardInset: number;
  onRetrySave: () => void;
  draftMode?: boolean;
  onPullUpCreate?: () => Promise<void>;
};

export function MobileEditorScreen({
  markdown,
  onChange,
  notePath = null,
  notePreview,
  hasActiveNote,
  saveError,
  keyboardInset,
  onRetrySave,
  draftMode = false,
  onPullUpCreate,
}: MobileEditorScreenProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [creating, setCreating] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const editorMarkdown =
    notePreview?.isRecording && hasActiveNote
      ? sanitizeRecordingEditorContent(markdown, notePreview.transcriptionStatus)
      : markdown;

  const focusEditorSurface = (container: HTMLDivElement) => {
    const editable = container.querySelector<HTMLElement>(".tiptap-content[contenteditable='true']");
    if (!editable || document.activeElement === editable) {
      return;
    }
    editable.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const startPullUp = (clientY: number, container: HTMLDivElement) => {
    if (!onPullUpCreate || creating) {
      touchStartYRef.current = null;
      return;
    }
    const scrollArea = container.querySelector<HTMLDivElement>(".tiptap-scroll");
    if (!scrollArea) {
      touchStartYRef.current = null;
      return;
    }
    const atBottom =
      scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 2;
    touchStartYRef.current = atBottom ? clientY : null;
  };

  const movePullUp = (clientY: number) => {
    if (touchStartYRef.current == null) {
      return;
    }
    const delta = touchStartYRef.current - clientY;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(110, delta * 0.62));
  };

  const endPullUp = async () => {
    if (touchStartYRef.current == null) {
      return;
    }
    touchStartYRef.current = null;
    const shouldCreate = pullDistance >= 78;
    setPullDistance(0);
    if (!shouldCreate || !onPullUpCreate) {
      return;
    }
    setCreating(true);
    try {
      await onPullUpCreate();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="mobile-editor-screen"
      style={{ paddingBottom: keyboardInset }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".tiptap-content[contenteditable='true']")) {
          return;
        }
        window.requestAnimationFrame(() => {
          focusEditorSurface(event.currentTarget);
        });
      }}
      onTouchStart={(event) => startPullUp(event.touches[0]?.clientY ?? 0, event.currentTarget)}
      onTouchMove={(event) => movePullUp(event.touches[0]?.clientY ?? 0)}
      onTouchEnd={() => {
        void endPullUp();
      }}
      onTouchCancel={() => {
        touchStartYRef.current = null;
        setPullDistance(0);
      }}
    >
      {!draftMode && hasActiveNote && saveError ? (
        <div className="mobile-editor-status" role="status" aria-live="polite">
          <>
            <span className="error">Save failed: {saveError}</span>
            <button type="button" className="mobile-inline-action" onClick={onRetrySave}>
              Retry
            </button>
          </>
        </div>
      ) : null}
      {!draftMode && hasActiveNote ? (
        <RecordingNoteHeader notePath={notePath} preview={notePreview} />
      ) : null}
      {!draftMode && hasActiveNote ? (
        <HandwritingNoteHeader notePath={notePath} preview={notePreview} />
      ) : null}
      <div className="mobile-editor-surface">
        <NoteEditor markdown={editorMarkdown} onChange={onChange} />
      </div>
      {onPullUpCreate ? (
        <div className="mobile-pullup-indicator" style={{ height: pullDistance }}>
          {creating
            ? "Creating note..."
            : pullDistance >= 78
              ? "Release to create note"
              : "Pull up to create note"}
        </div>
      ) : null}
    </div>
  );
}
