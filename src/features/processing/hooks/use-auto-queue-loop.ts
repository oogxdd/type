import { useEffect } from "react";

type AutoQueueLoopOptions = {
  enabled: boolean;
  delayMs: number;
  intervalMs?: number;
  onTick: () => Promise<void> | void;
};

/**
 * Starts a lightweight "scan for more work" loop. Transcription and OCR each
 * get their own loop so a slow or stuck provider cannot block the other queue.
 */
export function useAutoQueueLoop({
  enabled,
  delayMs,
  intervalMs = 15_000,
  onTick,
}: AutoQueueLoopOptions) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let intervalId: number | null = null;
    const start = () => {
      void onTick();
      intervalId = window.setInterval(() => {
        void onTick();
      }, intervalMs);
    };

    const startTimer = window.setTimeout(start, delayMs);
    return () => {
      window.clearTimeout(startTimer);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [delayMs, enabled, intervalMs, onTick]);
}
