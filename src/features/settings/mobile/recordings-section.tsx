import { useEffect } from "react";
import {
  formatHandwritingStatus,
  formatRecordingStatus,
  formatUpdatedAt,
} from "@/utils/format";
import { useProfiles } from "@/contexts/ProfilesContext";
import { useRecordings } from "@/contexts/RecordingsContext";
import { useHandwriting } from "@/contexts/HandwritingContext";
import { Group, ChoiceRow, InputRow, StatRow } from "./helpers";

const getJobTitle = (notePath: string): string => {
  const trimmed = notePath.trim();
  if (!trimmed) {
    return notePath;
  }
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || notePath;
};

export function MobileRecordingsSection() {
  const { syncSettings, updateSyncSettings } = useProfiles();
  const {
    recordingStatusMessage,
    recordingsQueue,
    recordingsList,
    recordingsBusy,
    recordingsError,
    refreshRecordings,
  } = useRecordings();
  const {
    handwritingStatusMessage,
    handwritingQueue,
    handwritingJobs,
    handwritingBusy,
    handwritingError,
    refreshHandwritingJobs,
  } = useHandwriting();

  const visibleVoiceJobs = recordingsList.slice(0, 12);
  const visibleHandwritingJobs = handwritingJobs.slice(0, 12);
  const isHuggingFace = syncSettings.handwritingOcrProvider === "huggingface";

  useEffect(() => {
    void refreshRecordings();
    void refreshHandwritingJobs();
  }, [refreshHandwritingJobs, refreshRecordings]);

  return (
    <>
      <Group title="Voice transcription">
        <InputRow
          label="AssemblyAI API key"
          value={syncSettings.assemblyAiApiKey}
          onChange={(value) => updateSyncSettings({ assemblyAiApiKey: value })}
          placeholder="Paste AssemblyAI key"
          password
        />
        <ChoiceRow
          label="Auto queue voice on mobile"
          selected={syncSettings.mobileAutoTranscriptionEnabled}
          onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: true })}
        />
        <ChoiceRow
          label="Manual voice queue only"
          selected={!syncSettings.mobileAutoTranscriptionEnabled}
          onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: false })}
        />
      </Group>

      <Group title="Handwriting OCR">
        <ChoiceRow
          label="OpenAI"
          selected={syncSettings.handwritingOcrProvider === "openai"}
          onClick={() => updateSyncSettings({ handwritingOcrProvider: "openai" })}
        />
        <ChoiceRow
          label="Hugging Face"
          selected={syncSettings.handwritingOcrProvider === "huggingface"}
          onClick={() => updateSyncSettings({ handwritingOcrProvider: "huggingface" })}
        />
        <InputRow
          label={isHuggingFace ? "Hugging Face API key" : "OpenAI API key"}
          value={isHuggingFace ? syncSettings.huggingFaceApiKey : syncSettings.openAiApiKey}
          onChange={(value) =>
            updateSyncSettings(
              isHuggingFace ? { huggingFaceApiKey: value } : { openAiApiKey: value }
            )
          }
          placeholder={isHuggingFace ? "Paste Hugging Face key" : "Paste OpenAI key"}
          password
        />
        <InputRow
          label={isHuggingFace ? "Model ID" : "Model"}
          value={isHuggingFace ? syncSettings.huggingFaceModel : syncSettings.openAiModel}
          onChange={(value) =>
            updateSyncSettings(
              isHuggingFace ? { huggingFaceModel: value } : { openAiModel: value }
            )
          }
          placeholder={isHuggingFace ? "microsoft/trocr-base-handwritten" : "gpt-4.1-mini"}
        />
        <ChoiceRow
          label="Auto queue handwriting on mobile"
          selected={syncSettings.mobileAutoHandwritingOcrEnabled}
          onClick={() => updateSyncSettings({ mobileAutoHandwritingOcrEnabled: true })}
        />
        <ChoiceRow
          label="Manual handwriting queue only"
          selected={!syncSettings.mobileAutoHandwritingOcrEnabled}
          onClick={() => updateSyncSettings({ mobileAutoHandwritingOcrEnabled: false })}
        />
      </Group>

      <Group title="Voice jobs">
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
            {recordingsBusy ? "Refreshing..." : "Refresh voice queue"}
          </button>
        </div>
      </Group>

      <Group title="Handwriting jobs">
        <StatRow label="In-flight" value={String(handwritingQueue?.in_flight ?? 0)} />
        <StatRow label="Current job" value={handwritingQueue?.current_note ?? "-"} />
        {handwritingStatusMessage ? (
          <p className="mobile-native-note">{handwritingStatusMessage}</p>
        ) : null}
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => void refreshHandwritingJobs()}
            disabled={handwritingBusy}
          >
            {handwritingBusy ? "Refreshing..." : "Refresh handwriting queue"}
          </button>
        </div>
      </Group>

      <Group title="Recent voice jobs">
        {visibleVoiceJobs.length === 0 ? (
          <p className="mobile-native-note">No jobs yet.</p>
        ) : (
          visibleVoiceJobs.map((item) => (
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

      <Group title="Recent handwriting jobs">
        {visibleHandwritingJobs.length === 0 ? (
          <p className="mobile-native-note">No jobs yet.</p>
        ) : (
          visibleHandwritingJobs.map((item) => (
            <div key={item.note_path} className="mobile-native-row stat mobile-recording-row">
              <span className="mobile-native-row-main">
                <span className="mobile-native-row-label">{getJobTitle(item.note_path)}</span>
                <span className="mobile-native-row-sub">
                  {formatHandwritingStatus(item)} · updated {formatUpdatedAt(item.updated_ms)}
                </span>
              </span>
            </div>
          ))
        )}
      </Group>

      {recordingsError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Voice queue error</strong>
          <p>{recordingsError}</p>
        </section>
      ) : null}
      {handwritingError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Handwriting queue error</strong>
          <p>{handwritingError}</p>
        </section>
      ) : null}
    </>
  );
}
