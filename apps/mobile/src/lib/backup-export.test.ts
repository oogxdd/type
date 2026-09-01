import { describe, expect, it } from "vitest";

import { backupFolderName } from "./backup-naming";

describe("backupFolderName", () => {
  it("creates a deterministic provider-safe name", () => {
    expect(
      backupFolderName("Personal / Notes", new Date("2026-09-01T01:02:03Z"))
    ).toBe("Type Backup - Personal - Notes - 2026-09-01 01-02-03 UTC");
  });

  it("falls back for a name made entirely of unsafe characters", () => {
    expect(backupFolderName(" /:*? ", new Date("2026-09-01T01:02:03Z"))).toContain(
      "Working Folder"
    );
  });
});
