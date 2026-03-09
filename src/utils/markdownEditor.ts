import { marked } from "marked";
import TurndownService from "turndown";

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

const stripEmptyLineTokens = (markdown: string) =>
  markdown.replace(EMPTY_LINE_TOKEN_MARKDOWN_RE, "");

const expandExtraBlankLines = (markdown: string) =>
  markdown.replace(/\n{3,}/g, (match) => {
    const extraBlankLines = Math.max(0, match.length - 2);
    if (extraBlankLines === 0) {
      return match;
    }
    return `\n\n${`${EMPTY_LINE_TOKEN}\n\n`.repeat(extraBlankLines)}`;
  });

const restoreEmptyLineTokens = (html: string) =>
  html.replace(EMPTY_LINE_TOKEN_HTML_RE, "<p><br></p>");

export const markdownToHtml = (markdown: string) => {
  const parsed = marked.parse(expandExtraBlankLines(stripEmptyLineTokens(markdown || "")), {
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
