import { useCallback, useEffect, useRef, useState } from "react";
import { deleteItems, readNote, renameItem, writeNote } from "@/features/notes/api/notes-api";
import { getAutoRenameTarget } from "@/features/notes/editor/lib/note-autoname";
import type { NoteFileNameFormat } from "@/shared/types";
import { getErrorMessage } from "@/shared/lib/errors";

const emitTreeInvalidated = () => {
  window.dispatchEvent(new CustomEvent("notes-tree-invalidated"));
};

export function useNoteEditor(
  activeNote: string | null,
  noteFileNameFormat: NoteFileNameFormat
) {
  const [noteContent, setNoteContent] = useState("");
  const [draftNoteContent, setDraftNoteContent] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const noteContentRef = useRef(noteContent);
  const activeNoteRef = useRef(activeNote);
  const noteDirtyRef = useRef(noteDirty);

  useEffect(() => {
    noteContentRef.current = noteContent;
  }, [noteContent]);

  useEffect(() => {
    noteDirtyRef.current = noteDirty;
  }, [noteDirty]);

  const saveNow = useCallback(
    async (targetNote: string | null, content: string) => {
      if (!targetNote) {
        return;
      }
      setIsSaving(true);
      setSaveError(null);
      try {
        await writeNote(targetNote, content);
        if (activeNoteRef.current === targetNote && noteContentRef.current === content) {
          setNoteDirty(false);
          noteDirtyRef.current = false;
        }
      } catch (error) {
        const message = getErrorMessage(error);
        setSaveError(message);
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // Load note content when activeNote changes
  useEffect(() => {
    let cancelled = false;
    const previousNote = activeNoteRef.current;
    const previousContent = noteContentRef.current;
    const previousDirty = noteDirtyRef.current;
    activeNoteRef.current = activeNote;

    const run = async () => {
      if (previousNote && previousNote !== activeNote) {
        try {
          const trimmed = previousContent.trim();
          if (previousDirty && !trimmed) {
            await deleteItems([previousNote]);
            emitTreeInvalidated();
          } else {
            if (previousDirty) {
              await saveNow(previousNote, previousContent);
            }
            if (trimmed) {
              // The editor owns the timing of the flush; the notes domain owns
              // the filename policy.
              const renameTarget = getAutoRenameTarget(
                previousNote,
                previousContent,
                noteFileNameFormat
              );
              if (renameTarget) {
                await renameItem(previousNote, renameTarget);
                emitTreeInvalidated();
              }
            }
          }
        } catch (error) {
          console.error("[notes] failed to flush previous note", error);
        }
      }

      if (!activeNote) {
        if (!cancelled) {
          setNoteDirty(false);
        }
        return;
      }

      const content = await readNote(activeNote);
      if (!cancelled) {
        setNoteContent(content);
        setNoteDirty(false);
        setSaveError(null);
        noteContentRef.current = content;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeNote, noteFileNameFormat, saveNow]);

  // Autosave with debounce
  useEffect(() => {
    if (!activeNote || !noteDirty) {
      return;
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      void saveNow(activeNote, noteContent);
    }, 400);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [activeNote, noteContent, noteDirty, saveNow]);

  const handleEditorChange = useCallback(
    (markdown: string) => {
      if (!activeNote) {
        setDraftNoteContent((prev) => (prev === markdown ? prev : markdown));
        return;
      }
      setNoteContent((prev) => (prev === markdown ? prev : markdown));
      noteContentRef.current = markdown;
      setNoteDirty(true);
      noteDirtyRef.current = true;
      setSaveError(null);
    },
    [activeNote]
  );

  const clearNote = useCallback(() => {
    setNoteContent("");
    setNoteDirty(false);
    noteDirtyRef.current = false;
  }, []);

  const clearDraft = useCallback(() => {
    setDraftNoteContent("");
  }, []);

  const primeNoteContent = useCallback((markdown: string) => {
    setNoteContent(markdown);
    noteContentRef.current = markdown;
    setNoteDirty(false);
    noteDirtyRef.current = false;
    setSaveError(null);
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!activeNoteRef.current || !noteDirtyRef.current) {
      return;
    }
    await saveNow(activeNoteRef.current, noteContentRef.current);
  }, [saveNow]);

  const retrySave = useCallback(async () => {
    if (!activeNoteRef.current) {
      return;
    }
    await saveNow(activeNoteRef.current, noteContentRef.current);
  }, [saveNow]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const isSaved = !noteDirty && !isSaving && !saveError;

  return {
    noteContent,
    draftNoteContent,
    noteDirty,
    isSaving,
    saveError,
    isSaved,
    handleEditorChange,
    clearNote,
    clearDraft,
    primeNoteContent,
    flushSave,
    retrySave,
  };
}
