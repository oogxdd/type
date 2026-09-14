import { describe, expect, it } from "vitest";

import {
  COMMIT_VELOCITY,
  BACK_SWIPE_GUTTER,
  horizontalVerdict,
  NATIVE_BACK_RESPONSE_DISTANCE,
  isVerticalCommitted,
  isAtScrollBottom,
  shouldCommitFiling,
  visiblePageHeight,
} from "./capture-gesture";

describe("horizontalVerdict", () => {
  it("keeps watching a swipe up that arcs sideways", () => {
    // The whole point of RIGHTWARD_FAIL being 24 and not 8: at the start of a
    // swipe up dy is still ~0, and a thumb arcs. These used to fail the
    // gesture terminally, which is what made it hard to perform.
    expect(horizontalVerdict(9, -7)).toBe("undecided");
    expect(horizontalVerdict(20, -4)).toBe("undecided");
    expect(horizontalVerdict(-18, -6)).toBe("undecided");
    expect(horizontalVerdict(6, -7)).toBe("undecided");
    expect(horizontalVerdict(20, -40)).toBe("undecided");
  });

  it("gives a clearly rightward drag to navigation", () => {
    expect(horizontalVerdict(40, -10)).toBe("navigation");
    expect(horizontalVerdict(26, 0)).toBe("navigation");
  });

  it("does not call a rightward drag navigation while it is mostly vertical", () => {
    expect(horizontalVerdict(40, -60)).toBe("undecided");
  });

  it("gives a clearly leftward drag to sync regardless of the vertical part", () => {
    expect(horizontalVerdict(-30, -5)).toBe("sync");
    expect(horizontalVerdict(-25, 0)).toBe("sync");
    // A diagonal used to wedge the race: neither activate nor fail.
    expect(horizontalVerdict(-30, -200)).toBe("sync");
  });

  it("ignores jitter around the origin", () => {
    expect(horizontalVerdict(0, 0)).toBe("undecided");
    expect(horizontalVerdict(3, 3)).toBe("undecided");
  });
});

describe("isVerticalCommitted", () => {
  it("latches once the drag is clearly upward", () => {
    expect(isVerticalCommitted(0, -13)).toBe(true);
    expect(isVerticalCommitted(-8, -30)).toBe(true);
  });

  it("does not latch before the drag has gone far enough up", () => {
    expect(isVerticalCommitted(0, -11)).toBe(false);
    expect(isVerticalCommitted(0, 40)).toBe(false);
  });

  it("latches a thumb arc, which is what a real swipe up looks like", () => {
    // A thumb pivots at its base, so a swipe up from the lower right drifts
    // left as it extends. The old 45deg rule missed these, they fell through to
    // horizontalVerdict, and the leftward branch failed the touch terminally --
    // the single biggest cause of "it works every other time".
    expect(isVerticalCommitted(-26, -14)).toBe(true);
    expect(isVerticalCommitted(26, -14)).toBe(true);
    expect(isVerticalCommitted(-30, -20)).toBe(true);
  });

  it("still refuses a drag that is genuinely sideways", () => {
    expect(isVerticalCommitted(50, -20)).toBe(false);
    expect(isVerticalCommitted(-50, -20)).toBe(false);
    expect(isVerticalCommitted(40, -13)).toBe(false);
  });

  it("latches the arc before the horizontal verdict can throw it away", () => {
    // The exact pair that used to die: dy clears the latch, but the old
    // |dx| < |dy| rule did not, and horizontalVerdict's leftward branch has no
    // dominance test -- so this read as "sync" and called the terminal fail().
    // swipeToSync could not have taken it either; its failOffsetY([-24, 24])
    // kills it as soon as the drag goes vertical.
    expect(isVerticalCommitted(-26, -14)).toBe(true);
    expect(horizontalVerdict(-26, -14)).toBe("sync");
  });

  it("keeps a swipe that only wobbles sideways after committing", () => {
    // 60px up, 20px of thumb drift: still filing, and once latched the caller
    // stops consulting horizontalVerdict — which would say "navigation" here.
    expect(isVerticalCommitted(20, -60)).toBe(true);
    expect(horizontalVerdict(20, -60)).toBe("undecided");
    expect(horizontalVerdict(30, -60)).toBe("undecided");
  });
});

describe("isAtScrollBottom", () => {
  it("is true for a note shorter than the viewport", () => {
    expect(isAtScrollBottom(0, 200, 600)).toBe(true);
  });

  it("is true within the slack of the real bottom", () => {
    expect(isAtScrollBottom(396, 1000, 600)).toBe(true);
  });

  it("is false while there is still note below", () => {
    expect(isAtScrollBottom(100, 1000, 600)).toBe(false);
  });
});

describe("visiblePageHeight", () => {
  it("subtracts the keyboard", () => {
    expect(visiblePageHeight(800, 300)).toBe(500);
  });

  it("never collapses to zero", () => {
    expect(visiblePageHeight(300, 800)).toBe(1);
  });
});

describe("shouldCommitFiling", () => {
  it("commits past COMMIT_FRACTION of the page", () => {
    // 15% of 500 = 75px. A short deliberate pull should already count.
    expect(shouldCommitFiling(-150, 500, 0)).toBe(true);
    expect(shouldCommitFiling(-90, 500, 0)).toBe(true);
    expect(shouldCommitFiling(-60, 500, 0)).toBe(false);
  });

  it("commits a fast flick regardless of distance", () => {
    expect(shouldCommitFiling(-10, 500, COMMIT_VELOCITY - 1)).toBe(true);
  });

  it("does not commit a slow short pull", () => {
    expect(shouldCommitFiling(-10, 500, -100)).toBe(false);
  });

  it("does not commit a downward flick", () => {
    expect(shouldCommitFiling(-10, 500, 900)).toBe(false);
  });
});

describe("NATIVE_BACK_RESPONSE_DISTANCE", () => {
  it("confines the native pop to the left gutter and nothing else", () => {
    // Absolute point coordinates, not edge distances: react-native-screens
    // passes them straight to isInGestureResponseDistance, which rejects a
    // touch when x > end. Unconstrained on every other side.
    expect(NATIVE_BACK_RESPONSE_DISTANCE).toEqual({ end: BACK_SWIPE_GUTTER });
  });

  it("partitions the screen rather than overlapping the pan's hitSlop", () => {
    // The pan carries hitSlop({ left: -BACK_SWIPE_GUTTER }), so it never sees a
    // touch starting left of the gutter -- and the native recognizer never sees
    // one starting right of it. No zone is contested, which is the whole point.
    const nativeTakes = (x: number) => x <= NATIVE_BACK_RESPONSE_DISTANCE.end;
    const panTakes = (x: number) => x >= BACK_SWIPE_GUTTER;
    for (const x of [0, 10, 23, 25, 200, 400]) {
      expect(nativeTakes(x) && panTakes(x)).toBe(false);
    }
  });
});
