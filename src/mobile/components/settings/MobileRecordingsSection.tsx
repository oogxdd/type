import { formatRecordingStatus } from "../../../utils/format";
import { useSettingsData } from "../../../hooks/useSettingsData";
import { useSessions } from "../../../contexts/SessionsContext";
import { useRecordings } from "../../../contexts/RecordingsContext";
import { useSelection } from "../../../contexts/SelectionContext";
import { Group, ChoiceRow, InputRow, StatRow } from "./SettingsHelpers";

export function MobileRecordingsSection() {
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
  const { activeFolder } = useSelection();
  const { isRecordingBusy, canQueue, recorderState, playButtonText } = useSettingsData();

  return (
    <>
      <Group title="Recorder">
        <StatRow label="Recorder state" value={recorderState} />
        <StatRow label="Device support" value={recordingSupported ? "Supported" : "Unsupported"} />
        <div className="mobile-native-actions">
          <button
            type="button"
            className="mobile-primary-btn"
            onClick={() => void startRecording(activeFolder || undefined)}
            disabled={!recordingSupported || isRecordingAudio || isRecordingBusy}
          >
            Start recording
          </button>
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={stopRecording}
            disabled={!recordingSupported || !isRecordingAudio}
          >
            Stop and save
          </button>
        </div>
      </Group>

      <Group title="Transcription">
        <InputRow
          label="AssemblyAI API key"
          value={syncSettings.assemblyAiApiKey}
          onChange={(v) => updateSyncSettings({ assemblyAiApiKey: v })}
          placeholder="Paste AssemblyAI key"
          password
        />
        <ChoiceRow
          label="Auto queue on mobile"
          subtitle="Retry unfinished recordings on launch and while app is open."
          selected={syncSettings.mobileAutoTranscriptionEnabled}
          onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: true })}
        />
        <ChoiceRow
          label="Manual queue only"
          subtitle="Only queue when you tap Queue transcription."
          selected={!syncSettings.mobileAutoTranscriptionEnabled}
          onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: false })}
        />
        <div className="mobile-native-actions single">
          <button type="button" className="mobile-secondary-btn" onClick={() => void queueRecordingTranscriptions("manual")} disabled={!canQueue}>
            Queue transcription
          </button>
          <button type="button" className="mobile-secondary-btn" onClick={() => void refreshRecordings()} disabled={recordingsBusy}>
            {recordingsBusy ? "Refreshing..." : "Refresh queue"}
          </button>
        </div>
        <StatRow label="In-flight" value={String(recordingsQueue?.in_flight ?? 0)} />
        <StatRow label="Current job" value={recordingsQueue?.current_recording ?? "-"} />
        {recordingStatusMessage ? <p className="mobile-native-note">{recordingStatusMessage}</p> : null}
        {recordingLiveStatus ? (
          <p className="mobile-native-note">{recordingLiveStatus}</p>
        ) : null}
      </Group>

      <Group title="Recordings monitor">
        {recordingsList.length === 0 ? (
          <p className="mobile-native-note">No recordings yet.</p>
        ) : (
          recordingsList.map((item) => (
            <div key={item.note_path} className="mobile-native-row stat mobile-recording-row">
              <span className="mobile-native-row-main">
                <span className="mobile-native-row-label">{item.note_path}</span>
                <span className="mobile-native-row-sub">{formatRecordingStatus(item)}</span>
              </span>
              <button
                type="button"
                className="mobile-secondary-btn mobile-recording-play"
                onClick={() => item.audio_path && void playRecording(item.audio_path)}
                disabled={!item.audio_path}
              >
                {playButtonText(item.audio_path ?? "")}
              </button>
            </div>
          ))
        )}
        {activeAudioSrc ? (
          <audio
            className="mobile-recording-player"
            controls
            autoPlay
            playsInline
            src={activeAudioSrc}
          />
        ) : null}
      </Group>

      {recorderError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Recording error</strong>
          <p>{recorderError}</p>
        </section>
      ) : null}
      {recordingsError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Queue error</strong>
          <p>{recordingsError}</p>
        </section>
      ) : null}
    </>
  );
}
