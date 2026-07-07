// Pure helpers for turning the core's tree + previews into list rows.

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
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

/**
 * Subfolders the user can browse into. Feed is not listed (it has its own
 * tab / screen), and dot-folders (`.type` settings, `.git`, …) are hidden
 * service directories.
 */
export const browsableFolders = (folder: FolderNode | null): FolderNode[] =>
  (folder?.children ?? []).filter(
    (child) => child.path !== FEED_FOLDER_PATH && !child.name.startsWith(".")
  );

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

export type NoteRowSection = {
  title: string;
  data: NoteRow[];
};

/** Same day/week bucketing the desktop feed tree uses, flattened into section headers. */
const dateGroupLabel = (timestampMs: number, now: Date): string => {
  const value = new Date(timestampMs);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemStart = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.round((todayStart.getTime() - itemStart.getTime()) / 86_400_000);
  if (diffDays <= 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return value.toLocaleDateString([], { weekday: "long" });
  }
  if (value.getFullYear() === now.getFullYear()) {
    return value.toLocaleDateString([], { month: "long" });
  }
  return value.toLocaleDateString([], { month: "long", year: "numeric" });
};

/**
 * Groups already-sorted (newest first) note rows into date sections —
 * Today / Yesterday / weekday name / month — mirroring the desktop feed's
 * calendar grouping in a flat list shape for the mobile feed.
 */
export const groupNoteRowsByDate = (rows: NoteRow[]): NoteRowSection[] => {
  const now = new Date();
  const sections: NoteRowSection[] = [];
  let currentTitle: string | null = null;
  for (const row of rows) {
    const timestamp = rowTimestamp(row);
    const title = timestamp > 0 ? dateGroupLabel(timestamp, now) : "Undated";
    if (title !== currentTitle) {
      sections.push({ title, data: [] });
      currentTitle = title;
    }
    sections[sections.length - 1].data.push(row);
  }
  return sections;
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
