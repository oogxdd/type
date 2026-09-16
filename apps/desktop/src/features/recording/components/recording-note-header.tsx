import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecordingPlayback } from "../hooks/use-recording-playback";
import { transcriptionState, transcriptionErrorSummary, transcriptionErrorDetails } from "../lib/transcription-presentation";
import { Mic } from "lucide-react";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import {
  formatRecordingStatusLabel,
  type NotePreview,
} from "@typenotes/shared/format";

type RecordingNoteHeaderProps = {
  notePath: string | null;
  preview?: NotePreview;
};

export function RecordingNoteHeader({ notePath, preview }: RecordingNoteHeaderProps) {
  const {
    recordingsList,
    recordingsQueue,
    recordingsError,
    refreshRecordings,
    retriggerTranscription,
    resolveAudioSrc,
  } = useRecordings();
  const [retriggerBusy, setRetriggerBusy] = useState(false);

  const recordingItem = useMemo(
    () => recordingsList.find((item) => item.note_path === notePath),
    [notePath, recordingsList]
  );
  const isRecording = Boolean(notePath && (preview?.isRecording || recordingItem));

  const effectiveStatus = recordingItem
    ? transcriptionState(recordingItem)
    : preview?.transcriptionStatus || "pending";

  const isProcessing = recordingItem?.is_processing ?? effectiveStatus === "processing";
  const isQueued = recordingItem?.is_queued ?? effectiveStatus === "queued";
  const queueIndex = notePath ? recordingsQueue?.pending.indexOf(notePath) ?? -1 : -1;
  const queuePosition = queueIndex >= 0 ? queueIndex + 1 : null;
  const queuePositionLabel = isProcessing ? "in progress" : isQueued ? queuePosition || "queued" : "-";

  const audioPath = recordingItem ? recordingItem.audio_path : preview?.recordingAudioPath || null;
  const { src: audioSrc, error: playbackError } = useRecordingPlayback(notePath, audioPath, resolveAudioSrc);
  const showTranscribeNow =
    Boolean(audioPath) && !isQueued && !isProcessing && effectiveStatus !== "completed";
  const showRetrigger =
    Boolean(audioPath) && !isQueued && !isProcessing &&
    effectiveStatus === "completed";

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
          <span className="value">{effectiveStatus === "waiting" ? "Awaiting audio" : formatRecordingStatusLabel(effectiveStatus)}</span>
        </div>
        <div className="recording-note-metric">
          <span className="label">Queued</span>
          <span className="value">{isQueued || isProcessing ? "Yes" : "No"}</span>
        </div>
        <div className="recording-note-metric">
          <span className="label">Queue #</span>
          <span className="value">{queuePositionLabel}</span>
        </div>
        {isProcessing && recordingsQueue?.current_recording === notePath && recordingsQueue?.progress ? (
          <div className="recording-note-metric">
            <span className="label">Progress</span>
            <span className="value">
              {recordingsQueue.progress.total_seconds > 0
                ? `${Math.min(
                    100,
                    Math.round(
                      (recordingsQueue.progress.processed_seconds /
                        recordingsQueue.progress.total_seconds) *
                        100
                    )
                  )}%`
                : "-"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="recording-note-actions">
        {showTranscribeNow ? (
          <button
            type="button"
            className="recording-note-btn"
            onClick={() => void handleRetrigger()}
            disabled={retriggerBusy}
          >
            {retriggerBusy ? "Queueing..." : "Transcribe now"}
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
      </div>

      {audioPath ? (
        audioSrc ? (
          <audio key={notePath} className="recording-note-player" controls preload="metadata" src={audioSrc} />
        ) : null
      ) : (
        <p className="recording-note-message">Audio has not arrived on this device. Open Sync on your phone to transfer it.</p>
      )}

      {playbackError ? <p className="recording-note-message">{playbackError}</p> : null}
      {effectiveStatus === "failed" && recordingItem?.error ? (
        <div className="recording-note-message error">
          <p>{transcriptionErrorSummary(recordingItem.error)}</p>
          <details className="mt-2">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
              {transcriptionErrorDetails(recordingItem.error)}
            </pre>
          </details>
        </div>
      ) : null}
      {recordingsError ? <p className="recording-note-message error">{recordingsError}</p> : null}
    </div>
  );
}
