import { describe, expect, it } from "vitest";

import { elapsedSeconds, formatRecordingTimer } from "./recording-timer";

describe("formatRecordingTimer", () => {
  it("formats sub-minute values with a zero minute", () => {
    expect(formatRecordingTimer(0)).toBe("0:00");
    expect(formatRecordingTimer(5)).toBe("0:05");
    expect(formatRecordingTimer(30)).toBe("0:30");
    expect(formatRecordingTimer(59)).toBe("0:59");
  });

  it("formats minutes with zero-padded seconds", () => {
    expect(formatRecordingTimer(60)).toBe("1:00");
    expect(formatRecordingTimer(75)).toBe("1:15");
    expect(formatRecordingTimer(659)).toBe("10:59");
  });

  it("rolls into hours past sixty minutes", () => {
    expect(formatRecordingTimer(3600)).toBe("1:00:00");
    expect(formatRecordingTimer(3661)).toBe("1:01:01");
    expect(formatRecordingTimer(45296)).toBe("12:34:56");
  });

  it("clamps and floors defensively", () => {
    expect(formatRecordingTimer(-5)).toBe("0:00");
    expect(formatRecordingTimer(30.9)).toBe("0:30");
  });
});

describe("elapsedSeconds", () => {
  it("counts whole seconds from the anchor", () => {
    expect(elapsedSeconds(1000, 1000)).toBe(0);
    expect(elapsedSeconds(1000, 1999)).toBe(0);
    expect(elapsedSeconds(1000, 2000)).toBe(1);
    expect(elapsedSeconds(1000, 31000)).toBe(30);
  });

  // The reported bug: sleep for ~10s at 0:30, wake up, and the timer must read
  // the real elapsed time (0:40) rather than the frozen 0:30.
  it("reflects real time across a sleep gap", () => {
    const startedAt = 0;
    expect(elapsedSeconds(startedAt, 30000)).toBe(30);
    expect(elapsedSeconds(startedAt, 40000)).toBe(40);
  });

  it("never goes negative if the clock is skewed", () => {
    expect(elapsedSeconds(5000, 1000)).toBe(0);
  });
});
