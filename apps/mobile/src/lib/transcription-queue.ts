// Starting transcription for recordings that were just written to the working
// folder, following that folder's `transcription_mode`. Shared by the two ways
// a recording gets in: the dictation button (record here) and the audio-file
// import (a Voice Memo shared in, or picked from Files).
//
//   assemblyai → cloud queue now, on this device
//   native     → on-device speech recognition, run by the core's queue
//   desktop    → nothing to do here; the note stays `pending` until a synced
//                desktop picks it up (local Whisper)
//   off        → nothing to do here; the note stays `pending` until the user
//                triggers it manually
//
// Kept free of React and React Native so it can be unit-tested.

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { TranscriptionMode } from "@typenotes/shared/types";

import { nativeTranscriptionProvider } from "./native-transcription";

export type TranscriptionQueueDeps = {
  queueAssembly: () => Promise<unknown>;
  queueNative: () => Promise<unknown>;
};

const defaultDeps: TranscriptionQueueDeps = {
  queueAssembly: () => core.queueRecordingTranscriptions(),
  queueNative: () => core.queueProviderTranscriptions(nativeTranscriptionProvider),
};

/**
 * Queue whatever is pending in the working folder against `mode`.
 *
 * Returns `null` on success (including the modes that queue nothing here), or
 * the failure message when queueing threw. A failure is never fatal: the notes
 * are already saved and stay `pending`, so a later retry — or a desktop after
 * sync — can still transcribe them. Callers surface the message and move on.
 */
export const startTranscription = async (
  mode: TranscriptionMode,
  deps: TranscriptionQueueDeps = defaultDeps
): Promise<string | null> => {
  try {
    if (mode === "assemblyai") {
      await deps.queueAssembly();
    } else if (mode === "native") {
      await deps.queueNative();
    }
    return null;
  } catch (error) {
    return getErrorMessage(error);
  }
};
