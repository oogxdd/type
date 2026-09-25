// Persistent Capture survives navigation to Settings. Flush it before changing
// the backend's active notes root, while its paths still refer to that root.
let flush: (() => Promise<void>) | null = null;
export const registerCaptureDraft = (callback: () => Promise<void>) => {
  flush = callback;
  return () => { if (flush === callback) flush = null; };
};
export const flushCaptureDraft = async (): Promise<void> => { await flush?.(); };

// Other open editors with debounced writes. Before the app is suspended every
// pending write must reach disk, or the pre-suspend sync would miss it.
const editorDrafts = new Set<() => Promise<void>>();
export const registerEditorDraft = (callback: () => Promise<void>) => {
  editorDrafts.add(callback);
  return () => { editorDrafts.delete(callback); };
};
export const flushAllDrafts = async (): Promise<void> => {
  await Promise.allSettled([flushCaptureDraft(), ...[...editorDrafts].map((draft) => draft())]);
};
