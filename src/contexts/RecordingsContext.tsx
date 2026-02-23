import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/notesApi";
import type { RecordingListItem, RecordingQueueSnapshot } from "../types";
import { FEED_FOLDER_PATH } from "../constants";
import { toBase64, fromBase64 } from "../utils/notes";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useProfiles } from "./ProfilesContext";

const recordingsPreviewSignature = (items: RecordingListItem[]) =>
  items
    .map((item) =>
      [
        item.note_path,
        item.status,
        item.updated_ms ?? "",
        item.error ?? "",
        item.is_queued ? "1" : "0",
        item.is_processing ? "1" : "0",
      ].join("|")
    )
    .sort()
    .join("||");

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
  layoutMode: string;
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

  const shouldAutoQueueTranscriptions =
    layoutMode === "desktop" || syncSettings.mobileAutoTranscriptionEnabled;

  const refreshRecordings = useCallback(async () => {
    setRecordingsBusy(true);
    try {
      const snapshot = await api.listRecordings();
      setRecordingsQueue(snapshot.queue);
      setRecordingsList(snapshot.recordings);
      const nextSignature = recordingsPreviewSignature(snapshot.recordings);
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
      const apiKey = syncSettings.assemblyAiApiKey.trim();
      if (!apiKey) {
        if (trigger === "manual") {
          setRecordingStatusMessage("AssemblyAI API key is required.");
        }
        return;
      }

      transcriptionQueueBusyRef.current = true;
      setTranscriptionQueueBusy(true);
      try {
        const result = await api.queueRecordingTranscriptions(apiKey);
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
    [syncSettings.assemblyAiApiKey, refreshRecordings]
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
    if (!shouldAutoQueueTranscriptions || !syncSettings.assemblyAiApiKey.trim()) {
      return;
    }
    void queueRecordingTranscriptions("auto");
    const timer = window.setInterval(() => {
      void queueRecordingTranscriptions("auto");
    }, 15000);
    return () => window.clearInterval(timer);
  }, [syncSettings.assemblyAiApiKey, queueRecordingTranscriptions, shouldAutoQueueTranscriptions]);

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
