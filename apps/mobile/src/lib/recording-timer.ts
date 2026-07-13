// Pure helpers for the recording timer.
//
// Kept free of React/native imports so the mm:ss formatting and the wall-clock
// elapsed math are unit-testable in isolation. The recording timer is driven by
// a wall-clock anchor (Date.now() captured when recording starts) rather than by
// expo-audio's polled `durationMillis`: the polled value freezes while the app
// is suspended (screen lock), whereas the wall-clock delta reflects the true
// elapsed time the moment the app resumes — matching Apple Voice Memos.

/** Whole seconds between `startedAtMs` and `nowMs`, never negative. */
export const elapsedSeconds = (startedAtMs: number, nowMs: number): number =>
  Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));

/**
 * Format a non-negative second count as `m:ss`, rolling into `h:mm:ss` past an
 * hour so long recordings stay readable.
 */
export const formatRecordingTimer = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
};
