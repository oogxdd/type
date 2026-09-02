// The arithmetic behind the capture-screen swipe, kept out of the screen so it
// can be read and tested without a device.
//
// Every function here carries the 'worklet' directive: the gesture callbacks
// that call them run on the UI runtime, which on iOS is the main thread. A
// plain JS function called from there would be a cross-runtime hop at best and
// an uncatchable crash at worst. In vitest the directive is just a string
// literal, so the same functions are ordinary code under test.

/**
 * Releasing past this fraction of the visible page height commits the swipe;
 * a faster upward flick commits regardless of distance.
 */
export const COMMIT_FRACTION = 0.2;
export const COMMIT_VELOCITY = -550;

/**
 * How far past the arm point (the bottom edge) the finger must travel before
 * the pan claims the touch from the scroll — small enough to feel instant,
 * big enough to ignore jitter.
 */
export const ACTIVATE_PULL = 6;

/** Scroll-edge slack (px): treat "within a few px" as at the edge. */
export const BOTTOM_SLACK = 6;
export const TOP_SLACK = 4;

/**
 * The iOS back-swipe strip. Capture runs with the whole-screen pop recognizer
 * enabled (as it did in mobile-v0.2.2), so this is not the only place back
 * lives — but the capture pans still exclude the strip outright via
 * `hitSlop({ left: -… })` so a drag starting on the edge is navigation, full
 * stop, with nothing to arbitrate.
 */
export const BACK_SWIPE_GUTTER = 48;

/**
 * Rightward travel that means "this is navigation, not filing".
 *
 * 8px / 1.0 are mobile-v0.2.2's values, restored deliberately. They are tight,
 * and `dx`/`dy` are measured from the touch start with the fail terminal for
 * the whole touch — so a thumb that arcs sideways early can lose a swipe up.
 * The alternative is worse: the whole-screen pop recognizer is back on for
 * Capture, and raising these makes swiping back out of Capture feel dead,
 * because the pan sits in BEGAN while the native gesture waits on it.
 * Navigation wins ties here on purpose.
 */
export const RIGHTWARD_FAIL = 8;
export const RIGHTWARD_FAIL_RATIO = 1;

/**
 * Leftward travel belongs to swipeToSync, which claims at -24. Fail at 8 like
 * the rightward side, but *regardless of the vertical component*: a
 * manual-activation gesture that neither activates nor fails stays BEGAN
 * forever, and in `Gesture.Race` everything behind it waits on that failure —
 * which is how a diagonal drag used to wedge the Sync swipe shut. This is the
 * one intentional deviation from 0.2.2.
 */
export const LEFTWARD_FAIL = 8;

/** swipeToSync's own guard against a rightward drag (the native back). */
export const SYNC_RIGHTWARD_FAIL = 8;

/** Pull-down at the top of the note that tucks the keyboard away. */
export const ESCAPE_DRAG = 14;

export type HorizontalVerdict = "undecided" | "navigation" | "sync";

/**
 * Which gesture a drag belongs to, judged from the travel so far. "undecided"
 * means keep watching — the vertical observers must not fail on it.
 */
export const horizontalVerdict = (dx: number, dy: number): HorizontalVerdict => {
  "worklet";
  if (dx > RIGHTWARD_FAIL && dx > Math.abs(dy) * RIGHTWARD_FAIL_RATIO) {
    return "navigation";
  }
  if (dx < -LEFTWARD_FAIL) {
    return "sync";
  }
  return "undecided";
};

/** The note is scrolled to its bottom edge, so the next pull is page filing. */
export const isAtScrollBottom = (
  offsetY: number,
  contentHeight: number,
  viewportHeight: number
): boolean => {
  "worklet";
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return offsetY >= maxScroll - BOTTOM_SLACK;
};

/** The visible page: the window minus whatever the keyboard covers. */
export const visiblePageHeight = (
  windowHeight: number,
  keyboardHeight: number
): number => {
  "worklet";
  return Math.max(1, windowHeight - keyboardHeight);
};

/** Release past a fifth of the page, or flick up hard enough, and it files. */
export const shouldCommitFiling = (
  pageOffsetY: number,
  pageHeight: number,
  velocityY: number
): boolean => {
  "worklet";
  return (
    -pageOffsetY > pageHeight * COMMIT_FRACTION || velocityY < COMMIT_VELOCITY
  );
};
