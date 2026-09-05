import { describe, expect, it } from "vitest";
import {
  bracketObject,
  classOf,
  findCharInLine,
  firstNonBlankIndex,
  lastNonBlankIndex,
  lineEndIndex,
  lineStartIndex,
  matchingBracket,
  paragraphBackward,
  paragraphForward,
  paragraphObject,
  quoteObject,
  wordBackward,
  wordEndBackward,
  wordEndForward,
  wordForward,
  wordObject,
} from "./text-motions";

describe("classOf", () => {
  it("splits words, punctuation and blanks", () => {
    expect(classOf("a")).toBe("word");
    expect(classOf("7")).toBe("word");
    expect(classOf("_")).toBe("word");
    expect(classOf("ф")).toBe("word");
    expect(classOf(".")).toBe("punct");
    expect(classOf(" ")).toBe("blank");
    expect(classOf("\n")).toBe("blank");
    expect(classOf(undefined)).toBe("blank");
  });

  it("treats everything non-blank as one class for W/B/E", () => {
    expect(classOf(".", true)).toBe("word");
    expect(classOf(" ", true)).toBe("blank");
  });
});

describe("wordForward", () => {
  const text = "foo.bar baz";

  it("stops at punctuation like w", () => {
    expect(wordForward(text, 0)).toBe(3);
    expect(wordForward(text, 3)).toBe(4);
    expect(wordForward(text, 4)).toBe(8);
  });

  it("skips punctuation like W", () => {
    expect(wordForward(text, 0, true)).toBe(8);
  });

  it("stops on an empty line", () => {
    expect(wordForward("one\n\ntwo", 0)).toBe(4);
  });

  it("clamps at the end of the buffer", () => {
    expect(wordForward(text, 10)).toBe(text.length);
  });
});

describe("wordBackward", () => {
  const text = "foo.bar baz";

  it("walks back one word at a time", () => {
    expect(wordBackward(text, 8)).toBe(4);
    expect(wordBackward(text, 4)).toBe(3);
    expect(wordBackward(text, 3)).toBe(0);
    expect(wordBackward(text, 0)).toBe(0);
  });

  it("skips punctuation for B", () => {
    expect(wordBackward(text, 8, true)).toBe(0);
  });
});

describe("wordEndForward", () => {
  it("lands on the last character of the word", () => {
    const text = "foo bar";
    expect(wordEndForward(text, 0)).toBe(2);
    expect(wordEndForward(text, 2)).toBe(6);
  });

  it("crosses a line break to reach the next word", () => {
    expect(wordEndForward("ab\ncd", 1)).toBe(4);
  });
});

describe("wordEndBackward", () => {
  it("lands on the previous word's last character", () => {
    expect(wordEndBackward("foo bar", 4)).toBe(2);
  });
});

describe("line helpers", () => {
  const text = "first\n  indented  \nlast";

  it("finds line bounds", () => {
    expect(lineStartIndex(text, 3)).toBe(0);
    expect(lineEndIndex(text, 3)).toBe(5);
    expect(lineStartIndex(text, 8)).toBe(6);
    expect(lineEndIndex(text, 8)).toBe(18);
  });

  it("finds the first and last non-blank characters", () => {
    expect(firstNonBlankIndex(text, 6)).toBe(8);
    expect(lastNonBlankIndex(text, 6)).toBe(15);
  });

  it("treats an empty line as its own bounds", () => {
    expect(lineStartIndex("a\n\nb", 2)).toBe(2);
    expect(lineEndIndex("a\n\nb", 2)).toBe(2);
  });
});

describe("findCharInLine", () => {
  const text = "a,b,c\nd,e";

  it("finds forward and backward", () => {
    expect(findCharInLine(text, 0, ",", { forward: true, till: false })).toBe(1);
    expect(findCharInLine(text, 0, ",", { forward: true, till: false, count: 2 })).toBe(3);
    expect(findCharInLine(text, 4, ",", { forward: false, till: false })).toBe(3);
  });

  it("stops one short for t and T", () => {
    expect(findCharInLine(text, 0, ",", { forward: true, till: true })).toBe(0);
    expect(findCharInLine(text, 0, "c", { forward: true, till: true })).toBe(3);
    expect(findCharInLine(text, 4, "a", { forward: false, till: true })).toBe(1);
  });

  it("never leaves the line and reports failure", () => {
    expect(findCharInLine(text, 0, "d", { forward: true, till: false })).toBeNull();
    expect(findCharInLine(text, 0, "z", { forward: true, till: false })).toBeNull();
  });
});

