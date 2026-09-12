import { Marked, type Tokens } from "marked";
import TurndownService from "turndown";

import { parseTagAttrs, formatTagAttrs, parseLeadingTagRun, parseTagSpan } from "@typenotes/shared/tags";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stock = new Marked();
const marked = new Marked();
marked.use({ extensions: [
  {
    name: "tagContainer", level: "block",
    start: (src) => src.match(/^:{3,}[^\n]*\S/m)?.index,
    tokenizer(src) {
      const opening = /^(:{3,})[ \t]*([^:\n][^\n]*)(?:\n|$)/.exec(src);
      if (!opening) return;
      const attrs = parseTagAttrs(opening[2]);
      // Keep a detectable marker in HTML: MCP refuses invalid openers.
      if (!attrs) return { type: "tagContainer", raw: opening[0], invalid: true, tokens: [] };
      let end = opening[0].length;
      let closeEnd = src.length;
      let closed = false;
      const nestedFences: string[] = [];
      let codeFence: { char: string; length: number } | null = null;
      for (const line of src.slice(end).match(/[^\n]*(?:\n|$)/g) ?? []) {
        if (!line) continue;
        const code = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (code) {
          if (!codeFence) codeFence = { char: code[1][0], length: code[1].length };
          else if (code[1][0] === codeFence.char && code[1].length >= codeFence.length && line.slice(code[0].length).trim() === "") codeFence = null;
        }
        if (!codeFence) {
          const nested = /^(:{3,})[ \t]+(.+)$/.exec(line.trimEnd());
          if (nested && parseTagAttrs(nested[2])) nestedFences.push(nested[1]);
          else if (nestedFences.length && line.trimEnd() === nestedFences[nestedFences.length - 1]) nestedFences.pop();
          else if (!nestedFences.length && line.trimEnd() === opening[1]) { closeEnd = end + line.length; closed = true; break; }
        }
        end += line.length;
      }
      const body = src.slice(opening[0].length, end);
      return { type: "tagContainer", raw: src.slice(0, closeEnd), attrs, unterminated: !closed, tokens: this.lexer.blockTokens(body) };
    },
    renderer(token) {
      if (token.invalid) return `<p data-tag-invalid="true">${escapeHtml(token.raw.trimEnd())}</p>\n`;
      return `<div data-tag-attrs="${escapeHtml(formatTagAttrs(token.attrs))}"${token.unterminated ? ' data-tag-unterminated="true"' : ""}>${this.parser.parse(token.tokens ?? [])}</div>\n`;
    },
  },
  {
    name: "tagLine", level: "block",
    start: (src) => src.match(/^#[^\s#]/m)?.index,
    tokenizer(src) {
      const leading = parseLeadingTagRun(src.split("\n")[0]);
      if (!leading) return;
      // Let the stock paragraph tokenizer determine the complete block extent.
      const firstLineEnd = src.indexOf("\n");
      const nextTag = firstLineEnd < 0 ? -1 : src.slice(firstLineEnd).search(/\n(?=:{3,}|#[^\s#])/);
      const paragraphSource = nextTag < 0 ? src : src.slice(0, firstLineEnd + nextTag);
      const paragraph = stock.lexer(paragraphSource)[0] as Tokens.Paragraph | undefined;
      if (!paragraph || paragraph.type !== "paragraph") return;
      const text = leading.rest + paragraph.text.slice(src.split("\n")[0].length);
      return { type: "tagLine", raw: paragraph.raw, attrs: leading.attrs, tokens: this.lexer.inlineTokens(text) };
    },
    renderer(token) { return `<div data-tag-attrs="${escapeHtml(formatTagAttrs(token.attrs))}"><p>${this.parser.parseInline(token.tokens ?? [])}</p></div>\n`; },
  },
  {
    name: "tagSpan", level: "inline",
    start: (src) => src.indexOf("["),
    tokenizer(src) {
      const span = parseTagSpan(src);
      if (!span) return;
      return { type: "tagSpan", raw: span.raw, attrs: span.attrs, tokens: this.lexer.inlineTokens(span.text) };
    },
    renderer(token) { return `<span data-tag-attrs="${escapeHtml(formatTagAttrs(token.attrs))}">${this.parser.parseInline(token.tokens ?? [])}</span>`; },
  },
] });

const EMPTY_LINE_TOKEN = "NV_EMPTY_LINE_TOKEN_9f3a1";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EMPTY_LINE_TOKEN_HTML_RE = new RegExp(
  `<p>\\s*${escapeRegExp(EMPTY_LINE_TOKEN)}\\s*<\\/p>`,
  "g"
);
const EMPTY_LINE_TOKEN_MARKDOWN_RE = new RegExp(
  EMPTY_LINE_TOKEN.split("_").map(escapeRegExp).join(String.raw`\\?_`),
  "g"
);

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

turndown.addRule("tagContainer", {
  filter: (node) => node.nodeName === "DIV" && node.hasAttribute("data-tag-attrs"),
  replacement(content, node) {
    const element = node as HTMLElement;
    const attrs = parseTagAttrs(element.getAttribute("data-tag-attrs") ?? "");
    if (!attrs) return content;
    const body = content.replace(/^\n+|\n+$/g, "");
    const onlyParagraph = element.children.length === 1 && element.firstElementChild?.tagName === "P";
    if (onlyParagraph && !element.hasAttribute("data-tag-unterminated") && !Object.keys(attrs.flags).length && body.trim()) {
      return `\n\n${formatTagAttrs(attrs)} ${body}\n\n`;
    }
    const lengths = [...body.matchAll(/^(:{3,})/gm)].map((match) => match[1].length);
    const fence = ":".repeat(Math.max(2, ...lengths) + 1);
    return `\n\n${fence} ${formatTagAttrs(attrs)}\n${body}\n${fence}\n\n`;
  },
});
turndown.addRule("tagSpan", {
  filter: (node) => node.nodeName === "SPAN" && node.hasAttribute("data-tag-attrs"),
  replacement(content, node) {
    const attrs = parseTagAttrs((node as HTMLElement).getAttribute("data-tag-attrs") ?? "");
    return attrs ? `[${content}]{${formatTagAttrs(attrs)}}` : content;
  },
});

const stripEmptyLineTokens = (markdown: string) =>
  markdown.replace(EMPTY_LINE_TOKEN_MARKDOWN_RE, "");

const expandExtraBlankLines = (markdown: string) =>
  markdown.replace(/\n{3,}/g, (match) => {
    // Turndown separates every paragraph with two newlines. An empty editor
    // paragraph therefore adds another *pair* ("a\n\n\n\nb"), not one token
    // per newline. Counting individual newlines here made every empty
    // paragraph multiply whenever a note was reopened.
    const extraBlankLines = Math.floor(Math.max(0, match.length - 2) / 2);
    if (extraBlankLines === 0) {
      return match;
    }
    return `\n\n${`${EMPTY_LINE_TOKEN}\n\n`.repeat(extraBlankLines)}`;
  });

const restoreEmptyLineTokens = (html: string) =>
  html.replace(EMPTY_LINE_TOKEN_HTML_RE, "<p><br></p>");

export const markdownToHtml = (markdown: string) => {
  const parsed = marked.parse(expandExtraBlankLines(stripEmptyLineTokens((markdown || "").replace(/\r\n?/g, "\n"))), {
    breaks: true,
    gfm: true,
  });
  return typeof parsed === "string" ? restoreEmptyLineTokens(parsed) : "";
};

export const htmlToMarkdown = (html: string) => {
  const normalized = html.replace(
    /<p>\s*(?:<br\s*\/?>|&nbsp;)?\s*<\/p>/gi,
    `<p>${EMPTY_LINE_TOKEN}</p>`
  );
  return stripEmptyLineTokens(turndown.turndown(normalized));
};
