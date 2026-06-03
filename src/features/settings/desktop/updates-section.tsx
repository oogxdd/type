import { useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { OTA_APPLY_PENDING_KEY } from "@/constants";

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

/**
 * Native desktop auto-updater. Talks to the Tauri updater plugin, which compares
 * the installed app version against the `latest.json` manifest hosted at the
 * endpoint configured in tauri.conf.json, then downloads and swaps the whole app
 * binary — no .dmg reinstall needed.
 */
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
        message: error instanceof Error ? error.message : String(error),
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
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const busy = state.status === "checking" || state.status === "downloading";

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
      <h3 className="text-sm font-semibold text-foreground">Desktop app</h3>

      <div className="grid gap-3 text-sm">
        <div className="text-xs text-muted-foreground">Current version: {__APP_VERSION__}</div>

        {state.status === "checking" && (
          <div className="text-sm text-muted-foreground">Checking for updates…</div>
        )}

        {state.status === "up-to-date" && (
          <div className="text-sm text-green-600 dark:text-green-400">
            You're on the latest version.
          </div>
        )}

        {state.status === "available" && (
          <div className="space-y-2">
            <div className="text-sm text-foreground">
              Version <strong>{state.version}</strong> is available.
            </div>
            {state.notes && <div className="text-xs text-muted-foreground">{state.notes}</div>}
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={downloadAndInstall}
            >
              Download & install
            </button>
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
          <div className="text-sm text-red-600 dark:text-red-400">{state.message}</div>
        )}

        {!busy && state.status !== "available" && state.status !== "ready" && (
          <button
            type="button"
            className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
            onClick={checkForUpdates}
          >
            Check for updates
          </button>
        )}
      </div>
    </section>
  );
}

type OtaState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string; notes?: string }
  | { status: "error"; message: string };

/**
 * OTA JS-bundle updates (used on iOS via the inkibra OTA plugin). Fetches a
 * manifest and reloads into the bundled web app — distinct from the native
 * desktop updater above, which swaps the whole binary.
 */
function OtaUpdates() {
  const [state, setState] = useState<OtaState>({ status: "idle" });

  const checkForUpdates = async () => {
    const manifestUrl = import.meta.env.VITE_OTA_MANIFEST_URL?.trim();
    if (!manifestUrl) {
      setState({ status: "error", message: "No update URL configured." });
      return;
    }

    setState({ status: "checking" });

    try {
      const response = await fetch(manifestUrl, { cache: "no-store" });
      if (!response.ok) {
        setState({ status: "error", message: `Failed to fetch manifest (${response.status}).` });
        return;
      }

      const manifest: { version?: string; notes?: string } = await response.json();
      if (!manifest.version) {
        setState({ status: "error", message: "Invalid manifest format." });
        return;
      }

      if (manifest.version === __APP_VERSION__) {
        setState({ status: "up-to-date" });
      } else {
        setState({ status: "available", version: manifest.version, notes: manifest.notes });
      }
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  };

  const applyUpdate = () => {
    window.localStorage.setItem(OTA_APPLY_PENDING_KEY, "true");
    window.location.reload();
  };

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
      <h3 className="text-sm font-semibold text-foreground">OTA updates (iOS)</h3>

      <div className="grid gap-3 text-sm">
        <div className="text-xs text-muted-foreground">Current version: {__APP_VERSION__}</div>

        {state.status === "checking" && (
          <div className="text-sm text-muted-foreground">Checking for updates...</div>
        )}

        {state.status === "up-to-date" && (
          <div className="text-sm text-green-600 dark:text-green-400">
            You're on the latest version.
          </div>
        )}

        {state.status === "available" && (
          <div className="space-y-2">
            <div className="text-sm text-foreground">
              Version <strong>{state.version}</strong> is available.
            </div>
            {state.notes && <div className="text-xs text-muted-foreground">{state.notes}</div>}
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={applyUpdate}
            >
              Apply update & restart
            </button>
          </div>
        )}

        {state.status === "error" && (
          <div className="text-sm text-red-600 dark:text-red-400">{state.message}</div>
        )}

        {state.status !== "checking" && state.status !== "available" && (
          <button
            type="button"
            className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
            onClick={checkForUpdates}
          >
            Check for updates
          </button>
        )}
      </div>
    </section>
  );
}

export function SettingsUpdatesSection() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Updates</h2>
      </div>

      <div className="space-y-4">
        <DesktopAppUpdates />
        <OtaUpdates />
      </div>
    </div>
  );
}
