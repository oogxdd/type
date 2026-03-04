import { fromBase64 } from "./notes";
import {
  joinFrontmatter,
  readFrontmatterScalar,
  removeFrontmatterScalar,
  splitFrontmatter,
} from "./frontmatter";
import {
  appendLensBackmatterBlock,
  extractLensBackmatter,
  stripLensBackmatterBlock,
} from "./lensBackmatter";

const NOTE_ANNOTATIONS_KEY = "type_annotations_b64";
const COORD_SCALE = 4095;
const INLINE_ANNOTATION_LINE_RE = /^type_annotations_b64:\s*[A-Za-z0-9+/=]{16,}\s*$/;
const INLINE_ANNOTATION_CAPTURE_RE =
  /^\s*type_annotations_b64:\s*([A-Za-z0-9+/=]{16,})\s*$/m;
const decoder = new TextDecoder();

export type NoteAnnotationAnchor = {
  hash: string;
  snippet: string;
  index: number;
  y: number;
};

export type NoteAnnotationPoint = {
  x: number;
  y: number;
};

export type NoteAnnotationStroke = {
  id: string;
  points: NoteAnnotationPoint[];
  color: string;
  width: number;
  anchor?: NoteAnnotationAnchor | null;
  createdAt: number;
};

export type NoteAnnotationTextNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  anchor?: NoteAnnotationAnchor | null;
  createdAt: number;
};

export type NoteAnnotationsPayload = {
  version: 1;
  strokes: NoteAnnotationStroke[];
  textNotes: NoteAnnotationTextNote[];
  updatedAt: number;
};

type CompactAnchorV1 = {
  h: string;
  s: string;
  i: number;
  y: number;
};

type CompactStrokeV1 = {
  i: string;
  p: string;
  c: string;
  w: number;
  k?: CompactAnchorV1;
  a: number;
};

type CompactTextNoteV1 = {
  i: string;
  x: number;
  y: number;
  n: string;
  k?: CompactAnchorV1;
  a: number;
};

type CompactPayloadV1 = {
  v: 1;
  u: number;
  q: number;
  s: CompactStrokeV1[];
  t: CompactTextNoteV1[];
};

type LegacyCompactPayloadV2 = {
  v: 2;
  s: CompactStrokeV1[];
  t: CompactTextNoteV1[];
  u: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const quantizeCoord = (value: number, scale = COORD_SCALE) =>
  Math.round(clamp01(value) * scale);

const dequantizeCoord = (value: number, scale = COORD_SCALE) =>
  clamp01(value / scale);

const roundCoord = (value: number, scale = COORD_SCALE) =>
  dequantizeCoord(quantizeCoord(value, scale), scale);

const fallbackAnnotations = (): NoteAnnotationsPayload => ({
  version: 1,
  strokes: [],
  textNotes: [],
  updatedAt: Date.now(),
});

const isDefined = <T,>(value: T | null): value is T => value !== null;

const removeInlineAnnotationLine = (markdown: string) =>
  markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !INLINE_ANNOTATION_LINE_RE.test(line.trim()))
    .join("\n");

export const stripInlineAnnotationMetadata = (markdown: string) =>
  removeInlineAnnotationLine(stripLensBackmatterBlock(markdown));

const readInlineAnnotationScalar = (markdown: string): string | null => {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(INLINE_ANNOTATION_CAPTURE_RE);
  return match && match[1] ? match[1] : null;
};

const sanitizeAnchor = (value: unknown): NoteAnnotationAnchor | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<NoteAnnotationAnchor>;
  if (
    typeof candidate.hash !== "string" ||
    !candidate.hash.trim() ||
    typeof candidate.snippet !== "string" ||
    typeof candidate.index !== "number" ||
    !Number.isFinite(candidate.index) ||
    typeof candidate.y !== "number" ||
    !Number.isFinite(candidate.y)
  ) {
    return null;
  }
  return {
    hash: candidate.hash.trim(),
    snippet: candidate.snippet.slice(0, 120),
    index: Math.max(0, Math.floor(candidate.index)),
    y: roundCoord(candidate.y),
  };
};

const sanitizePoint = (value: unknown): NoteAnnotationPoint | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<NoteAnnotationPoint>;
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return null;
  }
  return {
    x: roundCoord(candidate.x),
    y: roundCoord(candidate.y),
  };
};

