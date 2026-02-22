const FRONTMATTER_BLOCK_RE = /^---\r?\n[\s\S]*?\r?\n---/;

type FrontmatterSplit = {
  frontmatterBlock: string | null;
  body: string;
};

const normalizeNewlines = (value: string) => value.replace(/\r\n/g, "\n");

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitFrontmatterBlock = (block: string) => {
  const normalized = normalizeNewlines(block);
  const withoutStart = normalized.replace(/^---\n/, "");
  return withoutStart.replace(/\n---$/, "");
};

const buildFrontmatterBlock = (body: string) => `---\n${body}\n---`;

export const splitFrontmatter = (markdown: string): FrontmatterSplit => {
  const normalized = normalizeNewlines(markdown);
  if (!normalized.startsWith("---\n")) {
    return { frontmatterBlock: null, body: normalized };
  }

  const match = normalized.match(FRONTMATTER_BLOCK_RE);
  if (!match) {
    return { frontmatterBlock: null, body: normalized };
  }

  const frontmatterBlock = match[0];
  const frontmatterBody = splitFrontmatterBlock(frontmatterBlock);
  if (
    frontmatterBody.trim() &&
    !/(^|\n)\s*[A-Za-z0-9_-]+\s*:\s*/.test(frontmatterBody)
  ) {
    return { frontmatterBlock: null, body: normalized };
  }
  let body = normalized.slice(frontmatterBlock.length);
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }
  return { frontmatterBlock, body };
};

export const joinFrontmatter = (frontmatterBlock: string | null, body: string) => {
  const normalizedBody = normalizeNewlines(body);
  if (!frontmatterBlock) {
    return normalizedBody;
  }
  const normalizedBlock = normalizeNewlines(frontmatterBlock).replace(/\n+$/g, "");
  if (!normalizedBody) {
    return `${normalizedBlock}\n`;
  }
  return `${normalizedBlock}\n${normalizedBody}`;
};

export const stripFrontmatter = (markdown: string) => splitFrontmatter(markdown).body;

export const readFrontmatterScalar = (markdown: string, key: string): string | null => {
  const { frontmatterBlock } = splitFrontmatter(markdown);
  if (!frontmatterBlock) {
    return null;
  }
  const frontmatterBody = splitFrontmatterBlock(frontmatterBlock);
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.+?)\\s*$`, "m");
  const match = frontmatterBody.match(keyRe);
  if (!match || !match[1]) {
    return null;
  }
  const rawValue = match[1].trim();
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
};

export const upsertFrontmatterScalar = (
  markdown: string,
  key: string,
  value: string
) => {
  const { frontmatterBlock, body } = splitFrontmatter(markdown);
  const line = `${key}: ${value}`;

  if (!frontmatterBlock) {
    return joinFrontmatter(buildFrontmatterBlock(line), body);
  }

  const frontmatterBody = splitFrontmatterBlock(frontmatterBlock);
  const lines = frontmatterBody ? frontmatterBody.split("\n") : [];
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);
  const existingIndex = lines.findIndex((entry) => keyRe.test(entry));
  if (existingIndex >= 0) {
    lines[existingIndex] = line;
  } else {
    lines.push(line);
  }
  const nextFrontmatterBlock = buildFrontmatterBlock(lines.join("\n"));
  return joinFrontmatter(nextFrontmatterBlock, body);
};
