import { useState } from "react";
import { OTA_APPLY_PENDING_KEY } from "@/shared/constants";
import { Group } from "./helpers";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string; notes?: string }
  | { status: "error"; message: string };

export function MobileUpdatesSection() {
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
    <Group title="OTA updates (iOS)">
      <div className="mobile-native-row stat">
        <span className="mobile-native-row-label">Current version</span>
        <span className="mobile-native-row-value">{__APP_VERSION__}</span>
      </div>

      {state.status === "checking" && (
        <div className="mobile-native-row stat">
          <span className="mobile-native-row-label" style={{ opacity: 0.6 }}>
            Checking for updates...
          </span>
        </div>
      )}

      {state.status === "up-to-date" && (
        <div className="mobile-native-row stat">
          <span className="mobile-native-row-label" style={{ color: "var(--color-green-500, #22c55e)" }}>
            You're on the latest version.
          </span>
        </div>
      )}

      {state.status === "available" && (
        <>
          <div className="mobile-native-row stat">
            <span className="mobile-native-row-label">Available version</span>
            <span className="mobile-native-row-value">{state.version}</span>
          </div>
          {state.notes && (
            <div className="mobile-native-row stat">
              <span className="mobile-native-row-label" style={{ opacity: 0.6 }}>
                {state.notes}
              </span>
            </div>
          )}
          <button
            type="button"
            className="mobile-native-row choice"
            onClick={applyUpdate}
          >
            <span className="mobile-native-row-main">
              <span className="mobile-native-row-label">Apply update & restart</span>
            </span>
          </button>
        </>
      )}

      {state.status === "error" && (
        <div className="mobile-native-row stat">
          <span className="mobile-native-row-label" style={{ color: "var(--color-red-500, #ef4444)" }}>
            {state.message}
          </span>
        </div>
      )}

      {state.status !== "checking" && state.status !== "available" && (
        <button
          type="button"
          className="mobile-native-row choice"
          onClick={checkForUpdates}
        >
          <span className="mobile-native-row-main">
            <span className="mobile-native-row-label">Check for updates</span>
          </span>
        </button>
      )}
    </Group>
  );
}
