import { NoteEditor } from "../../components/NoteEditor";
import { useRef, useState } from "react";

type MobileEditorScreenProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  hasActiveNote: boolean;
  isSaving: boolean;
  saveError: string | null;
  keyboardInset: number;
  onRetrySave: () => void;
  draftMode?: boolean;
  onPullUpCreate?: () => Promise<void>;
};

export function MobileEditorScreen({
  markdown,
  onChange,
  hasActiveNote,
  isSaving,
  saveError,
  keyboardInset,
  onRetrySave,
  draftMode = false,
  onPullUpCreate,
}: MobileEditorScreenProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [creating, setCreating] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

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
      <div className="mobile-editor-status" role="status" aria-live="polite">
        {!hasActiveNote || draftMode ? (
          <span>Draft note</span>
        ) : saveError ? (
          <>
            <span className="error">Save failed: {saveError}</span>
            <button type="button" className="mobile-inline-action" onClick={onRetrySave}>
              Retry
            </button>
          </>
        ) : isSaving ? (
          <span>Saving...</span>
        ) : (
          <span>Saved</span>
        )}
      </div>
      <div className="mobile-editor-surface">
        <NoteEditor markdown={markdown} onChange={onChange} />
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
