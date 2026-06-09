import { useEffect, useMemo, useState } from "react";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { isSystemFolder } from "@/shared/constants";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { type DesktopContextMenuState } from "@/app/hooks/use-tree-interactions";

type DesktopContextMenuProps = {
  state: DesktopContextMenuState | null;
  onClose: () => void;
};

export function DesktopContextMenu({ state, onClose }: DesktopContextMenuProps) {
  const {
    startRenameFolder,
    deleteFolders,
    flattenIntoFeed,
    moveNotesToArchive,
    moveNotesToFolder,
    updateNoteMarkers,
    deleteNotes,
    showNoteInfo,
    allNotePreviews,
  } = useNotesTree();
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [destinationPath, setDestinationPath] = useState("");

  useEffect(() => {
    if (!state) {
      setMoveDialogOpen(false);
      setDestinationPath("");
    }
  }, [state]);

  const closeAll = () => {
    setMoveDialogOpen(false);
    setDestinationPath("");
    onClose();
  };

  const notePreview = state?.kind === "note" ? allNotePreviews[state.path] : null;
  const noteSelectedCount = state?.kind === "note" ? state.targetPaths.length : 0;
  const allArchived =
    state?.kind === "note" &&
    state.targetPaths.length > 0 &&
    state.targetPaths.every((path) => allNotePreviews[path]?.isArchived);
  const allReviewed =
    state?.kind === "note" &&
    state.targetPaths.length > 0 &&
    state.targetPaths.every((path) => allNotePreviews[path]?.isReviewed);

  const menuItems = useMemo(() => {
    if (!state) {
      return [];
    }

    if (state.kind === "folder") {
      const canRename = state.targetPaths.length === 1 && !isSystemFolder(state.targetPaths[0]);
      const canDelete = !state.targetPaths.some(isSystemFolder);
      return [
        {
          id: "folder.rename",
          label: "Rename folder",
          disabled: !canRename,
          run: () => {
            if (!canRename) return;
            startRenameFolder(state.targetPaths[0]);
            closeAll();
          },
        },
        {
          id: "folder.flatten",
          label: state.targetPaths.length > 1 ? "Move notes in folders to Feed" : "Move notes in folder to Feed",
          disabled: state.targetPaths.length === 0,
          run: () => {
            void flattenIntoFeed(state.targetPaths, []);
            closeAll();
          },
        },
        {
          id: "folder.delete",
          label: canDelete ? "Delete folder(s)" : "Delete (Unavailable)",
          disabled: !canDelete,
          destructive: true,
          run: () => {
            if (!canDelete) return;
            void deleteFolders(state.targetPaths);
            closeAll();
          },
        },
      ];
    }

    const archivedLabel = allArchived ? "Unarchive" : "Archive";
    const reviewedLabel = allReviewed ? "Mark unreviewed" : "Mark reviewed";
    return [
      {
        id: "note.move.folder",
        label:
          noteSelectedCount > 1
            ? `Move ${noteSelectedCount} notes to folder...`
            : "Move note to folder...",
        run: () => {
          setMoveDialogOpen(true);
        },
      },
      {
        id: "note.move.archive",
        label: "Move to Archive",
        run: () => {
          void moveNotesToArchive(state.targetPaths);
          closeAll();
        },
      },
      {
        id: "note.archive",
        label: archivedLabel,
        run: () => {
          void updateNoteMarkers(state.targetPaths, {
            archived: allArchived ? null : true,
          });
          closeAll();
        },
      },
      {
        id: "note.reviewed",
        label: reviewedLabel,
        run: () => {
          void updateNoteMarkers(state.targetPaths, {
            reviewed: allReviewed ? null : true,
          });
          closeAll();
        },
      },
      {
        id: "note.info",
        label: "See info",
        run: () => {
          void showNoteInfo(state.path);
          closeAll();
        },
      },
      {
        id: "note.delete",
        label: noteSelectedCount > 1 ? `Delete ${noteSelectedCount} notes` : "Delete selected",
        destructive: true,
        run: () => {
          void deleteNotes(state.targetPaths);
          closeAll();
        },
      },
    ];
  }, [
    allArchived,
    allReviewed,
    closeAll,
    deleteFolders,
    deleteNotes,
    flattenIntoFeed,
    moveNotesToArchive,
    noteSelectedCount,
    showNoteInfo,
    startRenameFolder,
    state,
    updateNoteMarkers,
  ]);

  const onSubmitMove = async () => {
    if (!state) {
      return;
    }
    const nextDestination = destinationPath.trim();
    if (!nextDestination) {
      return;
    }
    await moveNotesToFolder(state.targetPaths, nextDestination);
    closeAll();
  };

  return (
    <>
      <DropdownMenu
        open={Boolean(state)}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        modal={false}
      >
        {state ? (
          <DropdownMenuTrigger asChild>
            <button
              aria-hidden
              className="fixed size-0"
              style={{ left: state.x, top: state.y, position: "fixed" }}
              tabIndex={-1}
              type="button"
            />
          </DropdownMenuTrigger>
        ) : null}
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          className="w-72"
        >
          {menuItems.map((item, index) => (
            <div key={item.id}>
              {index === 2 && state?.kind === "folder" ? <DropdownMenuSeparator /> : null}
              {index === 0 && state?.kind === "note" ? null : null}
              <DropdownMenuItem
                disabled={"disabled" in item ? item.disabled : false}
                variant={item.destructive ? "destructive" : "default"}
                onSelect={(event) => {
                  event.preventDefault();
                  item.run();
                }}
              >
                {item.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={moveDialogOpen}
        onOpenChange={(open) => {
          setMoveDialogOpen(open);
          if (!open) {
            setDestinationPath("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move notes to folder</DialogTitle>
            <DialogDescription>
              Enter a folder path. Missing folders will be created.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              autoFocus
              value={destinationPath}
              onChange={(event) => setDestinationPath(event.target.value)}
              placeholder="Events/Wedding/Photos"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onSubmitMove();
                }
              }}
            />
            {notePreview ? (
              <div className="text-xs text-muted-foreground">
                {notePreview.title || notePreview.dateLabel || "Selected note"}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMoveDialogOpen(false);
                setDestinationPath("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void onSubmitMove()}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
