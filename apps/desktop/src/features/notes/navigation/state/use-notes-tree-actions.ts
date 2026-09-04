// Write side of the notes navigation slice.
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import * as api from "@/features/notes/api/notes-api";
import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
  isSystemFolder,
} from "@typenotes/shared/constants";
import { confirmAction, focusNoScroll } from "@/shared/lib/dom";
import { getNoteParentPath } from "@typenotes/shared/notes";
import { requestNoteEditorInsertMode } from "@/features/notes/editor/lib/editor-events";
import { applyFolderRenameToSelection, collectNotesForFlattening } from "../model/notes-tree-model";
import { findNode } from "@/features/notes/navigation/model/tree-ops";
import { findPostDeletionNavigationTarget } from "../model/visible-navigation";
import type { FeedNoteFilter } from "../model/feed-tree-model";
import type {
  FolderNode,
  NoteEntry,
  VisibleNavigationItem,
} from "@typenotes/shared/types";

type UseNotesTreeActionsArgs = {
  tree: FolderNode | null;
  refreshTree: () => Promise<void>;
  visibleNavigationItems: VisibleNavigationItem[];
  feedVisibleNavigationItems: VisibleNavigationItem[];
  feedNoteFilter: FeedNoteFilter;
  notes: NoteEntry[];
  feedNotes: NoteEntry[];
  setActiveFeedGroup: (id: string) => void;
  renamingFolder: string | null;
  setRenamingFolder: (path: string | null) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
};

