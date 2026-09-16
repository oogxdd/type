import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { deleteItems, readNote, renameItem, writeNote } from "@/features/notes/api/notes-api";
import { getAutoRenameTarget } from "../lib/note-autoname";
import { DocumentSession } from "../lib/document-session";
import type { NoteFileNameFormat } from "@typenotes/shared/types";

export function useNoteEditor(
  activeNote: string | null,
  noteFileNameFormat: NoteFileNameFormat,
  selectedPaths: string[],
  profileKey: string,
) {
  const [draftNoteContent, setDraftNoteContent] = useState("");
  const session = useMemo(() => new DocumentSession({
    read: readNote,
    write: writeNote,
    saved: (path) => window.dispatchEvent(new CustomEvent("note-previews-invalidated", { detail: path })),
    leave: async (path, content, edited) => {
      if (edited && !content.trim()) {
        await deleteItems([path]);
        window.dispatchEvent(new CustomEvent("notes-tree-invalidated"));
      } else {
        const target = getAutoRenameTarget(path, content, noteFileNameFormat);
        if (target) {
          await renameItem(path, target);
          window.dispatchEvent(new CustomEvent("notes-tree-invalidated"));
        }
      }
    },
  }), [profileKey, noteFileNameFormat]);
  useSyncExternalStore(session.subscribe, session.snapshot);
  // Profile workflows flush before switching the backend root. Obsolete timers stop here.
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const pathKey = JSON.stringify(selectedPaths);
  useEffect(() => { session.select(JSON.parse(pathKey) as string[]); }, [session, pathKey]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const path = (event as CustomEvent<unknown>).detail;
      session.refresh(typeof path === "string" ? path : undefined);
    };
    window.addEventListener("note-previews-invalidated", refresh);
    return () => window.removeEventListener("note-previews-invalidated", refresh);
  }, [session]);
  useEffect(() => { setDraftNoteContent(""); }, [profileKey]);
  const current = activeNote ? session.documents.get(activeNote) : undefined;
  const handleEditorChange = useCallback((markdown: string) => {
    if (activeNote) session.change(activeNote, markdown);
    else setDraftNoteContent(markdown);
  }, [activeNote, session]);
  // Existing navigation callers can clear their pane without erasing another note's draft.
  const clearNote = useCallback(() => {}, []);
  const clearDraft = useCallback(() => setDraftNoteContent(""), []);
  const primeNoteContent = useCallback((markdown: string) => {
    if (activeNote) session.prime(activeNote, markdown);
  }, [activeNote, session]);
  const entries = [...session.documents.values()];
  return {
    session,
    noteContent: current?.content ?? "",
    loadedNotePath: current?.loaded ? activeNote : null,
    draftNoteContent,
    noteDirty: entries.some((entry) => entry.dirty),
    isSaving: entries.some((entry) => entry.saving),
    saveError: entries.find((entry) => entry.error)?.error ?? null,
    handleEditorChange, clearNote, clearDraft, primeNoteContent,
    flushSave: session.flushAll,
    retrySave: session.flushAll,
  };
}
