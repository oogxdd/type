import type { MouseEvent as ReactMouseEvent } from "react";
import { MobileNotesScreen } from "@/mobile/views/notes-view";
import type { NoteEntry } from "@typenotes/shared/types";
import type { NotePreview } from "@typenotes/shared/format";
import { getDisplayRouteTitle } from "../types";
import { getErrorMessage } from "@typenotes/shared/errors";

type PhoneNotesScreenProps = {
  folderPath: string;
  activeFolderTitle: string;
  notes: NoteEntry[];
  notePreviews: Record<string, NotePreview>;
  activeNote: string | null;
  openEditorRoute: (notePath: string, folderPath?: string) => void;
  createNewNote: (
    preferredFolderPath?: string,
    initialContent?: string
  ) => Promise<string | null>;
  showToast: (message: string, tone?: "info" | "success" | "error") => void;
  onDeleteNote: (path: string) => Promise<boolean>;
  onArchiveNote: (path: string) => Promise<void>;
  openNoteActionSheet: (path: string) => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath?: string
  ) => Promise<void>;
  refreshNotesFeed: (folderPath: string) => Promise<void>;
};

export function PhoneNotesScreen({
  folderPath,
  activeFolderTitle,
  notes,
  notePreviews,
  activeNote,
  openEditorRoute,
  createNewNote,
  showToast,
  onDeleteNote,
  onArchiveNote,
  openNoteActionSheet,
  onNoteContextMenu,
  refreshNotesFeed,
}: PhoneNotesScreenProps) {
  return (
    <MobileNotesScreen
      folderTitle={activeFolderTitle}
      notes={notes}
      previews={notePreviews}
      activeNote={activeNote}
      onSelect={(path) => {
        openEditorRoute(path, folderPath);
      }}
      onCreate={() => {
        void (async () => {
          const path = await createNewNote(folderPath);
          if (!path) {
            return;
          }
          openEditorRoute(path, folderPath);
        })();
      }}
      onDelete={(path) => {
        void (async () => {
          try {
            const deleted = await onDeleteNote(path);
            if (deleted) {
              showToast("Note deleted", "success");
            }
          } catch (error) {
            const message = getErrorMessage(error);
            showToast(message, "error");
          }
        })();
      }}
      onArchive={(path) => {
        void (async () => {
          try {
            await onArchiveNote(path);
            showToast("Moved to Archive", "success");
          } catch (error) {
            const message = getErrorMessage(error);
            showToast(message, "error");
          }
        })();
      }}
      onLongPress={openNoteActionSheet}
      onContextMenu={(event, path) => {
        void onNoteContextMenu(event, path, folderPath);
      }}
      onPullRefresh={async () => {
        await refreshNotesFeed(folderPath);
      }}
      emptyStateText={`No notes in ${getDisplayRouteTitle(activeFolderTitle)}.`}
      createButtonLabel="Create note"
    />
  );
}
