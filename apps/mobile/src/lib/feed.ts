// Pure helpers for turning the core's tree + previews into list rows.

import { parseNotePreview, type NotePreview } from "@typenotes/shared/format";
import type { FolderNode, NotePreviewEntry } from "@typenotes/shared/types";

export type NoteRow = {
  path: string;
  preview: NotePreview;
};

export const findFolder = (
  root: FolderNode | null,
  path: string
): FolderNode | null => {
  if (!root) {
    return null;
  }
  if (root.path === path) {
    return root;
  }
  for (const child of root.children) {
    const found = findFolder(child, path);
    if (found) {
      return found;
    }
  }
  return null;
};

export const previewsByPath = (
  entries: NotePreviewEntry[]
): Map<string, NotePreview> => {
  const map = new Map<string, NotePreview>();
  for (const entry of entries) {
    map.set(
      entry.path,
      parseNotePreview(entry.content, entry.meta.updated_ms, entry.meta)
    );
  }
  return map;
};

const rowTimestamp = (row: NoteRow) =>
  row.preview.createdMs ?? row.preview.updatedMs ?? 0;

/**
 * Rows for one folder, newest first (by front-matter created/updated
 * timestamps, matching the desktop feed's ordering).
 */
export const folderNoteRows = (
  folder: FolderNode | null,
  previews: Map<string, NotePreview>,
  options: { hideArchived?: boolean } = {}
): NoteRow[] => {
  if (!folder) {
    return [];
  }
  const rows: NoteRow[] = [];
  for (const note of folder.notes) {
    const preview = previews.get(note.path);
    if (!preview) {
      continue;
    }
    if (options.hideArchived && preview.isArchived) {
      continue;
    }
    rows.push({ path: note.path, preview });
  }
  rows.sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
  return rows;
};

/** Every note path in the tree (for bulk preview fetches). */
export const collectNotePaths = (root: FolderNode | null): string[] => {
  if (!root) {
    return [];
  }
  const output: string[] = [];
  const walk = (node: FolderNode) => {
    node.notes.forEach((note) => output.push(note.path));
    node.children.forEach(walk);
  };
  walk(root);
  return output;
};
