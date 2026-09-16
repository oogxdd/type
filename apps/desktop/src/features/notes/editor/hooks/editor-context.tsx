import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import type { DocumentSession } from "../lib/document-session";
import { useNoteEditor } from "./use-note-editor";
import { useSelection } from "@/app/state/selection-store";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";

type EditorContextValue = {
  session: DocumentSession;
  noteContent: string;
  loadedNotePath: string | null;
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
  const { activeProfileId, activeProfileNotesRoot, syncSettings } = useProfiles();
  const activeNote = useSelection((state) => state.activeNote);
  const selectedNotes = useSelection((state) => state.selectedNotes);

  const {
    session,
    noteContent,
    loadedNotePath,
    draftNoteContent,
    isSaving: isNoteSaving,
    saveError: noteSaveError,
    handleEditorChange,
    clearNote,
    clearDraft,
    primeNoteContent,
    flushSave,
    retrySave,
  } = useNoteEditor(activeNote, syncSettings.noteFileNameFormat,
    selectedNotes.size ? [...selectedNotes] : activeNote ? [activeNote] : [],
    JSON.stringify([activeProfileId, activeProfileNotesRoot]));

  const rightPaneRef = useRef<HTMLDivElement | null>(null);

  return (
    <EditorContext.Provider
      value={{
        session,
        noteContent,
        loadedNotePath,
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
