import type { NoteFileNameFormat } from "@/shared/types";
import { stripInlineAnnotationMetadata } from "@/shared/lib/annotation-metadata";
import { stripFrontmatter } from "@/shared/lib/frontmatter";

const UUID_V7_FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/i;
const UUID_V7_PREFIX_FILE_NAME_RE = /^([0-9a-f]{8}-[0-9a-f]{4})(?:-(.+))?\.md$/i;
const UTC_TIMESTAMP_FILE_NAME_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)(?:-(.+))?\.md$/i;
const MIN_SLUG_CONTENT_CHARS = 8;
const MAX_SLUG_WORDS = 8;
const MAX_SLUG_LENGTH = 56;
const NOISE_HASH_RE = /^[a-z0-9]{1,32}$/;
const PLACEHOLDER_SUFFIX_RE =
  /^(?:note|untitled|note-[0-9a-f-]{8,}|recording|recording-[0-9a-f-]{8,}|handwriting|handwriting-[0-9a-f-]{8,})$/i;

const slugContentCharCount = (value: string) => value.replace(/-/g, "").length;

const hasEnoughSlugContent = (value: string) =>
  slugContentCharCount(value) >= MIN_SLUG_CONTENT_CHARS;

const isProvisionalSuffix = (suffix: string) =>
  !suffix || PLACEHOLDER_SUFFIX_RE.test(suffix) || !hasEnoughSlugContent(suffix);

const stripNoiseTokenSequences = (tokens: string[]) => {
  const cleaned: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (
      i + 3 < tokens.length &&
      tokens[i] === "nv" &&
      tokens[i + 1] === "empty" &&
      tokens[i + 2] === "line" &&
      tokens[i + 3] === "token"
    ) {
      i += 3;
      if (i + 1 < tokens.length && NOISE_HASH_RE.test(tokens[i + 1])) {
        i += 1;
      }
      continue;
    }
    cleaned.push(tokens[i]);
  }
  return cleaned;
};

export const buildSlugFromContent = (markdown: string) => {
  const normalized = stripInlineAnnotationMetadata(stripFrontmatter(markdown))
    .replace(/NV_EMPTY_LINE_TOKEN_[A-Za-z0-9]+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-*+]\s+/gm, "")
    .replace(/https?:\/\/\S+/gi, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  const tokens = normalized
    .split(" ")
    .filter((word) => word && !word.startsWith("http") && !word.startsWith("www"));
  const words = stripNoiseTokenSequences(tokens).slice(0, MAX_SLUG_WORDS);
  const slug = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-$/g, "");
};

/**
 * Returns a new file name only while the current name still looks provisional.
 * This keeps explicit user/remote names stable while letting new notes grow
 * from placeholders into useful, content-derived filenames.
 */
export const getAutoRenameTarget = (
  notePath: string,
  content: string,
  noteFileNameFormat: NoteFileNameFormat
) => {
  const segments = notePath.split("/");
  const fileName = segments[segments.length - 1] || "";
  const slug = buildSlugFromContent(content);
  if (!hasEnoughSlugContent(slug)) {
    return null;
  }

  if (noteFileNameFormat === "uuid_v7") {
    return null;
  }

  if (noteFileNameFormat === "utc_timestamp_slug") {
    const timestampMatch = fileName.match(UTC_TIMESTAMP_FILE_NAME_RE);
    if (!timestampMatch) {
      return null;
    }
    const prefix = timestampMatch[1];
    const suffix = (timestampMatch[2] || "").toLowerCase();
    if (!isProvisionalSuffix(suffix)) {
      return null;
    }
    const nextName = `${prefix}-${slug}.md`;
    return nextName.toLowerCase() === fileName.toLowerCase() ? null : nextName;
  }

  const prefixMatch = fileName.match(UUID_V7_PREFIX_FILE_NAME_RE);
  if (prefixMatch) {
    const prefix = (prefixMatch[1] || "").toLowerCase();
    const suffix = (prefixMatch[2] || "").toLowerCase();
    if (!isProvisionalSuffix(suffix)) {
      return null;
    }
    const nextName = `${prefix}-${slug}.md`;
    return nextName.toLowerCase() === fileName.toLowerCase() ? null : nextName;
  }

  if (!UUID_V7_FILE_NAME_RE.test(fileName)) {
    return null;
  }
  const rootId = fileName.replace(/\.md$/i, "");
  const prefix = rootId.slice(0, 13);
  const nextName = `${prefix}-${slug}.md`;
  return nextName.toLowerCase() === fileName.toLowerCase() ? null : nextName;
};