describe("paragraph motions", () => {
  const text = "one\ntwo\n\nthree\n\nfour";

  it("moves to the next and previous blank line", () => {
    expect(paragraphForward(text, 0)).toBe(8);
    expect(paragraphForward(text, 9)).toBe(15);
    expect(paragraphBackward(text, 16)).toBe(15);
    expect(paragraphBackward(text, 9)).toBe(8);
  });

  it("clamps at the buffer edges", () => {
    expect(paragraphForward(text, 16)).toBe(text.length);
    expect(paragraphBackward(text, 1)).toBe(0);
  });
});

describe("matchingBracket", () => {
  it("jumps both ways", () => {
    const text = "call(a, (b), c)";
    expect(matchingBracket(text, 4)).toBe(14);
    expect(matchingBracket(text, 14)).toBe(4);
    expect(matchingBracket(text, 8)).toBe(10);
  });

  it("scans forward on the line when not on a bracket", () => {
    expect(matchingBracket("call(a)", 0)).toBe(6);
  });

  it("returns null when there is no match", () => {
    expect(matchingBracket("no brackets", 0)).toBeNull();
  });
});

describe("wordObject", () => {
  const text = "the quick brown";

  it("iw takes the word only", () => {
    expect(wordObject(text, 5, { inner: true, big: false })).toEqual({
      start: 4,
      end: 9,
    });
  });

  it("aw takes the trailing whitespace", () => {
    expect(wordObject(text, 5, { inner: false, big: false })).toEqual({
      start: 4,
      end: 10,
    });
  });

  it("aw falls back to leading whitespace at the end of a line", () => {
    expect(wordObject(text, 12, { inner: false, big: false })).toEqual({
      start: 9,
      end: 15,
    });
  });

  it("never crosses a line break", () => {
    const range = wordObject("ab\ncd", 3, { inner: true, big: false });
    expect(range).toEqual({ start: 3, end: 5 });
  });
});

describe("quoteObject", () => {
  const text = 'say "hello there" now';

  it("i\" excludes the quotes", () => {
    expect(quoteObject(text, 8, '"', { inner: true })).toEqual({
      start: 5,
      end: 16,
    });
  });

  it('a" includes them', () => {
    expect(quoteObject(text, 8, '"', { inner: false })).toEqual({
      start: 4,
      end: 17,
    });
  });

  it("finds the pair ahead of the cursor", () => {
    expect(quoteObject(text, 0, '"', { inner: true })).toEqual({
      start: 5,
      end: 16,
    });
  });

  it("returns null when unpaired", () => {
    expect(quoteObject('one " two', 0, '"', { inner: true })).toBeNull();
  });
});

describe("bracketObject", () => {
  const text = "f(a, g(b), c)";

  it("takes the innermost enclosing pair", () => {
    expect(bracketObject(text, 7, "(", ")", { inner: true })).toEqual({
      start: 7,
      end: 8,
    });
    expect(bracketObject(text, 4, "(", ")", { inner: true })).toEqual({
      start: 2,
      end: 12,
    });
  });

  it("a( includes the brackets", () => {
    expect(bracketObject(text, 4, "(", ")", { inner: false })).toEqual({
      start: 1,
      end: 13,
    });
  });

  it("spans lines", () => {
    expect(bracketObject("{\na\n}", 2, "{", "}", { inner: true })).toEqual({
      start: 1,
      end: 4,
    });
  });

  it("returns null when there is no enclosing pair", () => {
    expect(bracketObject("plain", 2, "(", ")", { inner: true })).toBeNull();
  });
});

describe("paragraphObject", () => {
  const text = "one\ntwo\n\n\nthree";

  it("ip takes the run of non-blank lines", () => {
    expect(paragraphObject(text, 0, { inner: true })).toEqual({
      start: 0,
      end: 7,
    });
  });

  it("ap also takes the blank run that follows", () => {
    expect(paragraphObject(text, 0, { inner: false })).toEqual({
      start: 0,
      end: 9,
    });
  });

  it("works from inside a blank run", () => {
    expect(paragraphObject(text, 8, { inner: true })).toEqual({
      start: 8,
      end: 9,
    });
  });
});
