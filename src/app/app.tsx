import { useEffect, useRef, type ReactNode } from "react";
import "./app.css";
import "@/mobile/mobile.css";

import { ThemeProvider, useTheme } from "@/contexts/theme-context";
import { ProfilesProvider, useProfiles } from "@/contexts/profiles-context";
import { GitSyncProvider } from "@/contexts/git-sync-context";
import { SelectionProvider, useSelection } from "@/contexts/selection-context";
import { EditorProvider, useEditor } from "@/contexts/editor-context";
import { NotesTreeProvider, useNotesTree } from "@/contexts/notes-tree-context";
import { RecordingsProvider } from "@/contexts/recordings-context";
import { HandwritingProvider } from "@/contexts/handwriting-context";
import { SecurityProvider, useSecurity } from "@/contexts/security-context";
import { AppShell } from "./app-shell";
import { useLayoutMode } from "@/mobile/use-layout-mode";
import { SecurityLockScreen } from "@/features/security/lock-screen";
import { ErrorBoundary } from "./error-boundary";
import { hideLaunchSplash } from "./launch-screen";

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
            await unlockSecurity(password);
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
    <ErrorBoundary>
      <ThemeProvider>
        <SecurityProvider>
          <SecurityGate flushSaveRef={flushSaveRef} />
        </SecurityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
