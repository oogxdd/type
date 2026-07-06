import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import * as api from "@/features/recording/api/recordings-api";
import type { WhisperStatusResult } from "@typenotes/shared/types";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsHelpText,
} from "../settings-ui";

type WhisperEngineCardProps = {
  whisperModel: string;
  onWhisperModelChange: (value: string) => void;
};

export function WhisperEngineCard({ whisperModel, onWhisperModelChange }: WhisperEngineCardProps) {
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatusResult | null>(null);
  const [whisperSettingUp, setWhisperSettingUp] = useState(false);

  const probeWhisper = useCallback(async () => {
    try {
      setWhisperStatus(await api.checkWhisperStatus());
    } catch (error) {
      setWhisperStatus({
        available: false,
        python_found: false,
        error: getErrorMessage(error),
      });
    }
  }, []);

  const setUpWhisper = useCallback(async () => {
    setWhisperSettingUp(true);
    try {
      const status = await api.checkWhisperStatus(whisperModel.trim() || undefined, true);
      setWhisperStatus(status);
    } catch (error) {
      setWhisperStatus({
        available: false,
        python_found: false,
        error: getErrorMessage(error),
      });
    } finally {
      setWhisperSettingUp(false);
    }
  }, [whisperModel]);

  useEffect(() => {
    void probeWhisper();
  }, [probeWhisper]);

  const envReady = whisperStatus?.available ?? false;

  return (
    <SettingsCard>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Local engine (Whisper)</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            envReady
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              envReady ? "bg-emerald-500" : "bg-muted-foreground/50"
            }`}
          />
          {whisperStatus === null ? "Checking…" : envReady ? "Ready" : "Not set up"}
        </span>
      </div>
      <SettingsHelpText>
        No API key needed — the app manages its own Python environment. The first setup
        downloads the engine and model and can take a few minutes.
      </SettingsHelpText>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-foreground">Model / Path</span>
          <div className="flex flex-1 items-center gap-2 max-w-[300px]">
            <Input
              type="text"
              className="h-8 text-xs font-mono"
              value={whisperModel}
              onChange={(e) => onWhisperModelChange(e.target.value)}
              placeholder="large-v3"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={async () => {
                try {
                  const selected = await open({
                    directory: true,
                    multiple: false,
                    title: "Select Whisper model directory",
                  });
                  if (selected && typeof selected === "string") {
                    onWhisperModelChange(selected);
                  }
                } catch (err) {
                  console.error("Failed to open dialog", err);
                }
              }}
            >
              Browse
            </Button>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Model name (e.g. <code>large-v3</code>, <code>medium</code>, <code>small</code>) or
          an absolute path to a local model directory.
        </p>
      </div>

      {whisperStatus?.error ? (
        <SettingsErrorText>{whisperStatus.error}</SettingsErrorText>
      ) : null}

      <SettingsActionRow>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => void setUpWhisper()}
          disabled={whisperSettingUp}
        >
          {whisperSettingUp
            ? "Setting up…"
            : envReady
              ? "Re-check / Download model"
              : "Set up / Download model"}
        </Button>
      </SettingsActionRow>
    </SettingsCard>
  );
}
