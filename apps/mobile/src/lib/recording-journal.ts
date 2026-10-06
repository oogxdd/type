import { Directory, File, Paths } from "expo-file-system";
import type { PendingRecording } from "./recording-session";

const directory = () => {
  const dir = new Directory(Paths.document, "typenotes", "pending-recordings");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
};

export const rememberRecording = (clip: PendingRecording) => {
  const dir = directory();
  // Immutable entry + separate saved receipt. Never delete/overwrite the only
  // journal entry while updating it: Expo's overwrite move first unlinks it.
  const name = `${clip.id}${clip.notePath ? ".saved" : ""}`;
  const destination = new File(dir, `${name}.json`);
  if (destination.exists) return;
  const temporary = new File(dir, `${name}.tmp`);
  temporary.write(JSON.stringify(clip));
  temporary.moveSync(destination);
};

export const forgetRecording = (clip: PendingRecording) => {
  if (!clip.notePath) throw new Error("Cannot remove audio before its note is saved.");
  // Remove source only after core has saved the note and its audio copy.
  const source = new File(clip.uri);
  if (source.exists) source.delete();
  const entry = new File(directory(), `${clip.id}.json`);
  if (entry.exists) entry.delete();
  const receipt = new File(directory(), `${clip.id}.saved.json`);
  if (receipt.exists) receipt.delete();
};

export const pendingRecordings = (profileId: string, notesRoot: string): PendingRecording[] => {
  const result: PendingRecording[] = [];
  for (const file of directory().list()) {
    if (!(file instanceof File) || (!file.name.endsWith(".json") || file.name.endsWith(".saved.json"))) continue;
    try {
      const clip: PendingRecording = JSON.parse(file.textSync());
      if (clip.id === file.name.slice(0, -5) && clip.profileId === profileId &&
          clip.notesRoot === notesRoot && typeof clip.uri === "string" &&
          typeof clip.startedAt === "number" && typeof clip.mimeType === "string") {
        const receipt = new File(directory(), `${clip.id}.saved.json`);
        if (receipt.exists) {
          const saved = JSON.parse(receipt.textSync());
          if (saved.id === clip.id && typeof saved.notePath === "string") clip.notePath = saved.notePath;
        }
        // iOS may relocate the application container between launches/updates.
        const fileName = clip.uri.split("/").pop();
        if (clip.uri.includes("/ExpoAudio/") && fileName && /^recording-[a-zA-Z0-9-]+\.(wav|m4a|webm)$/.test(fileName)) {
          clip.uri = new File(Paths.document, "ExpoAudio", fileName).uri;
        }
        result.push(clip);
      }
    } catch { /* Keep unreadable entries for recovery; never delete audio. */ }
  }
  return result;
};
