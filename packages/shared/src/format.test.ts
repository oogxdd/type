import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatNoteDateLabel } from "./format";

describe("formatNoteDateLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Labels are cached per calendar field; every one must still be exactly
  // what the uncached toLocale*String call produced, on first use and after.
  it("matches the direct toLocale*String output, on every call", () => {
    const cases: Array<[Date, () => string]> = [];
    const time = (date: Date) => () =>
      date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const weekday = (date: Date) => () =>
      date.toLocaleDateString([], { weekday: "long" }).toLowerCase();
    const dayMonth = (date: Date) => () =>
      date.toLocaleDateString([], { day: "numeric", month: "short" });
    const fullDate = (date: Date) => () =>
      date.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
    for (const date of [new Date(2026, 8, 25, 9, 5), new Date(2026, 8, 25, 21, 5)]) {
      cases.push([date, time(date)]);
    }
    for (const date of [new Date(2026, 8, 22, 8), new Date(2026, 8, 21, 8)]) {
      cases.push([date, weekday(date)]);
    }
    for (const date of [new Date(2026, 2, 14), new Date(2026, 3, 14), new Date(2026, 2, 15)]) {
      cases.push([date, dayMonth(date)]);
    }
    for (const date of [new Date(2021, 10, 2), new Date(2020, 10, 2), new Date(2021, 10, 3)]) {
      cases.push([date, fullDate(date)]);
    }

    for (let round = 0; round < 2; round += 1) {
      for (const [date, direct] of cases) {
        expect(formatNoteDateLabel(date.getTime())).toBe(direct());
      }
    }
    expect(formatNoteDateLabel(new Date(2026, 8, 24, 8).getTime())).toBe("yesterday");
    expect(formatNoteDateLabel(null)).toBe("");
  });
});
