import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import * as api from "@/features/recording/api/recordings-api";
import type { WhisperStatusResult } from "@typenotes/shared/types";
import { getErrorMessage } from "@typenotes/shared/errors";

type WhisperEngineCardProps = {
  whisperModel: string;
  onWhisperModelChange: (value: string) => void;
};

/**
 * Local Whisper engine status + setup. Owns its own readiness state: a cheap,
 * side-effect-free probe on mount, and an explicit "Set up / Download model"
 * action that provisions the managed Python env. The only shared state is the
 * model name, which lives in profile sync settings.
 */
export function WhisperEngineCard({ whisperModel, onWhisperModelChange }: WhisperEngineCardProps) {
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatusResult | null>(null);
  const [whisperSettingUp, setWhisperSettingUp] = useState(false);

  // Lightweight readiness probe (does NOT provision — safe on mount).
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

  // Explicit provisioning: installs the env and downloads the chosen model.
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
    <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
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
      <p className="text-xs text-muted-foreground">
        No API key needed — the app manages its own Python environment. The first setup
        downloads the engine and model and can take a few minutes.
      </p>

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
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Model name (e.g. <code>large-v3</code>, <code>medium</code>, <code>small</code>) or
          an absolute path to a local model directory.
        </p>
      </div>

      {whisperStatus?.error ? (
        <p className="text-xs text-destructive break-words">{whisperStatus.error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
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
      </div>
    </section>
  );
}
