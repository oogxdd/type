import { useEffect, useMemo, useRef, useState } from "react";
import { TextSelection } from "@tiptap/pm/state";
import { formatEditorDate } from "../lib/editor-date";
import type { Editor } from "@tiptap/react";
import { useEditor } from "../hooks/editor-context";
import { useAppearance } from "@/app/state/appearance-store";
import { useSelection } from "@/app/state/selection-store";
import { NoteEditor } from "./note-editor";
import { EditorToolbar } from "./editor-toolbar";
import { constrainSelection, moveBetweenEditors, type EditorSurface, type EditorSurfaceHandle } from "../lib/editor-surface";
import { getActiveNoteEditor, setActiveNoteEditor } from "../lib/editor-bridge";
import { RecordingNotePlayback } from "@/features/recording/components/recording-note-playback";
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
  const pendingStart = useRef<string | null>(null);
  const startFrame = useRef(0);
  const revealFrame = useRef(0);
  const selectedPathsKey = JSON.stringify(notes.map((note) => note.path));
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (pendingStart.current && pendingStart.current !== ordered.current[0]?.path) pendingStart.current = null;
  }, [selectedPathsKey]);
  useEffect(() => () => { cancelAnimationFrame(startFrame.current); cancelAnimationFrame(revealFrame.current); }, []);
  const surface = useMemo<EditorSurface>(() => {
    const activate = (handle: EditorSurfaceHandle) => {
      active.current = handle;
      setActiveEditor(handle.editor);
      setActivePath(handle.path);
      setActiveNoteEditor(handle.editor, handle.path);
      setStatus(statuses.current.get(handle.path) ?? { mode: "NORMAL", pending: "" });
    };
    const focusStart = (multipleOnly = false) => {
      if (multipleOnly && ordered.current.length < 2) return false;
      const path = ordered.current[0]?.path;
      if (!path) return false;
      pendingStart.current = path;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      const first = handles.current.get(path);
      if (first) {
        pendingStart.current = null;
        first.focus(TextSelection.atStart(first.editor.state.doc).head, "normal");
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      }
      return true;
    };
    const revealStart = (handle: EditorSurfaceHandle) => {
      if (ordered.current.length < 2 || handle.path !== ordered.current[0]?.path) return;
      cancelAnimationFrame(revealFrame.current);
      revealFrame.current = requestAnimationFrame(() => {
        if (handle.editor.isDestroyed || !handle.editor.view.hasFocus()) return;
        const { state, view } = handle.editor;
        const first = TextSelection.atStart(state.doc);
        // Include the divider when the caret reaches the first visual line.
        if (state.selection.empty && state.selection.$head.sameParent(first.$head) &&
            view.coordsAtPos(state.selection.head).top <= view.coordsAtPos(first.head).top + 1 && scrollRef.current) {
          scrollRef.current.scrollTop = 0;
        }
      });
    };
    return {
      scrollRef, activate, focusStart, revealStart,
      register: (handle) => {
        handles.current.set(handle.path, handle);
        if (pendingStart.current === handle.path) {
          cancelAnimationFrame(startFrame.current);
          startFrame.current = requestAnimationFrame(() => {
            if (pendingStart.current === handle.path && ordered.current[0]?.path === handle.path) focusStart();
          });
        }
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
          const moved = moveBetweenEditors(available, handle, direction, count, mode, goal.current);
          if (active.current) revealStart(active.current);
          return moved;
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
      <div className="tiptap-scroll note-editor-group-scroll" ref={scrollRef} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const last = [...ordered.current].reverse().map((note) => handles.current.get(note.path)).find(Boolean);
        if (last) {
          event.stopPropagation();
          last.focus(TextSelection.atEnd(last.editor.state.doc).head, "insert");
        }
      }}>
        {notes.map((note) => {
          const document = session.documents.get(note.path);
          const preview = notePreviews[note.path] ?? allNotePreviews[note.path];
          const markdown = document?.content ?? "";
          return (
            <article key={note.path} className="note-editor-section" data-active={activePath === note.path} aria-label={note.title}>
              <header className="note-editor-divider" contentEditable={false}>
                {multiple ? <RecordingNotePlayback notePath={note.path} preview={preview} /> : null}
                <time>{formatEditorDate(preview?.createdMs ?? preview?.updatedMs ?? null)}</time>
              </header>
              {!multiple ? <RecordingNoteHeader notePath={note.path} preview={preview} /> : null}
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
