import { useLensAnnotations, type LensNote } from "../hooks/use-lens-annotations";
import { LensToolbar } from "./lens-toolbar";
import { LensNoteStage } from "./lens-note-stage";

type MultiNoteLensProps = {
  notes: LensNote[];
  activeNote: string | null;
  onBeforePersist?: () => Promise<void>;
  onActiveNoteContentSync?: (markdown: string) => void;
  onExitLens?: () => void;
};

/**
 * Reads several notes stacked together and lets the user draw / pin margin
 * notes over them. All annotation state and persistence lives in
 * useLensAnnotations; this component just wires it to the toolbar and stages.
 */
export function MultiNoteLens({
  notes,
  activeNote,
  onBeforePersist,
  onActiveNoteContentSync,
  onExitLens,
}: MultiNoteLensProps) {
  const lens = useLensAnnotations({
    notes,
    activeNote,
    onBeforePersist,
    onActiveNoteContentSync,
  });

  return (
    <div className="multi-lens-shell">
      <LensToolbar lens={lens} onExitLens={onExitLens} />

      <div className="multi-lens-status-row">
        <span>{lens.marksTotal} saved marks</span>
        {lens.saveMessage ? <span>{lens.saveMessage}</span> : null}
        {lens.saveError ? <span className="error">{lens.saveError}</span> : null}
        {lens.loadError ? <span className="error">{lens.loadError}</span> : null}
      </div>

      <div className="multi-lens-scroll">
        {lens.isLoading ? <div className="empty">Loading selected notes...</div> : null}
        {!lens.isLoading && lens.loadedNotes.length === 0 ? (
          <div className="empty">Select one or more notes to open lens view.</div>
        ) : null}
        {!lens.isLoading
          ? lens.loadedNotes.map((note, index) => (
              <LensNoteStage
                key={note.path}
                note={note}
                index={index}
                total={lens.loadedNotes.length}
                lens={lens}
              />
            ))
          : null}
      </div>
    </div>
  );
}
