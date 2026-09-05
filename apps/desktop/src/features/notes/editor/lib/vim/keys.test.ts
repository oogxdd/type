import { describe, expect, it } from "vitest";
import {
  emptyPending,
  isInclusiveMotion,
  isLinewiseMotion,
  parseVimKey,
  type VimCommand,
  type VimMode,
  type VimParseResult,
} from "./keys";

type FeedKey = string | { key: string; ctrl: boolean };

/** Types a key sequence and returns the last parse result. */
const feed = (keys: FeedKey[], mode: VimMode = "normal"): VimParseResult => {
  let pending = emptyPending();
  let last: VimParseResult = { kind: "pending", pending };
  for (const entry of keys) {
    const key = typeof entry === "string" ? entry : entry.key;
    last = parseVimKey(
      pending,
      {
        key,
        char: key.length === 1 ? key : null,
        ctrl: typeof entry === "string" ? false : entry.ctrl,
      },
      mode
    );
    pending = last.pending;
  }
  return last;
};

const commandOf = (keys: FeedKey[], mode: VimMode = "normal"): VimCommand => {
  const result = feed(keys, mode);
  if (result.kind !== "command") {
    throw new Error(`expected a command, got ${result.kind}`);
  }
  return result.command;
};

describe("counts", () => {
  it("treats a leading 0 as the line-start motion", () => {
    expect(commandOf(["0"])).toEqual({
      type: "motion",
      motion: { type: "lineStart" },
      count: 1,
      operator: null,
      register: null,
    });
  });

  it("treats a following 0 as a digit", () => {
    expect(commandOf(["1", "0", "j"])).toMatchObject({
      type: "motion",
      motion: { type: "down" },
      count: 10,
    });
  });

  it("multiplies the counts on both sides of an operator", () => {
    expect(commandOf(["2", "d", "3", "w"])).toMatchObject({
      type: "motion",
      motion: { type: "wordForward", big: false },
      count: 6,
      operator: "d",
    });
  });

  it("stays pending while only digits have been typed", () => {
    expect(feed(["3"]).kind).toBe("pending");
  });
});

describe("operators", () => {
  it("dd is a linewise operator", () => {
    expect(commandOf(["d", "d"])).toEqual({
      type: "lineOperator",
      operator: "d",
      count: 1,
      register: null,
    });
  });

  it("3dd carries its count", () => {
    expect(commandOf(["3", "d", "d"])).toMatchObject({
      type: "lineOperator",
      operator: "d",
      count: 3,
    });
  });

  it("yy and >> double the same way", () => {
    expect(commandOf(["y", "y"])).toMatchObject({ operator: "y" });
    expect(commandOf([">", ">"])).toMatchObject({ operator: ">" });
  });

  it("guu lowercases a line", () => {
    expect(commandOf(["g", "u", "u"])).toMatchObject({
      type: "lineOperator",
      operator: "gu",
    });
  });

  it("rejects an operator followed by a non-motion", () => {
    expect(feed(["d", "q"]).kind).toBe("unhandled");
  });

  it("pairs an operator with a motion", () => {
    expect(commandOf(["d", "$"])).toMatchObject({
      operator: "d",
      motion: { type: "lineEnd" },
    });
  });
});

describe("text objects", () => {
  it("diw deletes the inner word", () => {
    expect(commandOf(["d", "i", "w"])).toEqual({
      type: "textObject",
      object: { kind: "word", inner: true, big: false },
      count: 1,
      operator: "d",
      register: null,
    });
  });

  it("ca( changes around the parentheses", () => {
    expect(commandOf(["c", "a", "("])).toMatchObject({
      object: { kind: "bracket", inner: false, open: "(", close: ")" },
      operator: "c",
    });
  });

  it("yi\" yanks inside the quotes", () => {
    expect(commandOf(["y", "i", '"'])).toMatchObject({
      object: { kind: "quote", inner: true, quote: '"' },
      operator: "y",
    });
  });

  it("dap deletes a paragraph", () => {
    expect(commandOf(["d", "a", "p"])).toMatchObject({
      object: { kind: "paragraph", inner: false },
    });
  });

  it("rejects an unknown object", () => {
    expect(feed(["d", "i", "q"]).kind).toBe("unhandled");
  });
});

