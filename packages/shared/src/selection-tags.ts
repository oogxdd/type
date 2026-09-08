import { readFrontmatterScalar, removeFrontmatterScalar, upsertFrontmatterScalar } from "./frontmatter";

export type SelectionTag = { name: string; color: string };
export type BlockAnchor = { index: number; hash: string; before: string; after: string; document?: string };
export type TaggedBlock = BlockAnchor & { tags: SelectionTag[] };
export const SELECTION_TAGS_KEY = "type_selection_tags";
export const DEFAULT_TAG_COLOR = "#8b5cf6";
export const tagKey = (name: string) => name.trim().normalize("NFC").toLocaleLowerCase();
export const validTag = (value: unknown): value is SelectionTag => {
  if (!value || typeof value !== "object") return false;
  const tag = value as SelectionTag;
  return typeof tag.name === "string" && tag.name.trim().length > 0 && tag.name.length <= 80
    && typeof tag.color === "string" && /^#[\da-f]{6}$/i.test(tag.color);
};

// Two independent 32-bit fingerprints. We store no copy of the selected text
// in the plaintext header. These are matching hints, not cryptographic hashes.
export function blockFingerprint(text: string): string {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

export function blockAnchors(texts: string[]): BlockAnchor[] {
  const hashes = texts.map(blockFingerprint);
  const document = blockFingerprint(hashes.join("/"));
  return hashes.map((hash, index) => ({ index, hash, before: hashes[index - 1] ?? "", after: hashes[index + 1] ?? "", document }));
}

export function resolveBlockAnchor(anchor: BlockAnchor, blocks: BlockAnchor[]): number | null {
  if (anchor.document && anchor.document === blocks[0]?.document && blocks[anchor.index]?.hash === anchor.hash) return anchor.index;
  const candidates = blocks.filter((block) => block.hash === anchor.hash);
  if (candidates.length === 1) return candidates[0].index;
  if (!candidates.length) return null;
  const scored = candidates.map((block) => ({
    index: block.index,
    score: Number(block.before === anchor.before) + Number(block.after === anchor.after),
  })).sort((a, b) => b.score - a.score);
  // Never silently attach to another identical paragraph when context is ambiguous.
  return scored[0].score > (scored[1]?.score ?? -1) ? scored[0].index : null;
}

export function readSelectionTags(markdown: string): TaggedBlock[] {
  const raw = readFrontmatterScalar(markdown, SELECTION_TAGS_KEY);
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw);
    if (payload.version !== 1 || !Array.isArray(payload.blocks)) return [];
    return payload.blocks.filter((entry: TaggedBlock) => entry && Number.isInteger(entry.index)
      && entry.index >= 0 && typeof entry.hash === "string" && typeof entry.before === "string"
      && typeof entry.after === "string" && Array.isArray(entry.tags) && entry.tags.every(validTag));
  } catch { return []; }
}

export function writeSelectionTags(markdown: string, blocks: TaggedBlock[]): string {
  if (!blocks.length) return removeFrontmatterScalar(markdown, SELECTION_TAGS_KEY);
  return upsertFrontmatterScalar(markdown, SELECTION_TAGS_KEY, JSON.stringify({ version: 1, blocks }));
}

export function mergeTag(tags: SelectionTag[], tag: SelectionTag): SelectionTag[] {
  return [...tags.filter((entry) => tagKey(entry.name) !== tagKey(tag.name)), tag];
}
