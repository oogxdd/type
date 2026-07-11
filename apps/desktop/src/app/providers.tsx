import { type ReactNode } from "react";

import { useSelection } from "@/app/state/selection-store";
import { HandwritingProvider } from "@/features/handwriting/hooks/handwriting-context";
import { clearDraft } from "@/features/notes/editor/state/editor-store";
import {
  NotesTreeProvider,
  useNotesTree,
} from "@/features/notes/navigation/state/notes-tree-context";
import { RecordingsProvider } from "@/features/recording/hooks/recordings-context";
import { GitSyncProvider } from "@/features/sync/hooks/git-sync-context";
import { AppReadinessGate, AppSecurityGate } from "./readiness";

function CaptureFeatureProviders({ children }: { children: ReactNode }) {
  const notesTree = useNotesTree();
  const activeFolder = useSelection((state) => state.activeFolder);
  const selectNote = useSelection((state) => state.selectNote);

  const handleCapturedNoteComplete = async (result: {
    folder_path: string;
    note_path: string;
  }) => {
    await notesTree.refreshTree();
    selectNote(result.note_path, result.folder_path);
    clearDraft();
  };

  return (
    <RecordingsProvider
      activeFolder={activeFolder}
      onRecordingComplete={handleCapturedNoteComplete}
    >
      <HandwritingProvider
        activeFolder={activeFolder}
        onHandwritingComplete={handleCapturedNoteComplete}
      >
        {children}
      </HandwritingProvider>
    </RecordingsProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppSecurityGate>
      <GitSyncProvider>
        <NotesTreeProvider>
          <AppReadinessGate>
            <CaptureFeatureProviders>{children}</CaptureFeatureProviders>
          </AppReadinessGate>
        </NotesTreeProvider>
      </GitSyncProvider>
    </AppSecurityGate>
  );
}
