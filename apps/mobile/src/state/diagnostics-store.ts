// Device-local diagnostics preferences: which development-facing readouts the
// app is allowed to draw over normal UI. Like appearance-store this never
// touches the Rust core and persists to a small JSON file beside the core's
// app data, so it can never end up inside a notes root and sync to a desktop.
//
// Kept apart from appearance-store on purpose: "Reset to Defaults" on the
// Appearance screen must not silently switch a diagnostics readout back on.

import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";

// Mirrors core/boot.ts: the core's app_data_dir is `<documents>/typenotes`.
const DIAGNOSTICS_DIR = `${FileSystem.documentDirectory ?? ""}typenotes`;
const DIAGNOSTICS_FILE = `${DIAGNOSTICS_DIR}/diagnostics.json`;

export type Diagnostics = {
  /**
   * The auto-sync state label ("Saved locally", "Syncing…", …) in the corner
   * of the capture page. Off by default: the capture page is meant to be a
   * blank sheet, and the same information is on the Menu and Sync screens.
   */
  showCaptureSyncStatus: boolean;
};

export const DEFAULT_DIAGNOSTICS: Diagnostics = {
  showCaptureSyncStatus: false,
};

export const normalizeDiagnostics = (raw: unknown): Diagnostics => {
  const value = (raw ?? {}) as Partial<Record<keyof Diagnostics, unknown>>;
  return {
    showCaptureSyncStatus:
      typeof value.showCaptureSyncStatus === "boolean"
        ? value.showCaptureSyncStatus
        : DEFAULT_DIAGNOSTICS.showCaptureSyncStatus,
  };
};

const persist = async (diagnostics: Diagnostics) => {
  try {
    await FileSystem.makeDirectoryAsync(DIAGNOSTICS_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(
      DIAGNOSTICS_FILE,
      JSON.stringify(diagnostics)
    );
  } catch {
    // A failed write only costs the preference on the next launch — never
    // worth interrupting the UI over.
  }
};

type DiagnosticsState = {
  diagnostics: Diagnostics;
  /** False until the persisted file has been read (or found missing). */
  hydrated: boolean;
  load: () => Promise<void>;
  setShowCaptureSyncStatus: (value: boolean) => void;
};

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => {
  const update = (patch: Partial<Diagnostics>) => {
    const diagnostics = { ...get().diagnostics, ...patch };
    set({ diagnostics });
    void persist(diagnostics);
  };

  return {
    diagnostics: DEFAULT_DIAGNOSTICS,
    hydrated: false,
    load: async () => {
      try {
        const raw = await FileSystem.readAsStringAsync(DIAGNOSTICS_FILE);
        set({ diagnostics: normalizeDiagnostics(JSON.parse(raw)), hydrated: true });
      } catch {
        // No file yet (first launch) or unreadable — defaults are correct.
        set({ diagnostics: DEFAULT_DIAGNOSTICS, hydrated: true });
      }
    },
    setShowCaptureSyncStatus: (value) => update({ showCaptureSyncStatus: value }),
  };
});
