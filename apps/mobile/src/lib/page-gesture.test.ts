import { describe, expect, it } from "vitest";
import { pageReleaseStep } from "./capture-gesture";

describe("page release", () => {
  it("files capture only upwards", () => {
    expect(pageReleaseStep("up", true, true, false, true, false)).toBe(1);
    expect(pageReleaseStep("down", true, true, false, true, false)).toBe(0);
  });
  it("pages only towards an available neighbor", () => {
    expect(pageReleaseStep("down", true, true, false, true, true)).toBe(-1);
    expect(pageReleaseStep("up", true, true, false, false, true)).toBe(0);
  });
  it("never pages on cancellation, retraction, loading or a horizontal swipe", () => {
    expect(pageReleaseStep("up", true, false, false, true, true)).toBe(0);
    expect(pageReleaseStep("down", false, true, false, true, true)).toBe(0);
    expect(pageReleaseStep("down", true, true, true, true, true)).toBe(0);
    expect(pageReleaseStep("right", true, true, false, true, true)).toBe(0);
  });
});
