import { create } from "zustand";

type RecordingSessionState = {
  /** True while any recording or durable audio import is still active. */
  active: boolean;
  count: number;
  begin: () => void;
  end: () => void;
};

/**
 * App-level recording lifecycle state.
 *
 * This deliberately lives above CaptureScreen: iOS reports locking the screen
 * as app backgrounding, and the security auto-lock gate would otherwise
 * unmount CaptureScreen and stop its recorder. App.tsx uses this state to defer
 * the app's own lock until the recording has been stopped and saved.
 */
export const useRecordingSessionStore = create<RecordingSessionState>((set) => ({
  active: false,
  count: 0,
  begin: () => set((s) => ({ count: s.count + 1, active: true })),
  end: () => set((s) => ({ count: Math.max(0, s.count - 1), active: s.count > 1 })),
}));
