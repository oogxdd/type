import { describe, expect, it } from "vitest";

import {
  clearGestureAttempts,
  type GestureAttempt,
  getGestureAttempts,
  outcomeOf,
  recordGestureAttempt,
  summarizeGestureAttempts,
} from "./gesture-trace";

const attempt = (patch: Partial<GestureAttempt> = {}): GestureAttempt => ({
  at: 1,
  startX: 200,
  startY: 600,
  maxDx: 0,
  maxDy: 0,
  durationMs: 120,
  latchedVertical: false,
  activated: false,
  failedByVerdict: false,
  failedToSync: false,
  blockedByTransitioning: false,
  gotEnd: false,
  endSuccess: false,
  filed: false,
  ...patch,
});

describe("outcomeOf", () => {
  it("reports a clear upward drag we never claimed as stolen", () => {
    // The signature this whole trace exists for: the finger went up, we neither
    // activated nor handed the touch over, and it ended anyway — so something
    // outside the screen took it.
    expect(outcomeOf(attempt({ maxDy: -90 }))).toBe("stolen");
  });

  it("does not call a tap or a scroll stolen", () => {
    expect(outcomeOf(attempt({ maxDy: -4 }))).toBe("idle");
    expect(outcomeOf(attempt({ maxDy: 120 }))).toBe("idle");
  });

  it("separates the handovers we chose from the ones we lost", () => {
    expect(outcomeOf(attempt({ maxDy: -90, failedByVerdict: true }))).toBe("back");
    expect(outcomeOf(attempt({ maxDy: -90, failedToSync: true }))).toBe("sync");
    expect(
      outcomeOf(attempt({ maxDy: -90, blockedByTransitioning: true }))
    ).toBe("blocked");
  });

  it("distinguishes a claimed swipe that filed from one released short", () => {
    expect(outcomeOf(attempt({ maxDy: -200, activated: true, filed: true }))).toBe(
      "filed"
    );
    expect(outcomeOf(attempt({ maxDy: -30, activated: true }))).toBe("released");
  });
});

describe("summarizeGestureAttempts", () => {
  it("counts only upward attempts and lists where the lost ones started", () => {
    const summary = summarizeGestureAttempts([
      attempt({ maxDy: -80, startY: 740 }),
      attempt({ maxDy: -80, startY: 610 }),
      attempt({ maxDy: -80, activated: true, filed: true }),
      attempt({ maxDy: -2 }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.filed).toBe(1);
    expect(summary.stolen).toBe(2);
    expect(summary.stolenStartY).toEqual([610, 740]);
  });
});

describe("the ring buffer", () => {
  it("keeps the newest attempt first", () => {
    clearGestureAttempts();
    recordGestureAttempt(attempt({ at: 1 }));
    recordGestureAttempt(attempt({ at: 2 }));
    expect(getGestureAttempts().map((entry) => entry.at)).toEqual([2, 1]);
    clearGestureAttempts();
    expect(getGestureAttempts()).toEqual([]);
  });
});
