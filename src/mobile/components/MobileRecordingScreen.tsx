import { useEffect, useRef } from "react";

type MobileRecordingScreenProps = {
  recordingSupported: boolean;
  isRecording: boolean;
  isBusy: boolean;
  recordingError: string | null;
  recordingStatus: string | null;
  recordingLiveStatus: string | null;
  hasAssemblyApiKey: boolean;
  handwritingImportBusy: boolean;
  handwritingQueueBusy: boolean;
  handwritingStatus: string | null;
  handwritingError: string | null;
  hasHandwritingProviderConfig: boolean;
  onStart: () => void;
  onStop: () => void;
  onQueue: () => void;
  onPickHandwriting: () => void;
  onQueueHandwriting: () => void;
  autoStart?: boolean;
};

export function MobileRecordingScreen({
  recordingSupported,
  isRecording,
  isBusy,
  recordingError,
  recordingStatus,
  recordingLiveStatus,
  hasAssemblyApiKey,
  handwritingImportBusy,
  handwritingQueueBusy,
  handwritingStatus,
  handwritingError,
  hasHandwritingProviderConfig,
  onStart,
  onStop,
  onQueue,
  onPickHandwriting,
  onQueueHandwriting,
  autoStart,
}: MobileRecordingScreenProps) {
  const autoStartFired = useRef(false);

  useEffect(() => {
    if (autoStart && recordingSupported && !isRecording && !isBusy && !autoStartFired.current) {
      autoStartFired.current = true;
      onStart();
    }
  }, [autoStart, recordingSupported, isRecording, isBusy, onStart]);

  const mainLabel = isRecording ? "Stop and save" : "Start recording";

  return (
    <div className="mobile-recording-screen">
      <section className="mobile-recording-card hero" aria-label="Recorder">
        <h2>Recorder</h2>
        <p>Tap once to start. Tap again to finish and save into the selected folder.</p>
        <button
          type="button"
          className={`mobile-recording-toggle${isRecording ? " active" : ""}`}
          onClick={isRecording ? onStop : onStart}
          disabled={!recordingSupported || isBusy}
        >
          <span className="dot" aria-hidden />
          <span>{mainLabel}</span>
        </button>
        <div className="mobile-recording-meta" role="status" aria-live="polite">
          {!recordingSupported
            ? "Recording is not supported on this device."
            : isRecording
              ? "Recording now..."
              : isBusy
                ? "Saving audio..."
                : "Ready"}
        </div>
        {recordingLiveStatus ? (
          <p className="mobile-native-note">{recordingLiveStatus}</p>
        ) : null}
      </section>

      <section className="mobile-recording-card" aria-label="Transcription queue">
        <h2>Transcription</h2>
        <p>After save, pending recordings can be queued for AssemblyAI.</p>
        <button
          type="button"
          className="mobile-secondary-btn"
          onClick={onQueue}
          disabled={!hasAssemblyApiKey || isBusy}
        >
          Queue transcription
        </button>
      </section>

      <section className="mobile-recording-card" aria-label="Handwriting OCR">
        <h2>Handwriting</h2>
        <p>Pick an image to create a handwriting note and queue OCR.</p>
        <div className="mobile-native-actions">
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={onPickHandwriting}
            disabled={handwritingImportBusy}
          >
            {handwritingImportBusy ? "Importing..." : "Pick handwriting image"}
          </button>
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={onQueueHandwriting}
            disabled={
              !hasHandwritingProviderConfig ||
              isBusy ||
              handwritingImportBusy ||
              handwritingQueueBusy
            }
          >
            {handwritingQueueBusy ? "Queueing..." : "Queue handwriting OCR"}
          </button>
        </div>
      </section>

      {recordingStatus ? (
        <section className="mobile-recording-card" aria-label="Last status">
          <h2>Last status</h2>
          <p>{recordingStatus}</p>
        </section>
      ) : null}

      {handwritingStatus ? (
        <section className="mobile-recording-card" aria-label="Handwriting status">
          <h2>Handwriting status</h2>
          <p>{handwritingStatus}</p>
        </section>
      ) : null}

      {recordingError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Recording error</strong>
          <p>{recordingError}</p>
        </section>
      ) : null}

      {handwritingError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Handwriting error</strong>
          <p>{handwritingError}</p>
        </section>
      ) : null}
    </div>
  );
}
