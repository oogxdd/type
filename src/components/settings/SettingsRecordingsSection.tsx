import { formatRecordingStatus, formatUpdatedAt } from "../../utils/format";
import { useProfiles } from "../../contexts/ProfilesContext";
import { useRecordings } from "../../contexts/RecordingsContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function SettingsRecordingsSection() {
  const { syncSettings, updateSyncSettings } = useProfiles();
  const {
    recordingStatusMessage,
    recordingsQueue,
    recordingsList,
    recordingsBusy,
    recordingsError,
    refreshRecordings,
  } = useRecordings();

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">Recordings</h2>
        <p className="settings-detail-text">Transcription settings and job status.</p>
      </div>

      <div className="settings-section-stack">
        <section className="settings-group">
          <h3 className="settings-group-title">Transcription</h3>
          <label className="settings-control">
            <span>AssemblyAI API key</span>
            <Input
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
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Jobs</h3>
          <div className="settings-info-grid">
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
            <div className="settings-control">
              <span>Last queue result</span>
              <span className="settings-inline-help">{recordingStatusMessage}</span>
            </div>
          ) : null}
          <div className="settings-action-row">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void refreshRecordings()}
              disabled={recordingsBusy}
            >
              {recordingsBusy ? "Refreshing..." : "Refresh queue"}
            </Button>
          </div>
          {recordingsError ? (
            <p className="settings-warning-text settings-inline-warning">{recordingsError}</p>
          ) : null}
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Queue items</h3>
          <div className="settings-recordings-list">
            {recordingsList.length === 0 ? (
              <div className="settings-recording-row empty">No recordings yet.</div>
            ) : (
              recordingsList.map((item) => {
                const currentStatus = formatRecordingStatus(item);
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
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}
