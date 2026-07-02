import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "@typenotes/shared/errors";

type ProcessingSnapshot<TQueue, TItem> = {
  queue: TQueue;
  items: TItem[];
};

type UseProcessingQueueOptions<TQueue, TItem> = {
  loadSnapshot: () => Promise<ProcessingSnapshot<TQueue, TItem>>;
  getSignature: (items: TItem[]) => string;
  invalidateEventName: string;
  refreshOnMount?: boolean;
  onSnapshotLoaded?: (snapshot: ProcessingSnapshot<TQueue, TItem>) => void;
};

/**
 * Shared queue plumbing for the background processing domains.
 * The queue execution stays separate per domain; this just keeps the
 * bookkeeping, signature invalidation, and error handling consistent.
 */
export function useProcessingQueue<TQueue, TItem>({
  loadSnapshot,
  getSignature,
  invalidateEventName,
  refreshOnMount = true,
  onSnapshotLoaded,
}: UseProcessingQueueOptions<TQueue, TItem>) {
  const [queue, setQueue] = useState<TQueue | null>(null);
  const [items, setItems] = useState<TItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signatureRef = useRef("");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const snapshot = await loadSnapshot();
      setQueue(snapshot.queue);
      setItems(snapshot.items);

      const nextSignature = getSignature(snapshot.items);
      if (signatureRef.current !== nextSignature) {
        signatureRef.current = nextSignature;
        window.dispatchEvent(new CustomEvent(invalidateEventName));
      }

      onSnapshotLoaded?.(snapshot);
      setError(null);
    } catch (loadingError) {
      setError(getErrorMessage(loadingError));
    } finally {
      setBusy(false);
    }
  }, [getSignature, invalidateEventName, loadSnapshot, onSnapshotLoaded]);

  useEffect(() => {
    if (!refreshOnMount) {
      return;
    }
    void refresh();
  }, [refresh, refreshOnMount]);

  return {
    queue,
    items,
    busy,
    error,
    setError,
    refresh,
  };
}
