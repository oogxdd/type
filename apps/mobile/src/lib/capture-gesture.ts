// Shared by the home coordinator and scroll view. Worklets are platform-free.
export type SwipeDirection = "pending" | "left" | "right" | "up" | "down" | "diagonal";

export const DIRECTION_SLOP = 12;
export const DIAGONAL_SLOP = 24;
export const AXIS_DOMINANCE = 1.6;
export const PULL_REVEAL = 12;
export const PULL_READY = 100;
export const PULL_DISARM = 83;
// The pulled-open strip below the page. Its height *is* the overscroll, so the
// paper appears to lift off a slightly darker surface rather than a control
// flying in. The label only fades in once the strip is tall enough to hold it
// centered, which is why reveal sits well above PULL_REVEAL.
export const PULL_LABEL_REVEAL = 52;
export const PULL_LABEL_FULL = 72;
export const PULL_ZONE_MAX = 180;

/** The strip's height is the pull itself, capped so a hard fling stays sane. */
export const pullZoneHeight = (pull: number): number => {
  "worklet";
  return Math.min(Math.max(0, pull), PULL_ZONE_MAX);
};

/** 0 until the strip can hold a centered line, then fades to 1. */
export const pullLabelOpacity = (pull: number): number => {
  "worklet";
  const span = PULL_LABEL_FULL - PULL_LABEL_REVEAL;
  return Math.min(1, Math.max(0, (pull - PULL_LABEL_REVEAL) / span));
};

/** Choose once per touch. A latched direction survives a thumb's later arc. */
export const resolveSwipeDirection = (
  previous: SwipeDirection, dx: number, dy: number
): SwipeDirection => {
  "worklet";
  if (previous !== "pending") return previous;
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (Math.max(x, y) < DIRECTION_SLOP) return "pending";
  if (x >= y * AXIS_DOMINANCE) return dx > 0 ? "right" : "left";
  if (y >= x * AXIS_DOMINANCE) return dy > 0 ? "down" : "up";
  return Math.hypot(dx, dy) >= DIAGONAL_SLOP ? "diagonal" : "pending";
};

/** Only the distance beyond the note counts, never the preceding scroll. */
export const overscrollPastEnd = (
  offsetY: number, contentHeight: number, viewportHeight: number
): number => {
  "worklet";
  if (viewportHeight <= 0) return 0;
  return Math.max(0, offsetY - Math.max(0, contentHeight - viewportHeight));
};

/** Hysteresis avoids flickering labels/haptics at the threshold. */
export const isPullReady = (pull: number, wasReady: boolean): boolean => {
  "worklet";
  return pull >= (wasReady ? PULL_DISARM : PULL_READY);
};

export const shouldCommitPull = (
  direction: SwipeDirection, ready: boolean, success: boolean, blocked: boolean
): boolean => {
  "worklet";
  return success && !blocked && direction === "up" && ready;
};

export const menuReleaseTarget = (
  progress: number, velocityX: number, startedOpen: boolean, success: boolean
): number => {
  "worklet";
  if (!success) return startedOpen ? 1 : 0;
  if (velocityX > 500) return 1;
  if (velocityX < -500) return 0;
  return progress >= (startedOpen ? 0.7 : 0.3) ? 1 : 0;
};

export const visiblePageHeight = (windowHeight: number, keyboardHeight: number): number => {
  "worklet";
  return Math.max(1, windowHeight - keyboardHeight);
};
