import { useRef } from "react";
import "./App.css";
import "./mobile/mobile.css";

import { ThemeProvider } from "./contexts/ThemeContext";
import { SessionsProvider } from "./contexts/SessionsContext";
import { GitSyncProvider } from "./contexts/GitSyncContext";
import { NotesTreeProvider, useNotesTree } from "./contexts/NotesTreeContext";
import { RecordingsProvider } from "./contexts/RecordingsContext";
import { AppShell } from "./AppShell";
import { useLayoutMode } from "./mobile/useLayoutMode";

function AppInner() {
  const notesTree = useNotesTree();
  const layoutMode = useLayoutMode();

  return (
    <RecordingsProvider
      activeFolder={notesTree.activeFolder}
      layoutMode={layoutMode}
      onRecordingComplete={async (result) => {
        await notesTree.refreshTree();
        notesTree.setSelectedFolders(new Set([result.folder_path]));
        notesTree.setLastSelectedFolder(result.folder_path);
        notesTree.setActiveFolder(result.folder_path);
        notesTree.setSelectedNotes(new Set([result.note_path]));
        notesTree.setLastSelectedNote(result.note_path);
        notesTree.setActiveNote(result.note_path);
        notesTree.clearDraft();
      }}
    >
      <AppShell />
    </RecordingsProvider>
  );
}

function FlushSaveBridge({
  flushSaveRef,
}: {
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const { flushSave } = useNotesTree();
  flushSaveRef.current = flushSave;
  return null;
}

function App() {
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);

  return (
    <ThemeProvider>
      <SessionsProvider flushSaveRef={flushSaveRef}>
        <GitSyncProvider>
          <NotesTreeProvider>
            <FlushSaveBridge flushSaveRef={flushSaveRef} />
            <AppInner />
          </NotesTreeProvider>
        </GitSyncProvider>
      </SessionsProvider>
    </ThemeProvider>
  );
}

export default App;
