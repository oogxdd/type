// Flattening the folder tree into list rows.
//
// The core already hands the phone the whole nested tree (`get_tree` recurses
// and reads no note bodies), so browsing it a level at a time was a UI choice,
// not a data limit — and it was the reason folders looked nothing like the
// desktop's expandable panel over identical data. A flat array of rows with a
// depth is all a FlatList needs to draw the same hierarchy.

import type { FolderNode } from "@typenotes/shared/types";

import { browsableFolders, folderNoteCount } from "./feed";

export type FolderTreeRow = {
  folder: FolderNode;
  /** 0 for a top-level folder. */
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /** Notes here and in every folder below — see folderNoteCount. */
  noteCount: number;
};

/**
 * Rows for every folder that is visible given `expanded`: a folder's children
 * appear only while its own path is in the set. System and dot folders are
 * excluded at every level (browsableFolders).
 */
export const flattenFolderTree = (
  root: FolderNode | null,
  expanded: ReadonlySet<string>
): FolderTreeRow[] => {
  const rows: FolderTreeRow[] = [];
  const walk = (folder: FolderNode, depth: number) => {
    const children = browsableFolders(folder);
    const isExpanded = expanded.has(folder.path);
    rows.push({
      folder,
      depth,
      hasChildren: children.length > 0,
      isExpanded,
      noteCount: folderNoteCount(folder),
    });
    if (isExpanded) {
      for (const child of children) {
        walk(child, depth + 1);
      }
    }
  };
  for (const child of browsableFolders(root)) {
    walk(child, 0);
  }
  return rows;
};

/** Toggling one folder open or shut, without mutating the caller's set. */
export const toggleExpanded = (
  expanded: ReadonlySet<string>,
  path: string
): Set<string> => {
  const next = new Set(expanded);
  if (!next.delete(path)) {
    next.add(path);
  }
  return next;
};

/**
 * Every folder in the tree as a flat list of paths, deepest last — the choices
 * a "move to folder" picker offers. Includes system folders: moving a note
 * into Archieve is a legitimate destination even though Archieve is not
 * something you browse to.
 */
export const allFolderPaths = (root: FolderNode | null): string[] => {
  const paths: string[] = [];
  const walk = (folder: FolderNode) => {
    for (const child of folder.children) {
      if (child.name.startsWith(".")) {
        continue;
      }
      paths.push(child.path);
      walk(child);
    }
  };
  if (root) {
    walk(root);
  }
  return paths;
};
