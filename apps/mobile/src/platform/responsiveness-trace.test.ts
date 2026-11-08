import { describe, expect, it, vi } from "vitest";
import { beginNavigationTrace, clearResponsivenessTrace, configureResponsivenessTrace, exportResponsivenessTrace, finishNavigationTrace, recordResponsiveness } from "./responsiveness-trace";

describe("responsiveness trace", () => {
  it("is opt-in, bounded, and distinguishes JS navigation timing from rendered latency", () => {
    clearResponsivenessTrace(); configureResponsivenessTrace(false);
    recordResponsiveness("ignored");
    expect(exportResponsivenessTrace()).not.toContain("ignored");
    configureResponsivenessTrace(true);
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(1000); beginNavigationTrace();
    clock.mockReturnValue(1042); finishNavigationTrace();
    expect(exportResponsivenessTrace()).toContain("p95: 42ms");
    expect(exportResponsivenessTrace()).toContain("not rendered-frame latency");
    for (let index = 0; index < 600; index++) recordResponsiveness("heartbeat");
    expect(exportResponsivenessTrace().split("\n")).toHaveLength(502);
    clock.mockRestore(); configureResponsivenessTrace(false); clearResponsivenessTrace();
  });
});
