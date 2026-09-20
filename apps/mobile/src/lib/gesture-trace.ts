// Session-only trace of the unified home gesture. No note text is recorded.
import type { SwipeDirection } from "./capture-gesture";

export type GestureOutcome = "filed" | "released" | "menu-open" | "menu-close" |
  "cancelled" | "scroll" | "diagonal" | "blocked" | "idle";
export type GestureAttempt = {
  at: number;
  startX: number;
  startY: number;
  maxDx: number;
  maxDy: number;
  maxPull: number;
  durationMs: number;
  direction: SwipeDirection;
  outcome: GestureOutcome;
};
export const outcomeOf = (attempt: GestureAttempt): GestureOutcome => attempt.outcome;

const CAPACITY = 40;

let attempts: GestureAttempt[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const recordGestureAttempt = (attempt: GestureAttempt) => {
  // A new array rather than a mutation: useSyncExternalStore compares by
  // identity, and the list is 40 entries.
  attempts = [attempt, ...attempts].slice(0, CAPACITY);
  emit();
};

export const clearGestureAttempts = () => {
  attempts = [];
  emit();
};

export const getGestureAttempts = (): GestureAttempt[] => attempts;

export const subscribeToGestureAttempts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const summarizeGestureAttempts = (entries: GestureAttempt[]) => {
  const upward = entries.filter((entry) => entry.direction === "up");
  return {
    total: upward.length,
    filed: upward.filter((entry) => entry.outcome === "filed").length,
    cancelled: upward.filter((entry) => entry.outcome === "cancelled").length,
  };
};
