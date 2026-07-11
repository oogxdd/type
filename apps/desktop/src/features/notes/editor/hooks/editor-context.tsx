import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useNoteEditor } from "./use-note-editor";
import { useSelection } from "@/app/state/selection-store";
import {
  selectActiveProfileId,
  selectActiveProfileNotesRoot,
  selectSyncSettings,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";

type EditorContextValue = {
  noteContent: string;
  draftNoteContent: string;
  isNoteSaving: boolean;
  noteSaveError: string | null;
  handleEditorChange: (markdown: string) => void;
  clearNote: () => void;
  clearDraft: () => void;
  primeNoteContent: (markdown: string) => void;
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
  const activeProfileId = useProfilesStore(selectActiveProfileId);
  const activeProfileNotesRoot = useProfilesStore(selectActiveProfileNotesRoot);
  const syncSettings = useProfilesStore(selectSyncSettings);
  const activeNote = useSelection((state) => state.activeNote);

  const {
    noteContent,
    draftNoteContent,
    isSaving: isNoteSaving,
    saveError: noteSaveError,
    handleEditorChange,
    clearNote,
    clearDraft,
    primeNoteContent,
    flushSave,
    retrySave,
  } = useNoteEditor(activeNote, syncSettings.noteFileNameFormat);

  const rightPaneRef = useRef<HTMLDivElement | null>(null);

  // Clear editor state when profile identity or notes root changes
  useEffect(() => {
    if (activeProfileId) {
      clearNote();
      clearDraft();
    }
  }, [activeProfileId, activeProfileNotesRoot, clearNote, clearDraft]);

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
        primeNoteContent,
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
