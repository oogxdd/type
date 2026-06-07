import type { PointerEvent as ReactPointerEvent } from "react";
import type { NoteAnnotationPoint } from "./note-annotations";

// Pure geometry / hashing helpers for the multi-note lens. Coordinates are
// normalized to 0..1 within each note's stage so annotations survive resizes.

export const DRAW_TOOL = "draw" as const;
export const TEXT_TOOL = "text" as const;
export type LensTool = typeof DRAW_TOOL | typeof TEXT_TOOL;

// Block-level elements we anchor annotations to (so a mark stays near "its"
// paragraph when surrounding content reflows).
export const TEXT_BLOCK_SELECTOR =
  ".tiptap-content p, .tiptap-content li, .tiptap-content blockquote, .tiptap-content h1, .tiptap-content h2, .tiptap-content h3";

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const pointsToSvgPath = (points: NoteAnnotationPoint[]) =>
  points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x * 100} ${point.y * 100}`)
    .join(" ");

export const getOverlayPoint = (
  event: ReactPointerEvent<HTMLDivElement>
): NoteAnnotationPoint | null => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  return {
    x: clamp01((event.clientX - rect.left) / rect.width),
    y: clamp01((event.clientY - rect.top) / rect.height),
  };
};

export const isWithinInlineTextEditor = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(".multi-lens-inline-text-editor"));

export const normalizeAnchorText = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

export const shortAnchorSnippet = (value: string) => normalizeAnchorText(value).slice(0, 80);

// FNV-1a hash of the normalized block text — a cheap, stable anchor key.
export const hashAnchorText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

let markCounter = 0;
export const buildId = () => {
  markCounter = (markCounter + 1) % 1_679_616;
  return `${Date.now().toString(36)}-${markCounter.toString(36)}`;
};
