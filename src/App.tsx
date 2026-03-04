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
import { SecurityProvider, useSecurity } from "./contexts/SecurityContext";
import { AppShell } from "./AppShell";
import { useLayoutMode } from "./mobile/useLayoutMode";
import { SecurityLockScreen } from "./components/SecurityLockScreen";

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

function UnlockedApp({
  flushSaveRef,
}: {
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  return (
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
  );
}

function SecurityGate({
  flushSaveRef,
}: {
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const {
    securityState,
    securityBusy,
    securityError,
    isLocked,
    unlockSecurity,
  } = useSecurity();

  if (!securityState) {
    return <div className="security-lock-screen">Loading security...</div>;
  }

  if (securityState.encryption_enabled && isLocked) {
    return (
      <SecurityLockScreen
        busy={securityBusy}
        error={securityError}
        onUnlock={async (password) => {
          const result = await unlockSecurity(password);
          if (!result.unlocked) {
            return;
          }
        }}
      />
    );
  }

  return <UnlockedApp flushSaveRef={flushSaveRef} />;
}

function App() {
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);

  return (
    <ThemeProvider>
      <SecurityProvider>
        <SecurityGate flushSaveRef={flushSaveRef} />
      </SecurityProvider>
    </ThemeProvider>
  );
}

export default App;
