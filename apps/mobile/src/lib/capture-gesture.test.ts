import { describe, expect, it } from "vitest";

import {
  COMMIT_VELOCITY,
  horizontalVerdict,
  isAtScrollBottom,
  shouldCommitFiling,
  visiblePageHeight,
} from "./capture-gesture";

describe("horizontalVerdict", () => {
  it("keeps watching a swipe that is already mostly vertical", () => {
    // Thresholds are tight (0.2.2's) because the whole-screen pop recognizer
    // is on for Capture, so the pan must get out of its way quickly. What
    // still has to survive is a drag whose vertical part already dominates.
    expect(horizontalVerdict(6, -7)).toBe("undecided");
    expect(horizontalVerdict(20, -40)).toBe("undecided");
  });

  it("hands an early sideways arc to navigation, ties included", () => {
    // Deliberate: navigation wins ambiguity, because a pan sitting in BEGAN
    // is what makes the native back gesture feel dead.
    expect(horizontalVerdict(9, -7)).toBe("navigation");
    expect(horizontalVerdict(20, -4)).toBe("navigation");
    expect(horizontalVerdict(-18, -6)).toBe("sync");
  });

  it("gives a clearly rightward drag to navigation", () => {
    expect(horizontalVerdict(40, -10)).toBe("navigation");
  });

  it("does not call a rightward drag navigation while it is mostly vertical", () => {
    expect(horizontalVerdict(40, -60)).toBe("undecided");
  });

  it("gives a clearly leftward drag to sync regardless of the vertical part", () => {
    expect(horizontalVerdict(-30, -5)).toBe("sync");
    // A diagonal used to wedge the race: neither activate nor fail.
    expect(horizontalVerdict(-30, -200)).toBe("sync");
  });

  it("ignores jitter around the origin", () => {
    expect(horizontalVerdict(0, 0)).toBe("undecided");
    expect(horizontalVerdict(3, 3)).toBe("undecided");
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
  it("commits past a fifth of the page", () => {
    expect(shouldCommitFiling(-150, 500, 0)).toBe(true);
    expect(shouldCommitFiling(-90, 500, 0)).toBe(false);
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
