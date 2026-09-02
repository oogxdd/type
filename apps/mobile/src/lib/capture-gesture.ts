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
export const COMMIT_FRACTION = 0.15;
export const COMMIT_VELOCITY = -420;

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
 * The strip along the left edge where a drag is navigation and nothing else.
 *
 * 24 rather than 48: the whole-screen pop recognizer is enabled for Capture,
 * so this no longer has to be the only place a back swipe can start, and every
 * pixel of it is a pixel where swiping up to file does not exist at all. 24pt
 * still covers the true edge, where back is the only plausible intent.
 */
export const BACK_SWIPE_GUTTER = 24;

/**
 * Absolute sideways travel before a drag is called navigation rather than
 * filing. `dx`/`dy` are measured from the touch start and the fail is terminal
 * for the whole touch, so this one number decides how forgiving the swipe up
 * feels.
 *
 * 8 (0.2.2's value) is too tight to live with: a thumb arcs, and at the start
 * of a swipe up `dy` is still ~0, so an early 9px drift killed the gesture for
 * good. 24pt is ~4mm — a real back swipe crosses it within the first frames
 * and still feels immediate, while an arcing swipe up survives it.
 *
 * Past VERTICAL_LATCH this stops being consulted at all.
 */
export const RIGHTWARD_FAIL = 24;
export const RIGHTWARD_FAIL_RATIO = 1;

/**
 * Leftward travel belongs to swipeToSync, which claims at -24. Fail at the same
 * point, but *regardless of the vertical component*: a manual-activation
 * gesture that neither activates nor fails stays BEGAN forever, and in
 * `Gesture.Race` everything behind it waits on that failure — which is how a
 * diagonal drag used to wedge the Sync swipe shut.
 */
export const LEFTWARD_FAIL = 24;

/** swipeToSync's own guard against a rightward drag (the native back). */
export const SYNC_RIGHTWARD_FAIL = 8;

/** Pull-down at the top of the note that tucks the keyboard away. */
export const ESCAPE_DRAG = 14;

/**
 * Upward travel after which the touch belongs to filing for good.
 *
 * Once the finger has clearly gone up, the sideways wobble every thumb makes
 * as it extends must not be able to hand the touch back to navigation. Without
 * this latch a swipe that started perfectly could still die two thirds of the
 * way through, which is most of what made the gesture feel unreliable.
 */
export const VERTICAL_LATCH = 12;

/**
 * Has this drag committed to being vertical? Checked before the horizontal
 * verdict; once true, `horizontalVerdict` is not consulted again for the touch.
 */
export const isVerticalCommitted = (dx: number, dy: number): boolean => {
  "worklet";
  return dy < -VERTICAL_LATCH && Math.abs(dx) < Math.abs(dy);
};

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
