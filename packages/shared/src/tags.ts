/**
 * The one grammar behind every tag position in a note body.
 *
 * A tag lives in the Markdown text, never in a side table keyed by position, so
 * it cannot drift from the text it marks. The same `attrs` production appears in
 * exactly three places:
 *
 *     ::: #urgent researched=true      after a container's opening fence
 *     [вот эта]{#component number=42}  inside {…} after a span's ]
 *     #todo позвонить в банк           the leading run of a block
 *
 * Colour is deliberately absent: the body carries names and flags only, and the
 * per-folder registry maps a name to its colour. Recolouring is therefore global
 * and free, and a name the registry has never heard of still renders.
 */

export type TagAttrs = {
  /** Names as written, deduplicated by `tagKey`, in source order. */
  tags: string[];
  /** `key=value` flags; a repeated key keeps the last value. */
  flags: Record<string, string>;
};

/** A registry entry. The registry is advisory — it supplies colour, not truth. */
export type TagDefinition = {
  name: string;
  color: string;
  description?: string;
};

export const MAX_TAG_NAME_LENGTH = 80;
export const DEFAULT_TAG_COLOR = "#8b5cf6";

/**
 * Identity: trim, NFC, lowercase. `#Work` and `#work` are one tag, which is what
 * the MCP's `skip-ai` comparison has always relied on.
 */
export const tagKey = (name: string) => name.trim().normalize("NFC").toLocaleLowerCase();

// Escaped underscores from older Turndown output are accepted as underscores.
const NAME = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}_./-]|\\_)*`;
const KEY = String.raw`[A-Za-z_][A-Za-z0-9_-]*`;
const VALUE = String.raw`"(?:[^"\\]|\\.)*"|[^"\s}][^\s}]*`;

const ATTR_TOKEN_RE = new RegExp(`^(?:#(${NAME})|(${KEY})=(${VALUE}))`, "u");
const WHOLE_NAME_RE = new RegExp(`^${NAME}$`, "u");
const LEADING_TAG_RE = new RegExp(`^#(${NAME})[ \\t]+`, "u");

/** A fence line: `:::` alone, or `:::` followed by a parsable attribute run. */
const FENCE_RE = /^(:{3,})[ \t]*(.*)$/;

const unescapeName = (raw: string) => raw.replace(/\\([_./-])/g, "$1").normalize("NFC");

/** Six-digit hex only. The colour reaches an inline `style`, so this is a guard. */
export const validTagColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);

export const validTagName = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const name = unescapeName(value);
  return name.length > 0 && [...name].length <= MAX_TAG_NAME_LENGTH && WHOLE_NAME_RE.test(name);
};

export const validTagDefinition = (value: unknown): value is TagDefinition => {
  if (!value || typeof value !== "object") return false;
  const tag = value as TagDefinition;
  return validTagName(tag.name) && validTagColor(tag.color)
    && (tag.description === undefined || typeof tag.description === "string");
};

export const emptyTagAttrs = (): TagAttrs => ({ tags: [], flags: {} });

export const hasTagAttrs = (attrs: TagAttrs) =>
  attrs.tags.length > 0 || Object.keys(attrs.flags).length > 0;

const unquoteValue = (raw: string) =>
  raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
    ? raw.slice(1, -1).replace(/\\(.)/g, "$1")
    : raw;

/**
 * Parse a complete attribute run. Returns null when *any* part of it fails, so a
 * caller can fall back to treating the text as prose — or, where privacy is at
 * stake, refuse the note. Never partially succeeds.
 */
export function parseTagAttrs(source: string): TagAttrs | null {
  let rest = source.trim();
  if (!rest) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  const flags: Record<string, string> = Object.create(null);
  while (rest.length > 0) {
    const match = rest.match(ATTR_TOKEN_RE);
    if (!match) return null;
    if (match[1] !== undefined) {
      const name = unescapeName(match[1]);
      if ([...name].length > MAX_TAG_NAME_LENGTH) return null;
      const key = tagKey(name);
      if (!seen.has(key)) {
        seen.add(key);
        tags.push(name);
      }
    } else {
      flags[match[2]] = unquoteValue(match[3]);
    }
    const next = rest.slice(match[0].length);
    // Tokens are whitespace separated; `#a#b` is not two tags.
    if (next.length > 0 && !/^\s/.test(next)) return null;
    rest = next.replace(/^\s+/, "");
  }
  return hasTagAttrs({ tags, flags }) ? { tags, flags } : null;
}

