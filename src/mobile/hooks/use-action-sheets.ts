import { useCallback, useState } from "react";
import type { MobileActionSheetState, MobileToastState } from "../navigation";
import type { SheetContext } from "../types";
import { SYSTEM_FOLDER_PATHS, getDisplayFolderName } from "../types";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { getErrorMessage } from "@/shared/lib/errors";

export function useActionSheets(showToast: (message: string, tone?: MobileToastState["tone"]) => void) {
  const {
    setExpanded,
    deleteNotes,
    deleteFolders,
    moveNotesToArchive,
    showNoteInfo,
    renameFolderFromMobile,
  } = useNotesTree();

  const [sheetState, setSheetState] = useState<MobileActionSheetState | null>(null);
  const [sheetContext, setSheetContext] = useState<SheetContext | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    path: string;
    currentName: string;
  } | null>(null);

  const closeActionSheet = useCallback(() => {
    setSheetState(null);
    setSheetContext(null);
  }, []);

  const openFolderActionSheet = useCallback((path: string) => {
    const folderName = path.split("/").pop() || path;
    const isSystemFolder = SYSTEM_FOLDER_PATHS.has(path);
    setSheetContext({ type: "folder", path });
    setSheetState({
      open: true,
      title: "Folder actions",
      subtitle: getDisplayFolderName(folderName),
      actions: [
        {
          id: "folder.rename",
          label: isSystemFolder ? "Rename (Unavailable)" : "Rename",
          disabled: isSystemFolder,
        },
        {
          id: "folder.delete",
          label: isSystemFolder ? "Delete (Unavailable)" : "Delete",
          destructive: true,
          disabled: isSystemFolder,
        },
      ],
    });
  }, []);

  const openNoteActionSheet = useCallback((path: string) => {
    setSheetContext({ type: "note", path });
    setSheetState({
      open: true,
      title: "Note actions",
      subtitle: (path.split("/").pop() || path).replace(/\.md$/i, ""),
      actions: [
        { id: "note.info", label: "Info" },
        { id: "note.archive", label: "Archive" },
        { id: "note.delete", label: "Delete", destructive: true },
      ],
    });
  }, []);

  const onDeleteFolder = useCallback(
    async (path: string) => {
      await deleteFolders([path]);
    },
    [deleteFolders]
  );

  const onDeleteNote = useCallback(
    async (path: string) => {
      return deleteNotes([path]);
    },
    [deleteNotes]
  );

  const onArchiveNote = useCallback(
    async (path: string) => {
      await moveNotesToArchive([path]);
    },
    [moveNotesToArchive]
  );

  const onToggleFolder = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    },
    [setExpanded]
  );

  const onSheetSelect = useCallback(
    async (actionId: string) => {
      const context = sheetContext;
      closeActionSheet();
      if (!context) {
        return;
      }
      try {
        if (context.type === "folder") {
          if (actionId === "folder.rename") {
            setRenamePrompt({
              path: context.path,
              currentName: context.path.split("/").pop() || context.path,
            });
            return;
          }
          if (actionId === "folder.delete") {
            await onDeleteFolder(context.path);
            showToast("Folder deleted", "success");
            return;
          }
          return;
        }

        if (actionId === "note.info") {
          await showNoteInfo(context.path);
          return;
        }
        if (actionId === "note.archive") {
          await onArchiveNote(context.path);
          showToast("Moved to Archive", "success");
          return;
        }
        if (actionId === "note.delete") {
          const deleted = await onDeleteNote(context.path);
          if (deleted) {
            showToast("Note deleted", "success");
          }
        }
      } catch (error) {
        const message = getErrorMessage(error);
        showToast(message, "error");
      }
    },
    [
      closeActionSheet,
      onArchiveNote,
      onDeleteFolder,
      onDeleteNote,
      showNoteInfo,
      sheetContext,
      showToast,
    ]
  );

  const onRenameConfirm = useCallback(
    async (nextName: string) => {
      if (!renamePrompt) {
        return;
      }
      try {
        await renameFolderFromMobile(renamePrompt.path, nextName);
        setRenamePrompt(null);
        showToast("Folder renamed", "success");
      } catch (error) {
        const message = getErrorMessage(error);
        showToast(message, "error");
      }
    },
    [renameFolderFromMobile, renamePrompt, showToast]
  );

  return {
    sheetState,
    sheetContext,
    renamePrompt,
    setRenamePrompt,
    closeActionSheet,
    openFolderActionSheet,
    openNoteActionSheet,
    onDeleteNote,
    onArchiveNote,
    onToggleFolder,
    onSheetSelect,
    onRenameConfirm,
  };
}
