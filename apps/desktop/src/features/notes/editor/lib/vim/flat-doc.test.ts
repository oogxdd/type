import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { buildVimDoc } from "./flat-doc";

// A stand-in for StarterKit's schema with just enough shape to exercise the
// projection: several block types, an inline leaf, and a hard break.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*" },
    horizontalRule: { group: "block" },
    hardBreak: { inline: true, group: "inline", selectable: false },
    image: { inline: true, group: "inline", attrs: { src: { default: "" } } },
    text: { group: "inline" },
  },
});

const { paragraph, heading, hardBreak, horizontalRule, image } = schema.nodes;
const paragraphOf = (text: string) =>
  paragraph.create(null, text ? schema.text(text) : null);

describe("buildVimDoc", () => {
  it("joins blocks into one buffer of lines", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [paragraphOf("hello"), paragraphOf("world")])
    );
    expect(doc.text).toBe("hello\nworld");
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]).toMatchObject({
      flatStart: 0,
      flatEnd: 5,
      from: 1,
      to: 6,
      blockPos: 0,
      blockEnd: 7,
      wholeBlock: true,
    });
    expect(doc.lines[1]).toMatchObject({
      flatStart: 6,
      flatEnd: 11,
      from: 8,
      to: 13,
      blockPos: 7,
      blockEnd: 14,
    });
  });

  it("maps every index to a position and back", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [paragraphOf("abc"), paragraphOf("de")])
    );
    for (let index = 0; index <= doc.text.length; index += 1) {
      if (doc.text[index] === "\n") {
        continue;
      }
      expect(doc.toIndex(doc.toPos(index))).toBe(index);
    }
  });

  it("maps the newline slot to the end of its line", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [paragraphOf("abc"), paragraphOf("de")])
    );
    expect(doc.toPos(3)).toBe(4);
    expect(doc.toPos(4)).toBe(6);
  });

  it("splits a block on hard breaks and marks it partial", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [
        paragraph.create(null, [
          schema.text("ab"),
          hardBreak.create(),
          schema.text("cd"),
        ]),
      ])
    );
    expect(doc.text).toBe("ab\ncd");
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines.every((line) => !line.wholeBlock)).toBe(true);
    expect(doc.lines[0]).toMatchObject({ from: 1, to: 3, blockPos: 0 });
    expect(doc.lines[1]).toMatchObject({ from: 4, to: 6, blockPos: 0 });
  });

  it("keeps an empty paragraph as an empty line", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [
        paragraphOf("a"),
        paragraphOf(""),
        paragraphOf("b"),
      ])
    );
    expect(doc.text).toBe("a\n\nb");
    expect(doc.lines[1]).toMatchObject({ from: 4, to: 4 });
    expect(doc.lineNumberAt(2)).toBe(1);
  });

  it("gives an inline leaf exactly one column", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [
        paragraph.create(null, [
          schema.text("a"),
          image.create({ src: "x" }),
          schema.text("b"),
        ]),
      ])
    );
    expect(doc.text).toHaveLength(3);
    expect(doc.lines[0]).toMatchObject({ from: 1, to: 4 });
  });

  it("skips non-textblock leaves so motions step over them", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [
        paragraphOf("a"),
        horizontalRule.create(),
        paragraphOf("b"),
      ])
    );
    expect(doc.text).toBe("a\nb");
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[1].blockPos).toBe(4);
  });

  it("treats a heading as an ordinary line", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [
        heading.create(null, schema.text("Title")),
        paragraphOf("body"),
      ])
    );
    expect(doc.text).toBe("Title\nbody");
    expect(doc.lineNumberAt(7)).toBe(1);
  });

  it("finds the line for any index", () => {
    const doc = buildVimDoc(
      schema.nodes.doc.create(null, [
        paragraphOf("one"),
        paragraphOf("two"),
        paragraphOf("three"),
      ])
    );
    expect(doc.lineNumberAt(0)).toBe(0);
    expect(doc.lineNumberAt(3)).toBe(0);
    expect(doc.lineNumberAt(4)).toBe(1);
    expect(doc.lineNumberAt(99)).toBe(2);
    expect(doc.lineAt(5).from).toBe(6);
  });
});
