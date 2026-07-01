const BACKMATTER_TYPE = "type:lens:v1";
const BACKMATTER_BLOCK_RE =
  /(?:\n{1,2})?(<!--\s*type:lens:v1\s*\n([\s\S]*?)\n-->)\s*$/;

const normalizeNewlines = (value: string) => value.replace(/\r\n/g, "\n");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type LensBackmatterSource = "backmatter" | "none";

export type LensBackmatterExtractResult = {
  content: string;
  lens: Record<string, unknown> | null;
  source: LensBackmatterSource;
  rawBlock: string | null;
};

type SplitLensBackmatterResult = {
  content: string;
  rawBlock: string | null;
  rawPayload: string | null;
};

export const splitLensBackmatterBlock = (
  markdown: string
): SplitLensBackmatterResult => {
  const normalized = normalizeNewlines(markdown);
  const match = normalized.match(BACKMATTER_BLOCK_RE);
  if (!match || match.index === undefined) {
    return {
      content: normalized,
      rawBlock: null,
      rawPayload: null,
    };
  }

  const prefix = normalized.slice(0, match.index).replace(/\s+$/g, "");
  return {
    content: prefix,
    rawBlock: match[1] || null,
    rawPayload: match[2] || null,
  };
};

export const stripLensBackmatterBlock = (markdown: string) =>
  splitLensBackmatterBlock(markdown).content;

export const buildLensBackmatterBlock = (payload: Record<string, unknown>) =>
  `<!-- ${BACKMATTER_TYPE}\n${JSON.stringify(payload)}\n-->`;

export const appendLensBackmatterBlock = (
  markdown: string,
  payload: Record<string, unknown>
) => {
  const content = stripLensBackmatterBlock(markdown).replace(/\s+$/g, "");
  const block = buildLensBackmatterBlock(payload);
  if (!content) {
    return `${block}\n`;
  }
  return `${content}\n\n${block}\n`;
};

export const appendRawLensBackmatterBlock = (markdown: string, rawBlock: string | null) => {
  const content = stripLensBackmatterBlock(markdown).replace(/\s+$/g, "");
  if (!rawBlock) {
    return content;
  }
  const normalizedBlock = normalizeNewlines(rawBlock).replace(/\s+$/g, "");
  if (!content) {
    return `${normalizedBlock}\n`;
  }
  return `${content}\n\n${normalizedBlock}\n`;
};

export const extractLensBackmatter = (
  markdown: string
): LensBackmatterExtractResult => {
  const split = splitLensBackmatterBlock(markdown);
  if (!split.rawPayload) {
    return {
      content: split.content,
      lens: null,
      source: "none",
      rawBlock: null,
    };
  }

  try {
    const parsed = JSON.parse(split.rawPayload) as unknown;
    if (!isRecord(parsed)) {
      return {
        content: split.content,
        lens: null,
        source: "none",
        rawBlock: split.rawBlock,
      };
    }
    return {
      content: split.content,
      lens: parsed,
      source: "backmatter",
      rawBlock: split.rawBlock,
    };
  } catch {
    return {
      content: split.content,
      lens: null,
      source: "none",
      rawBlock: split.rawBlock,
    };
  }
};
