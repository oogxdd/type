import { describe, expect, it } from "vitest";
import { mergeTag, validTag } from "./selection-tags";
describe("selection tag values", () => {
  it("merges by normalized name", () => { expect(mergeTag([{ name: "Work", color: "#123456" }], { name: "work", color: "#abcdef" })).toEqual([{ name: "work", color: "#abcdef" }]); });
  it("rejects injected CSS and invalid names", () => { expect(validTag({ name: "ok", color: "red;position:fixed" })).toBe(false); expect(validTag({ name: "bad!", color: "#abcdef" })).toBe(false); });
});
