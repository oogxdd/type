import { formatRecordingStatus, formatUpdatedAt } from "../../../utils/format";
import { useSessions } from "../../../contexts/SessionsContext";
import { useRecordings } from "../../../contexts/RecordingsContext";
import { Group, ChoiceRow, InputRow, StatRow } from "./SettingsHelpers";

const getJobTitle = (notePath: string): string => {
  const trimmed = notePath.trim();
  if (!trimmed) {
    return notePath;
  }
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || notePath;
};

export function MobileRecordingsSection() {
  const { syncSettings, updateSyncSettings } = useSessions();
  const {
    recordingStatusMessage,
    recordingsQueue,
    recordingsList,
    recordingsBusy,
    recordingsError,
    refreshRecordings,
  } = useRecordings();
  const visibleJobs = recordingsList.slice(0, 12);

  return (
    <>
      <Group title="Transcription">
        <InputRow
          label="AssemblyAI API key"
          value={syncSettings.assemblyAiApiKey}
          onChange={(value) => updateSyncSettings({ assemblyAiApiKey: value })}
          placeholder="Paste AssemblyAI key"
          password
        />
        <ChoiceRow
          label="Auto queue on mobile"
          selected={syncSettings.mobileAutoTranscriptionEnabled}
          onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: true })}
        />
        <ChoiceRow
          label="Manual queue only"
          selected={!syncSettings.mobileAutoTranscriptionEnabled}
          onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: false })}
        />
      </Group>

      <Group title="Jobs">
        <StatRow label="In-flight" value={String(recordingsQueue?.in_flight ?? 0)} />
        <StatRow label="Current job" value={recordingsQueue?.current_recording ?? "-"} />
        {recordingStatusMessage ? <p className="mobile-native-note">{recordingStatusMessage}</p> : null}
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => void refreshRecordings()}
            disabled={recordingsBusy}
          >
            {recordingsBusy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </Group>

      <Group title="Recent jobs">
        {visibleJobs.length === 0 ? (
          <p className="mobile-native-note">No jobs yet.</p>
        ) : (
          visibleJobs.map((item) => (
            <div key={item.note_path} className="mobile-native-row stat mobile-recording-row">
              <span className="mobile-native-row-main">
                <span className="mobile-native-row-label">{getJobTitle(item.note_path)}</span>
                <span className="mobile-native-row-sub">
                  {formatRecordingStatus(item)} · updated {formatUpdatedAt(item.updated_ms)}
                </span>
              </span>
            </div>
          ))
        )}
      </Group>

      {recordingsError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Queue error</strong>
          <p>{recordingsError}</p>
        </section>
      ) : null}
    </>
  );
}
