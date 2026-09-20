// Persistent Capture survives navigation to Settings. Flush it before changing
// the backend's active notes root, while its paths still refer to that root.
let flush: (() => Promise<void>) | null = null;
export const registerCaptureDraft = (callback: () => Promise<void>) => {
  flush = callback;
  return () => { if (flush === callback) flush = null; };
};
export const flushCaptureDraft = async (): Promise<void> => { await flush?.(); };
