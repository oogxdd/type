import { useCallback, useEffect, useMemo, useState } from "react";
import { Mic } from "lucide-react";
import { useRecordings } from "@/contexts/recordings-context";
import {
  formatRecordingStatus,
  formatRecordingStatusLabel,
  type NotePreview,
} from "@/utils/format";

type RecordingNoteHeaderProps = {
  notePath: string | null;
  preview?: NotePreview;
};

export function RecordingNoteHeader({ notePath, preview }: RecordingNoteHeaderProps) {
  const {
    recordingsList,
    recordingsQueue,
    recordingsError,
    transcriptionQueueBusy,
    refreshRecordings,
    queueRecordingTranscriptions,
    retriggerTranscription,
    playRecording,
    activeAudioPath,
    activeAudioSrc,
  } = useRecordings();
  const [playerBusy, setPlayerBusy] = useState(false);
  const [retriggerBusy, setRetriggerBusy] = useState(false);

  const recordingItem = useMemo(
    () => recordingsList.find((item) => item.note_path === notePath),
    [notePath, recordingsList]
  );
  const isRecording = Boolean(notePath && (preview?.isRecording || recordingItem));

  const effectiveStatus = recordingItem
    ? formatRecordingStatus(recordingItem)
    : preview?.transcriptionStatus || "pending";

  const isProcessing = recordingItem?.is_processing ?? effectiveStatus === "processing";
  const isQueued = recordingItem?.is_queued ?? effectiveStatus === "queued";
  const queueIndex = notePath ? recordingsQueue?.pending.indexOf(notePath) ?? -1 : -1;
  const queuePosition = queueIndex >= 0 ? queueIndex + 1 : null;
  const queuePositionLabel = isProcessing ? "in progress" : isQueued ? queuePosition || "queued" : "-";

  const audioPath = recordingItem?.audio_path || preview?.recordingAudioPath || null;
  const showTranscribeNow =
    Boolean(audioPath) && !isQueued && !isProcessing && effectiveStatus !== "completed";
  const showRetrigger =
    Boolean(audioPath) && !isQueued && !isProcessing &&
    (effectiveStatus === "completed" || effectiveStatus === "failed");

  const loadAudioPlayer = useCallback(async () => {
    if (!audioPath) {
      return;
    }
    setPlayerBusy(true);
    try {
      await playRecording(audioPath);
    } finally {
      setPlayerBusy(false);
    }
  }, [audioPath, playRecording]);

  const handleRetrigger = useCallback(async () => {
    if (!notePath) return;
    setRetriggerBusy(true);
    try {
      await retriggerTranscription(notePath);
      await refreshRecordings();
    } finally {
      setRetriggerBusy(false);
    }
  }, [notePath, retriggerTranscription, refreshRecordings]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    void refreshRecordings();
    const timer = window.setInterval(() => {
      void refreshRecordings();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [isRecording, refreshRecordings]);

  useEffect(() => {
    if (!isRecording || !audioPath) {
      return;
    }
    if (activeAudioPath === audioPath && activeAudioSrc) {
      return;
    }
    void loadAudioPlayer();
  }, [activeAudioPath, activeAudioSrc, audioPath, isRecording, loadAudioPlayer]);

  if (!isRecording || !notePath) {
    return null;
  }

  return (
    <div className="recording-note-header" role="status" aria-live="polite">
      <div className="recording-note-header-top">
        <span className="recording-note-chip">
          <Mic size={13} />
          <span>Voice recording</span>
        </span>
      </div>

      <div className="recording-note-metrics">
        <div className="recording-note-metric">
          <span className="label">Status</span>
          <span className="value">{formatRecordingStatusLabel(effectiveStatus)}</span>
        </div>
        <div className="recording-note-metric">
          <span className="label">Queued</span>
          <span className="value">{isQueued || isProcessing ? "Yes" : "No"}</span>
        </div>
        <div className="recording-note-metric">
          <span className="label">Queue #</span>
          <span className="value">{queuePositionLabel}</span>
        </div>
      </div>

      <div className="recording-note-actions">
        {showTranscribeNow ? (
          <button
            type="button"
            className="recording-note-btn"
            onClick={() => {
              void (async () => {
                await queueRecordingTranscriptions("manual");
                await refreshRecordings();
              })();
            }}
            disabled={transcriptionQueueBusy}
          >
            {transcriptionQueueBusy ? "Queueing..." : "Transcribe now"}
          </button>
        ) : null}
        {showRetrigger ? (
          <button
            type="button"
            className="recording-note-btn"
            onClick={() => void handleRetrigger()}
            disabled={retriggerBusy}
          >
            {retriggerBusy ? "Re-queueing..." : "Retranscribe"}
          </button>
        ) : null}
        {audioPath && !(activeAudioPath === audioPath && activeAudioSrc) ? (
          <button
            type="button"
            className="recording-note-btn ghost"
            onClick={() => {
              void loadAudioPlayer();
            }}
            disabled={playerBusy}
          >
            {playerBusy ? "Loading player..." : "Load player"}
          </button>
        ) : null}
      </div>

      {audioPath ? (
        activeAudioPath === audioPath && activeAudioSrc ? (
          <audio className="recording-note-player" controls preload="metadata" src={activeAudioSrc} />
        ) : null
      ) : (
        <p className="recording-note-message">Audio file is missing for this note.</p>
      )}

      {recordingItem?.error ? (
        <p className="recording-note-message error">{recordingItem.error}</p>
      ) : null}
      {recordingsError ? <p className="recording-note-message error">{recordingsError}</p> : null}
    </div>
  );
}
