import { useEffect, useState } from "react";
import { useSelection } from "@/app/state/selection-store";
import { readNote } from "@/features/notes/api/notes-api";
import { stripInlineAnnotationMetadata } from "@typenotes/shared/annotation-metadata";
import { getErrorMessage } from "@typenotes/shared/errors";
import { sanitizeRecordingEditorContent } from "@typenotes/shared/format";
import { stripFrontmatter } from "@typenotes/shared/frontmatter";
import type { LensNote } from "../hooks/use-lens-annotations";
import { NoteReadonlyContent } from "./note-readonly-content";

type ReviewBody = { markdown: string; raw: string; error?: never } | { markdown?: never; raw?: never; error: string };

export function MultiNoteReview({
  notes,
  onBeforeRead,
}: {
  notes: LensNote[];
  onBeforeRead: () => Promise<void>;
}) {
  const setSelectedNotes = useSelection((state) => state.setSelectedNotes);
  const setActiveNote = useSelection((state) => state.setActiveNote);
  const setLastSelectedNote = useSelection((state) => state.setLastSelectedNote);
  const [bodies, setBodies] = useState<Record<string, ReviewBody>>({});
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("note-previews-invalidated", refresh);
    return () => window.removeEventListener("note-previews-invalidated", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Flush the single editor before reading its persisted body for review.
    void onBeforeRead().then(async () => {
      if (cancelled) return;
      const entries = await Promise.all(notes.map(async (note) => {
        try {
          const raw = await readNote(note.path);
          const body = stripInlineAnnotationMetadata(stripFrontmatter(raw));
          const markdown = note.isRecording
            ? sanitizeRecordingEditorContent(body, note.transcriptionStatus)
            : body;
          return [note.path, { markdown, raw }] as const;
        } catch (cause) {
          return [note.path, { error: getErrorMessage(cause) }] as const;
        }
      }));
      if (!cancelled) setBodies(Object.fromEntries(entries));
    }).catch((cause) => {
      if (!cancelled) setError(getErrorMessage(cause));
    });
    return () => { cancelled = true; };
  }, [notes, onBeforeRead, revision]);

  const openNote = (path: string) => {
    setSelectedNotes(new Set([path]));
    setLastSelectedNote(path);
    setActiveNote(path);
  };

  return (
    <section className="note-review" aria-label="Selected notes review">
      <header className="note-review-toolbar">
        <strong>{notes.length} notes</strong>
        <span>Review · Read only</span>
      </header>
      {error ? <p className="note-review-error" role="alert">{error}</p> : null}
      <div className="note-review-scroll" tabIndex={0} aria-label="Selected note contents">
        {notes.map((note) => {
          const body = bodies[note.path];
          return (
            <article className="note-review-note" key={note.path} aria-label={note.title}>
              <header className="note-review-heading">
                <div>
                  <h2>{note.title}</h2>
                  <p>{[note.dateLabel, note.path.split("/").slice(0, -1).join("/")].filter(Boolean).join(" · ")}</p>
                </div>
                <button type="button" className="multi-lens-btn subtle" onClick={() => openNote(note.path)} aria-label={`Edit note: ${note.title}`}>
                  Edit note
                </button>
              </header>
              {!body ? <p className="note-review-placeholder" role="status">Loading note...</p>
                : body.error !== undefined ? <div className="note-review-error" role="alert">{body.error} <button type="button" className="multi-lens-btn" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>
                : body.markdown.trim() ? <NoteReadonlyContent markdown={body.markdown} notePath={note.path} />
                : <p className="note-review-placeholder">Empty note</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
