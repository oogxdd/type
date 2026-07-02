// Write side of the notes navigation slice.
import { useCallback, type RefObject } from "react";

import * as api from "@/features/notes/api/notes-api";
import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
  isSystemFolder,
} from "@typenotes/shared/constants";
import { confirmAction, focusNoScroll } from "@/shared/lib/dom";
import { getNoteParentPath } from "@typenotes/shared/notes";
import type { ProfileSyncSettings } from "@typenotes/shared/types";
import { applyFolderRenameToSelection, collectNotesForFlattening } from "../model/notes-tree-model";
import { findNode } from "@/features/notes/navigation/model/tree-ops";
import type { FolderNode } from "@typenotes/shared/types";

type UseNotesTreeActionsArgs = {
  tree: FolderNode | null;
  syncSettings: ProfileSyncSettings;
  refreshTree: () => Promise<void>;
  rightPaneRef: RefObject<HTMLDivElement | null>;
  selectedFolders: Set<string>;
  setSelectedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedFolder: (path: string) => void;
  activeFolder: string;
  setActiveFolder: (path: string) => void;
  setSelectedNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedNote: (path: string) => void;
  activeNote: string | null;
  setActiveNote: (path: string | null) => void;
  clearDraft: () => void;
  clearNote: () => void;
  renamingFolder: string | null;
  setRenamingFolder: (path: string | null) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
};

