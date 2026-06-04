import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("preserves messages of Error subclasses", () => {
    class HttpError extends Error {}
    expect(getErrorMessage(new HttpError("404"))).toBe("404");
  });

  it("passes through plain strings", () => {
    expect(getErrorMessage("offline")).toBe("offline");
  });

  it("stringifies non-Error, non-string values", () => {
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
    expect(getErrorMessage({ code: 1 })).toBe("[object Object]");
  });
});
