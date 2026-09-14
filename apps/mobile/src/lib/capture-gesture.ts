// The arithmetic behind the capture-screen swipes, kept out of the screen so it
// can be read and tested without a device.
//
// Every function here carries the 'worklet' directive: the callbacks that call
// them run on the UI runtime, which on iOS is the main thread. A plain JS
// function called from there would be a cross-runtime hop at best and an
// uncatchable crash at worst. In vitest the directive is just a string
// literal, so the same functions are ordinary code under test.
//
// Most of what used to live here is gone, and the reason is worth keeping.
// Filing a page was a Pan with manualActivation that had to *steal* the touch
// from the ScrollView at exactly the right frame, so it needed an arm point
// (ACTIVATE_PULL), an edge test (isAtScrollBottom, BOTTOM_SLACK), a vertical
// latch and a horizontal verdict (RIGHTWARD_FAIL, LEFTWARD_FAIL,
// VERTICAL_LATCH) — an apparatus for winning races against the scroll view and
// against the two horizontal pans.
//
// It now rides the scroll view's own overscroll, so there is no second
// recognizer and nothing to arbitrate: you cannot reach the end of the note
// without scrolling to it, and past the end the bounce *is* the gesture. A
// scroll view competing with nobody needs none of that apparatus.

/**
 * How far past the end of the note the content must be dragged before
 * releasing files the page.
 *
 * This is *overscroll*, not finger travel: iOS rubber-bands with roughly 50%
 * resistance at the start and more as it stretches, so reaching 80pt takes
 * noticeably more thumb than 80pt. That resistance is the point — it is what
 * makes the pull feel like pulling rather than sliding.
 */
export const PULL_THRESHOLD = 80;

/**
 * Height of the tab that comes up out of the bottom edge as you pull.
 *
 * The tab is not decoration. Before it, the gesture gave no feedback at all
 * until the page itself moved, so a pull that fell short was indistinguishable
 * from a dead screen — which is a large part of why filing felt unreliable
 * even on the attempts where it was working correctly.
 */
export const PULL_TAB_HEIGHT = 44;

/** How far past its own height the tab keeps travelling before it stops. */
export const PULL_TAB_MAX_STRETCH = 96;

/** Scroll-edge slack (px): treat "within a few px" as at the top edge. */
export const TOP_SLACK = 4;

/** swipeToSync's guard against a rightward drag, which belongs to the menu. */
export const SYNC_RIGHTWARD_FAIL = 8;

/** Pull-down at the top of the note that tucks the keyboard away. */
export const ESCAPE_DRAG = 14;

/**
 * How far the content is overscrolled past its end, in points. Zero everywhere
 * else, including while bouncing at the top.
 *
 * Taken from the scroll event's own contentSize/layoutMeasurement rather than
 * from mirrored shared values: the numbers that decide the gesture should be
 * the ones the scroll view just laid out with, not a copy that a layout pass
 * may not have refreshed yet.
 */
export const overscrollPastEnd = (
  offsetY: number,
  contentHeight: number,
  viewportHeight: number
): number => {
  "worklet";
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, offsetY - maxScroll);
};

/** Releasing here files the page and brings a blank one in. */
export const shouldCommitPull = (pull: number): boolean => {
  "worklet";
  return pull >= PULL_THRESHOLD;
};

/** 0..1 across the pull, for the tab's colour, label and rotation. */
export const pullProgress = (pull: number): number => {
  "worklet";
  return Math.min(1, Math.max(0, pull / PULL_THRESHOLD));
};

/**
 * How far the tab has risen above the bottom edge. It tracks the overscroll
 * 1:1 so it reads as physically attached to the page, then stops so a hard
 * fling cannot throw it into orbit.
 */
export const pullTabReveal = (pull: number): number => {
  "worklet";
  return Math.min(Math.max(0, pull), PULL_TAB_HEIGHT + PULL_TAB_MAX_STRETCH);
};

/** The visible page: the window minus whatever the keyboard covers. */
export const visiblePageHeight = (
  windowHeight: number,
  keyboardHeight: number
): number => {
  "worklet";
  return Math.max(1, windowHeight - keyboardHeight);
};
