import { useRef, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { AppearanceProvider } from "@/app/state/appearance-store";
import { SelectionProvider, useSelection } from "@/app/state/selection-store";
import { EditorProvider, useEditor } from "@/features/editor/hooks/editor-context";
import { HandwritingProvider } from "@/features/handwriting/hooks/handwriting-context";
import { NotesTreeProvider, useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { ProfilesProvider } from "@/features/profiles/hooks/profiles-context";
import { RecordingsProvider } from "@/features/recording/hooks/recordings-context";
import { SecurityProvider } from "@/features/security/hooks/security-context";
import { GitSyncProvider } from "@/features/sync/hooks/git-sync-context";
import { useLayoutMode } from "@/mobile/use-layout-mode";
import { useBackgroundSave } from "./lifecycle/use-background-save";
import { AppReadinessGate, AppSecurityGate } from "./readiness";

function FlushSaveBridge({
  flushSaveRef,
}: {
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const { flushSave } = useEditor();
  flushSaveRef.current = flushSave;
  return null;
}

function AppLifecycle() {
  const { flushSave } = useEditor();
  useBackgroundSave(flushSave);
  return null;
}

function CaptureFeatureProviders({ children }: { children: ReactNode }) {
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
        {children}
      </HandwritingProvider>
    </RecordingsProvider>
  );
}

function UnlockedAppProviders({
  children,
  flushSaveRef,
}: {
  children: ReactNode;
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  return (
    <ProfilesProvider flushSaveRef={flushSaveRef}>
      <GitSyncProvider>
        <SelectionProvider>
          <EditorProvider>
            <NotesTreeProvider>
              <FlushSaveBridge flushSaveRef={flushSaveRef} />
              <AppLifecycle />
              <AppReadinessGate>
                <CaptureFeatureProviders>{children}</CaptureFeatureProviders>
              </AppReadinessGate>
            </NotesTreeProvider>
          </EditorProvider>
        </SelectionProvider>
      </GitSyncProvider>
    </ProfilesProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);

  return (
    <AppearanceProvider>
      <SecurityProvider>
        <AppSecurityGate>
          <UnlockedAppProviders flushSaveRef={flushSaveRef}>
            {children}
          </UnlockedAppProviders>
        </AppSecurityGate>
      </SecurityProvider>
    </AppearanceProvider>
  );
}
