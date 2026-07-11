import { useCallback, useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { LocalOcrStatusResult } from "@typenotes/shared/types";
import { getErrorMessage } from "@typenotes/shared/errors";

import * as api from "@/features/handwriting/api/handwriting-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsHelpText,
} from "../settings-ui";

type LocalOcrEngineCardProps = {
  modelPath: string;
  onModelPathChange: (value: string) => void;
};

export function LocalOcrEngineCard({
  modelPath,
  onModelPathChange,
}: LocalOcrEngineCardProps) {
  const [status, setStatus] = useState<LocalOcrStatusResult | null>(null);
  const [settingUp, setSettingUp] = useState(false);

  const probe = useCallback(async () => {
    try {
      setStatus(await api.checkLocalOcrStatus(modelPath.trim() || undefined));
    } catch (error) {
      setStatus({
        available: false,
        python_found: false,
        model_path: modelPath,
        error: getErrorMessage(error),
      });
    }
  }, [modelPath]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const setUp = async () => {
    setSettingUp(true);
    try {
      setStatus(await api.checkLocalOcrStatus(modelPath.trim() || undefined, true));
    } catch (error) {
      setStatus({
        available: false,
        python_found: false,
        model_path: modelPath,
        error: getErrorMessage(error),
      });
    } finally {
      setSettingUp(false);
    }
  };

  const ready = status?.available ?? false;

  return (
    <SettingsCard>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Local engine (EasyOCR)</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            ready
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              ready ? "bg-emerald-500" : "bg-muted-foreground/50"
            }`}
          />
          {status === null ? "Checking..." : ready ? "Ready" : "Not set up"}
        </span>
      </div>
      <SettingsHelpText>
        Runs on this computer with no API key. First setup installs the managed engine and
        downloads its detection and recognition models.
      </SettingsHelpText>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-foreground">Model storage</span>
          <div className="flex max-w-[340px] flex-1 items-center gap-2">
            <Input
              type="text"
              className="h-8 text-xs font-mono"
              value={modelPath}
              onChange={(event) => onModelPathChange(event.target.value)}
              placeholder={status?.model_path || "App data (default)"}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
            <Button
              variant="secondary"
              size="icon-sm"
              type="button"
              title="Choose model storage folder"
              aria-label="Choose model storage folder"
              onClick={async () => {
                const selected = await open({
                  directory: true,
                  multiple: false,
                  title: "Select local OCR model storage",
                });
                if (selected && typeof selected === "string") {
                  onModelPathChange(selected);
                }
              }}
            >
              <FolderOpen size={15} />
            </Button>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Leave empty for app data, or choose an absolute folder on an external drive.
        </p>
      </div>

      {status?.error ? <SettingsErrorText>{status.error}</SettingsErrorText> : null}

      <SettingsActionRow>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => void setUp()}
          disabled={settingUp}
        >
          <RefreshCw size={14} className={settingUp ? "animate-spin" : ""} />
          {settingUp ? "Setting up..." : ready ? "Re-check models" : "Set up local OCR"}
        </Button>
      </SettingsActionRow>
    </SettingsCard>
  );
}
