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
import type { RecordingListItem, RecordingQueueSnapshot } from "@/shared/types";
import { FEED_FOLDER_PATH } from "@/shared/constants";
import { toBase64, fromBase64 } from "@/shared/lib/notes";
import { useAudioRecorder } from "./use-audio-recorder";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { jobListSignature } from "@/shared/lib/jobs";
import type { LayoutMode } from "@/mobile/navigation";

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
  const [recordingsQueue, setRecordingsQueue] = useState<RecordingQueueSnapshot | null>(null);
  const [recordingsList, setRecordingsList] = useState<RecordingListItem[]>([]);
  const [recordingsBusy, setRecordingsBusy] = useState(false);
  const [recordingsError, setRecordingsError] = useState<string | null>(null);
  const [activeAudioPath, setActiveAudioPath] = useState<string | null>(null);
  const [activeAudioSrc, setActiveAudioSrc] = useState<string | null>(null);

  const transcriptionQueueBusyRef = useRef(false);
  const recordingTargetFolderRef = useRef<string>(FEED_FOLDER_PATH);
  const activeAudioObjectUrlRef = useRef<string | null>(null);
  const recordingsSignatureRef = useRef<string>("");

  const isDesktop = layoutMode === "desktop";

  const shouldAutoQueueTranscriptions =
    isDesktop || syncSettings.mobileAutoTranscriptionEnabled;

  const refreshRecordings = useCallback(async () => {
    setRecordingsBusy(true);
    try {
      const snapshot = await api.listRecordings();
      setRecordingsQueue(snapshot.queue);
      setRecordingsList(snapshot.recordings);
      const nextSignature = jobListSignature(snapshot.recordings);
      if (recordingsSignatureRef.current !== nextSignature) {
        recordingsSignatureRef.current = nextSignature;
        window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
      }
      if (activeAudioPath) {
        const stillExists = snapshot.recordings.some(
          (item) => item.audio_path === activeAudioPath
        );
        if (!stillExists) {
          if (activeAudioObjectUrlRef.current) {
            URL.revokeObjectURL(activeAudioObjectUrlRef.current);
            activeAudioObjectUrlRef.current = null;
          }
          setActiveAudioPath(null);
          setActiveAudioSrc(null);
        }
      }
      setRecordingsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingsError(message);
    } finally {
      setRecordingsBusy(false);
    }
  }, [activeAudioPath]);

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
      const message = error instanceof Error ? error.message : String(error);
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
        const message = error instanceof Error ? error.message : String(error);
        setRecordingStatusMessage(message);
      } finally {
        transcriptionQueueBusyRef.current = false;
        setTranscriptionQueueBusy(false);
        void refreshRecordings();
      }
    },
    [isDesktop, syncSettings.assemblyAiApiKey, refreshRecordings]
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
        const message = error instanceof Error ? error.message : String(error);
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

  // Auto queue transcriptions timer
  useEffect(() => {
    if (!shouldAutoQueueTranscriptions) {
      return;
    }
    // On desktop, local whisper needs no API key.
    // On mobile, require AssemblyAI key.
    if (!isDesktop && !syncSettings.assemblyAiApiKey.trim()) {
      return;
    }
    let intervalId: number | null = null;
    const startAutoQueue = () => {
      void queueRecordingTranscriptions("auto");
      intervalId = window.setInterval(() => {
        void queueRecordingTranscriptions("auto");
      }, 15000);
    };
    const delayMs = layoutMode === "phone" ? 3000 : 0;
    const startTimer = window.setTimeout(startAutoQueue, delayMs);
    return () => {
      window.clearTimeout(startTimer);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    layoutMode,
    isDesktop,
    syncSettings.assemblyAiApiKey,
    queueRecordingTranscriptions,
    shouldAutoQueueTranscriptions,
  ]);

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
