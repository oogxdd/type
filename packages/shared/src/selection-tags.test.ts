import { describe, expect, it } from "vitest";
import { blockAnchors, mergeTag, readSelectionTags, resolveBlockAnchor, writeSelectionTags } from "./selection-tags";
import { stripFrontmatter } from "./frontmatter";

const tag = { name: 'Конфиденциальное: "личное"', color: "#8b5cf6" };
describe("selection tag anchors", () => {
  it("follows a block when paragraphs are inserted before it", () => {
    const original = blockAnchors(["before", "password goes here", "after"]);
    expect(resolveBlockAnchor(original[1], blockAnchors(["new", "another", "before", "password goes here", "after"]))).toBe(3);
  });
  it("survives deleting earlier paragraphs and moving unique text", () => {
    const anchor = blockAnchors(["one", "two", "three"])[1];
    expect(resolveBlockAnchor(anchor, blockAnchors(["two", "three"]))).toBe(0);
    expect(resolveBlockAnchor(anchor, blockAnchors(["three", "one", "two"]))).toBe(2);
  });
  it("distinguishes repeated text through its neighbors", () => {
    const anchor = blockAnchors(["alpha", "same", "beta", "same", "gamma"])[3];
    expect(resolveBlockAnchor(anchor, blockAnchors(["new", "alpha", "same", "beta", "same", "gamma"]))).toBe(4);
  });
  it("restores repeated blocks exactly in an unchanged document", () => {
    const blocks = blockAnchors(["same", "same", "same", "same"]);
    expect(resolveBlockAnchor(blocks[2], blocks)).toBe(2);
  });
  it("does not guess for changed or ambiguous blocks", () => {
    const old = blockAnchors(["before", "same", "after"])[1];
    expect(resolveBlockAnchor(old, blockAnchors(["before", "changed", "after"]))).toBeNull();
    expect(resolveBlockAnchor(old, blockAnchors(["x", "same", "y", "x", "same", "y"]))).toBeNull();
  });
});
describe("selection tag frontmatter", () => {
  it("roundtrips Unicode tags, punctuation and colors without copying body text", () => {
    const source = "---\nid: note-1\ncustom: keep-me\n---\nA secret\n\nOther text\n";
    const blocks = [{ ...blockAnchors(["A secret", "Other text"])[0], tags: [tag] }];
    const result = writeSelectionTags(source, blocks);
    expect(readSelectionTags(result)).toEqual(blocks);
    expect(stripFrontmatter(result)).toBe(stripFrontmatter(source));
    expect(result).toContain("custom: keep-me");
    expect(result.split("\n---")[0]).not.toContain("A secret");
  });
  it("updates a single field and removes it when no tags remain", () => {
    const blocks = [{ ...blockAnchors(["text"])[0], tags: [tag] }];
    const once = writeSelectionTags("text", blocks);
    expect(writeSelectionTags(once, blocks)).toBe(once);
    expect(writeSelectionTags(once, [])).toBe("text");
  });
  it("rejects corrupt metadata, unsafe colors and future versions", () => {
    expect(readSelectionTags('---\ntype_selection_tags: broken\n---\ntext')).toEqual([]);
    expect(readSelectionTags('---\ntype_selection_tags: {"version":2,"blocks":[]}\n---\ntext')).toEqual([]);
    const blocks = [{ ...blockAnchors(["text"])[0], tags: [{ name: "tag", color: "red; position: fixed" }] }];
    expect(readSelectionTags(writeSelectionTags("text", blocks))).toEqual([]);
  });
  it("reassigns the same name without duplicates and keeps unrelated tags", () => {
    expect(mergeTag([{name:"Work",color:"#2563eb"}, tag], {name:"work",color:"#16a34a"})).toEqual([tag,{name:"work",color:"#16a34a"}]);
  });
});
