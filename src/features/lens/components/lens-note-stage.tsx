import { NoteReadonlyContent } from "./note-readonly-content";
import { clamp01, pointsToSvgPath } from "../lib/lens-geometry";
import type { LensAnnotations, LoadedLensNote } from "../hooks/use-lens-annotations";

type LensNoteStageProps = {
  note: LoadedLensNote;
  index: number;
  total: number;
  lens: LensAnnotations;
};

export function LensNoteStage({ note, index, total, lens }: LensNoteStageProps) {
  const { drawing, pendingTextDraft, isAnnotating, isAnnotationsVisible } = lens;

  const noteMarksCount = note.annotations.strokes.length + note.annotations.textNotes.length;
  const draftPath =
    drawing && drawing.notePath === note.path ? pointsToSvgPath(drawing.points) : null;

  // Shift each mark by how far its anchored text block has moved since it was drawn.
  const renderedStrokes = note.annotations.strokes.map((stroke) => {
    const deltaY = lens.resolveAnchorDelta(note.path, stroke.anchor);
    if (!deltaY) {
      return stroke;
    }
    return {
      ...stroke,
      points: stroke.points.map((point) => ({ x: point.x, y: clamp01(point.y + deltaY) })),
    };
  });
  const renderedTextNotes = note.annotations.textNotes.map((item) => {
    const deltaY = lens.resolveAnchorDelta(note.path, item.anchor);
    if (!deltaY) {
      return item;
    }
    return { ...item, y: clamp01(item.y + deltaY) };
  });

  return (
    <section className="multi-lens-note">
      <header className="multi-lens-note-header">
        <div className="multi-lens-note-headline">
          <h4>{note.title || note.path.split("/").pop() || note.path}</h4>
          <p>
            {note.path}
            {note.dateLabel ? ` · ${note.dateLabel}` : ""}
          </p>
        </div>
        <div className="multi-lens-note-actions">
          <span>{noteMarksCount} marks</span>
          <button
            type="button"
            className="multi-lens-btn subtle"
            onClick={() => lens.clearAnnotations(note.path)}
            disabled={noteMarksCount === 0}
          >
            Clear
          </button>
        </div>
      </header>

      <div className="multi-lens-note-stage">
        <div
          className="multi-lens-note-readonly"
          ref={(node) => {
            lens.noteReadonlyRefMap.current[note.path] = node;
          }}
        >
          <NoteReadonlyContent markdown={note.displayMarkdown} />
        </div>

        {isAnnotationsVisible ? (
          <div
            className={`multi-lens-overlay ${isAnnotating ? "is-editing" : ""}`}
            onPointerDown={(event) => lens.handleOverlayPointerDown(note.path, event)}
            onPointerMove={(event) => lens.handleOverlayPointerMove(note.path, event)}
            onPointerUp={(event) => lens.handleOverlayPointerEnd(note.path, event)}
            onPointerCancel={(event) => lens.handleOverlayPointerEnd(note.path, event)}
          >
            <svg className="multi-lens-strokes" viewBox="0 0 100 100" preserveAspectRatio="none">
              {renderedStrokes.map((stroke) => (
                <path
                  key={stroke.id}
                  d={pointsToSvgPath(stroke.points)}
                  fill="none"
                  stroke={stroke.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={stroke.width}
                />
              ))}
              {draftPath ? (
                <path
                  d={draftPath}
                  fill="none"
                  stroke="#2b6ff0"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={0.42}
                />
              ) : null}
            </svg>
            {renderedTextNotes.map((item) => (
              <aside
                className="multi-lens-text-note"
                key={item.id}
                style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}
              >
                {item.text}
              </aside>
            ))}
            {pendingTextDraft && pendingTextDraft.notePath === note.path ? (
              <form
                className="multi-lens-inline-text-editor"
                style={{
                  left: `${pendingTextDraft.point.x * 100}%`,
                  top: `${pendingTextDraft.point.y * 100}%`,
                }}
                onSubmit={lens.commitPendingTextDraftFromSubmit}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <textarea
                  ref={lens.textDraftRef}
                  className="multi-lens-inline-text-editor-input"
                  rows={1}
                  value={pendingTextDraft.text}
                  placeholder="Margin note..."
                  onChange={(event) => lens.setPendingTextDraftText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      lens.cancelPendingTextDraft();
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      lens.commitPendingTextDraft();
                    }
                  }}
                />
                <div className="multi-lens-inline-text-editor-actions">
                  <button
                    type="button"
                    className="multi-lens-inline-text-editor-action"
                    onClick={lens.cancelPendingTextDraft}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="multi-lens-inline-text-editor-action primary"
                    disabled={!pendingTextDraft.text.trim()}
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>

      {index < total - 1 ? <div className="multi-lens-divider" /> : null}
    </section>
  );
}
