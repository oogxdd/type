import { useEffect } from "react";
import {
  formatHandwritingStatus,
  formatUpdatedAt,
} from "@/shared/lib/format";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

export function SettingsRecordingsSection() {
  const { syncSettings, updateSyncSettings } = useProfiles();
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
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Recordings</h2>
        <p className="text-sm text-muted-foreground">
          Mobile voice transcription and handwriting OCR settings. For desktop voice
          transcription, see the <strong>Transcription</strong> section.
        </p>
      </div>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Voice transcription (mobile)</h3>
          <p className="text-xs text-muted-foreground">
            Mobile uses AssemblyAI cloud transcription.
          </p>
          <label className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">AssemblyAI API key</span>
            <Input
              type="password"
              value={syncSettings.assemblyAiApiKey}
              onChange={(event) => updateSyncSettings({ assemblyAiApiKey: event.target.value })}
              placeholder="Paste AssemblyAI key (mobile only)"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <div className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">Mobile transcription</span>
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
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Handwriting OCR</h3>
          <label className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">Provider</span>
            <select
              className="h-9 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring/60"
              value={syncSettings.handwritingOcrProvider}
              onChange={(event) =>
                updateSyncSettings({
                  handwritingOcrProvider: event.target.value as "openai" | "huggingface",
                })
              }
            >
              <option value="openai">OpenAI</option>
              <option value="huggingface">Hugging Face</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">
              {isHuggingFace ? "Hugging Face API key" : "OpenAI API key"}
            </span>
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
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">
              {isHuggingFace ? "Model ID" : "Model"}
            </span>
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
          </label>
          <div className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">Mobile handwriting OCR</span>
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
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Handwriting jobs</h3>
          <div className="overflow-hidden rounded-md border border-border/70">
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-3 py-2 text-sm">
              <span>Queue in-flight</span>
              <code className="text-xs">{handwritingQueue?.in_flight ?? 0}</code>
            </div>
            <div className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
              <span>Queue active job</span>
              <code className="text-xs">{handwritingQueue?.current_note ?? "-"}</code>
            </div>
          </div>
          {handwritingStatusMessage ? (
            <span className="text-xs text-muted-foreground">{handwritingStatusMessage}</span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void refreshHandwritingJobs()}
              disabled={handwritingBusy}
            >
              {handwritingBusy ? "Refreshing..." : "Refresh handwriting queue"}
            </Button>
          </div>
          {handwritingError ? <p className="text-xs text-destructive">{handwritingError}</p> : null}
        </section>

        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Handwriting queue items</h3>
          <div className="overflow-hidden rounded-md border border-border/70">
            {handwritingJobs.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No handwriting OCR jobs yet.
              </div>
            ) : (
              handwritingJobs.map((item) => (
                <div
                  key={item.note_path}
                  className="grid gap-1 border-b border-border/70 px-3 py-2.5 last:border-b-0"
                >
                  <div className="text-sm font-medium text-foreground break-all">{item.note_path}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <code>{formatHandwritingStatus(item)}</code>
                    <span>updated {formatUpdatedAt(item.updated_ms)}</span>
                  </div>
                  {item.error ? <p className="text-xs text-destructive">{item.error}</p> : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
