import { describe, expect, it } from "vitest";
import {
  clearGestureAttempts, type GestureAttempt, getGestureAttempts,
  recordGestureAttempt, summarizeGestureAttempts,
} from "./gesture-trace";

const attempt = (patch: Partial<GestureAttempt> = {}): GestureAttempt => ({
  at: 1, startX: 200, startY: 600, maxDx: 0, maxDy: -100, maxPull: 0,
  durationMs: 120, direction: "up", outcome: "scroll", ...patch,
});

describe("gesture diagnostics", () => {
  it("does not mistake a normal long-note scroll or diagonal for a stolen gesture", () => {
    expect(summarizeGestureAttempts([
      attempt(), attempt({ outcome: "filed", maxPull: 85 }),
      attempt({ outcome: "cancelled" }),
      attempt({ direction: "diagonal", outcome: "diagonal" }),
    ])).toEqual({ total: 3, filed: 1, cancelled: 1 });
  });
  it("keeps only the newest 40 attempts and can clear them", () => {
    clearGestureAttempts();
    for (let i = 0; i < 45; i++) recordGestureAttempt(attempt({ at: i }));
    expect(getGestureAttempts()).toHaveLength(40);
    expect(getGestureAttempts()[0].at).toBe(44);
    clearGestureAttempts();
    expect(getGestureAttempts()).toEqual([]);
  });
});
