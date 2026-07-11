// Notes navigation workflows: create/delete/move/rename/flatten plus the
// boot-time wiring. Plain module functions — CRUD here is a workflow, not
// just a write: refresh the tree, sync selection, and hand focus to the
// editor in one pass.
import { listen } from "@tauri-apps/api/event";

import { useAppearance } from "@/app/state/appearance-store";
import { useSelection } from "@/app/state/selection-store";
import * as api from "@/features/notes/api/notes-api";
import {
  clearDraft,
  clearNote,
  rightPaneRef,
} from "@/features/notes/editor/state/editor-store";
import {
  selectActiveProfileId,
  selectActiveProfileNotesRoot,
  selectSyncSettings,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import { confirmAction, focusNoScroll } from "@/shared/lib/dom";
import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
  isSystemFolder,
} from "@typenotes/shared/constants";
import { getNoteParentPath } from "@typenotes/shared/notes";
import {
  applyFolderRenameToSelection,
  collectNotesForFlattening,
} from "../model/notes-tree-model";
import { findNode } from "../model/tree-ops";
import {
  invalidateNotePreviews,
  refreshNotePreviews,
  resetPreviewCacheForActiveProfile,
} from "./note-previews";
import { refreshTree, useNotesStore } from "./notes-store";

export async function createNewNote(
  preferredFolderPath?: string,
  initialContent = "",
  targetTimestampMs?: number
): Promise<string | null> {
  const treeSnapshot = useNotesStore.getState().tree ?? (await api.getTree());
  const initialFolderPath = preferredFolderPath?.trim() || FEED_FOLDER_PATH;
  const targetNode =
    findNode(treeSnapshot, initialFolderPath) ||
    findNode(treeSnapshot, FEED_FOLDER_PATH);
  if (!targetNode) return null;
  const folderPath = targetNode.path;
  const { noteFileNameFormat } = selectSyncSettings(useProfilesStore.getState());
  const created = await api.createNote(
    folderPath,
    initialContent,
    targetTimestampMs,
    noteFileNameFormat
  );
  const path = created.path;
  await refreshTree();

  useSelection.getState().selectNote(path, folderPath);
  clearDraft();

  requestAnimationFrame(() => {
    const editorElement =
      rightPaneRef.current?.querySelector<HTMLElement>(
        ".tiptap-content[contenteditable='true']"
      ) || rightPaneRef.current;
    focusNoScroll(editorElement);
  });

  return path;
}

function applyFolderRename(oldPath: string, newPath: string) {
  const selection = useSelection.getState();
  const next = applyFolderRenameToSelection(
    selection.activeFolder,
    selection.selectedFolders,
    oldPath,
    newPath
  );
  selection.setActiveFolder(next.activeFolder);
  if (next.selectedFolderChanged) {
    selection.setSelectedFolders(next.selectedFolders);
    selection.setLastSelectedFolder(newPath);
  }
}

export function startRenameFolder(path: string) {
  if (isSystemFolder(path)) {
    window.alert(`"${path}" is a fixed folder and cannot be renamed.`);
    return;
  }
  const name = path.split("/").pop() || "";
  useNotesStore.setState({ renamingFolder: path, renameValue: name });
}

export async function submitRenameFolder() {
  const { renamingFolder, renameValue } = useNotesStore.getState();
  if (!renamingFolder || !renameValue.trim()) {
    useNotesStore.setState({ renamingFolder: null });
    return;
  }
  const oldPath = renamingFolder;
  const newPath = await api.renameItem(oldPath, renameValue.trim());
  useNotesStore.setState({ renamingFolder: null, renameValue: "" });
  await refreshTree();
  applyFolderRename(oldPath, newPath);
}

export function cancelRenameFolder() {
  useNotesStore.setState({ renamingFolder: null, renameValue: "" });
}

export async function deleteFolders(paths: string[]) {
  if (paths.length === 0) return;
  if (paths.some(isSystemFolder)) {
    window.alert(`"Feed" and "Archieve" are fixed folders and cannot be deleted.`);
    return;
  }
  const confirmed = await confirmAction(`Delete ${paths.length} folder(s)?`);
  if (!confirmed) return;
  await api.deleteItems(paths);
  const selection = useSelection.getState();
  selection.setSelectedFolders(new Set());
  if (paths.includes(selection.activeFolder)) {
    selection.setActiveFolder("");
  }
  await refreshTree();
}

