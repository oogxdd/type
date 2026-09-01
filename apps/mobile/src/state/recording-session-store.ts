import { create } from "zustand";

type RecordingSessionState = {
  /** True from native recorder start through the final save/queue cleanup. */
  active: boolean;
  setActive: (active: boolean) => void;
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
  setActive: (active) => set({ active }),
}));
