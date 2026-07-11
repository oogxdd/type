// Recordings domain store: microphone capture (MediaRecorder lifecycle) and
// the local-Whisper transcription queue. All actions are plain module
// functions; the auto-queue loop is armed once at boot and self-gates on
// lock state and profile readiness.
import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";

import * as api from "@/api/recordings-api";
import { toBase64 } from "@/lib/browser";
import { invalidateNotePreviews } from "@/state/note-previews";
import { completeCapture } from "@/state/notes-actions";
import {
  selectActiveProfileId,
  selectSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import { selectIsLocked, useSecurityStore } from "@/state/security-store";
import { useSelection } from "@/state/selection-store";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { getErrorMessage } from "@typenotes/shared/errors";
import { jobListSignature } from "@typenotes/shared/jobs";
import type {
  RecordingListItem,
  RecordingQueueSnapshot,
} from "@typenotes/shared/types";

type RecordingsState = {
  isRecording: boolean;
  isFinalizing: boolean;
  recorderError: string | null;
  recordingElapsedLabel: string | null;
  statusMessage: string | null;
  queueBusy: boolean;
  queue: RecordingQueueSnapshot | null;
  recordings: RecordingListItem[];
  listBusy: boolean;
  listError: string | null;
};

export const useRecordingsStore = create<RecordingsState>(() => ({
  isRecording: false,
  isFinalizing: false,
  recorderError: null,
  recordingElapsedLabel: null,
  statusMessage: null,
  queueBusy: false,
  queue: null,
  recordings: [],
  listBusy: false,
  listError: null,
}));

export const recordingSupported =
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

// ---- transcription queue ----

let queueInFlight = false;
let listSignature = "";

export async function refreshRecordings() {
  useRecordingsStore.setState({ listBusy: true });
  try {
    const snapshot = await api.listRecordings();
    useRecordingsStore.setState({
      queue: snapshot.queue,
      recordings: snapshot.recordings,
      listError: null,
    });
    const nextSignature = jobListSignature(snapshot.recordings);
    if (listSignature !== nextSignature) {
      listSignature = nextSignature;
      // A finished transcription rewrites its note body on disk.
      invalidateNotePreviews();
    }
  } catch (error) {
    useRecordingsStore.setState({ listError: getErrorMessage(error) });
  } finally {
    useRecordingsStore.setState({ listBusy: false });
  }
}

export async function queueRecordingTranscriptions(
  trigger: "manual" | "auto" = "manual"
) {
  if (queueInFlight) {
    return;
  }
  queueInFlight = true;
  useRecordingsStore.setState({ queueBusy: true });
  try {
    // Local whisper transcription — no API key needed.
    const { whisperModel } = selectSyncSettings(useProfilesStore.getState());
    const result = await api.queueLocalTranscriptions(
      whisperModel.trim() || undefined
    );
    const statusMessage =
      trigger === "manual"
        ? `Scanned ${result.scanned}, queued ${result.queued}, in-flight ${result.in_flight}.`
        : `Auto queue: scanned ${result.scanned}, queued ${result.queued}.`;
    useRecordingsStore.setState({ statusMessage });
  } catch (error) {
    useRecordingsStore.setState({ statusMessage: getErrorMessage(error) });
  } finally {
    queueInFlight = false;
    useRecordingsStore.setState({ queueBusy: false });
    void refreshRecordings();
  }
}

export async function retriggerTranscription(notePath: string) {
  try {
    const { whisperModel } = selectSyncSettings(useProfilesStore.getState());
    await api.retriggerTranscription(notePath, whisperModel.trim() || undefined);
    useRecordingsStore.setState({
      statusMessage: `Re-queued ${notePath} for transcription.`,
    });
    void refreshRecordings();
  } catch (error) {
    useRecordingsStore.setState({
      statusMessage: `Retrigger failed: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Resolves to a native asset:// URL streamed directly from disk by the
 * webview — no IPC blob, no Blob/object-URL lifecycle to manage.
 */
export async function resolveAudioSrc(audioPath: string) {
  const absolutePath = await api.resolveRecordingAudioPath(audioPath);
  return convertFileSrc(absolutePath);
}

// ---- microphone capture ----

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/ogg;codecs=opus",
  "audio/mpeg",
];

const pickMimeType = () => {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }
  return (
    MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ||
    ""
  );
};

const recorderErrorMessage = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Microphone permission is required.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone device was found.";
    }
    return error.message || "Audio recording failed.";
  }
  return getErrorMessage(error);
};

const formatElapsed = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${mmss}` : mmss;
};

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let chosenMimeType = "";
let targetFolder: string = FEED_FOLDER_PATH;
let elapsedTimer: number | null = null;

const stopStream = () => {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
};

const stopElapsedTimer = () => {
  if (elapsedTimer !== null) {
    window.clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  useRecordingsStore.setState({ recordingElapsedLabel: null });
};

async function saveRecordingBlob(blob: Blob, mimeType: string) {
  if (blob.size === 0) {
    useRecordingsStore.setState({
      recorderError: "No audio captured. Try recording again.",
    });
    return;
  }
  useRecordingsStore.setState({ isFinalizing: true });
  try {
    const buffer = await blob.arrayBuffer();
    const { noteFileNameFormat } = selectSyncSettings(useProfilesStore.getState());
    const result = await api.saveAudioRecording(
      toBase64(new Uint8Array(buffer)),
      mimeType || blob.type || undefined,
      targetFolder || FEED_FOLDER_PATH,
      noteFileNameFormat
    );
    await completeCapture(result);
    useRecordingsStore.setState({
      statusMessage: `Saved ${result.note_path}.`,
      recorderError: null,
    });
    void refreshRecordings();
    await queueRecordingTranscriptions("auto");
  } catch (error) {
    useRecordingsStore.setState({ recorderError: recorderErrorMessage(error) });
  } finally {
    useRecordingsStore.setState({ isFinalizing: false });
  }
}

export function startRecording(preferredFolderPath?: string | null) {
  void (async () => {
    try {
      if (!recordingSupported) {
        useRecordingsStore.setState({
          recorderError: "This device does not support audio recording in-app.",
        });
        return;
      }
      const { isRecording, isFinalizing } = useRecordingsStore.getState();
      if (isRecording || isFinalizing) {
        return;
      }
      targetFolder =
        preferredFolderPath?.trim() ||
        useSelection.getState().activeFolder.trim() ||
        FEED_FOLDER_PATH;

      useRecordingsStore.setState({ recorderError: null });
      chunks = [];
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      chosenMimeType = pickMimeType();
      recorder = chosenMimeType
        ? new MediaRecorder(stream, { mimeType: chosenMimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        useRecordingsStore.setState({
          recorderError: "Audio recorder encountered an error.",
        });
      };
      recorder.onstop = () => {
        recorder = null;
        useRecordingsStore.setState({ isRecording: false });
        stopElapsedTimer();
        stopStream();

        const blob = new Blob(chunks, { type: chosenMimeType || "audio/webm" });
        chunks = [];
        void saveRecordingBlob(blob, chosenMimeType || blob.type);
      };

      recorder.start(200);
      const startedAtMs = Date.now();
      useRecordingsStore.setState({
        isRecording: true,
        recordingElapsedLabel: formatElapsed(0),
      });
      elapsedTimer = window.setInterval(() => {
        useRecordingsStore.setState({
          recordingElapsedLabel: formatElapsed(Date.now() - startedAtMs),
        });
      }, 1000);
    } catch (error) {
      useRecordingsStore.setState({ recorderError: recorderErrorMessage(error) });
      stopStream();
    }
  })();
}

export function stopRecording() {
  if (!recorder || recorder.state === "inactive") {
    return;
  }
  recorder.stop();
}

// ---- boot wiring ----

const AUTO_QUEUE_INTERVAL_MS = 15_000;

/** Arm the auto-transcription loop. Ticks no-op while locked or profile-less. */
export function initRecordings() {
  const tick = () => {
    if (
      selectIsLocked(useSecurityStore.getState()) ||
      !selectActiveProfileId(useProfilesStore.getState())
    ) {
      return;
    }
    void queueRecordingTranscriptions("auto");
  };
  tick();
  window.setInterval(tick, AUTO_QUEUE_INTERVAL_MS);
  // The boot tick fires before the profile snapshot arrives; run once as soon
  // as a profile is ready instead of waiting out the first interval.
  useProfilesStore.subscribe((state, previous) => {
    if (selectActiveProfileId(state) && !selectActiveProfileId(previous)) {
      tick();
    }
  });
}
