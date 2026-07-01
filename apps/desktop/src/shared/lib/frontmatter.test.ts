import { describe, expect, it } from "vitest";
import {
  readFrontmatterScalar,
  removeFrontmatterScalar,
  splitFrontmatter,
  stripFrontmatter,
  upsertFrontmatterScalar,
} from "./frontmatter";

describe("splitFrontmatter", () => {
  it("returns a null block when there is no frontmatter", () => {
    expect(splitFrontmatter("just a body")).toEqual({
      frontmatterBlock: null,
      body: "just a body",
    });
  });

  it("separates a frontmatter block from the body and drops the blank line", () => {
    const { frontmatterBlock, body } = splitFrontmatter("---\nid: 1\n---\nhello");
    expect(frontmatterBlock).toBe("---\nid: 1\n---");
    expect(body).toBe("hello");
  });

  it("normalizes CRLF newlines", () => {
    expect(stripFrontmatter("a\r\nb")).toBe("a\nb");
  });

  it("ignores a `---` fenced block that is not key: value frontmatter", () => {
    // A horizontal rule / thematic break, not metadata.
    const input = "---\njust prose\n---\nbody";
    expect(splitFrontmatter(input).frontmatterBlock).toBeNull();
  });
});

describe("readFrontmatterScalar", () => {
  it("reads an unquoted value", () => {
    expect(readFrontmatterScalar("---\ntype: note\n---\n", "type")).toBe("note");
  });

  it("unwraps double- and single-quoted values", () => {
    expect(readFrontmatterScalar('---\ntitle: "Hi there"\n---\n', "title")).toBe("Hi there");
    expect(readFrontmatterScalar("---\ntitle: 'Hi'\n---\n", "title")).toBe("Hi");
  });

  it("returns null for a missing key or missing frontmatter", () => {
    expect(readFrontmatterScalar("---\nid: 1\n---\n", "type")).toBeNull();
    expect(readFrontmatterScalar("no frontmatter", "id")).toBeNull();
  });
});

describe("upsertFrontmatterScalar", () => {
  it("creates a frontmatter block when none exists", () => {
    expect(upsertFrontmatterScalar("hello", "id", "1")).toBe("---\nid: 1\n---\nhello");
  });

  it("updates an existing key in place", () => {
    expect(upsertFrontmatterScalar("---\nid: 1\n---\nx", "id", "2")).toBe("---\nid: 2\n---\nx");
  });

  it("appends a new key while preserving existing ones", () => {
    expect(upsertFrontmatterScalar("---\nid: 1\n---\nx", "type", "note")).toBe(
      "---\nid: 1\ntype: note\n---\nx"
    );
  });

  it("round-trips with readFrontmatterScalar", () => {
    const next = upsertFrontmatterScalar("body", "status", "done");
    expect(readFrontmatterScalar(next, "status")).toBe("done");
  });
});

describe("removeFrontmatterScalar", () => {
  it("removes one key while keeping the others", () => {
    expect(removeFrontmatterScalar("---\nid: 1\ntype: note\n---\nx", "id")).toBe(
      "---\ntype: note\n---\nx"
    );
  });

  it("collapses to the plain body when the last key is removed", () => {
    expect(removeFrontmatterScalar("---\nid: 1\n---\nhello", "id")).toBe("hello");
  });

  it("is a no-op when the key is absent", () => {
    const input = "---\nid: 1\n---\nhello";
    expect(removeFrontmatterScalar(input, "missing")).toBe(input);
  });
});
