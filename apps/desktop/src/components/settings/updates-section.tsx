import { useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getErrorMessage } from "@typenotes/shared/errors";
import { Button } from "@/components/ui/button";
import { SettingsCard, SettingsSection } from "./settings-ui";

type DesktopUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string; notes?: string }
  | { status: "downloading"; version: string; downloaded: number; total: number | null }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function DesktopAppUpdates() {
  const [state, setState] = useState<DesktopUpdateState>({ status: "idle" });
  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = async () => {
    setState({ status: "checking" });
    try {
      const update = await check();
      if (!update) {
        setState({ status: "up-to-date" });
        return;
      }
      updateRef.current = update;
      setState({ status: "available", version: update.version, notes: update.body });
    } catch (error) {
      setState({
        status: "error",
        message: getErrorMessage(error),
      });
    }
  };

  const downloadAndInstall = async () => {
    const update = updateRef.current;
    if (!update) return;

    let total: number | null = null;
    let downloaded = 0;
    setState({ status: "downloading", version: update.version, downloaded: 0, total: null });

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            setState({ status: "downloading", version: update.version, downloaded: 0, total });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setState({ status: "downloading", version: update.version, downloaded, total });
            break;
          case "Finished":
            setState({ status: "ready", version: update.version });
            break;
        }
      });
      setState({ status: "ready", version: update.version });
      await relaunch();
    } catch (error) {
      setState({
        status: "error",
        message: getErrorMessage(error),
      });
    }
  };

  const busy = state.status === "checking" || state.status === "downloading";

  return (
    <SettingsCard title="Desktop app">
      <div className="grid gap-3 text-sm">
        <div className="text-xs text-muted-foreground">Current version: {__APP_VERSION__}</div>

        {state.status === "checking" && (
          <div className="text-sm text-muted-foreground">Checking for updates…</div>
        )}

        {state.status === "up-to-date" && (
          <div className="text-sm text-emerald-600 dark:text-emerald-400">
            You're on the latest version.
          </div>
        )}

        {state.status === "available" && (
          <div className="space-y-2">
            <div className="text-sm text-foreground">
              Version <strong>{state.version}</strong> is available.
            </div>
            {state.notes && <div className="text-xs text-muted-foreground">{state.notes}</div>}
            <Button type="button" size="sm" onClick={() => void downloadAndInstall()}>
              Download &amp; install
            </Button>
          </div>
        )}

        {state.status === "downloading" && (
          <div className="text-sm text-muted-foreground">
            Downloading {state.version}…{" "}
            {state.total
              ? `${formatBytes(state.downloaded)} / ${formatBytes(state.total)}`
              : formatBytes(state.downloaded)}
          </div>
        )}

        {state.status === "ready" && (
          <div className="text-sm text-muted-foreground">
            Update installed. Restarting…
          </div>
        )}

        {state.status === "error" && (
          <div className="text-sm text-destructive">{state.message}</div>
        )}

        {!busy && state.status !== "available" && state.status !== "ready" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void checkForUpdates()}
          >
            Check for updates
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}

export function SettingsUpdatesSection() {
  return (
    <SettingsSection title="Updates">
      <DesktopAppUpdates />
    </SettingsSection>
  );
}
