import { useEffect, useRef, type ReactNode } from "react";
import "./App.css";
import "./mobile/mobile.css";

import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { ProfilesProvider, useProfiles } from "./contexts/ProfilesContext";
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
import { hideLaunchSplash } from "./utils/launchScreen";

function StartupScreen({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className={`startup-screen startup-screen-${theme}`} aria-label="Starting Type">
      <img className="startup-logo" src="/type-splash-logo.png" alt="Type logo" />
    </div>
  );
}

function LaunchReveal({ children }: { children: ReactNode }) {
  useEffect(() => {
    hideLaunchSplash();
  }, []);

  return <>{children}</>;
}

function AppReadyGate({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const { profilesSnapshot, activeProfileId } = useProfiles();
  const { tree } = useNotesTree();

  const appReady = Boolean(profilesSnapshot) && (!activeProfileId || Boolean(tree));
  if (!appReady) {
    return <StartupScreen theme={theme} />;
  }

  return <LaunchReveal>{children}</LaunchReveal>;
}

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
              <AppReadyGate>
                <AppInner />
              </AppReadyGate>
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
  const { theme } = useTheme();
  const {
    securityState,
    securityBusy,
    securityError,
    isLocked,
    unlockSecurity,
  } = useSecurity();

  if (!securityState) {
    return <StartupScreen theme={theme} />;
  }

  if (securityState.encryption_enabled && isLocked) {
    return (
      <LaunchReveal>
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
      </LaunchReveal>
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
