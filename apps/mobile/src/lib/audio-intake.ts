// The one pipeline every imported audio file goes through, whichever way it
// arrived: import → queue transcription for the working folder's mode →
// refresh the feed. Two entry points share it:
//
//   the dictation button's "audio file" action (pick from Files), and
//   an audio file shared into Type from Voice Memos / Files (see App.tsx).
//
// This is the platform-facing half — expo-file-system, the core, the stores.
// The decisions it makes (which files are importable, which path down to the
// core, what the result reads like) live in `audio-import.ts`, which is pure
// and unit-tested.

import * as FileSystem from "expo-file-system/legacy";

import { effectiveTranscriptionMode } from "@typenotes/shared/types";

import {
  coreAudioImportDeps,
  describeImportOutcome,
  importAudioFiles,
  type AudioImportOutcome,
  type PickedAudioFile,
} from "./audio-import";
import { startTranscription } from "./transcription-queue";
import { useNotesStore } from "../state/notes-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";

export type AudioIntakeResult = AudioImportOutcome & {
  /** One line for a status pill or banner. */
  message: string;
};

/**
 * Import the given files and start their transcription. Never throws for a
 * per-file problem — read `imported`/`failed` and show `message`.
 */
export const runAudioImport = async (
  files: PickedAudioFile[]
): Promise<AudioIntakeResult> => {
  const settings = activeProfile(useSettingsStore.getState().snapshot)?.settings;
  const mode = settings ? effectiveTranscriptionMode(settings) : "desktop";

  const outcome = await importAudioFiles(files, {
    ...coreAudioImportDeps,
    readBase64: (uri) => FileSystem.readAsStringAsync(uri, { encoding: "base64" }),
    discard: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  });

  // Nothing landed — there is nothing to transcribe, and the queue call would
  // only add a second, less useful error message.
  if (outcome.imported === 0) {
    return { ...outcome, message: describeImportOutcome(outcome, mode) };
  }

  const queueError = await startTranscription(mode);
  void useNotesStore.getState().refresh().catch(() => {});
  return {
    ...outcome,
    message: describeImportOutcome(outcome, mode, queueError),
  };
};
