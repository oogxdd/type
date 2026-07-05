import { FEED_FOLDER_PATH, isSystemFolder } from "@/shared/constants";
import type { FolderNode, NoteEntry, VisibleNavigationItem } from "@/shared/types";
import type { LayoutMode } from "@/mobile/navigation";
import type { TreeItem } from "@/features/notes/navigation/model/types";
import type { FlattenedItem } from "@/features/notes/navigation/model/types";
import { collectAllNotes } from "@/shared/lib/notes";
import { findNode } from "@/features/notes/navigation/model/tree-ops";
import type { NotePreview } from "@/shared/lib/format";

// Pure helpers for the notes navigation view. Keep the render rules here so
// components stay dumb and the state hook can stay mostly orchestration.
type PreviewSourceInput = {
  layoutMode: LayoutMode;
  activeFolder: string;
  activeNote: string | null;
  notes: NoteEntry[];
  feedNotes: NoteEntry[];
  allNotes: NoteEntry[];
  shouldNestNotesInNavigation: boolean;
};

export function selectPreviewSourceNotes({
  layoutMode,
  activeFolder,
  activeNote,
  notes,
  feedNotes,
  allNotes,
  shouldNestNotesInNavigation,
}: PreviewSourceInput): NoteEntry[] {
  if (activeFolder === FEED_FOLDER_PATH) {
    return feedNotes;
  }
  if (layoutMode !== "phone" && !shouldNestNotesInNavigation) {
    return notes;
  }

  // On phone, warming the whole vault when the editor opens is wasted work.
  // The active note is enough for the recording/handwriting header preview.
  if (layoutMode === "phone" && !activeFolder) {
    if (!activeNote) {
      return [];
    }
    const active = allNotes.find((note) => note.path === activeNote);
    return active ? [active] : [];
  }

  return allNotes;
}

export function buildVisibleNavigationItems(
  treeData: TreeItem[],
  expanded: Set<string>,
  shouldNestNotesInNavigation: boolean
): VisibleNavigationItem[] {
  if (!shouldNestNotesInNavigation) {
    return [];
  }

  const items: VisibleNavigationItem[] = [];

  // Nested navigation renders folders and notes in one flat list, but only for
  // the expanded branches the current layout actually wants to show.
  const walk = (nodes: TreeItem[], parentId: string | null) => {
    nodes.forEach((node) => {
      items.push({
        type: "folder",
        id: node.id,
        parentId,
      });

      const notesInNode = node.notes || [];
      const hasNestedItems = node.children.length > 0 || notesInNode.length > 0;
      if (!hasNestedItems || !expanded.has(node.id)) {
        return;
      }

      notesInNode.forEach((note) => {
        items.push({
          type: "note",
          id: note.path,
          parentId: node.id,
        });
      });

      walk(node.children, node.id);
    });
  };

  walk(treeData, null);
  return items;
}

export function getFirstSelectableFolderPath(tree: FolderNode | null): string {
  if (!tree) {
    return "";
  }
  const feed = findNode(tree, FEED_FOLDER_PATH);
  return feed?.path || tree.children[0]?.path || "";
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
