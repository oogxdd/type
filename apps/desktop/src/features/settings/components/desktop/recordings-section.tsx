import { useEffect } from "react";
import {
  formatHandwritingStatus,
  formatUpdatedAt,
} from "@typenotes/shared/format";
import {
  selectSyncSettings,
  updateSyncSettings,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsField,
  SettingsHelpText,
  SettingsInfoGrid,
  SettingsInfoRow,
  SettingsSection,
  SettingsSelect,
} from "../settings-ui";

export function SettingsRecordingsSection() {
  const syncSettings = useProfilesStore(selectSyncSettings);
  const {
    handwritingStatusMessage,
    handwritingQueue,
    handwritingJobs,
    handwritingBusy,
    handwritingError,
    refreshHandwritingJobs,
  } = useHandwriting();

  const isHuggingFace = syncSettings.handwritingOcrProvider === "huggingface";
  const providerKey = isHuggingFace
    ? syncSettings.huggingFaceApiKey
    : syncSettings.openAiApiKey;
  const providerModel = isHuggingFace
    ? syncSettings.huggingFaceModel
    : syncSettings.openAiModel;

  useEffect(() => {
    void refreshHandwritingJobs();
  }, [refreshHandwritingJobs]);

  return (
    <SettingsSection
      title="Recordings"
      description="Mobile voice transcription and handwriting OCR settings. For desktop voice transcription, see the Transcription section."
    >
      <SettingsCard
        title="Voice transcription (mobile)"
        description="Mobile uses AssemblyAI cloud transcription."
      >
        <SettingsField label="AssemblyAI API key">
          <Input
            type="password"
            value={syncSettings.assemblyAiApiKey}
            onChange={(event) => updateSyncSettings({ assemblyAiApiKey: event.target.value })}
            placeholder="Paste AssemblyAI key (mobile only)"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </SettingsField>
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={syncSettings.mobileAutoTranscriptionEnabled}
            onChange={(event) =>
              updateSyncSettings({ mobileAutoTranscriptionEnabled: event.target.checked })
            }
          />
          <span>Auto-queue voice transcription on mobile</span>
        </label>
      </SettingsCard>

      <SettingsCard title="Handwriting OCR">
        <SettingsField label="Provider">
          <SettingsSelect
            value={syncSettings.handwritingOcrProvider}
            onChange={(event) =>
              updateSyncSettings({
                handwritingOcrProvider: event.target.value as "openai" | "huggingface",
              })
            }
          >
            <option value="openai">OpenAI</option>
            <option value="huggingface">Hugging Face</option>
          </SettingsSelect>
        </SettingsField>
        <SettingsField label={isHuggingFace ? "Hugging Face API key" : "OpenAI API key"}>
          <Input
            type="password"
            value={providerKey}
            onChange={(event) =>
              updateSyncSettings(
                isHuggingFace
                  ? { huggingFaceApiKey: event.target.value }
                  : { openAiApiKey: event.target.value }
              )
            }
            placeholder={isHuggingFace ? "Paste Hugging Face key" : "Paste OpenAI key"}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </SettingsField>
        <SettingsField label={isHuggingFace ? "Model ID" : "Model"}>
          <Input
            type="text"
            value={providerModel}
            onChange={(event) =>
              updateSyncSettings(
                isHuggingFace
                  ? { huggingFaceModel: event.target.value }
                  : { openAiModel: event.target.value }
              )
            }
            placeholder={
              isHuggingFace ? "microsoft/trocr-base-handwritten" : "gpt-4.1-mini"
            }
            autoCapitalize="off"
            autoCorrect="off"
          />
        </SettingsField>
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={syncSettings.mobileAutoHandwritingOcrEnabled}
            onChange={(event) =>
              updateSyncSettings({
                mobileAutoHandwritingOcrEnabled: event.target.checked,
              })
            }
          />
          <span>Auto-queue handwriting OCR on mobile</span>
        </label>
      </SettingsCard>

      <SettingsCard title="Handwriting jobs">
        <SettingsInfoGrid>
          <SettingsInfoRow label="Queue in-flight">
            <code className="text-xs">{handwritingQueue?.in_flight ?? 0}</code>
          </SettingsInfoRow>
          <SettingsInfoRow label="Queue active job">
            <code className="text-xs">{handwritingQueue?.current_note ?? "-"}</code>
          </SettingsInfoRow>
        </SettingsInfoGrid>
        {handwritingStatusMessage ? (
          <SettingsHelpText>{handwritingStatusMessage}</SettingsHelpText>
        ) : null}
        <SettingsActionRow>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => void refreshHandwritingJobs()}
            disabled={handwritingBusy}
          >
            {handwritingBusy ? "Refreshing..." : "Refresh handwriting queue"}
          </Button>
        </SettingsActionRow>
        {handwritingError ? <SettingsErrorText>{handwritingError}</SettingsErrorText> : null}
      </SettingsCard>

      <SettingsCard title="Handwriting queue items">
        <SettingsInfoGrid>
          {handwritingJobs.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No handwriting OCR jobs yet.
            </div>
          ) : (
            handwritingJobs.map((item) => (
              <div
                key={item.note_path}
                className="grid gap-1 border-b border-border/50 px-3 py-2.5 last:border-b-0"
              >
                <div className="break-all text-sm font-medium text-foreground">{item.note_path}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <code>{formatHandwritingStatus(item)}</code>
                  <span>updated {formatUpdatedAt(item.updated_ms)}</span>
                </div>
                {item.error ? <SettingsErrorText>{item.error}</SettingsErrorText> : null}
              </div>
            ))
          )}
        </SettingsInfoGrid>
      </SettingsCard>
    </SettingsSection>
  );
}
