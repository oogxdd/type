import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as api from "../api/recordings-api";
import type { RecordingListItem, RecordingQueueSnapshot } from "@typenotes/shared/types";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { toBase64 } from "@/shared/lib/notes";
import { useAudioRecorder } from "./use-audio-recorder";
import {
  selectSyncSettings,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import { invalidateNotePreviews } from "@/features/notes/navigation/state/note-previews";
import { useAutoQueueLoop } from "@/features/processing/hooks/use-auto-queue-loop";
import { useProcessingQueue } from "@/features/processing/hooks/use-processing-queue";
import { jobListSignature } from "@typenotes/shared/jobs";
import { getErrorMessage } from "@typenotes/shared/errors";

type RecordingsContextValue = {
  recordingSupported: boolean;
  isRecordingAudio: boolean;
  isRecordingFinalizing: boolean;
  recorderError: string | null;
  recordingElapsedLabel: string | null;
  recordingStatusMessage: string | null;
  transcriptionQueueBusy: boolean;
  recordingsQueue: RecordingQueueSnapshot | null;
  recordingsList: RecordingListItem[];
  recordingsBusy: boolean;
  recordingsError: string | null;
  startRecording: (preferredFolderPath?: string | null) => void;
  stopRecording: () => void;
  refreshRecordings: () => Promise<void>;
  resolveAudioSrc: (audioPath: string) => Promise<string>;
  queueRecordingTranscriptions: (trigger?: "manual" | "auto") => Promise<void>;
  retriggerTranscription: (notePath: string) => Promise<void>;
};

const RecordingsContext = createContext<RecordingsContextValue | null>(null);

export function RecordingsProvider({
  children,
  activeFolder,
  onRecordingComplete,
}: {
  children: ReactNode;
  activeFolder: string;
  onRecordingComplete: (result: {
    folder_path: string;
    note_path: string;
    audio_path: string;
  }) => Promise<void>;
}) {
  const syncSettings = useProfilesStore(selectSyncSettings);
  const [recordingStatusMessage, setRecordingStatusMessage] = useState<string | null>(null);
  const [transcriptionQueueBusy, setTranscriptionQueueBusy] = useState(false);

  const transcriptionQueueBusyRef = useRef(false);
  const recordingTargetFolderRef = useRef<string>(FEED_FOLDER_PATH);

  const loadRecordingsSnapshot = useCallback(async () => {
    const snapshot = await api.listRecordings();
    return {
      queue: snapshot.queue,
      items: snapshot.recordings,
    };
  }, []);

  const {
    queue: recordingsQueue,
    items: recordingsList,
    busy: recordingsBusy,
    error: recordingsError,
    refresh: refreshRecordings,
  } = useProcessingQueue<RecordingQueueSnapshot, RecordingListItem>({
    loadSnapshot: loadRecordingsSnapshot,
    getSignature: jobListSignature,
    // A finished transcription rewrites its note body on disk.
    onJobsChanged: invalidateNotePreviews,
  });

  // Resolves to a native asset:// URL streamed directly from disk by the
  // webview — no IPC blob, no Blob/object-URL lifecycle to manage. Cheap
  // enough (a validated path-string round-trip, not a file read) that every
  // consumer can just call this on its own note, independently.
  const resolveAudioSrc = useCallback(async (audioPath: string) => {
    const absolutePath = await api.resolveRecordingAudioPath(audioPath);
    return convertFileSrc(absolutePath);
  }, []);

  const queueRecordingTranscriptions = useCallback(
    async (trigger: "manual" | "auto" = "manual") => {
      if (transcriptionQueueBusyRef.current) {
        return;
      }

      transcriptionQueueBusyRef.current = true;
      setTranscriptionQueueBusy(true);
      try {
        // Local whisper transcription — no API key needed.
        const result = await api.queueLocalTranscriptions(
          syncSettings.whisperModel.trim() || undefined
        );
        const label =
          trigger === "manual"
            ? `Scanned ${result.scanned}, queued ${result.queued}, in-flight ${result.in_flight}.`
            : `Auto queue: scanned ${result.scanned}, queued ${result.queued}.`;
        setRecordingStatusMessage(label);
      } catch (error) {
        const message = getErrorMessage(error);
        setRecordingStatusMessage(message);
      } finally {
        transcriptionQueueBusyRef.current = false;
        setTranscriptionQueueBusy(false);
        void refreshRecordings();
      }
    },
    [refreshRecordings, syncSettings.whisperModel]
  );

  const retriggerTranscription = useCallback(
    async (notePath: string) => {
      try {
        await api.retriggerTranscription(
          notePath,
          syncSettings.whisperModel.trim() || undefined
        );
        setRecordingStatusMessage(`Re-queued ${notePath} for transcription.`);
        void refreshRecordings();
      } catch (error) {
        const message = getErrorMessage(error);
        setRecordingStatusMessage(`Retrigger failed: ${message}`);
      }
    },
    [refreshRecordings, syncSettings.whisperModel]
  );

  const resolveRecordingTargetFolder = useCallback(
    (preferredFolderPath?: string | null) => {
      const preferred = preferredFolderPath?.trim();
      if (preferred) {
        return preferred;
      }
      const active = activeFolder.trim();
      return active || FEED_FOLDER_PATH;
    },
    [activeFolder]
  );

  const handleRecordingReady = useCallback(
    async (blob: Blob, mimeType: string) => {
      const buffer = await blob.arrayBuffer();
      const audioBase64 = toBase64(new Uint8Array(buffer));
      const targetFolder = recordingTargetFolderRef.current || FEED_FOLDER_PATH;
      const result = await api.saveAudioRecording(
        audioBase64,
        mimeType || undefined,
        targetFolder,
        syncSettings.noteFileNameFormat
      );
      await onRecordingComplete(result);
      setRecordingStatusMessage(`Saved ${result.note_path}.`);
      void refreshRecordings();
      await queueRecordingTranscriptions("auto");
    },
    [
      onRecordingComplete,
      queueRecordingTranscriptions,
      refreshRecordings,
      syncSettings.noteFileNameFormat,
    ]
  );

  const {
    isSupported: recordingSupported,
    isRecording: isRecordingAudio,
    isFinalizing: isRecordingFinalizing,
    error: recorderError,
    recordingElapsedLabel,
    startRecording: startRecordingRaw,
    stopRecording: stopRecordingRaw,
  } = useAudioRecorder({
    onRecordingReady: handleRecordingReady,
  });

  const startRecording = useCallback(
    (preferredFolderPath?: string | null) => {
      recordingTargetFolderRef.current =
        resolveRecordingTargetFolder(preferredFolderPath);
      void startRecordingRaw();
    },
    [resolveRecordingTargetFolder, startRecordingRaw]
  );

  const stopRecording = useCallback(() => {
    stopRecordingRaw();
  }, [stopRecordingRaw]);

  const autoQueueTranscriptions = useCallback(
    () => queueRecordingTranscriptions("auto"),
    [queueRecordingTranscriptions]
  );
  useAutoQueueLoop({
    enabled: true,
    delayMs: 0,
    onTick: autoQueueTranscriptions,
  });

  return (
    <RecordingsContext.Provider
      value={{
        recordingSupported,
        isRecordingAudio,
        isRecordingFinalizing,
        recorderError,
        recordingElapsedLabel,
        recordingStatusMessage,
        transcriptionQueueBusy,
        recordingsQueue,
        recordingsList,
        recordingsBusy,
        recordingsError,
        startRecording,
        stopRecording,
        refreshRecordings,
        resolveAudioSrc,
        queueRecordingTranscriptions,
        retriggerTranscription,
      }}
    >
      {children}
    </RecordingsContext.Provider>
  );
}

export function useRecordings() {
  const context = useContext(RecordingsContext);
  if (!context) {
    throw new Error("useRecordings must be used within a RecordingsProvider");
  }
  return context;
}
