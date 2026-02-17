import { useRef } from "react";
import "./App.css";
import "./mobile/mobile.css";

import { ThemeProvider } from "./contexts/ThemeContext";
import { SessionsProvider } from "./contexts/SessionsContext";
import { GitSyncProvider } from "./contexts/GitSyncContext";
import { SelectionProvider, useSelection } from "./contexts/SelectionContext";
import { EditorProvider, useEditor } from "./contexts/EditorContext";
import { NotesTreeProvider, useNotesTree } from "./contexts/NotesTreeContext";
import { RecordingsProvider } from "./contexts/RecordingsContext";
import { AppShell } from "./AppShell";
import { useLayoutMode } from "./mobile/useLayoutMode";

function AppInner() {
  const notesTree = useNotesTree();
  const selection = useSelection();
  const editor = useEditor();
  const layoutMode = useLayoutMode();

  return (
    <RecordingsProvider
      activeFolder={selection.activeFolder}
      layoutMode={layoutMode}
      onRecordingComplete={async (result) => {
        await notesTree.refreshTree();
        selection.setSelectedFolders(new Set([result.folder_path]));
        selection.setLastSelectedFolder(result.folder_path);
        selection.setActiveFolder(result.folder_path);
        selection.setSelectedNotes(new Set([result.note_path]));
        selection.setLastSelectedNote(result.note_path);
        selection.setActiveNote(result.note_path);
        editor.clearDraft();
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
  const { flushSave } = useEditor();
  flushSaveRef.current = flushSave;
  return null;
}

function App() {
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);

  return (
    <ThemeProvider>
      <SessionsProvider flushSaveRef={flushSaveRef}>
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
      </SessionsProvider>
    </ThemeProvider>
  );
}

export default App;
