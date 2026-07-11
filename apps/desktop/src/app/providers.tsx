import { useEffect, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useSelection } from "@/app/state/selection-store";
import { HandwritingProvider } from "@/features/handwriting/hooks/handwriting-context";
import {
  EditorProvider,
  useEditor,
} from "@/features/notes/editor/hooks/editor-context";
import {
  NotesTreeProvider,
  useNotesTree,
} from "@/features/notes/navigation/state/notes-tree-context";
import { registerProfileMutationFlush } from "@/features/profiles/state/profiles-store";
import { RecordingsProvider } from "@/features/recording/hooks/recordings-context";
import { GitSyncProvider } from "@/features/sync/hooks/git-sync-context";
import { useBackgroundSave } from "./lifecycle/use-background-save";
import { AppReadinessGate, AppSecurityGate } from "./readiness";

function EditorLifecycle() {
  const { flushSave } = useEditor();
  // Pending editor saves must hit disk before a profile mutation can swap the
  // active notes root.
  useEffect(() => {
    registerProfileMutationFlush(flushSave);
  }, [flushSave]);
  useBackgroundSave(flushSave);
  return null;
}

function CaptureFeatureProviders({ children }: { children: ReactNode }) {
  const notesTree = useNotesTree();
  const selection = useSelection(
    useShallow((state) => ({
      activeFolder: state.activeFolder,
      selectNote: state.selectNote,
    }))
  );
  const editor = useEditor();

  const handleCapturedNoteComplete = async (result: {
    folder_path: string;
    note_path: string;
  }) => {
    await notesTree.refreshTree();
    selection.selectNote(result.note_path, result.folder_path);
    editor.clearDraft();
  };

  return (
    <RecordingsProvider
      activeFolder={selection.activeFolder}
      onRecordingComplete={handleCapturedNoteComplete}
    >
      <HandwritingProvider
        activeFolder={selection.activeFolder}
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
        <EditorProvider>
          <NotesTreeProvider>
            <EditorLifecycle />
            <AppReadinessGate>
              <CaptureFeatureProviders>{children}</CaptureFeatureProviders>
            </AppReadinessGate>
          </NotesTreeProvider>
        </EditorProvider>
      </GitSyncProvider>
    </AppSecurityGate>
  );
}
