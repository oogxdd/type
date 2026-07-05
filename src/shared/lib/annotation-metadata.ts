import { stripLensBackmatterBlock } from "./lens-backmatter";

const INLINE_ANNOTATION_LINE_RE = /^type_annotations_b64:\s*[A-Za-z0-9+/=]{16,}\s*$/;

const removeInlineAnnotationLine = (markdown: string) =>
  markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !INLINE_ANNOTATION_LINE_RE.test(line.trim()))
    .join("\n");

/**
 * Removes metadata that belongs to optional annotation/lens features.
 * Core preview, slug, and editor display paths all call this before treating
 * markdown as user-authored note text.
 */
export const stripInlineAnnotationMetadata = (markdown: string) =>
  removeInlineAnnotationLine(stripLensBackmatterBlock(markdown));