export function useNotesTreeActions({
  tree,
  refreshTree,
  visibleNavigationItems,
  feedVisibleNavigationItems,
  feedNoteFilter,
  notes,
  feedNotes,
  setActiveFeedGroup,
  renamingFolder,
  setRenamingFolder,
  renameValue,
  setRenameValue,
}: UseNotesTreeActionsArgs) {
  const { syncSettings } = useProfiles();
  const { clearDraft, clearNote, rightPaneRef } = useEditor();
  const {
    selectedFolders,
    setSelectedFolders,
    setLastSelectedFolder,
    activeFolder,
    setActiveFolder,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
    selectFolder,
    selectNote,
  } = useSelection(
    useShallow((state) => ({
      selectedFolders: state.selectedFolders,
      setSelectedFolders: state.setSelectedFolders,
      setLastSelectedFolder: state.setLastSelectedFolder,
      activeFolder: state.activeFolder,
      setActiveFolder: state.setActiveFolder,
      setSelectedNotes: state.setSelectedNotes,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
      selectFolder: state.selectFolder,
      selectNote: state.selectNote,
    }))
  );

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
      selectNote(path, folderPath);
      clearDraft();
      if (initialContent.length === 0) {
        requestNoteEditorInsertMode(path);
      }

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
      selectNote,
      syncSettings.noteFileNameFormat,
      tree,
    ]
  );

  const selectPostDeletionTarget = useCallback(
    (target: VisibleNavigationItem | null, fromFeed: boolean) => {
      if (!target) {
        setSelectedFolders(new Set());
        setLastSelectedFolder("");
        setActiveFolder("");
        setSelectedNotes(new Set());
        setLastSelectedNote("");
        setActiveNote(null);
        clearNote();
        return;
      }
      if (target.type === "folder") {
        if (fromFeed) {
          setActiveFeedGroup(target.id);
          selectFolder(FEED_FOLDER_PATH);
        } else {
          selectFolder(target.id);
        }
        clearNote();
        return;
      }
      if (fromFeed) {
        setActiveFeedGroup(target.parentId);
        selectNote(target.id, FEED_FOLDER_PATH);
      } else {
        selectNote(target.id, target.parentId);
      }
    },
    [
      clearNote,
      selectFolder,
      selectNote,
      setActiveFeedGroup,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
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
      const removedIds = new Set(
        visibleNavigationItems
          .filter((item) =>
            paths.some((path) => item.id === path || item.id.startsWith(`${path}/`))
          )
          .map((item) => item.id)
      );
      const nextTarget = findPostDeletionNavigationTarget(
        visibleNavigationItems,
        removedIds
      );
      await api.deleteItems(paths);
      await refreshTree();
      selectPostDeletionTarget(nextTarget, false);
    },
    [refreshTree, selectPostDeletionTarget, visibleNavigationItems]
  );

  const deleteNotes = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return false;
      const confirmed = await confirmAction(`Delete ${paths.length} note(s)?`);
      if (!confirmed) return false;
      const fromFeed = activeFolder === FEED_FOLDER_PATH;
      const nestedNavigationItems = fromFeed
        ? feedVisibleNavigationItems
        : visibleNavigationItems;
      const navigationItems = nestedNavigationItems.some((item) =>
        paths.includes(item.id)
      )
        ? nestedNavigationItems
        : (fromFeed ? feedNotes : notes).map((note) => ({
            type: "note" as const,
            id: note.path,
            parentId: fromFeed ? FEED_FOLDER_PATH : activeFolder,
          }));
      const nextTarget = findPostDeletionNavigationTarget(
        navigationItems,
        new Set(paths)
      );
      await api.deleteItems(paths);
      await refreshTree();
      selectPostDeletionTarget(nextTarget, fromFeed);
      return true;
    },
    [
      activeFolder,
      feedNotes,
      feedVisibleNavigationItems,
      notes,
      refreshTree,
      selectPostDeletionTarget,
      visibleNavigationItems,
    ]
  );

  const moveNotesToArchive = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const fromFeed = activeFolder === FEED_FOLDER_PATH;
      const nestedNavigationItems = fromFeed
        ? feedVisibleNavigationItems
        : visibleNavigationItems;
      const navigationItems = nestedNavigationItems.some((item) =>
        paths.includes(item.id)
      )
        ? nestedNavigationItems
        : (fromFeed ? feedNotes : notes).map((note) => ({
            type: "note" as const,
            id: note.path,
            parentId: fromFeed ? FEED_FOLDER_PATH : activeFolder,
          }));
      const nextTarget = findPostDeletionNavigationTarget(
        navigationItems,
        new Set(paths)
      );
      await api.moveItems(paths, ARCHIEVE_FOLDER_PATH);
      await refreshTree();
      selectPostDeletionTarget(nextTarget, fromFeed);
    },
    [
      activeFolder,
      feedNotes,
      feedVisibleNavigationItems,
      notes,
      refreshTree,
      selectPostDeletionTarget,
      visibleNavigationItems,
    ]
  );

  const moveNotesToFolder = useCallback(
    async (paths: string[], destinationPath: string) => {
      const normalizedDestination = destinationPath.trim();
      if (paths.length === 0 || !normalizedDestination) {
        return;
      }
      const movesOutOfFeed =
        activeFolder === FEED_FOLDER_PATH &&
        normalizedDestination !== FEED_FOLDER_PATH;
      const nextTarget = movesOutOfFeed
        ? findPostDeletionNavigationTarget(
            feedVisibleNavigationItems,
            new Set(paths)
          )
        : null;
      await api.moveItems(paths, normalizedDestination);
      await refreshTree();
      if (movesOutOfFeed) {
        selectPostDeletionTarget(nextTarget, true);
        return;
      }
      selectFolder(normalizedDestination);
      clearNote();
    },
    [
      activeFolder,
      clearNote,
      feedVisibleNavigationItems,
      refreshTree,
      selectFolder,
      selectPostDeletionTarget,
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
      const removesNotesFromCurrentFeed =
        activeFolder === FEED_FOLDER_PATH &&
        feedNoteFilter === "active" &&
        markers.archived === true;
      const nextTarget = removesNotesFromCurrentFeed
        ? findPostDeletionNavigationTarget(
            feedVisibleNavigationItems,
            new Set(uniquePaths)
          )
        : null;
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
      if (removesNotesFromCurrentFeed) {
        selectPostDeletionTarget(nextTarget, true);
      }
    },
    [
      activeFolder,
      feedNoteFilter,
      feedVisibleNavigationItems,
      selectPostDeletionTarget,
    ]
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

      // Deliberately keeps the active note open (it may have just moved into
      // Feed), so this only redirects the folder selection.
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

  const createFolder = useCallback(
    async (path: string) => {
      const normalizedPath = path
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join("/");
      if (!normalizedPath || isSystemFolder(normalizedPath)) {
        return;
      }
      // There is no bare create-folder command: create_note's create_dir_all
      // of its destination is what materializes the folder (matching the
      // desktop move dialog and the mobile folder picker).
      await api.createNote(normalizedPath, "", undefined, syncSettings.noteFileNameFormat);
      await refreshTree();
      selectFolder(normalizedPath);
    },
    [refreshTree, selectFolder, syncSettings.noteFileNameFormat]
  );

  return {
    createNewNote,
    createFolder,
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
