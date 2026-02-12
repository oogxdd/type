import { useEffect, useRef, useState } from "react";
import { readNote, writeNote } from "../data/notesApi";

export function useNoteEditor(activeNote: string | null) {
  const [noteContent, setNoteContent] = useState("");
  const [draftNoteContent, setDraftNoteContent] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Load note content when activeNote changes
  useEffect(() => {
    if (!activeNote) {
      setNoteDirty(false);
      return;
    }
    let cancelled = false;
    readNote(activeNote).then((content) => {
      if (!cancelled) {
        setNoteContent(content);
        setNoteDirty(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeNote]);

  // Autosave with debounce
  useEffect(() => {
    if (!activeNote || !noteDirty) {
      return;
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      writeNote(activeNote, noteContent).then(() => {
        setNoteDirty(false);
      });
    }, 400);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [activeNote, noteContent, noteDirty]);

  const handleEditorChange = (markdown: string) => {
    if (!activeNote) {
      setDraftNoteContent((prev) => (prev === markdown ? prev : markdown));
      return;
    }
    setNoteContent((prev) => (prev === markdown ? prev : markdown));
    setNoteDirty(true);
  };

  const clearNote = () => {
    setNoteContent("");
    setNoteDirty(false);
  };

  return {
    noteContent,
    draftNoteContent,
    noteDirty,
    handleEditorChange,
    clearNote,
  };
}
