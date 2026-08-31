// Pure helpers for turning the core's tree + previews into list rows.

import { isSystemFolder } from "@typenotes/shared/constants";
import { parseNotePreview, type NotePreview } from "@typenotes/shared/format";
import type {
  FolderNode,
  NoteEntry,
  NotePreviewEntry,
} from "@typenotes/shared/types";

export type NoteRow = {
  path: string;
  preview: NotePreview;
  /**
   * The body has not been read yet, so `preview` is a stand-in built from the
   * file name. Rows never disappear just because their preview is missing.
   */
  pending: boolean;
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
 * Subfolders the user can browse into.
 *
 * Both system folders are excluded — Feed and Archieve each have their own
 * pinned entry, exactly as on the desktop, whose folders panel filters them
 * with this same `isSystemFolder`. Listing Archieve as an ordinary folder was
 * the most visible way the mobile folder list disagreed with the desktop over
 * identical data. Dot-folders (`.type`, `.git`, …) are service directories.
 */
export const browsableFolders = (folder: FolderNode | null): FolderNode[] =>
  (folder?.children ?? []).filter(
    (child) => !isSystemFolder(child.path) && !child.name.startsWith(".")
  );

/**
 * Notes in this folder and every folder under it.
 *
 * A count of direct children only makes a folder that holds nothing but
 * subfolders read as empty, which is not what the desktop shows.
 */
export const folderNoteCount = (folder: FolderNode | null): number => {
  if (!folder) {
    return 0;
  }
  let total = folder.notes.length;
  for (const child of folder.children) {
    total += folderNoteCount(child);
  }
  return total;
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

// New note file names carry a sortable prefix (see the filename lifecycle in
// AGENTS.md): a UTC timestamp, a uuid v7, or a uuid v7 prefix. None of that is
// a title, so strip it before showing a file name to anyone.
const UTC_SLUG_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-/;
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-?/i;
const UUID_SHORT_PREFIX = /^[0-9a-f]{8}-/i;

const titleFromFileName = (name: string): string => {
  const base = name.replace(/\.md$/i, "");
  const stripped = base
    .replace(UTC_SLUG_PREFIX, "")
    .replace(UUID_PREFIX, "")
    .replace(UUID_SHORT_PREFIX, "")
    .replace(/-+/g, " ")
    .trim();
  return stripped || base;
};

/**
 * A stand-in for a note whose body has not been fetched yet.
 *
 * Skipping such notes made them vanish from the list — a note that arrived
 * with a sync stayed invisible until a pull-to-refresh, and any single failed
 * preview fetch silently hid a note. A row built from the file name is a much
 * smaller lie than no row at all.
 */
const placeholderPreview = (note: NoteEntry): NotePreview => ({
  title: titleFromFileName(note.name),
  dateLabel: "",
  secondLine: "",
  createdMs: null,
  updatedMs: null,
  archivedMs: null,
  reviewedMs: null,
  isArchived: false,
  isReviewed: false,
  isRecording: false,
  isHandwriting: false,
  recordingAudioPath: null,
  handwritingAttachmentPath: null,
  transcriptionStatus: null,
  ocrStatus: null,
});

export type NoteRowOptions = {
  hideArchived?: boolean;
  /** Drop rows the current feed filter excludes. */
  keep?: (preview: NotePreview) => boolean;
};

const buildRows = (
  folder: FolderNode | null,
  previews: Map<string, NotePreview>,
  options: NoteRowOptions
): NoteRow[] => {
  if (!folder) {
    return [];
  }
  const rows: NoteRow[] = [];
  for (const note of folder.notes) {
    const loaded = previews.get(note.path);
    const preview = loaded ?? placeholderPreview(note);
    if (options.hideArchived && preview.isArchived) {
      continue;
    }
    // A placeholder knows nothing about markers, so never let a filter hide a
    // note on the strength of a guess.
    if (loaded && options.keep && !options.keep(preview)) {
      continue;
    }
    rows.push({ path: note.path, preview, pending: !loaded });
  }
  return rows;
};

/**
 * Feed rows, newest first by front-matter timestamps.
 *
 * Feed keeps no `.notes-order.json` and the core returns it sorted by file
 * name, so the ordering the user sees has to be recomputed here — the same
 * thing the desktop does with its own previews.
 */
export const feedNoteRows = (
  folder: FolderNode | null,
  previews: Map<string, NotePreview>,
  options: NoteRowOptions = {}
): NoteRow[] => {
  const rows = buildRows(folder, previews, options);
  rows.sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
  return rows;
};

/**
 * Rows for an ordinary folder, in the order the core returned them.
 *
 * That order is the folder's `.notes-order.json` — what the user arranged by
 * dragging on the desktop. Re-sorting by timestamp here (which this function
 * used to do for every folder, Feed or not) threw that away, and was the
 * reason a folder looked different on the phone than on the desktop.
 */
export const folderNoteRows = (
  folder: FolderNode | null,
  previews: Map<string, NotePreview>,
  options: NoteRowOptions = {}
): NoteRow[] => buildRows(folder, previews, options);

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
