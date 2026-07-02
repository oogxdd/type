import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { getNoteParentPath } from "@typenotes/shared/notes";
import type { AppMode } from "@typenotes/shared/types";

type UseNoteOpenerArgs = {
  setAppMode: Dispatch<SetStateAction<AppMode>>;
};

export type NoteOpener = {
  /** Switch to notes mode and select a folder, clearing any note selection. */
  openPinnedFolder: (folderPath: string) => void;
};

/**
 * Programmatic navigation into a folder or note from outside the tree: the
 * sidebar's Feed/Trash buttons (`openPinnedFolder`) and the Transcription
 * settings page, which fires a window "open-note" event to jump straight to a
 * recording's note. Both leave settings/other modes and mirror a plain click's
 * selection update.
 */
export const useNoteOpener = ({ setAppMode }: UseNoteOpenerArgs): NoteOpener => {
  const { clearDraft, clearNote } = useEditor();
  const {
    setSelectedFolders,
    setLastSelectedFolder,
    setActiveFolder,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      setSelectedFolders: state.setSelectedFolders,
      setLastSelectedFolder: state.setLastSelectedFolder,
      setActiveFolder: state.setActiveFolder,
      setSelectedNotes: state.setSelectedNotes,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
    }))
  );

  const openPinnedFolder = useCallback(
    (folderPath: string) => {
      setAppMode("notes");
      setSelectedFolders(new Set([folderPath]));
      setLastSelectedFolder(folderPath);
      setActiveFolder(folderPath);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      clearDraft();
      clearNote();
    },
    [
      clearDraft,
      clearNote,
      setAppMode,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  const openNoteByPath = useCallback(
    (notePath: string) => {
      const noteParentPath = getNoteParentPath(notePath);
      setAppMode("notes");
      setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
      setLastSelectedFolder(noteParentPath);
      setActiveFolder(noteParentPath);
      setSelectedNotes(new Set([notePath]));
      setLastSelectedNote(notePath);
      setActiveNote(notePath);
    },
    [
      setAppMode,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const notePath = (event as CustomEvent<{ notePath?: string }>).detail
        ?.notePath;
      if (notePath) {
        openNoteByPath(notePath);
      }
    };
    window.addEventListener("open-note", handler);
    return () => window.removeEventListener("open-note", handler);
  }, [openNoteByPath]);

  return { openPinnedFolder };
};