export function useNotesTreeActions({
  tree,
  syncSettings,
  refreshTree,
  rightPaneRef,
  selectedFolders,
  setSelectedFolders,
  setLastSelectedFolder,
  activeFolder,
  setActiveFolder,
  setSelectedNotes,
  setLastSelectedNote,
  activeNote,
  setActiveNote,
  clearDraft,
  clearNote,
  renamingFolder,
  setRenamingFolder,
  renameValue,
  setRenameValue,
}: UseNotesTreeActionsArgs) {
  const createNewNote = useCallback(
    async (
      preferredFolderPath?: string,
      initialContent = "",
      targetTimestampMs?: number
    ) => {
      const treeSnapshot = tree ?? (await api.getTree());
      const initialFolderPath = preferredFolderPath?.trim() || FEED_FOLDER_PATH;
      const targetNode =
        findNode(treeSnapshot, initialFolderPath) || findNode(treeSnapshot, FEED_FOLDER_PATH);
      if (!targetNode) return null;
      const folderPath = targetNode.path;
      const created = await api.createNote(
        folderPath,
        initialContent,
        targetTimestampMs,
        syncSettings.noteFileNameFormat
      );
      const path = created.path;
      await refreshTree();

      // New note creation is a workflow, not just a write: refresh the tree,
      // sync selection, and hand focus to the editor in one pass.
      setSelectedFolders(new Set([folderPath]));
      setLastSelectedFolder(folderPath);
      setActiveFolder(folderPath);
      setSelectedNotes(new Set([path]));
      setLastSelectedNote(path);
      setActiveNote(path);
      clearDraft();

      requestAnimationFrame(() => {
        const editorElement =
          rightPaneRef.current?.querySelector<HTMLElement>(
            ".tiptap-content[contenteditable='true']"
          ) || rightPaneRef.current;
        focusNoScroll(editorElement);
      });

      return path;
    },
    [
      clearDraft,
      refreshTree,
      rightPaneRef,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      syncSettings.noteFileNameFormat,
      tree,
    ]
  );

  const applyFolderRename = useCallback(
    (oldPath: string, newPath: string) => {
      const next = applyFolderRenameToSelection(
        activeFolder,
        selectedFolders,
        oldPath,
        newPath
      );
      setActiveFolder(next.activeFolder);
      if (next.selectedFolderChanged) {
        setSelectedFolders(next.selectedFolders);
        setLastSelectedFolder(newPath);
      }
    },
    [activeFolder, selectedFolders, setActiveFolder, setLastSelectedFolder, setSelectedFolders]
  );

  const startRenameFolder = useCallback(
    (path: string) => {
      if (isSystemFolder(path)) {
        window.alert(`"${path}" is a fixed folder and cannot be renamed.`);
        return;
      }
      const name = path.split("/").pop() || "";
      setRenamingFolder(path);
      setRenameValue(name);
    },
    [setRenamingFolder, setRenameValue]
  );

  const submitRenameFolder = useCallback(async () => {
    if (!renamingFolder || !renameValue.trim()) {
      setRenamingFolder(null);
      return;
    }
    const oldPath = renamingFolder;
    const newPath = await api.renameItem(oldPath, renameValue.trim());
    setRenamingFolder(null);
    setRenameValue("");
    await refreshTree();
    applyFolderRename(oldPath, newPath);
  }, [applyFolderRename, refreshTree, renamingFolder, renameValue, setRenamingFolder, setRenameValue]);

  const cancelRenameFolder = useCallback(() => {
    setRenamingFolder(null);
    setRenameValue("");
  }, [setRenamingFolder, setRenameValue]);

  const deleteFolders = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      if (paths.some(isSystemFolder)) {
        window.alert(`"Feed" and "Archieve" are fixed folders and cannot be deleted.`);
        return;
      }
      const confirmed = await confirmAction(`Delete ${paths.length} folder(s)?`);
      if (!confirmed) return;
      await api.deleteItems(paths);
      setSelectedFolders(new Set());
      if (paths.includes(activeFolder)) setActiveFolder("");
      await refreshTree();
    },
    [activeFolder, refreshTree, setActiveFolder, setSelectedFolders]
  );

  const deleteNotes = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return false;
      const confirmed = await confirmAction(`Delete ${paths.length} note(s)?`);
      if (!confirmed) return false;
      await api.deleteItems(paths);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      if (paths.includes(activeNote || "")) {
        setActiveNote(null);
        clearNote();
      }
      await refreshTree();
      return true;
    },
    [activeNote, clearNote, refreshTree, setActiveNote, setLastSelectedNote, setSelectedNotes]
  );

  const moveNotesToArchive = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      await api.moveItems(paths, ARCHIEVE_FOLDER_PATH);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      clearNote();
      setSelectedFolders(new Set([ARCHIEVE_FOLDER_PATH]));
      setLastSelectedFolder(ARCHIEVE_FOLDER_PATH);
      setActiveFolder(ARCHIEVE_FOLDER_PATH);
      await refreshTree();
    },
    [
      clearNote,
      refreshTree,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  const moveNotesToFolder = useCallback(
    async (paths: string[], destinationPath: string) => {
      const normalizedDestination = destinationPath.trim();
      if (paths.length === 0 || !normalizedDestination) {
        return;
      }
      await api.moveItems(paths, normalizedDestination);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      clearNote();
      setSelectedFolders(new Set([normalizedDestination]));
      setLastSelectedFolder(normalizedDestination);
      setActiveFolder(normalizedDestination);
      await refreshTree();
    },
    [
      clearNote,
      refreshTree,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  const updateNoteMarkers = useCallback(
    async (
      paths: string[],
      markers: { archived?: boolean | null; reviewed?: boolean | null }
    ) => {
      const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
      if (uniquePaths.length === 0) {
        return;
      }
      await Promise.all(
        uniquePaths.map((path) =>
          api.updateNoteMarkers({
            path,
            archived: markers.archived ?? null,
            reviewed: markers.reviewed ?? null,
          })
        )
      );
      window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
    },
    []
  );

  const flattenIntoFeed = useCallback(
    async (folderPaths: string[], notePaths: string[]) => {
      const treeSnapshot = tree;
      if (!treeSnapshot) return;

      const { notePaths: notePathsToMove, foldersToRemove } = collectNotesForFlattening(
        treeSnapshot,
        folderPaths,
        notePaths
      );

      const notesToMove = notePathsToMove.filter(
        (path) => getNoteParentPath(path) !== FEED_FOLDER_PATH
      );
      if (notesToMove.length === 0 && foldersToRemove.length === 0) return;

      const folderSuffix =
        foldersToRemove.length > 0
          ? ` and remove ${foldersToRemove.length} folder(s)`
          : "";
      const confirmed = await confirmAction(
        `Move ${notesToMove.length} note(s) into Feed${folderSuffix}?`
      );
      if (!confirmed) return;

      if (notesToMove.length > 0) {
        await api.moveItems(notesToMove, FEED_FOLDER_PATH);
      }
      if (foldersToRemove.length > 0) {
        await api.deleteItems(foldersToRemove);
      }

      setSelectedFolders(new Set([FEED_FOLDER_PATH]));
      setLastSelectedFolder(FEED_FOLDER_PATH);
      setActiveFolder(FEED_FOLDER_PATH);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      await refreshTree();
    },
    [
      refreshTree,
      setActiveFolder,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      tree,
    ]
  );

  const showNoteInfo = useCallback(async (path: string) => {
    try {
      const meta = await api.getNoteMeta(path);
      const createdLabel = meta.created_ms
        ? new Date(meta.created_ms).toLocaleString()
        : "—";
      const updatedLabel = meta.updated_ms
        ? new Date(meta.updated_ms).toLocaleString()
        : "—";
      const archivedLabel = meta.archived_ms
        ? new Date(meta.archived_ms).toLocaleString()
        : "—";
      const reviewedLabel = meta.reviewed_ms
        ? new Date(meta.reviewed_ms).toLocaleString()
        : "—";
      window.alert(
        `Created: ${createdLabel}\nUpdated: ${updatedLabel}\nArchived: ${archivedLabel}\nReviewed: ${reviewedLabel}`
      );
    } catch (error) {
      console.error("[notes] failed to show note info", error);
    }
  }, []);

  return {
    createNewNote,
    deleteFolders,
    deleteNotes,
    moveNotesToArchive,
    moveNotesToFolder,
    updateNoteMarkers,
    flattenIntoFeed,
    showNoteInfo,
    startRenameFolder,
    submitRenameFolder,
    cancelRenameFolder,
  };
}
