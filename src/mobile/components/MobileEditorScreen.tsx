import { NoteEditor } from "../../components/NoteEditor";

type MobileEditorScreenProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  hasActiveNote: boolean;
  isSaving: boolean;
  saveError: string | null;
  keyboardInset: number;
  onRetrySave: () => void;
};

export function MobileEditorScreen({
  markdown,
  onChange,
  hasActiveNote,
  isSaving,
  saveError,
  keyboardInset,
  onRetrySave,
}: MobileEditorScreenProps) {
  if (!hasActiveNote) {
    return <div className="mobile-screen-empty">Select a note to start editing.</div>;
  }

  return (
    <div className="mobile-editor-screen" style={{ paddingBottom: keyboardInset }}>
      <div className="mobile-editor-status" role="status" aria-live="polite">
        {saveError ? (
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
    </div>
  );
}
