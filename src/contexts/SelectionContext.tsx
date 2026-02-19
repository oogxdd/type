import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSessions } from "./SessionsContext";
import { getNoteParentPath } from "../utils/notes";

type SelectionContextValue = {
  selectedFolders: Set<string>;
  setSelectedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  lastSelectedFolder: string;
  setLastSelectedFolder: (path: string) => void;
  activeFolder: string;
  setActiveFolder: (path: string) => void;
  selectedNotes: Set<string>;
  setSelectedNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
  lastSelectedNote: string;
  setLastSelectedNote: (path: string) => void;
  activeNote: string | null;
  setActiveNote: (path: string | null) => void;
  selectFolderForMobile: (path: string) => void;
  selectNoteForMobile: (notePath: string) => void;
  enterMobileHome: () => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { activeSessionId, activeSessionNotesRoot } = useSessions();

  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [lastSelectedFolder, setLastSelectedFolder] = useState("");
  const [activeFolder, setActiveFolder] = useState("");
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [lastSelectedNote, setLastSelectedNote] = useState("");
  const [activeNote, setActiveNote] = useState<string | null>(null);

  // Reset selection state when active session or notes root changes
  useEffect(() => {
    if (activeSessionId) {
      setSelectedFolders(new Set());
      setLastSelectedFolder("");
      setActiveFolder("");
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
    }
  }, [activeSessionId, activeSessionNotesRoot]);

  // -- Debug logging
  useEffect(() => {
    console.log("[folders] selectedFolders", Array.from(selectedFolders));
  }, [selectedFolders]);

  useEffect(() => {
    console.log("[folders] activeFolder", activeFolder);
  }, [activeFolder]);

  const selectFolderForMobile = useCallback((path: string) => {
    if (!path) return;
    setSelectedFolders(new Set([path]));
    setLastSelectedFolder(path);
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
  }, []);

  const selectNoteForMobile = useCallback((notePath: string) => {
    const parentPath = getNoteParentPath(notePath);
    setSelectedFolders(new Set(parentPath ? [parentPath] : []));
    setLastSelectedFolder(parentPath);
    setActiveFolder(parentPath);
    setSelectedNotes(new Set([notePath]));
    setLastSelectedNote(notePath);
    setActiveNote(notePath);
  }, []);

  const enterMobileHome = useCallback(() => {
    setSelectedFolders(new Set());
    setLastSelectedFolder("");
    setActiveFolder("");
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
  }, []);

  return (
    <SelectionContext.Provider
      value={{
        selectedFolders,
        setSelectedFolders,
        lastSelectedFolder,
        setLastSelectedFolder,
        activeFolder,
        setActiveFolder,
        selectedNotes,
        setSelectedNotes,
        lastSelectedNote,
        setLastSelectedNote,
        activeNote,
        setActiveNote,
        selectFolderForMobile,
        selectNoteForMobile,
        enterMobileHome,
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return context;
}
