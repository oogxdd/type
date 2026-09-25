// Where the note-preview snapshots (lib/preview-snapshot.ts) live: one file
// per working folder beside the core's app data, like appearance.json — never
// inside a notes root, so a snapshot never syncs.
//
// Every failure means "no snapshot": the cost is one slower launch, never an
// error in front of the user.

import * as FileSystem from "expo-file-system/legacy";

// Mirrors core/boot.ts: the core's app_data_dir is `<documents>/typenotes`.
const SNAPSHOT_DIR = `${FileSystem.documentDirectory ?? ""}typenotes/note-previews`;

const snapshotFile = (profileId: string) =>
  `${SNAPSHOT_DIR}/${encodeURIComponent(profileId)}.json`;

export const readPreviewSnapshot = async (profileId: string): Promise<string | null> => {
  try {
    const file = snapshotFile(profileId);
    const info = await FileSystem.getInfoAsync(file);
    return info.exists ? await FileSystem.readAsStringAsync(file) : null;
  } catch {
    return null;
  }
};

export const writePreviewSnapshot = async (
  profileId: string,
  contents: string
): Promise<void> => {
  try {
    await FileSystem.makeDirectoryAsync(SNAPSHOT_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(snapshotFile(profileId), contents);
  } catch {
    // The next launch reads whatever the snapshot is missing.
  }
};

export const deletePreviewSnapshot = async (profileId: string): Promise<void> => {
  try {
    await FileSystem.deleteAsync(snapshotFile(profileId), { idempotent: true });
  } catch {
    // Nothing to remove, or nothing we can do about it.
  }
};
