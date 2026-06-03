import type { MouseEvent as ReactMouseEvent } from "react";
import { MobileNotesScreen } from "@/mobile/views/notes-view";
import type { NotePreview } from "@/shared/lib/format";
import type { RecentBucket } from "@/mobile/hooks/use-recent-buckets";

type PhoneRecentDateScreenProps = {
  bucketId: string;
  recentBucketById: Map<string, RecentBucket>;
  allNotePreviews: Record<string, NotePreview>;
  activeNote: string | null;
  openEditorRoute: (notePath: string, folderPath?: string) => void;
  createNewNote: (
    preferredFolderPath?: string,
    initialContent?: string,
    targetTimestampMs?: number
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
  refreshTree: () => Promise<void>;
};

export function PhoneRecentDateScreen({
  bucketId,
  recentBucketById,
  allNotePreviews,
  activeNote,
  openEditorRoute,
  createNewNote,
  showToast,
  onDeleteNote,
  onArchiveNote,
  openNoteActionSheet,
  onNoteContextMenu,
  refreshTree,
}: PhoneRecentDateScreenProps) {
  const bucket = recentBucketById.get(bucketId);
  const bucketNotes = bucket?.notes ?? [];
  const bucketTitle = bucket?.label ?? "Recent";

  return (
    <MobileNotesScreen
      folderTitle={bucketTitle}
      notes={bucketNotes}
      previews={allNotePreviews}
      activeNote={activeNote}
      onSelect={(path) => {
        openEditorRoute(path);
      }}
      onCreate={() => {
        void (async () => {
          const path = await createNewNote(undefined, "", bucket?.dayEndMs ?? undefined);
          if (!path) {
            return;
          }
          openEditorRoute(path);
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
            const message = error instanceof Error ? error.message : String(error);
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
            const message = error instanceof Error ? error.message : String(error);
            showToast(message, "error");
          }
        })();
      }}
      onLongPress={openNoteActionSheet}
      onContextMenu={(event, path) => {
        void onNoteContextMenu(event, path);
      }}
      onPullRefresh={async () => {
        await refreshTree();
      }}
      emptyStateText={`No notes in ${bucketTitle}.`}
      createButtonLabel="Create note"
    />
  );
}
