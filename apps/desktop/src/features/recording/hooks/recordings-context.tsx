import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../api/recordings-api";
import type { RecordingListItem, RecordingQueueSnapshot } from "@typenotes/shared/types";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { toBase64, fromBase64 } from "@/shared/lib/notes";
import { useAudioRecorder } from "./use-audio-recorder";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useAutoQueueLoop } from "@/features/processing/hooks/use-auto-queue-loop";
import { useProcessingQueue } from "@/features/processing/hooks/use-processing-queue";
import { jobListSignature } from "@typenotes/shared/jobs";
import type { LayoutMode } from "@/mobile/navigation";
import { getErrorMessage } from "@typenotes/shared/errors";

type RecordingsContextValue = {
  recordingSupported: boolean;
  isRecordingAudio: boolean;
  isRecordingFinalizing: boolean;
  recorderError: string | null;
  nativeRecoveryNotice: string | null;
  recordingElapsedLabel: string | null;
  recordingStatusMessage: string | null;
  recordingLiveStatus: string | null;
  transcriptionQueueBusy: boolean;
  recordingsQueue: RecordingQueueSnapshot | null;
  recordingsList: RecordingListItem[];
  recordingsBusy: boolean;
  recordingsError: string | null;
  activeAudioPath: string | null;
  activeAudioSrc: string | null;
  startRecording: (preferredFolderPath?: string | null) => void;
  stopRecording: () => void;
  refreshRecordings: () => Promise<void>;
  playRecording: (audioPath: string) => Promise<void>;
  queueRecordingTranscriptions: (trigger?: "manual" | "auto") => Promise<void>;
  retriggerTranscription: (notePath: string) => Promise<void>;
  shouldAutoQueueTranscriptions: boolean;
};

const RecordingsContext = createContext<RecordingsContextValue | null>(null);