const sanitizePayload = (value: unknown): NoteAnnotationsPayload => {
  if (!value || typeof value !== "object") {
    return fallbackAnnotations();
  }
  const raw = value as Partial<NoteAnnotationsPayload>;

  const strokes = Array.isArray(raw.strokes)
    ? raw.strokes
        .map((stroke) => {
          if (!stroke || typeof stroke !== "object") {
            return null;
          }
          const candidate = stroke as Partial<NoteAnnotationStroke>;
          if (typeof candidate.id !== "string" || !Array.isArray(candidate.points)) {
            return null;
          }
          const points = candidate.points
            .map(sanitizePoint)
            .filter((entry): entry is NoteAnnotationPoint => entry !== null);
          if (points.length < 2) {
            return null;
          }
          const width =
            typeof candidate.width === "number" && Number.isFinite(candidate.width)
              ? Math.min(2.4, Math.max(0.1, candidate.width))
              : 0.4;
          const color =
            typeof candidate.color === "string" && candidate.color.trim()
              ? candidate.color
              : "#2b6ff0";
          const createdAt =
            typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
              ? candidate.createdAt
              : Date.now();
          return {
            id: candidate.id,
            points,
            color,
            width,
            anchor: sanitizeAnchor(candidate.anchor),
            createdAt,
          } satisfies NoteAnnotationStroke;
        })
        .filter(isDefined)
    : [];

  const textNotes = Array.isArray(raw.textNotes)
    ? raw.textNotes
        .map((note) => {
          if (!note || typeof note !== "object") {
            return null;
          }
          const candidate = note as Partial<NoteAnnotationTextNote>;
          if (
            typeof candidate.id !== "string" ||
            typeof candidate.text !== "string" ||
            !candidate.text.trim()
          ) {
            return null;
          }
          const x = typeof candidate.x === "number" ? clamp01(candidate.x) : null;
          const y = typeof candidate.y === "number" ? clamp01(candidate.y) : null;
          if (x === null || y === null) {
            return null;
          }
          const createdAt =
            typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
              ? candidate.createdAt
              : Date.now();
          return {
            id: candidate.id,
            x: roundCoord(x),
            y: roundCoord(y),
            text: candidate.text.trim(),
            anchor: sanitizeAnchor(candidate.anchor),
            createdAt,
          } satisfies NoteAnnotationTextNote;
        })
        .filter(isDefined)
    : [];

  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now();

  return {
    version: 1,
    strokes,
    textNotes,
    updatedAt,
  };
};

const encodePoints = (points: NoteAnnotationPoint[], scale = COORD_SCALE) =>
  points
    .map(
      (point) =>
        `${quantizeCoord(point.x, scale).toString(36)}.${quantizeCoord(point.y, scale).toString(36)}`
    )
    .join(",");

const decodePoints = (value: string, scale = COORD_SCALE): NoteAnnotationPoint[] => {
  if (!value || typeof value !== "string") {
    return [];
  }
  const points: NoteAnnotationPoint[] = [];
  value.split(",").forEach((pair) => {
    const [qxRaw, qyRaw] = pair.split(".");
    if (!qxRaw || !qyRaw) {
      return;
    }
    const qx = Number.parseInt(qxRaw, 36);
    const qy = Number.parseInt(qyRaw, 36);
    if (!Number.isFinite(qx) || !Number.isFinite(qy)) {
      return;
    }
    points.push({
      x: dequantizeCoord(qx, scale),
      y: dequantizeCoord(qy, scale),
    });
  });
  return points;
};

const compactAnchorFromPayload = (value: unknown): NoteAnnotationAnchor | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<CompactAnchorV1>;
  if (
    typeof candidate.h !== "string" ||
    !candidate.h.trim() ||
    typeof candidate.s !== "string" ||
    typeof candidate.i !== "number" ||
    typeof candidate.y !== "number"
  ) {
    return null;
  }
  return sanitizeAnchor({
    hash: candidate.h,
    snippet: candidate.s,
    index: candidate.i,
    y: candidate.y,
  });
};

const toCompactAnchor = (anchor: NoteAnnotationAnchor | null | undefined): CompactAnchorV1 | undefined => {
  const normalized = sanitizeAnchor(anchor);
  if (!normalized) {
    return undefined;
  }
  return {
    h: normalized.hash,
    s: normalized.snippet,
    i: normalized.index,
    y: quantizeCoord(normalized.y),
  };
};

