import type { NoteEntry, FolderNode } from "@typenotes/shared/types";
import type { NotePreview } from "@typenotes/shared/format";
import { timestampFromFileName } from "./feed";

let foregroundUntil = 0;
export const noteForegroundActivity = (quietMs = 180) => {
  foregroundUntil = Math.max(foregroundUntil, Date.now() + quietMs);
};
export const yieldForNoteHistory = async () => {
  do { await new Promise<void>((resolve) => setTimeout(resolve, 16)); }
  while (Date.now() < foregroundUntil);
};

/** Local calendar boundaries, Monday-start week; filename dates are hints. */
export const prioritizeNotes = (notes: NoteEntry[], previews: Map<string, NotePreview>, now = new Date()): string[][] => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(today);
  week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  const groups: string[][] = [[], [], [], []];
  for (const note of notes) {
    const date = previews.get(note.path)?.createdMs ?? timestampFromFileName(note.name);
    const index = date === null ? 2 : date >= today.getTime() ? 0 : date >= week.getTime() ? 1 : 3;
    groups[index].push(note.path);
  }
  return groups;
};

/** Reuse unaffected folders and notes after a native tree scan. */
export const reconcileNoteTree = (previous: FolderNode | null, next: FolderNode): FolderNode => {
  if (!previous || previous.path !== next.path) return next;
  const oldChildren = new Map(previous.children.map((child) => [child.path, child]));
  const children = next.children.map((child) => reconcileNoteTree(oldChildren.get(child.path) ?? null, child));
  const sameNotes = previous.notes.length === next.notes.length && previous.notes.every((note, index) => {
    const other = next.notes[index];
    return note.path === other.path && note.name === other.name && note.version === other.version;
  });
  const sameChildren = children.length === previous.children.length && children.every((child, index) => child === previous.children[index]);
  if (sameNotes && sameChildren && previous.name === next.name) return previous;
  return { ...next, notes: sameNotes ? previous.notes : next.notes, children: sameChildren ? previous.children : children };
};
