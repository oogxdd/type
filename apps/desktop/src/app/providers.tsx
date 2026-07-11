import { type ReactNode } from "react";

import { useSelection } from "@/state/selection-store";
import { HandwritingProvider } from "@/state/handwriting-context";
import { clearDraft } from "@/state/editor-store";
import { refreshTree } from "@/state/notes-store";
import { RecordingsProvider } from "@/state/recordings-context";
import { GitSyncProvider } from "@/state/git-sync-context";
import { AppReadinessGate, AppSecurityGate } from "./readiness";

// Capture flows (recording, handwriting) end in the same place: the new note
// becomes the selection and any scratch draft is dropped.
const handleCapturedNoteComplete = async (result: {
  folder_path: string;
  note_path: string;
}) => {
  await refreshTree();
  useSelection.getState().selectNote(result.note_path, result.folder_path);
  clearDraft();
};

function CaptureFeatureProviders({ children }: { children: ReactNode }) {
  const activeFolder = useSelection((state) => state.activeFolder);

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
        <AppReadinessGate>
          <CaptureFeatureProviders>{children}</CaptureFeatureProviders>
        </AppReadinessGate>
      </GitSyncProvider>
    </AppSecurityGate>
  );
}