export function RecordingsProvider({
  children,
  activeFolder,
  layoutMode,
  onRecordingComplete,
}: {
  children: ReactNode;
  activeFolder: string;
  layoutMode: LayoutMode;
  onRecordingComplete: (result: {
    folder_path: string;
    note_path: string;
    audio_path: string;
  }) => Promise<void>;
}) {
  const { syncSettings } = useProfiles();
  const [recordingStatusMessage, setRecordingStatusMessage] = useState<string | null>(null);
  const [transcriptionQueueBusy, setTranscriptionQueueBusy] = useState(false);
  const [activeAudioPath, setActiveAudioPath] = useState<string | null>(null);
  const [activeAudioSrc, setActiveAudioSrc] = useState<string | null>(null);

  const transcriptionQueueBusyRef = useRef(false);
  const recordingTargetFolderRef = useRef<string>(FEED_FOLDER_PATH);
  const activeAudioObjectUrlRef = useRef<string | null>(null);

  const isDesktop = layoutMode === "desktop";

  const shouldAutoQueueTranscriptions =
    isDesktop || syncSettings.mobileAutoTranscriptionEnabled;

  const cleanupMissingActiveAudio = useCallback(
    (snapshot: { items: RecordingListItem[] }) => {
      if (!activeAudioPath) {
        return;
      }
      const stillExists = snapshot.items.some(
        (item) => item.audio_path === activeAudioPath
      );
      if (stillExists) {
        return;
      }
      if (activeAudioObjectUrlRef.current) {
        URL.revokeObjectURL(activeAudioObjectUrlRef.current);
        activeAudioObjectUrlRef.current = null;
      }
      setActiveAudioPath(null);
      setActiveAudioSrc(null);
    },
    [activeAudioPath]
  );

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
    setError: setRecordingsError,
    refresh: refreshRecordings,
  } = useProcessingQueue<RecordingQueueSnapshot, RecordingListItem>({
    loadSnapshot: loadRecordingsSnapshot,
    getSignature: jobListSignature,
    invalidateEventName: "note-previews-invalidated",
    onSnapshotLoaded: cleanupMissingActiveAudio,
  });

  const playRecording = useCallback(async (audioPath: string) => {
    try {
      const payload = await api.readRecordingAudio(audioPath);
      const bytes = fromBase64(payload.audio_base64);
      const blob = new Blob([bytes], {
        type: payload.mime_type || "audio/mpeg",
      });
      const objectUrl = URL.createObjectURL(blob);
      if (activeAudioObjectUrlRef.current) {
        URL.revokeObjectURL(activeAudioObjectUrlRef.current);
      }
      activeAudioObjectUrlRef.current = objectUrl;
      setActiveAudioPath(audioPath);
      setActiveAudioSrc(objectUrl);
      setRecordingsError(null);
    } catch (error) {
      const message = getErrorMessage(error);
      setRecordingsError(message);
    }
  }, []);

  useEffect(
    () => () => {
      if (activeAudioObjectUrlRef.current) {
        URL.revokeObjectURL(activeAudioObjectUrlRef.current);
        activeAudioObjectUrlRef.current = null;
      }
    },
    []
  );

  const queueRecordingTranscriptions = useCallback(
    async (trigger: "manual" | "auto" = "manual") => {
      if (transcriptionQueueBusyRef.current) {
        return;
      }

      transcriptionQueueBusyRef.current = true;
      setTranscriptionQueueBusy(true);
      try {
        let result;
        if (isDesktop) {
          // Desktop: use local whisper transcription (no API key needed)
          result = await api.queueLocalTranscriptions(
            syncSettings.whisperModel.trim() || undefined
          );
        } else {
          // Mobile: use AssemblyAI (requires API key)
          const apiKey = syncSettings.assemblyAiApiKey.trim();
          if (!apiKey) {
            if (trigger === "manual") {
              setRecordingStatusMessage("AssemblyAI API key is required.");
            }
            return;
          }
          result = await api.queueRecordingTranscriptions(apiKey);
        }
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
    [
      isDesktop,
      refreshRecordings,
      syncSettings.assemblyAiApiKey,
      syncSettings.whisperModel,
    ]
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
      if (shouldAutoQueueTranscriptions) {
        await queueRecordingTranscriptions("auto");
      }
    },
    [
      onRecordingComplete,
      queueRecordingTranscriptions,
      refreshRecordings,
      shouldAutoQueueTranscriptions,
      syncSettings.noteFileNameFormat,
    ]
  );

  const {
    isSupported: recordingSupported,
    isRecording: isRecordingAudio,
    isFinalizing: isRecordingFinalizing,
    error: recorderError,
    nativeRecoveryNotice,
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

  const recordingLiveStatus =
    isRecordingAudio && recordingElapsedLabel
      ? `${nativeRecoveryNotice ? `${nativeRecoveryNotice} ` : "Recording in progress. "}Elapsed ${recordingElapsedLabel}.`
      : null;

  const autoQueueTranscriptions = useCallback(
    () => queueRecordingTranscriptions("auto"),
    [queueRecordingTranscriptions]
  );
  useAutoQueueLoop({
    enabled:
      shouldAutoQueueTranscriptions &&
      // Desktop local Whisper needs no key; mobile AssemblyAI does.
      (isDesktop || syncSettings.assemblyAiApiKey.trim().length > 0),
    delayMs: layoutMode === "phone" ? 3000 : 0,
    onTick: autoQueueTranscriptions,
  });

  return (
    <RecordingsContext.Provider
      value={{
        recordingSupported,
        isRecordingAudio,
        isRecordingFinalizing,
        recorderError,
        nativeRecoveryNotice,
        recordingElapsedLabel,
        recordingStatusMessage,
        recordingLiveStatus,
        transcriptionQueueBusy,
        recordingsQueue,
        recordingsList,
        recordingsBusy,
        recordingsError,
        activeAudioPath,
        activeAudioSrc,
        startRecording,
        stopRecording,
        refreshRecordings,
        playRecording,
        queueRecordingTranscriptions,
        retriggerTranscription,
        shouldAutoQueueTranscriptions,
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
