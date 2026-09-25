// The note previews the phone keeps between launches, so a launch reads only
// the notes whose file changed since (the core's `NoteEntry.version`) instead
// of every note in the working folder.
//
// Pure: storage lives in state/preview-snapshot-file.ts. The notes store keeps
// one snapshot per working folder and never writes one while encryption is on
// — a preview is the opening text of a note, in the clear.

import { formatNoteDateLabel, type NotePreview } from "@typenotes/shared/format";

/**
 * Bump when what a preview holds, or how it is derived from a note, changes:
 * an older snapshot is then ignored instead of showing previews in the old
 * shape until each note happens to change.
 */
export const PREVIEW_SNAPSHOT_FORMAT = 1;

export type VersionedPreview = { version: string; preview: NotePreview };

type StoredPreview = Omit<NotePreview, "dateLabel">;

type SnapshotFile = {
  format: number;
  notes: Record<string, [version: string, preview: StoredPreview]>;
};

export const serializePreviewSnapshot = (
  notes: Map<string, VersionedPreview>
): string => {
  const file: SnapshotFile = { format: PREVIEW_SNAPSHOT_FORMAT, notes: {} };
  for (const [path, { version, preview }] of notes) {
    // Relative to today ("yesterday", a weekday), so recomputed on load.
    const { dateLabel, ...stored } = preview;
    file.notes[path] = [version, stored];
  }
  return JSON.stringify(file);
};

/** A corrupt, unreadable or older-format snapshot is simply no snapshot. */
export const parsePreviewSnapshot = (
  raw: string
): Map<string, VersionedPreview> => {
  const notes = new Map<string, VersionedPreview>();
  try {
    const file = JSON.parse(raw) as Partial<SnapshotFile> | null;
    if (file?.format !== PREVIEW_SNAPSHOT_FORMAT || typeof file.notes !== "object" || !file.notes) {
      return notes;
    }
    for (const [path, entry] of Object.entries(file.notes)) {
      if (!Array.isArray(entry)) {
        continue;
      }
      const [version, stored] = entry;
      if (typeof version !== "string" || typeof stored !== "object" || !stored) {
        continue;
      }
      notes.set(path, {
        version,
        preview: { ...stored, dateLabel: formatNoteDateLabel(stored.updatedMs ?? null) },
      });
    }
  } catch {
    notes.clear();
  }
  return notes;
};
