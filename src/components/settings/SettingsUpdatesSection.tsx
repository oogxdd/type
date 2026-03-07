import { useState } from "react";
import { OTA_APPLY_PENDING_KEY } from "../../constants";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string; notes?: string }
  | { status: "error"; message: string };

export function SettingsUpdatesSection() {
  const [state, setState] = useState<CheckState>({ status: "idle" });

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
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Updates</h2>
      </div>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">OTA updates (iOS)</h3>

          <div className="grid gap-3 text-sm">
            <div className="text-xs text-muted-foreground">
              Current version: {__APP_VERSION__}
            </div>

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
                {state.notes && (
                  <div className="text-xs text-muted-foreground">{state.notes}</div>
                )}
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
      </div>
    </div>
  );
}
