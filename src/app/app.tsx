import { useEffect, useRef, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import "./app.css";
import "@/mobile/mobile.css";

import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { AppearanceProvider, useAppearance } from "@/app/state/appearance-store";
import { ProfilesProvider, useProfiles } from "@/features/profiles/hooks/profiles-context";
import { GitSyncProvider } from "@/features/sync/hooks/git-sync-context";
import { SelectionProvider, useSelection } from "@/app/state/selection-store";
import { EditorProvider, useEditor } from "@/features/editor/hooks/editor-context";
import { NotesTreeProvider, useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { RecordingsProvider } from "@/features/recording/hooks/recordings-context";
import { HandwritingProvider } from "@/features/handwriting/hooks/handwriting-context";
import { SecurityProvider, useSecurity } from "@/features/security/hooks/security-context";
import { AppShell } from "./app-shell";
import { useLayoutMode } from "@/mobile/use-layout-mode";
import { SecurityLockScreen } from "@/features/security/components/lock-screen";
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
  const theme = useAppearance((state) => state.theme);
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
  const selection = useSelection(
    useShallow((state) => ({
      activeFolder: state.activeFolder,
      setSelectedFolders: state.setSelectedFolders,
      setLastSelectedFolder: state.setLastSelectedFolder,
      setActiveFolder: state.setActiveFolder,
      setSelectedNotes: state.setSelectedNotes,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
    }))
  );
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
  const theme = useAppearance((state) => state.theme);
  const {
    securityState,
    securityBusy,
    securityError,
    isLocked,
    unlockSecurity,
  } = useSecurity();

  if (!APP_EXTENSIONS.security) {
    return <UnlockedApp flushSaveRef={flushSaveRef} />;
  }

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
      <AppearanceProvider>
        <SecurityProvider>
          <SecurityGate flushSaveRef={flushSaveRef} />
        </SecurityProvider>
      </AppearanceProvider>
    </ErrorBoundary>
  );
}

export default App;
