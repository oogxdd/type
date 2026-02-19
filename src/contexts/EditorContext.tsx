import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useNoteEditor } from "../hooks/useNoteEditor";
import { useSelection } from "./SelectionContext";
import { useProfiles } from "./ProfilesContext";

type EditorContextValue = {
  noteContent: string;
  draftNoteContent: string;
  isNoteSaving: boolean;
  noteSaveError: string | null;
  handleEditorChange: (markdown: string) => void;
  clearNote: () => void;
  clearDraft: () => void;
  flushSave: () => Promise<void>;
  retrySave: () => Promise<void>;
  rightPaneRef: React.RefObject<HTMLDivElement | null>;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { activeProfileId, activeProfileNotesRoot } = useProfiles();
  const { activeNote } = useSelection();

  const {
    noteContent,
    draftNoteContent,
    isSaving: isNoteSaving,
    saveError: noteSaveError,
    handleEditorChange,
    clearNote,
    clearDraft,
    flushSave,
    retrySave,
  } = useNoteEditor(activeNote);

  const rightPaneRef = useRef<HTMLDivElement | null>(null);

  // Clear editor state when profile identity or notes root changes
  useEffect(() => {
    if (activeProfileId) {
      clearNote();
      clearDraft();
    }
  }, [activeProfileId, activeProfileNotesRoot, clearNote, clearDraft]);

  // Flush save on visibility/unload
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        void flushSave();
      }
    };
    const handleBeforeUnload = () => {
      void flushSave();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushSave]);

  return (
    <EditorContext.Provider
      value={{
        noteContent,
        draftNoteContent,
        isNoteSaving,
        noteSaveError,
        handleEditorChange,
        clearNote,
        clearDraft,
        flushSave,
        retrySave,
        rightPaneRef,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditor must be used within an EditorProvider");
  }
  return context;
}