const formatFlagValue = (value: string) =>
  value.length === 0 || /[\s}"]/.test(value)
    ? `"${value.replace(/(["\\])/g, "\\$1")}"`
    : value;

export function formatTagAttrs(attrs: TagAttrs): string {
  const parts = attrs.tags.map((name) => `#${name}`);
  for (const key of Object.keys(attrs.flags)) parts.push(`${key}=${formatFlagValue(attrs.flags[key])}`);
  return parts.join(" ");
}

/** Union used when containers nest or merge. Later tags and flags win ties. */
export function mergeTagAttrs(base: TagAttrs, extra: TagAttrs): TagAttrs {
  const tags = [...base.tags];
  const seen = new Set(tags.map(tagKey));
  for (const name of extra.tags) {
    if (seen.has(tagKey(name))) continue;
    seen.add(tagKey(name));
    tags.push(name);
  }
  return { tags, flags: { ...base.flags, ...extra.flags } };
}

/**
 * The sugar form: one or more `#tag` tokens at the very start of a block,
 * followed by content. A tag must tag *something*, so a block that is only
 * hashtags stays prose — and a hashtag anywhere else in the line is prose too,
 * which keeps "I put #skip-ai on that" literal. Leading #fff and #123 are tags.
 */
export function parseLeadingTagRun(text: string): { attrs: TagAttrs; rest: string } | null {
  const names: string[] = [];
  let rest = text;
  for (;;) {
    const match = rest.match(LEADING_TAG_RE);
    if (!match) break;
    names.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  if (names.length === 0 || rest.trim().length === 0) return null;
  // `#a #b` alone is a run with no content, not tag `a` on content `#b`: the
  // last token lacks the trailing space that makes it part of the run.
  if (rest.charCodeAt(0) === 35 && parseTagAttrs(rest) !== null) return null;
  const attrs = parseTagAttrs(names.map((name) => `#${name}`).join(" "));
  return attrs ? { attrs, rest } : null;
}

/** `:::`-fence classification, shared by the tokenizer and the preview stripper. */
export function parseFenceLine(line: string): { fence: string; attrs: TagAttrs | null } | null {
  const match = line.match(FENCE_RE);
  if (!match) return null;
  const trailing = match[2].trim();
  if (!trailing) return { fence: match[1], attrs: null };
  const attrs = parseTagAttrs(trailing);
  return attrs ? { fence: match[1], attrs } : null;
}

/** Read a span at the start of a string, balancing brackets and quoted flags. */
export function parseTagSpan(source: string): { raw: string; text: string; attrs: TagAttrs } | null {
  if (source[0] !== "[") return null;
  let depth = 1, end = 1;
  for (; end < source.length && depth; end++) {
    if (source[end] === "\\") { end++; continue; }
    if (source[end] === "[") depth++;
    if (source[end] === "]") depth--;
  }
  if (depth || source[end] !== "{") return null;
  let quoted = false, close = end + 1;
  for (; close < source.length; close++) {
    if (source[close] === "\\") { close++; continue; }
    if (source[close] === '"') quoted = !quoted;
    if (source[close] === "}" && !quoted) break;
  }
  if (close === source.length) return null;
  const attrs = parseTagAttrs(source.slice(end + 1, close));
  return attrs ? { raw: source.slice(0, close + 1), text: source.slice(1, end - 1), attrs } : null;
}

function stripTagSpans(source: string): string {
  let result = "";
  for (let i = 0; i < source.length;) {
    const span = source[i] === "[" ? parseTagSpan(source.slice(i)) : null;
    if (span) { result += stripTagSpans(span.text); i += span.raw.length; }
    else { result += source[i]; i++; }
  }
  return result;
}

/**
 * Reduce one line of Markdown to what a human reads, for previews and slugs.
 * Returns null for a fence line, which the caller drops entirely. Previews are
 * not a privacy surface: an unparsable `::: !!` is shown as the prose it is.
 */
export function stripTagSyntaxFromLine(line: string): string | null {
  if (parseFenceLine(line)) return null;
  const spanless = stripTagSpans(line.replace(/\\([\[\]])/g, "$1"));
  const leading = parseLeadingTagRun(spanless);
  return leading ? leading.rest : spanless;
}
