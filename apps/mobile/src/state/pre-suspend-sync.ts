// Sync owed changes when the app is backgrounded. See docs/SYNC_TIMING.md.
//
// Timers do not fire while iOS has the app suspended, so an edit still waiting
// for its typing pause would otherwise sit on the phone until the next launch.
// The native background task (lib/background-task) buys ~30 s; this flushes
// every open draft to disk, then runs the owed sync inside that window.

import { finishBackgroundWindow } from "../lib/background-task";
import { flushAllDrafts } from "../lib/capture-draft";
import { useBackgroundOperationStore } from "./background-operation-store";
import { useSyncStore } from "./sync-store";

/** Below iOS's ~30 s, so we release the task ourselves instead of expiring. */
const PRE_SUSPEND_BUDGET_MS = 25_000;

let running = false;

/**
 * Call synchronously from the AppState "background" handler, before the
 * auto-lock check: the background operation it opens defers Type's own lock
 * until the sync settles, since a locked core rejects the sync.
 */
export const runPreSuspendSync = (): void => {
  if (running) return;
  running = true;
  useBackgroundOperationStore.getState().begin();
  let budget: ReturnType<typeof setTimeout> | null = null;
  const work = (async () => {
    await flushAllDrafts();
    await useSyncStore.getState().syncBeforeSuspend();
  })().catch(() => {});
  const timeout = new Promise<void>((resolve) => {
    budget = setTimeout(resolve, PRE_SUSPEND_BUDGET_MS);
  });
  void Promise.race([work, timeout]).finally(() => {
    if (budget) clearTimeout(budget);
    running = false;
    useBackgroundOperationStore.getState().end();
    finishBackgroundWindow();
  });
};
