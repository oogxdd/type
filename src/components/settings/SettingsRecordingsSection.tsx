import { Button } from "../ui/button";
import { formatRecordingStatus, formatUpdatedAt } from "../../utils/format";
import { useSettingsData } from "../../hooks/useSettingsData";
import { useSessions } from "../../contexts/SessionsContext";
import { useRecordings } from "../../contexts/RecordingsContext";

export function SettingsRecordingsSection() {
  const { syncSettings, updateSyncSettings } = useSessions();
  const {
    recordingSupported,
    isRecordingAudio,
    recorderError,
    recordingStatusMessage,
    recordingLiveStatus,
    recordingsQueue,
    recordingsList,
    recordingsBusy,
    recordingsError,
    activeAudioSrc,
    startRecording,
    stopRecording,
    refreshRecordings,
    playRecording,
    queueRecordingTranscriptions,
  } = useRecordings();
  const { isRecordingBusy, recorderState, playButtonText } = useSettingsData();

  return (
    <>
      <h2 className="settings-detail-title">Recordings</h2>
      <p className="settings-detail-text">
        Recordings are saved as regular notes with front matter metadata.
        <br />
        Audio files are stored in <code>_Recordings</code>.
        <br />
        Pending recordings can be queued for AssemblyAI transcription.
      </p>
      <label className="settings-control">
        <span>AssemblyAI API key</span>
        <input
          type="password"
          value={syncSettings.assemblyAiApiKey}
          onChange={(event) => updateSyncSettings({ assemblyAiApiKey: event.target.value })}
          placeholder="Paste AssemblyAI key"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
      <div className="settings-control">
        <span>Mobile transcription</span>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={syncSettings.mobileAutoTranscriptionEnabled}
            onChange={(event) =>
              updateSyncSettings({ mobileAutoTranscriptionEnabled: event.target.checked })
            }
          />
          <span>Auto-queue on mobile</span>
        </label>
        <span className="settings-inline-help">
          Re-queues unfinished recordings on launch and while the mobile app stays open.
        </span>
      </div>
      <div className="settings-info-grid">
        <div className="settings-info-row">
          <span>Recorder</span>
          <code>
            {recorderState === "Unsupported"
              ? "unsupported"
              : recorderState === "Recording"
                ? "recording"
                : recorderState === "Saving"
                  ? "saving"
                  : "idle"}
          </code>
        </div>
        <div className="settings-info-row">
          <span>Transcription mode</span>
          <code>{syncSettings.assemblyAiApiKey.trim() ? "enabled" : "api key required"}</code>
        </div>
        <div className="settings-info-row">
          <span>Queue in-flight</span>
          <code>{recordingsQueue?.in_flight ?? 0}</code>
        </div>
        <div className="settings-info-row">
          <span>Queue active job</span>
          <code>{recordingsQueue?.current_recording ?? "-"}</code>
        </div>
      </div>
      {recordingStatusMessage ? (
        <label className="settings-control">
          <span>Last queue result</span>
          <span className="settings-inline-help">{recordingStatusMessage}</span>
        </label>
      ) : null}
      {recordingLiveStatus ? (
        <label className="settings-control">
          <span>Live recorder</span>
          <span className="settings-inline-help">{recordingLiveStatus}</span>
        </label>
      ) : null}
      {recorderError ? (
        <p className="settings-warning-text settings-inline-warning">{recorderError}</p>
      ) : null}
      <div className="settings-action-row">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void startRecording()}
          disabled={!recordingSupported || isRecordingAudio || isRecordingBusy}
        >
          Start recording
        </Button>
        <Button
          size="sm"
          type="button"
          onClick={stopRecording}
          disabled={!recordingSupported || !isRecordingAudio}
        >
          Stop and save
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => void refreshRecordings()}
          disabled={recordingsBusy}
        >
          {recordingsBusy ? "Refreshing..." : "Refresh queue"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => void queueRecordingTranscriptions("manual")}
          disabled={!syncSettings.assemblyAiApiKey.trim() || isRecordingBusy}
        >
          Queue transcription
        </Button>
      </div>
      {recordingsError ? (
        <p className="settings-warning-text settings-inline-warning">{recordingsError}</p>
      ) : null}
      <div className="settings-control">
        <span>Recordings monitor</span>
        <div className="settings-recordings-list">
          {recordingsList.length === 0 ? (
            <div className="settings-recording-row empty">No recordings yet.</div>
          ) : (
            recordingsList.map((item) => {
              const currentStatus = formatRecordingStatus(item);
              const canPlay = Boolean(item.audio_path);
              return (
                <div key={item.note_path} className="settings-recording-row">
                  <div className="settings-recording-main">
                    <div className="settings-recording-title">{item.note_path}</div>
                    <div className="settings-recording-meta">
                      <code>{currentStatus}</code>
                      <span>updated {formatUpdatedAt(item.updated_ms)}</span>
                    </div>
                    {item.error ? (
                      <p className="settings-warning-text settings-inline-warning">{item.error}</p>
                    ) : null}
                  </div>
                  <div className="settings-recording-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => item.audio_path && void playRecording(item.audio_path)}
                      disabled={!canPlay}
                    >
                      {playButtonText(item.audio_path ?? "")}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {activeAudioSrc ? <audio className="settings-recording-player" controls src={activeAudioSrc} /> : null}
      </div>
    </>
  );
}
