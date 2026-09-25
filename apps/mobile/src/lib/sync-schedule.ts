// When an automatic sync runs after a local change. See docs/SYNC_TIMING.md.
//
// Every automatic sync is a full pull → commit → push round trip, so running
// one per typing pause spawned a commit per pause. Typing now waits for a
// longer pause (with a ceiling, so a long session still syncs), while finished
// actions — filing a page, deleting, moving, saving audio — sync promptly.
//
// To restore the old per-pause behavior, set EDIT_SYNC_DEBOUNCE_MS to
// ACTION_SYNC_DELAY_MS; nothing else depends on the difference.

/**
 * - `edit`: text is still being typed into a note that stays open.
 * - `action`: a discrete change that is finished (filed, deleted, moved, audio).
 * - `now`: lifecycle wakeups (app opened / foregrounded) and retries.
 */
export type SyncTiming = "edit" | "action" | "now";

/** Pause after the last keystroke before typing is synced. */
export const EDIT_SYNC_DEBOUNCE_MS = 45_000;
/** Continuous typing still syncs at least this often. */
export const EDIT_SYNC_MAX_WAIT_MS = 3 * 60_000;
/** Short grace so a burst (multi-select delete, page filed + blank page) is one sync. */
export const ACTION_SYNC_DELAY_MS = 1_500;

export type PendingSync = {
  dueAt: number;
  /** When the first unsynced edit of this batch was scheduled; caps the debounce. */
  firstEditAt: number | null;
  /** An action or wakeup is waiting — later edits must not postpone it. */
  urgent: boolean;
};

/**
 * The next deadline after a change of `timing` at `now`, given what is already
 * scheduled. Edits debounce each other; nothing ever pushes an urgent deadline
 * later.
 */
export const nextPendingSync = (
  pending: PendingSync | null,
  timing: SyncTiming,
  now: number
): PendingSync => {
  const firstEditAt = pending?.firstEditAt ?? null;
  if (timing === "edit") {
    if (pending?.urgent) {
      return { ...pending, firstEditAt: firstEditAt ?? now };
    }
    const batchStart = firstEditAt ?? now;
    return {
      dueAt: Math.min(now + EDIT_SYNC_DEBOUNCE_MS, batchStart + EDIT_SYNC_MAX_WAIT_MS),
      firstEditAt: batchStart,
      urgent: false,
    };
  }
  const delay = timing === "now" ? 0 : ACTION_SYNC_DELAY_MS;
  const dueAt = pending?.urgent
    ? Math.min(pending.dueAt, now + delay)
    : now + delay;
  return { dueAt, firstEditAt, urgent: true };
};
