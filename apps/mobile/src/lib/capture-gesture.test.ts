import { describe, expect, it } from "vitest";

import {
  overscrollPastEnd,
  PULL_TAB_HEIGHT,
  PULL_TAB_MAX_STRETCH,
  PULL_THRESHOLD,
  pullProgress,
  pullTabReveal,
  shouldCommitPull,
  visiblePageHeight,
} from "./capture-gesture";

describe("overscrollPastEnd", () => {
  it("is zero while there is still note below", () => {
    expect(overscrollPastEnd(100, 1000, 600)).toBe(0);
  });

  it("is zero exactly at the end", () => {
    expect(overscrollPastEnd(400, 1000, 600)).toBe(0);
  });

  it("measures how far past the end the content has been dragged", () => {
    expect(overscrollPastEnd(460, 1000, 600)).toBe(60);
  });

  it("treats a note shorter than the viewport as already at its end", () => {
    // Nothing to scroll, so the first pixel of drag is already a pull. That is
    // what makes a blank page fileable without a special case for it.
    expect(overscrollPastEnd(0, 200, 600)).toBe(0);
    expect(overscrollPastEnd(30, 200, 600)).toBe(30);
  });

  it("ignores the top bounce", () => {
    // Bouncing backwards past the start is a negative offset and belongs to
    // the keyboard-escape observer, not to filing.
    expect(overscrollPastEnd(-50, 1000, 600)).toBe(0);
  });
});

describe("shouldCommitPull", () => {
  it("commits at the threshold and past it", () => {
    expect(shouldCommitPull(PULL_THRESHOLD)).toBe(true);
    expect(shouldCommitPull(PULL_THRESHOLD + 40)).toBe(true);
  });

  it("does not commit a pull that fell short", () => {
    expect(shouldCommitPull(PULL_THRESHOLD - 1)).toBe(false);
    expect(shouldCommitPull(0)).toBe(false);
  });
});

describe("pullProgress", () => {
  it("runs 0..1 across the threshold and then holds", () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(PULL_THRESHOLD / 2)).toBeCloseTo(0.5);
    expect(pullProgress(PULL_THRESHOLD)).toBe(1);
    expect(pullProgress(PULL_THRESHOLD * 3)).toBe(1);
  });
});

describe("pullTabReveal", () => {
  it("tracks the overscroll one to one", () => {
    // The tab has to read as attached to the page, so any damping here would
    // show up as lag against the text moving beside it.
    expect(pullTabReveal(0)).toBe(0);
    expect(pullTabReveal(30)).toBe(30);
    expect(pullTabReveal(PULL_TAB_HEIGHT)).toBe(PULL_TAB_HEIGHT);
  });

  it("stops so a hard fling cannot throw it off screen", () => {
    expect(pullTabReveal(10_000)).toBe(PULL_TAB_HEIGHT + PULL_TAB_MAX_STRETCH);
  });

  it("has fully cleared the bottom edge before the threshold", () => {
    // Otherwise the tab would still be half off-screen at the moment it turns
    // armed, and the state change would be invisible where it matters most.
    expect(pullTabReveal(PULL_THRESHOLD)).toBeGreaterThan(PULL_TAB_HEIGHT);
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
