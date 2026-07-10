import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
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
  const { selectFolder, selectNote } = useSelection(
    useShallow((state) => ({
      selectFolder: state.selectFolder,
      selectNote: state.selectNote,
    }))
  );

  const openPinnedFolder = useCallback(
    (folderPath: string) => {
      setAppMode("notes");
      selectFolder(folderPath);
      clearDraft();
      clearNote();
    },
    [clearDraft, clearNote, selectFolder, setAppMode]
  );

  const openNoteByPath = useCallback(
    (notePath: string) => {
      setAppMode("notes");
      selectNote(notePath);
    },
    [selectNote, setAppMode]
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
