type MobileRecordingScreenProps = {
  recordingSupported: boolean;
  isRecording: boolean;
  isBusy: boolean;
  recordingError: string | null;
  recordingStatus: string | null;
  hasAssemblyApiKey: boolean;
  onStart: () => void;
  onStop: () => void;
  onQueue: () => void;
};

export function MobileRecordingScreen({
  recordingSupported,
  isRecording,
  isBusy,
  recordingError,
  recordingStatus,
  hasAssemblyApiKey,
  onStart,
  onStop,
  onQueue,
}: MobileRecordingScreenProps) {
  const mainLabel = isRecording ? "Stop and save" : "Start recording";

  return (
    <div className="mobile-recording-screen">
      <section className="mobile-recording-card hero" aria-label="Recorder">
        <h2>Recorder</h2>
        <p>Tap once to start. Tap again to finish and save into Recordings.</p>
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
      </section>

      <section className="mobile-recording-card" aria-label="Transcription queue">
        <h2>Transcription</h2>
        <p>After save, desktop can auto-pick this recording for AssemblyAI.</p>
        <button
          type="button"
          className="mobile-secondary-btn"
          onClick={onQueue}
          disabled={!hasAssemblyApiKey || isBusy}
        >
          Queue transcription
        </button>
      </section>

      {recordingStatus ? (
        <section className="mobile-recording-card" aria-label="Last status">
          <h2>Last status</h2>
          <p>{recordingStatus}</p>
        </section>
      ) : null}

      {recordingError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Recording error</strong>
          <p>{recordingError}</p>
        </section>
      ) : null}
    </div>
  );
}
