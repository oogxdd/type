import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditor } from "../hooks/editor-context";
import { useAppearance } from "@/app/state/appearance-store";
import { useSelection } from "@/app/state/selection-store";
import { NoteEditor } from "./note-editor";
import { EditorToolbar } from "./editor-toolbar";
import { constrainSelection, moveBetweenEditors, type EditorSurface, type EditorSurfaceHandle } from "../lib/editor-surface";
import { getActiveNoteEditor, setActiveNoteEditor } from "../lib/editor-bridge";
import { RecordingNoteHeader } from "@/features/recording/components/recording-note-header";
import { HandwritingNoteHeader } from "@/features/handwriting/components/handwriting-note-header";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { sanitizeRecordingEditorContent } from "@typenotes/shared/format";

type EditorNote = { path: string; title: string; dateLabel: string; isRecording: boolean; transcriptionStatus: string | null };

/** One scroll and one set of controls; each file retains its own editor and undo history. */
export function NoteEditorGroup({ notes }: { notes: EditorNote[] }) {
  const { session } = useEditor();
  const { notePreviews, allNotePreviews } = useNotesTree();
  const activeNote = useSelection((state) => state.activeNote);
  const showMode = useAppearance((state) => state.showVimModeIndicator);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handles = useRef(new Map<string, EditorSurfaceHandle>());
  const active = useRef<EditorSurfaceHandle | null>(null);
  const ordered = useRef(notes);
  ordered.current = notes;
  const preferred = useRef(activeNote);
  preferred.current = activeNote;
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [status, setStatus] = useState({ mode: "NORMAL", pending: "" });
  const statuses = useRef(new Map<string, typeof status>());
  const [, redrawToolbar] = useState(0);
  const goal = useRef<number | null>(null);
  const moving = useRef(false);
  const surface = useMemo<EditorSurface>(() => {
    const activate = (handle: EditorSurfaceHandle) => {
      active.current = handle;
      setActiveEditor(handle.editor);
      setActivePath(handle.path);
      setActiveNoteEditor(handle.editor, handle.path);
      setStatus(statuses.current.get(handle.path) ?? { mode: "NORMAL", pending: "" });
    };
    return {
      scrollRef, activate,
      register: (handle) => {
        handles.current.set(handle.path, handle);
        if (!active.current || handle.path === preferred.current) activate(handle);
        return () => {
          handles.current.delete(handle.path);
          statuses.current.delete(handle.path);
          if (active.current === handle) {
            active.current = null;
            const replacement = ordered.current.map((note) => handles.current.get(note.path)).find(Boolean);
            if (replacement) activate(replacement);
            else {
              setActiveEditor(null);
              setActivePath(null);
              if (getActiveNoteEditor() === handle.editor) setActiveNoteEditor(null);
            }
          }
        };
      },
      status: (handle, mode, pending) => {
        statuses.current.set(handle.path, { mode, pending });
        if (active.current === handle) setStatus({ mode, pending });
      },
      moveVertical: (handle, direction, count, mode) => {
        goal.current ??= handle.editor.view.coordsAtPos(handle.editor.state.selection.head).left + 1;
        moving.current = true;
        try {
          // Stop at failed/loading notes, rather than silently skipping their content.
          const index = ordered.current.findIndex((note) => note.path === handle.path);
          let first = index, last = index;
          while (first > 0 && handles.current.has(ordered.current[first - 1].path)) first--;
          while (last + 1 < ordered.current.length && handles.current.has(ordered.current[last + 1].path)) last++;
          const available = ordered.current.slice(first, last + 1).map((note) => handles.current.get(note.path)!);
          return moveBetweenEditors(available, handle, direction, count, mode, goal.current);
        } finally { moving.current = false; }
      },
    };
  }, []);
  useEffect(() => {
    if (!activeEditor) return;
    const update = () => {
      redrawToolbar((value) => value + 1);
      if (!moving.current) goal.current = null;
    };
    activeEditor.on("transaction", update);
    return () => { activeEditor.off("transaction", update); };
  }, [activeEditor]);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const clamp = () => constrainSelection(root);
    document.addEventListener("selectionchange", clamp);
    root.addEventListener("copy", clamp, true);
    root.addEventListener("cut", clamp, true);
    let draggedFrom: Element | null = null;
    const noteAt = (target: EventTarget | null) => target instanceof Element ? target.closest("[data-note-editor]") : null;
    const startDrag = (event: DragEvent) => { draggedFrom = noteAt(event.target); };
    const endDrag = () => { draggedFrom = null; };
    const preventCrossDrop = (event: DragEvent) => {
      if (draggedFrom && noteAt(event.target) !== draggedFrom) {
        event.preventDefault();
        event.stopPropagation();
      }
      draggedFrom = null;
    };
    root.addEventListener("dragstart", startDrag);
    root.addEventListener("dragend", endDrag);
    root.addEventListener("drop", preventCrossDrop, true);
    return () => {
      document.removeEventListener("selectionchange", clamp);
      root.removeEventListener("copy", clamp, true);
      root.removeEventListener("cut", clamp, true);
      root.removeEventListener("dragstart", startDrag);
      root.removeEventListener("dragend", endDrag);
      root.removeEventListener("drop", preventCrossDrop, true);
    };
  }, []);
  const multiple = notes.length > 1;
  return (
    <section className="note-editor-group tiptap-editor" aria-label={multiple ? "Selected notes editor" : "Note editor surface"} data-vim-mode={status.mode === "V-LINE" ? "visual-line" : status.mode.toLowerCase()}>
      <EditorToolbar editor={activeEditor} />
      <div className="tiptap-scroll note-editor-group-scroll" ref={scrollRef}>
        {notes.map((note) => {
          const document = session.documents.get(note.path);
          const preview = notePreviews[note.path] ?? allNotePreviews[note.path];
          const markdown = document?.content ?? "";
          return (
            <article key={note.path} className="note-editor-section" data-active={activePath === note.path} aria-label={note.title}>
              {multiple ? <header className="note-editor-divider" contentEditable={false}>
                <span>{note.title}</span><time>{note.dateLabel}</time>
              </header> : null}
              <RecordingNoteHeader notePath={note.path} preview={preview} />
              <HandwritingNoteHeader notePath={note.path} preview={preview} />
              {document?.error ? <div role="alert" className="note-editor-error">{document.error} <button type="button" onClick={() => void (document.loaded && document.dirty ? session.flush(note.path) : session.load(note.path, true)).catch(() => {})}>Retry</button></div> : null}
              {document?.loaded ? <NoteEditor documentKey={note.path} markdown={note.isRecording ? sanitizeRecordingEditorContent(markdown, note.transcriptionStatus) : markdown} onChange={(content) => session.change(note.path, content)} surface={surface} />
                : !document?.error ? <p className="note-editor-loading" role="status">Loading note…</p> : null}
            </article>
          );
        })}
      </div>
      {showMode ? <div className="vim-mode-indicator" aria-live="polite">{status.mode}{status.pending ? <span className="vim-pending-keys">{status.pending}</span> : null}</div> : null}
    </section>
  );
}