export async function deleteNotes(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false;
  const confirmed = await confirmAction(`Delete ${paths.length} note(s)?`);
  if (!confirmed) return false;
  await api.deleteItems(paths);
  const selection = useSelection.getState();
  selection.setSelectedNotes(new Set());
  selection.setLastSelectedNote("");
  if (paths.includes(selection.activeNote || "")) {
    selection.setActiveNote(null);
    clearNote();
  }
  await refreshTree();
  return true;
}

export async function moveNotesToArchive(paths: string[]) {
  if (paths.length === 0) return;
  await api.moveItems(paths, ARCHIEVE_FOLDER_PATH);
  useSelection.getState().selectFolder(ARCHIEVE_FOLDER_PATH);
  clearNote();
  await refreshTree();
}

export async function moveNotesToFolder(paths: string[], destinationPath: string) {
  const normalizedDestination = destinationPath.trim();
  if (paths.length === 0 || !normalizedDestination) {
    return;
  }
  await api.moveItems(paths, normalizedDestination);
  useSelection.getState().selectFolder(normalizedDestination);
  clearNote();
  await refreshTree();
}

export async function updateNoteMarkers(
  paths: string[],
  markers: { archived?: boolean | null; reviewed?: boolean | null }
) {
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
  invalidateNotePreviews();
}

export async function flattenIntoFeed(folderPaths: string[], notePaths: string[]) {
  const treeSnapshot = useNotesStore.getState().tree;
  if (!treeSnapshot) return;

  const { notePaths: notePathsToMove, foldersToRemove } =
    collectNotesForFlattening(treeSnapshot, folderPaths, notePaths);

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
  const selection = useSelection.getState();
  selection.setSelectedFolders(new Set([FEED_FOLDER_PATH]));
  selection.setLastSelectedFolder(FEED_FOLDER_PATH);
  selection.setActiveFolder(FEED_FOLDER_PATH);
  selection.setSelectedNotes(new Set());
  selection.setLastSelectedNote("");
  await refreshTree();
}

export async function showNoteInfo(path: string) {
  try {
    const meta = await api.getNoteMeta(path);
    const label = (ms: number | null | undefined) =>
      ms ? new Date(ms).toLocaleString() : "—";
    window.alert(
      `Created: ${label(meta.created_ms)}\nUpdated: ${label(meta.updated_ms)}\n` +
        `Archived: ${label(meta.archived_ms)}\nReviewed: ${label(meta.reviewed_ms)}`
    );
  } catch (error) {
    console.error("[notes] failed to show note info", error);
  }
}

/** Wire tree/preview loading to profile, selection, and sync events. Call once at boot. */
export function initNotes() {
  // Tree state is profile-scoped. Any profile/root switch throws away the
  // cached tree and previews and rebuilds from the active root.
  useProfilesStore.subscribe((state, previous) => {
    const activeProfileId = selectActiveProfileId(state);
    if (!activeProfileId) {
      return;
    }
    if (
      activeProfileId !== selectActiveProfileId(previous) ||
      selectActiveProfileNotesRoot(state) !==
        selectActiveProfileNotesRoot(previous)
    ) {
      useNotesStore.setState({ tree: null });
      resetPreviewCacheForActiveProfile();
      void refreshTree();
    }
  });

  // Previews follow the derived source-note set; refreshNotePreviews no-ops
  // when that set is unchanged, so these can fire liberally.
  useNotesStore.subscribe((state, previous) => {
    if (state.tree !== previous.tree) {
      void refreshNotePreviews();
    }
  });
  useSelection.subscribe((state, previous) => {
    if (state.activeFolder !== previous.activeFolder) {
      void refreshNotePreviews();
    }
  });
  useAppearance.subscribe((state, previous) => {
    if (state.notesListMode !== previous.notesListMode) {
      void refreshNotePreviews();
    }
  });

  // A phone pushing over local sync changes the notes on disk behind the
  // frontend's back; the backend emits this event after each accepted push.
  void listen("local-sync-push-received", () => {
    console.log("[notes] local sync push received — refreshing tree");
    void refreshTree();
  });
}
