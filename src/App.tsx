import { useRef } from "react";
import "./App.css";
import "./mobile/mobile.css";

import { ThemeProvider } from "./contexts/ThemeContext";
import { ProfilesProvider } from "./contexts/ProfilesContext";
import { GitSyncProvider } from "./contexts/GitSyncContext";
import { SelectionProvider, useSelection } from "./contexts/SelectionContext";
import { EditorProvider, useEditor } from "./contexts/EditorContext";
import { NotesTreeProvider, useNotesTree } from "./contexts/NotesTreeContext";
import { RecordingsProvider } from "./contexts/RecordingsContext";
import { HandwritingProvider } from "./contexts/HandwritingContext";
import { AppShell } from "./AppShell";
import { useLayoutMode } from "./mobile/useLayoutMode";

function AppInner() {
  const notesTree = useNotesTree();
  const selection = useSelection();
  const editor = useEditor();
  const layoutMode = useLayoutMode();
  const handleCapturedNoteComplete = async (result: {
    folder_path: string;
    note_path: string;
  }) => {
    await notesTree.refreshTree();
    selection.setSelectedFolders(new Set([result.folder_path]));
    selection.setLastSelectedFolder(result.folder_path);
    selection.setActiveFolder(result.folder_path);
    selection.setSelectedNotes(new Set([result.note_path]));
    selection.setLastSelectedNote(result.note_path);
    selection.setActiveNote(result.note_path);
    editor.clearDraft();
  };

  return (
    <RecordingsProvider
      activeFolder={selection.activeFolder}
      layoutMode={layoutMode}
      onRecordingComplete={handleCapturedNoteComplete}
    >
      <HandwritingProvider
        activeFolder={selection.activeFolder}
        layoutMode={layoutMode}
        onHandwritingComplete={handleCapturedNoteComplete}
      >
        <AppShell />
      </HandwritingProvider>
    </RecordingsProvider>
  );
}

function FlushSaveBridge({
  flushSaveRef,
}: {
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const { flushSave } = useEditor();
  flushSaveRef.current = flushSave;
  return null;
}

function App() {
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);

  return (
    <ThemeProvider>
      <ProfilesProvider flushSaveRef={flushSaveRef}>
        <GitSyncProvider>
          <SelectionProvider>
            <EditorProvider>
              <NotesTreeProvider>
                <FlushSaveBridge flushSaveRef={flushSaveRef} />
                <AppInner />
              </NotesTreeProvider>
            </EditorProvider>
          </SelectionProvider>
        </GitSyncProvider>
      </ProfilesProvider>
    </ThemeProvider>
  );
}

export default App;
