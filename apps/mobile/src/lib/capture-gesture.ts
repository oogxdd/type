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
 * UIKit's own edge pop (`_UIParallaxTransitionPanGestureRecognizer`) is waved
 * through unconditionally by react-native-screens (RNSScreenStack.mm:876-877)
 * and no prop can narrow it, so this strip was always going to belong to
 * navigation. The screen's `gestureResponseDistance` now lines the full-screen
 * recognizer up with it exactly, and the pan's `hitSlop({ left: -24 })` lines
 * our side up from the other direction.
 *
 * The result is a clean partition rather than a contested zone: x <= 24 is
 * navigation's, everything else is ours. See apps/mobile/GESTURES.md for why
 * the previous split — by *height*, at 52% of the screen — could not be made
 * to feel consistent.
 */
export const BACK_SWIPE_GUTTER = 24;

/**
 * The `gestureResponseDistance` that confines the native full-screen pop to the
 * left gutter.
 *
 * The values are absolute point coordinates in the stack view's space, not edge
 * distances, and -1 means unconstrained — so this says "only touches starting
 * at x <= BACK_SWIPE_GUTTER are ever offered to the native recognizer".
 *
 * The previous split was by height (NATIVE_BACK_BAND_FRACTION = 0.52), which
 * left the top half of the screen contested: the native recognizer fires on
 * ~10pt in *any* direction, so a swipe up that happened to start above the line
 * was cancelled before it began. Worse, the same rightward drag ran through two
 * different implementations with thresholds 2.5x apart depending on which half
 * of the screen the thumb landed in — which is most of why back "worked every
 * other time". See apps/mobile/GESTURES.md.
 */
export const NATIVE_BACK_RESPONSE_DISTANCE = { end: BACK_SWIPE_GUTTER };

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
 * Past VERTICAL_LATCH (as widened by VERTICAL_LATCH_RATIO) this stops being
 * consulted at all. Crossing it no longer hands the touch to the native
 * recognizer either — outside the left gutter there is nobody to hand it to —
 * so the gesture navigates to Menu itself and only then fails.
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
 * How much sideways travel an upward drag may have and still latch as vertical.
 *
 * This is the fix for "the swipe up works every other time". A thumb pivots at
 * its base, so as it extends it does not travel straight up — it arcs, and for
 * a right thumb starting low on the screen that arc goes *left*. The latch used
 * to require |dx| < |dy|, i.e. within 45° of vertical, which a real arc breaks
 * constantly in its first frames.
 *
 * A drag that misses the latch falls through to `horizontalVerdict`, and there
 * the leftward branch has no dominance test at all — so dx = -26, dy = -14 (an
 * ordinary arcing swipe up) read as "sync" and called the *terminal*
 * `manager.fail()`. The swipe up was dead, and swipeToSync could not have taken
 * the touch either: its own failOffsetY([-24, 24]) kills it the moment the drag
 * goes vertical. The touch was thrown away and handed to nobody.
 *
 * 2 means "within ~63° of vertical still counts as going up". Raise it if the
 * trace still shows arcing swipes leaving by verdict; lower it if deliberate
 * diagonal back-swipes start filing pages instead. verdictDx/verdictDy in the
 * Gesture trace record the exact point each verdict was taken at, so this can
 * be moved from evidence rather than guessed.
 */
export const VERTICAL_LATCH_RATIO = 2;

/**
 * Has this drag committed to being vertical? Checked before the horizontal
 * verdict; once true, `horizontalVerdict` is not consulted again for the touch.
 */
export const isVerticalCommitted = (dx: number, dy: number): boolean => {
  "worklet";
  return (
    dy < -VERTICAL_LATCH && Math.abs(dx) < Math.abs(dy) * VERTICAL_LATCH_RATIO
  );
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
