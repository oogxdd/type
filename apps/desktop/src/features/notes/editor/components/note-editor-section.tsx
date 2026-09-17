import { memo, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { NotePreview } from "@typenotes/shared/format";
import { sanitizeRecordingEditorContent } from "@typenotes/shared/format";
import { RecordingNotePlayback } from "@/features/recording/components/recording-note-playback";
import { RecordingNoteHeader } from "@/features/recording/components/recording-note-header";
import { HandwritingNoteHeader } from "@/features/handwriting/components/handwriting-note-header";
import type { DocumentSession } from "../lib/document-session";
import type { EditorSurface } from "../lib/editor-surface";
import { formatEditorDate } from "../lib/editor-date";
import { NoteEditor } from "./note-editor";

type Props = {
  path: string; title: string; preview?: NotePreview; multiple: boolean;
  mounted: boolean; active: boolean; session: DocumentSession; surface: EditorSurface;
  onRequest: (path: string) => void;
};

/** Offscreen rows keep only a measured spacer; edits notify just their own row. */
export const NoteEditorSection = memo(function NoteEditorSection({
  path, title, preview, multiple, mounted, active, session, surface, onRequest,
}: Props) {
  const subscribe = useCallback((listener: () => void) => session.subscribeDocument(path, listener), [session, path]);
  const snapshot = useCallback(() => session.documentSnapshot(path), [session, path]);
  useSyncExternalStore(subscribe, snapshot);
  const entry = session.documents.get(path);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const height = useRef(180);
  const onChange = useCallback((content: string) => session.change(path, content), [session, path]);
  useEffect(() => {
    if (mounted) void session.load(path, false, true);
  }, [mounted, path, session]);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!mounted || !body) return;
    const measure = () => { height.current = Math.max(48, body.getBoundingClientRect().height); };
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    return () => observer.disconnect();
  }, [mounted]);
  const content = entry?.content ?? "";
  return (
    <article className="note-editor-section" data-note-path={path} data-active={active} aria-label={title}>
      {multiple ? <header className="note-editor-divider" contentEditable={false}>
        {preview?.isRecording ? <RecordingNotePlayback notePath={path} preview={preview} /> : null}
        <time>{formatEditorDate(preview?.createdMs ?? preview?.updatedMs ?? null)}</time>
      </header> : null}
      <div ref={bodyRef} style={mounted ? undefined : { height: height.current }}>
        {mounted ? <>
          {!multiple ? <RecordingNoteHeader notePath={path} preview={preview} /> : null}
          <HandwritingNoteHeader notePath={path} preview={preview} />
          {entry?.error ? <div role="alert" className="note-editor-error">
            {entry.error} <button type="button" onClick={() => void (entry.loaded && entry.dirty ? session.flush(path) : session.load(path, true, true)).catch(() => {})}>Retry</button>
          </div> : null}
          {entry?.loaded ? <NoteEditor documentKey={path}
            markdown={preview?.isRecording ? sanitizeRecordingEditorContent(content, preview.transcriptionStatus) : content}
            onChange={onChange} surface={surface} loadingHeight={height.current} />
            : !entry?.error ? <p className="note-editor-loading" role="status">Loading note…</p> : null}
        </> : <button type="button" className="note-editor-placeholder" onClick={(event) => {
          event.stopPropagation(); onRequest(path);
        }}>Load note</button>}
      </div>
    </article>
  );
});
