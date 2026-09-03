import { describe, expect, it } from "vitest";

import {
  COMMIT_VELOCITY,
  horizontalVerdict,
  isInNativeBackBand,
  nativeBackBandBottom,
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

  it("does not latch a diagonal that is more sideways than up", () => {
    expect(isVerticalCommitted(30, -20)).toBe(false);
    expect(isVerticalCommitted(-30, -20)).toBe(false);
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

describe("isInNativeBackBand", () => {
  const H = 800; // bottom of the native band at 0.52 → 416

  it("puts the line where nativeBackBandBottom says", () => {
    expect(nativeBackBandBottom(H)).toBe(416);
  });

  it("leaves the upper screen to the native back gesture", () => {
    expect(isInNativeBackBand(0, H)).toBe(true);
    expect(isInNativeBackBand(300, H)).toBe(true);
    expect(isInNativeBackBand(416, H)).toBe(true);
  });

  it("keeps the lower screen for the capture gestures", () => {
    // Where a thumb starts pushing the page up. Nothing may fail the touch
    // here, because nothing else is competing for it.
    expect(isInNativeBackBand(417, H)).toBe(false);
    expect(isInNativeBackBand(700, H)).toBe(false);
    expect(isInNativeBackBand(H, H)).toBe(false);
  });
});