const decodeCompactPayloadV1 = (value: unknown): NoteAnnotationsPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<CompactPayloadV1>;
  if (candidate.v !== 1) {
    return null;
  }

  const scale =
    typeof candidate.q === "number" && Number.isFinite(candidate.q) && candidate.q > 0
      ? candidate.q
      : COORD_SCALE;

  const strokes = Array.isArray(candidate.s)
    ? candidate.s
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const item = entry as Partial<CompactStrokeV1>;
          if (typeof item.i !== "string" || typeof item.p !== "string") {
            return null;
          }
          const points = decodePoints(item.p, scale);
          if (points.length < 2) {
            return null;
          }
          const widthRaw = typeof item.w === "number" && Number.isFinite(item.w) ? item.w : 40;
          return {
            id: item.i,
            points,
            color: typeof item.c === "string" && item.c.trim() ? item.c : "#2b6ff0",
            width: Math.min(2.4, Math.max(0.1, widthRaw / 100)),
            anchor: compactAnchorFromPayload(item.k),
            createdAt:
              typeof item.a === "number" && Number.isFinite(item.a) ? item.a : Date.now(),
          } satisfies NoteAnnotationStroke;
        })
        .filter(isDefined)
    : [];

  const textNotes = Array.isArray(candidate.t)
    ? candidate.t
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const item = entry as Partial<CompactTextNoteV1>;
          if (
            typeof item.i !== "string" ||
            typeof item.n !== "string" ||
            !item.n.trim() ||
            typeof item.x !== "number" ||
            typeof item.y !== "number"
          ) {
            return null;
          }
          return {
            id: item.i,
            x: dequantizeCoord(item.x, scale),
            y: dequantizeCoord(item.y, scale),
            text: item.n.trim(),
            anchor: compactAnchorFromPayload(item.k),
            createdAt:
              typeof item.a === "number" && Number.isFinite(item.a) ? item.a : Date.now(),
          } satisfies NoteAnnotationTextNote;
        })
        .filter(isDefined)
    : [];

  return {
    version: 1,
    strokes,
    textNotes,
    updatedAt:
      typeof candidate.u === "number" && Number.isFinite(candidate.u)
        ? candidate.u
        : Date.now(),
  };
};

const decodeLegacyCompactPayloadV2 = (value: unknown): NoteAnnotationsPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<LegacyCompactPayloadV2>;
  if (candidate.v !== 2) {
    return null;
  }
  return decodeCompactPayloadV1({
    v: 1,
    u: candidate.u,
    q: COORD_SCALE,
    s: candidate.s,
    t: candidate.t,
  });
};

const decodePayloadObject = (value: unknown): NoteAnnotationsPayload | null =>
  decodeCompactPayloadV1(value) || decodeLegacyCompactPayloadV2(value) || sanitizePayload(value);

const decodePayloadFromBase64 = (encodedValue: string): NoteAnnotationsPayload | null => {
  try {
    const bytes = fromBase64(encodedValue);
    const json = decoder.decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    return decodePayloadObject(parsed);
  } catch {
    return null;
  }
};

const toCompactPayloadV1 = (payload: NoteAnnotationsPayload): CompactPayloadV1 => ({
  v: 1,
  u: payload.updatedAt,
  q: COORD_SCALE,
  s: payload.strokes.map((stroke) => ({
    i: stroke.id,
    p: encodePoints(stroke.points, COORD_SCALE),
    c: stroke.color,
    w: Math.round(Math.min(2.4, Math.max(0.1, stroke.width)) * 100),
    k: toCompactAnchor(stroke.anchor),
    a: stroke.createdAt,
  })),
  t: payload.textNotes.map((note) => ({
    i: note.id,
    x: quantizeCoord(note.x, COORD_SCALE),
    y: quantizeCoord(note.y, COORD_SCALE),
    n: note.text,
    k: toCompactAnchor(note.anchor),
    a: note.createdAt,
  })),
});

const stripLegacyLensMetadata = (markdown: string) => {
  const withoutBackmatter = stripLensBackmatterBlock(markdown);
  const withoutFrontmatterKey = removeFrontmatterScalar(
    withoutBackmatter,
    NOTE_ANNOTATIONS_KEY
  );
  const { frontmatterBlock, body } = splitFrontmatter(withoutFrontmatterKey);
  const cleanBody = removeInlineAnnotationLine(body);
  return joinFrontmatter(frontmatterBlock, cleanBody);
};

const hasAnyMarks = (payload: NoteAnnotationsPayload) =>
  payload.strokes.length > 0 || payload.textNotes.length > 0;

export const parseNoteAnnotations = (markdown: string): NoteAnnotationsPayload => {
  const extracted = extractLensBackmatter(markdown);
  if (extracted.lens) {
    return decodePayloadObject(extracted.lens) || fallbackAnnotations();
  }

  const encodedValue =
    readFrontmatterScalar(markdown, NOTE_ANNOTATIONS_KEY) ||
    readInlineAnnotationScalar(markdown);
  if (encodedValue) {
    return decodePayloadFromBase64(encodedValue) || fallbackAnnotations();
  }

  return fallbackAnnotations();
};

export const withNoteAnnotations = (
  markdown: string,
  payload: NoteAnnotationsPayload
) => {
  const cleanMarkdown = stripLegacyLensMetadata(markdown);
  const normalizedPayload = sanitizePayload(payload);
  if (!hasAnyMarks(normalizedPayload)) {
    return cleanMarkdown;
  }
  const compact = toCompactPayloadV1(normalizedPayload) as unknown as Record<string, unknown>;
  return appendLensBackmatterBlock(cleanMarkdown, compact);
};
