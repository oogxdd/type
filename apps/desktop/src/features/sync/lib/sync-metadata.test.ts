import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatLastSuccessfulSync,
  readLastSuccessfulSyncAt,
  writeLastSuccessfulSyncAt,
} from "./sync-metadata";

const NOW = new Date("2026-09-04T12:00:00.000Z").getTime();

describe("formatLastSuccessfulSync", () => {
  it("describes sync that has not been enabled", () => {
    expect(formatLastSuccessfulSync("", NOW)).toBe("Sync is off");
  });

  it("uses human-friendly recent time ranges", () => {
    expect(formatLastSuccessfulSync("2026-09-04T11:59:45.000Z", NOW)).toBe(
      "Last synced just now"
    );
    expect(formatLastSuccessfulSync("2026-09-04T11:22:00.000Z", NOW)).toBe(
      "Last synced 38 minutes ago"
    );
    expect(formatLastSuccessfulSync("2026-09-04T08:00:00.000Z", NOW)).toBe(
      "Last synced a few hours ago"
    );
    expect(formatLastSuccessfulSync("2026-09-03T10:00:00.000Z", NOW)).toBe(
      "Last synced yesterday"
    );
  });
});

describe("sync metadata persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("seeds the dedicated key from an existing per-profile timestamp", () => {
    const values = new Map<string, string>([
      [
        "notes-viewer-profile-sync-settings",
        JSON.stringify({ work: { lastSuccessfulSyncAt: "2026-09-03T10:00:00.000Z" } }),
      ],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    expect(readLastSuccessfulSyncAt("work")).toBe("2026-09-03T10:00:00.000Z");
    expect(values.get("typenotes-last-successful-sync:work")).toBe(
      "2026-09-03T10:00:00.000Z"
    );

    writeLastSuccessfulSyncAt("work", "2026-09-04T12:00:00.000Z");
    expect(readLastSuccessfulSyncAt("work")).toBe("2026-09-04T12:00:00.000Z");
  });
});
