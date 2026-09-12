import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAG_COLOR, formatTagAttrs, mergeTagAttrs, parseFenceLine, parseLeadingTagRun,
  parseTagAttrs, stripTagSyntaxFromLine, tagKey, validTagColor, validTagDefinition, validTagName,
} from "./tags";

describe("parseTagAttrs", () => {
  it("reads tags, flags and both together", () => {
    expect(parseTagAttrs("#todo")).toEqual({ tags: ["todo"], flags: {} });
    expect(parseTagAttrs("#a #b")).toEqual({ tags: ["a", "b"], flags: {} });
    expect(parseTagAttrs("#urgent researched=true number=42"))
      .toEqual({ tags: ["urgent"], flags: { researched: "true", number: "42" } });
    expect(parseTagAttrs("addressant=johny")).toEqual({ tags: [], flags: { addressant: "johny" } });
  });

  it("admits the separators real tag names use", () => {
    for (const name of ["type/lines", "type.pm/namings", "bookmarks-shit", "skip-ai", "заметки/работа", "a1", "trailing_", "a./-"]) {
      expect(parseTagAttrs(`#${name}`)).toEqual({ tags: [name], flags: {} });
    }
  });

  it("folds turndown's underscore escaping, so one tag does not become two", () => {
    expect(parseTagAttrs(String.raw`#trading\_app`)).toEqual({ tags: ["trading_app"], flags: {} });
    expect(tagKey("trading_app")).toBe(tagKey(String.raw`trading\_app`.replace(/\\/g, "")));
  });

  it("deduplicates by identity but keeps the name as written", () => {
    expect(parseTagAttrs("#Work #work")).toEqual({ tags: ["Work"], flags: {} });
  });

  it("keeps the last value for a repeated key", () => {
    expect(parseTagAttrs("a=1 a=2")).toEqual({ tags: [], flags: { a: "2" } });
  });

  it("reads quoted values", () => {
    expect(parseTagAttrs('who="two words"')).toEqual({ tags: [], flags: { who: "two words" } });
    expect(parseTagAttrs('who="say \\"hi\\""')).toEqual({ tags: [], flags: { who: 'say "hi"' } });
  });

  it("fails whole, never in part", () => {
    for (const bad of ["", "   ", "#", "#-a", "#a#b", "plain", "#a !!", 'x="unfinished', "# a", "="]) {
      expect(parseTagAttrs(bad), bad).toBeNull();
    }
  });

  it("rejects a name past the length cap", () => {
    expect(parseTagAttrs(`#${"a".repeat(80)}`)).not.toBeNull();
    expect(parseTagAttrs(`#${"a".repeat(81)}`)).toBeNull();
  });

  it("round-trips through formatTagAttrs", () => {
    for (const source of ["#todo", "#a #b", "#urgent researched=true", 'who="two words"', "#a #b k=v"]) {
      const attrs = parseTagAttrs(source);
      expect(attrs, source).not.toBeNull();
      expect(formatTagAttrs(attrs!)).toBe(source);
      expect(parseTagAttrs(formatTagAttrs(attrs!))).toEqual(attrs);
    }
  });
});

describe("parseLeadingTagRun", () => {
  it("takes a run at the very start of a block", () => {
    expect(parseLeadingTagRun("#todo позвонить в банк"))
      .toEqual({ attrs: { tags: ["todo"], flags: {} }, rest: "позвонить в банк" });
    expect(parseLeadingTagRun("#a #b текст")?.attrs.tags).toEqual(["a", "b"]);
  });

  it("is prose anywhere else in the line, which keeps hex and issue refs literal", () => {
    expect(parseLeadingTagRun("позвонить в банк #todo")).toBeNull();
    expect(parseLeadingTagRun("цвет #fff в середине строки")).toBeNull();
    expect(parseLeadingTagRun("я поставил #skip-ai на тот абзац")).toBeNull();
  });

  it("requires content: a tag must tag something", () => {
    expect(parseLeadingTagRun("#todo")).toBeNull();
    expect(parseLeadingTagRun("#a #b")).toBeNull();
    expect(parseLeadingTagRun("#todo   ")).toBeNull();
  });

  it("does not collide with an ATX heading", () => {
    expect(parseLeadingTagRun("# обычный заголовок")).toBeNull();
    expect(parseLeadingTagRun("## Заголовок")).toBeNull();
  });
});

describe("parseFenceLine", () => {
  it("reads openers and closers", () => {
    expect(parseFenceLine("::: #urgent")).toEqual({ fence: ":::", attrs: { tags: ["urgent"], flags: {} } });
    expect(parseFenceLine(":::#urgent")?.attrs?.tags).toEqual(["urgent"]);
    expect(parseFenceLine("::::  #a #b")).toEqual({ fence: "::::", attrs: { tags: ["a", "b"], flags: {} } });
    expect(parseFenceLine(":::")).toEqual({ fence: ":::", attrs: null });
    expect(parseFenceLine("::: ")).toEqual({ fence: ":::", attrs: null });
  });

  it("is not a fence when the attributes do not parse", () => {
    expect(parseFenceLine("::: not attrs")).toBeNull();
    expect(parseFenceLine("::: #bad!!")).toBeNull();
    expect(parseFenceLine("::")).toBeNull();
    expect(parseFenceLine("текст")).toBeNull();
  });
});

describe("stripTagSyntaxFromLine", () => {
  it("drops fence lines and strips leading runs", () => {
    expect(stripTagSyntaxFromLine("::: #urgent")).toBeNull();
    expect(stripTagSyntaxFromLine(":::")).toBeNull();
    expect(stripTagSyntaxFromLine("#todo позвонить в банк")).toBe("позвонить в банк");
  });

  it("reduces spans to their text, escaped or not", () => {
    expect(stripTagSyntaxFromLine("фраза [вот эта]{#component} внутри")).toBe("фраза вот эта внутри");
    expect(stripTagSyntaxFromLine(String.raw`фраза \[вот эта\]{#component} внутри`)).toBe("фраза вот эта внутри");
  });

  it("leaves prose alone", () => {
    expect(stripTagSyntaxFromLine("цвет #fff в середине")).toBe("цвет #fff в середине");
    expect(stripTagSyntaxFromLine("[ссылка](https://x.com)")).toBe("[ссылка](https://x.com)");
    expect(stripTagSyntaxFromLine("[a]{b}")).toBe("[a]{b}");
    expect(stripTagSyntaxFromLine('[text]{who="a}b"}')).toBe("text");
    expect(stripTagSyntaxFromLine('[outer [inner]{#b}]{#a}')).toBe("outer inner");
    expect(stripTagSyntaxFromLine("::: not attrs")).toBe("::: not attrs");
  });
});

describe("validation and merging", () => {
  it("guards colours, because they reach an inline style", () => {
    expect(validTagColor(DEFAULT_TAG_COLOR)).toBe(true);
    expect(validTagColor("red; position: fixed")).toBe(false);
    expect(validTagColor("#fff")).toBe(false);
  });

  it("validates names and registry entries", () => {
    expect(validTagName("skip-ai")).toBe(true);
    expect(validTagName("-bad")).toBe(false);
    expect(validTagDefinition({ name: "todo", color: "#8b5cf6" })).toBe(true);
    expect(validTagDefinition({ name: "todo", color: "nope" })).toBe(false);
  });

  it("unions attrs without duplicating identities", () => {
    expect(mergeTagAttrs({ tags: ["a"], flags: { x: "1" } }, { tags: ["A", "b"], flags: { x: "2", y: "3" } }))
      .toEqual({ tags: ["a", "b"], flags: { x: "2", y: "3" } });
  });
});
