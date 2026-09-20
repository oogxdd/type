import { describe, expect, it } from "vitest";
import {
  isPullReady, menuReleaseTarget, overscrollPastEnd,
  resolveSwipeDirection, shouldCommitPull, visiblePageHeight,
} from "./capture-gesture";

describe("direction ownership", () => {
  it("waits through jitter, then uses the same rule for all four directions", () => {
    expect(resolveSwipeDirection("pending", 8, -5)).toBe("pending");
    expect(resolveSwipeDirection("pending", 30, 6)).toBe("right");
    expect(resolveSwipeDirection("pending", -30, 6)).toBe("left");
    expect(resolveSwipeDirection("pending", 6, -30)).toBe("up");
    expect(resolveSwipeDirection("pending", 6, 30)).toBe("down");
  });
  it("rejects a diagonal without later turning it into a command", () => {
    const direction = resolveSwipeDirection("pending", 20, -20);
    expect(direction).toBe("diagonal");
    expect(resolveSwipeDirection(direction, 20, -120)).toBe("diagonal");
  });
  it("allows a thumb to arc or reverse after choosing an axis", () => {
    const direction = resolveSwipeDirection("pending", -5, -20);
    expect(resolveSwipeDirection(direction, -90, -70)).toBe("up");
    expect(resolveSwipeDirection(direction, 0, 10)).toBe("up");
  });
});

describe("pull after the end of a note", () => {
  it("excludes all travel through a long note", () => {
    expect(overscrollPastEnd(500, 1800, 600)).toBe(0);
    expect(overscrollPastEnd(1200, 1800, 600)).toBe(0);
    expect(overscrollPastEnd(1280, 1800, 600)).toBe(80);
  });
  it("handles short notes, top bounce and an unmeasured viewport", () => {
    expect(overscrollPastEnd(80, 200, 600)).toBe(80);
    expect(overscrollPastEnd(-80, 200, 600)).toBe(0);
    expect(overscrollPastEnd(80, 200, 0)).toBe(0);
  });
  it("arms, tolerates jitter, and lets the user retract to cancel", () => {
    expect(isPullReady(79, false)).toBe(false);
    expect(isPullReady(80, false)).toBe(true);
    expect(isPullReady(76, true)).toBe(true);
    expect(isPullReady(63, true)).toBe(false);
    expect(isPullReady(76, false)).toBe(false);
  });
  it("only files an armed upward release; cancellation never files", () => {
    expect(shouldCommitPull("up", true, true, false)).toBe(true);
    expect(shouldCommitPull("up", false, true, false)).toBe(false);
    expect(shouldCommitPull("up", true, false, false)).toBe(false);
    expect(shouldCommitPull("up", true, true, true)).toBe(false);
    expect(shouldCommitPull("diagonal", true, true, false)).toBe(false);
    expect(shouldCommitPull("right", true, true, false)).toBe(false);
  });
  it("keeps the incoming page above the keyboard", () => {
    expect(visiblePageHeight(800, 300)).toBe(500);
    expect(visiblePageHeight(300, 800)).toBe(1);
  });
});

describe("menu release", () => {
  it("supports dragging open and closed, with a reversible preview", () => {
    expect(menuReleaseTarget(0.4, 0, false, true)).toBe(1);
    expect(menuReleaseTarget(0.1, 0, false, true)).toBe(0);
    expect(menuReleaseTarget(0.6, 0, true, true)).toBe(0);
    expect(menuReleaseTarget(0.9, 0, true, true)).toBe(1);
  });
  it("allows a horizontal flick, but never completes a cancelled gesture", () => {
    expect(menuReleaseTarget(0.1, 600, false, true)).toBe(1);
    expect(menuReleaseTarget(0.9, -600, true, true)).toBe(0);
    expect(menuReleaseTarget(0.8, 900, false, false)).toBe(0);
    expect(menuReleaseTarget(0.2, -900, true, false)).toBe(1);
  });
});
