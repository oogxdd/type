import { FEED_FOLDER_PATH, isSystemFolder } from "@typenotes/shared/constants";
import type { FolderNode, NoteEntry } from "@typenotes/shared/types";
import type { FlattenedItem } from "./types";
import { collectAllNotes } from "@typenotes/shared/notes";
import { findNode } from "./tree-ops";
import type { NotePreview } from "@typenotes/shared/format";

// Pure helpers for the notes navigation view. Keep the render rules here so
// components stay dumb and the state hook can stay mostly orchestration.
type PreviewSourceInput = {
  activeFolder: string;
  notes: NoteEntry[];
  feedNotes: NoteEntry[];
  allNotes: NoteEntry[];
  shouldNestNotesInNavigation: boolean;
};

export function selectPreviewSourceNotes({
  activeFolder,
  notes,
  feedNotes,
  allNotes,
  shouldNestNotesInNavigation,
}: PreviewSourceInput): NoteEntry[] {
  if (activeFolder === FEED_FOLDER_PATH) {
    return feedNotes;
  }
  if (!shouldNestNotesInNavigation) {
    return notes;
  }
  // Nested navigation shows every folder's notes inline, so warm the vault.
  return allNotes;
}

type RenamedSelection = {
  activeFolder: string;
  selectedFolders: Set<string>;
  selectedFolderChanged: boolean;
};

export function applyFolderRenameToSelection(
  currentActiveFolder: string,
  currentSelectedFolders: Set<string>,
  oldPath: string,
  newPath: string
): RenamedSelection {
  const nextSelectedFolders = new Set(currentSelectedFolders);
  let selectedFolderChanged = false;

  if (nextSelectedFolders.has(oldPath)) {
    nextSelectedFolders.delete(oldPath);
    nextSelectedFolders.add(newPath);
    selectedFolderChanged = true;
  }

  return {
    activeFolder: currentActiveFolder === oldPath ? newPath : currentActiveFolder,
    selectedFolders: nextSelectedFolders,
    selectedFolderChanged,
  };
}

export function buildNotePreviews(notes: NoteEntry[], previews: Record<string, NotePreview>) {
  const next: Record<string, NotePreview> = {};
  notes.forEach((note) => {
    const preview = previews[note.path];
    if (preview) {
      next[note.path] = preview;
    }
  });
  return next;
}

export function collectNotesForFlattening(
  tree: FolderNode,
  folderPaths: string[],
  notePaths: string[]
) {
  const noteSet = new Set<string>(notePaths);
  const foldersToRemove: string[] = [];

  for (const folderPath of folderPaths) {
    if (!folderPath) continue;
    const node = findNode(tree, folderPath);
    if (node) {
      collectAllNotes(node).forEach((note) => noteSet.add(note.path));
    }
    if (!isSystemFolder(folderPath)) {
      foldersToRemove.push(folderPath);
    }
  }

  return {
    notePaths: Array.from(noteSet),
    foldersToRemove,
  };
}

export function mapParentById(items: FlattenedItem[]) {
  const map: Record<string, string | null> = {};
  items.forEach((item) => {
    map[item.id] = item.parentId;
  });
  return map;
}