describe("motions", () => {
  it("gg goes to the first line, 5gg to the fifth", () => {
    expect(commandOf(["g", "g"])).toMatchObject({
      motion: { type: "gotoLine", line: 1 },
    });
    expect(commandOf(["5", "g", "g"])).toMatchObject({
      motion: { type: "gotoLine", line: 5 },
    });
  });

  it("G goes to the last line, 5G to the fifth", () => {
    expect(commandOf(["G"])).toMatchObject({
      motion: { type: "gotoLine", line: "last" },
    });
    expect(commandOf(["5", "G"])).toMatchObject({
      motion: { type: "gotoLine", line: 5 },
    });
  });

  it("waits for the character after f, t, F and T", () => {
    expect(feed(["f"]).kind).toBe("pending");
    expect(commandOf(["f", "x"])).toMatchObject({
      motion: { type: "findChar", char: "x", forward: true, till: false },
    });
    expect(commandOf(["T", "x"])).toMatchObject({
      motion: { type: "findChar", char: "x", forward: false, till: true },
    });
  });

  it("maps ctrl-d and ctrl-u to half pages", () => {
    expect(commandOf([{ key: "d", ctrl: true }])).toMatchObject({
      motion: { type: "halfPageDown" },
    });
    expect(commandOf([{ key: "u", ctrl: true }])).toMatchObject({
      motion: { type: "halfPageUp" },
    });
  });

  it("classifies linewise and inclusive motions", () => {
    expect(isLinewiseMotion({ type: "down" })).toBe(true);
    expect(isLinewiseMotion({ type: "wordForward", big: false })).toBe(false);
    expect(isInclusiveMotion({ type: "wordEnd", big: false })).toBe(true);
    expect(isInclusiveMotion({ type: "wordForward", big: false })).toBe(false);
    expect(
      isInclusiveMotion({ type: "findChar", char: "x", forward: true, till: false })
    ).toBe(true);
  });
});

describe("registers", () => {
  it('"ayy yanks into register a', () => {
    expect(commandOf(['"', "a", "y", "y"])).toMatchObject({
      type: "lineOperator",
      operator: "y",
      register: "a",
    });
  });

  it('"ap pastes from register a', () => {
    expect(commandOf(['"', "a", "p"])).toMatchObject({
      type: "action",
      action: "paste",
      register: "a",
    });
  });
});

describe("actions", () => {
  it("maps the insert-entering keys", () => {
    expect(commandOf(["i"])).toMatchObject({ action: "insertBefore" });
    expect(commandOf(["a"])).toMatchObject({ action: "insertAfter" });
    expect(commandOf(["I"])).toMatchObject({ action: "insertLineStart" });
    expect(commandOf(["A"])).toMatchObject({ action: "insertLineEnd" });
    expect(commandOf(["o"])).toMatchObject({ action: "openBelow" });
    expect(commandOf(["O"])).toMatchObject({ action: "openAbove" });
  });

  it("maps the single-key edits", () => {
    expect(commandOf(["x"])).toMatchObject({ action: "deleteChar" });
    expect(commandOf(["3", "x"])).toMatchObject({
      action: "deleteChar",
      count: 3,
    });
    expect(commandOf(["D"])).toMatchObject({ action: "deleteToLineEnd" });
    expect(commandOf(["J"])).toMatchObject({ action: "joinLines" });
    expect(commandOf(["."])).toMatchObject({ action: "repeatChange" });
  });

  it("r waits for its replacement character", () => {
    expect(feed(["r"]).kind).toBe("pending");
    expect(commandOf(["r", "z"])).toEqual({
      type: "replaceChar",
      char: "z",
      count: 1,
    });
  });

  it("zz, zt and zb scroll", () => {
    expect(commandOf(["z", "z"])).toMatchObject({ action: "scrollCenter" });
    expect(commandOf(["z", "t"])).toMatchObject({ action: "scrollTop" });
    expect(commandOf(["z", "b"])).toMatchObject({ action: "scrollBottom" });
  });

  it("ctrl-r redoes", () => {
    expect(commandOf([{ key: "r", ctrl: true }])).toMatchObject({
      action: "redo",
    });
  });

  it("gv reselects", () => {
    expect(commandOf(["g", "v"])).toMatchObject({ action: "visualReselect" });
  });
});

describe("visual mode", () => {
  it("d, y and c act on the selection immediately", () => {
    expect(commandOf(["d"], "visual")).toEqual({
      type: "visualOperator",
      operator: "d",
      register: null,
    });
    expect(commandOf(["y"], "visual-line")).toMatchObject({ operator: "y" });
    expect(commandOf(["c"], "visual")).toMatchObject({ operator: "c" });
  });

  it("i and a open a text object instead of entering Insert", () => {
    expect(commandOf(["i", "w"], "visual")).toMatchObject({
      type: "textObject",
      object: { kind: "word", inner: true },
      operator: null,
    });
  });

  it("motions still move the head", () => {
    expect(commandOf(["e"], "visual")).toMatchObject({
      type: "motion",
      motion: { type: "wordEnd", big: false },
      operator: null,
    });
  });

  it("u, U and ~ change case", () => {
    expect(commandOf(["u"], "visual")).toMatchObject({ operator: "gu" });
    expect(commandOf(["U"], "visual")).toMatchObject({ operator: "gU" });
    expect(commandOf(["~"], "visual")).toMatchObject({ operator: "g~" });
  });

  it("o swaps the ends and p replaces the selection", () => {
    expect(commandOf(["o"], "visual")).toMatchObject({
      action: "visualSwapEnds",
    });
    expect(commandOf(["p"], "visual")).toMatchObject({ operator: "p" });
  });

  it("V from charwise Visual switches to linewise", () => {
    expect(commandOf(["V"], "visual")).toMatchObject({ action: "visualLine" });
  });
});

describe("unknown keys", () => {
  it("are reported as unhandled and reset the pending command", () => {
    const result = feed(["3", "d", "q"]);
    expect(result.kind).toBe("unhandled");
    expect(result.pending).toEqual(emptyPending());
  });
});
