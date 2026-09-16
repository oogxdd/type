import { describe, expect, it } from "vitest";
import { formatEditorDate } from "./editor-date";

describe("editor divider dates", () => {
  const now = new Date(2026, 8, 20, 18);
  it("includes time on today, yesterday and weekday labels", () => {
    expect(formatEditorDate(new Date(2026, 8, 20, 16).getTime(), now)).toBe("Today 16:00");
    expect(formatEditorDate(new Date(2026, 8, 19, 16).getTime(), now)).toBe("Yesterday 16:00");
    expect(formatEditorDate(new Date(2026, 8, 15, 16).getTime(), now)).toBe("Tuesday 16:00");
  });
  it("includes weekday, day, month and time for older dates, and year when needed", () => {
    expect(formatEditorDate(new Date(2026, 8, 12, 16).getTime(), now)).toBe("Saturday 12 Sept 16:00");
    expect(formatEditorDate(new Date(2025, 8, 12, 16).getTime(), now)).toBe("Friday 12 Sept 2025 16:00");
  });
  it("does not invent a date for missing metadata", () => {
    expect(formatEditorDate(null, now)).toBe("");
    expect(formatEditorDate(NaN, now)).toBe("");
  });
});
