// An opt-in, in-memory ring buffer of the `[sync]` lines sync-store.ts already
// logs to the console. TestFlight/standalone builds have no attached console,
// so without this the only way to debug a stuck sync was pasting desktop-side
// logs and guessing at what the phone was doing. Capturing is gated by the
// Diagnostics toggle (off by default) and cleared on app restart — this is a
// debugging instrument, not a permanent record.

import { create } from "zustand";

const MAX_ENTRIES = 500;

export type SyncLogEntry = {
  /** `Date.now()` when the line was logged. */
  at: number;
  message: string;
};

type SyncLogState = {
  entries: SyncLogEntry[];
  push: (message: string) => void;
  clear: () => void;
};

export const useSyncLogStore = create<SyncLogState>((set) => ({
  entries: [],
  push: (message) =>
    set((state) => {
      const entries = [...state.entries, { at: Date.now(), message }];
      return {
        entries: entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries,
      };
    }),
  clear: () => set({ entries: [] }),
}));

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** `HH:mm:ss.mmm`, stable and sortable, matching the desktop terminal's feel. */
export const formatSyncLogTimestamp = (at: number): string => {
  const date = new Date(at);
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(
    date.getMilliseconds(),
    3
  )}`;
};

export const formatSyncLogForExport = (entries: SyncLogEntry[]): string =>
  entries.map((entry) => `[${formatSyncLogTimestamp(entry.at)}] ${entry.message}`).join("\n");
