// A small ring buffer of capture-screen swipe attempts, for the Gesture trace
// readout in Settings -> Diagnostics.
//
// Why this exists: the capture pans compete with a native recognizer that
// cannot be arbitrated with (see apps/mobile/GESTURES.md), so "the swipe did
// not register" has several indistinguishable causes — the native back pop took
// the touch, the system's home-indicator gesture took it before the app saw it
// at all, we declined to activate, or we deliberately handed it over. Guessing
// between them is what made the first two rounds of fixes miss. One record per
// touch turns that into data.
//
// Deliberately not zustand and not persisted: this is a debugging readout with
// a lifetime of one app session, and it must stay cheap enough that recording
// an attempt can never be the reason a gesture feels slow.

export type GestureAttempt = {
  /** Wall clock at the end of the touch. */
  at: number;
  /** Where the finger landed, in the gesture host's coordinates. */
  startX: number;
  startY: number;
  /** Signed extremes of travel: how far it got, and which way. */
  maxDx: number;
  maxDy: number;
  durationMs: number;
  /** The drag went far enough up that we stopped arbitrating for it. */
  latchedVertical: boolean;
  /** We claimed the touch from the scroll. */
  activated: boolean;
  /** We handed the touch to the native back recognizer on purpose. */
  failedByVerdict: boolean;
  /** We handed the touch to the Sync swipe on purpose. */
  failedToSync: boolean;
  /** A commit was still in flight, so we declined to claim this touch. */
  blockedByTransitioning: boolean;
  /** The pan reached onEnd rather than only onFinalize. */
  gotEnd: boolean;
  /** onEnd's `success` argument: false means something took the touch. */
  endSuccess: boolean;
  /** The release committed to filing. */
  filed: boolean;
};

export type GestureOutcome =
  | "filed"
  | "released"
  | "back"
  | "sync"
  | "blocked"
  | "stolen"
  | "idle";

/**
 * How far up a touch must travel before "we never claimed it" is evidence of a
 * problem rather than of a tap or a scroll.
 */
const MEANINGFUL_PULL = 20;

/**
 * What happened to one touch.
 *
 * The interesting verdict is "stolen": the finger clearly went up, we neither
 * claimed it nor gave it away, and it ended anyway — so a recognizer outside
 * this screen took it. That is the signature of the native full-screen pop,
 * and of the system home-indicator gesture at the very bottom edge.
 */
export const outcomeOf = (attempt: GestureAttempt): GestureOutcome => {
  if (attempt.filed) {
    return "filed";
  }
  if (attempt.activated) {
    return "released";
  }
  if (attempt.failedByVerdict) {
    return "back";
  }
  if (attempt.failedToSync) {
    return "sync";
  }
  if (attempt.blockedByTransitioning) {
    return "blocked";
  }
  if (attempt.maxDy < -MEANINGFUL_PULL) {
    return "stolen";
  }
  return "idle";
};

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

export type GestureTraceSummary = {
  total: number;
  filed: number;
  stolen: number;
  /** Start heights of the touches that were taken away, lowest first. */
  stolenStartY: number[];
};

/** The one-line answer the Diagnostics screen leads with. */
export const summarizeGestureAttempts = (
  entries: GestureAttempt[]
): GestureTraceSummary => {
  const upward = entries.filter((entry) => entry.maxDy < -MEANINGFUL_PULL);
  const stolen = upward.filter((entry) => outcomeOf(entry) === "stolen");
  return {
    total: upward.length,
    filed: upward.filter((entry) => outcomeOf(entry) === "filed").length,
    stolen: stolen.length,
    stolenStartY: stolen.map((entry) => Math.round(entry.startY)).sort((a, b) => a - b),
  };
};
