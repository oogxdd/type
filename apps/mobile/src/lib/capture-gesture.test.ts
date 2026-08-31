import { describe, expect, it } from "vitest";

import {
  COMMIT_VELOCITY,
  horizontalVerdict,
  isAtScrollBottom,
  shouldCommitFiling,
  visiblePageHeight,
} from "./capture-gesture";

describe("horizontalVerdict", () => {
  it("keeps watching a swipe up that arcs sideways", () => {
    // The regression from 755be630: at the start of a swipe up dy is still
    // near zero, and an 8px sideways arc used to fail the gesture terminally.
    expect(horizontalVerdict(9, -7)).toBe("undecided");
    expect(horizontalVerdict(20, -4)).toBe("undecided");
    expect(horizontalVerdict(-18, -6)).toBe("undecided");
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
