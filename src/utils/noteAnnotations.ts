import { fromBase64, toBase64 } from "./notes";
import { readFrontmatterScalar, upsertFrontmatterScalar } from "./frontmatter";

const NOTE_ANNOTATIONS_KEY = "type_annotations_b64";
const COORD_SCALE = 4095;
const INLINE_ANNOTATION_LINE_RE = /^type_annotations_b64:\s*[A-Za-z0-9+/=]{16,}\s*$/;
const INLINE_ANNOTATION_CAPTURE_RE =
  /^\s*type_annotations_b64:\s*([A-Za-z0-9+/=]{16,})\s*$/m;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type NoteAnnotationPoint = {
  x: number;
  y: number;
};

export type NoteAnnotationStroke = {
  id: string;
  points: NoteAnnotationPoint[];
  color: string;
  width: number;
  createdAt: number;
};

export type NoteAnnotationTextNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  createdAt: number;
};

export type NoteAnnotationsPayload = {
  version: 1;
  strokes: NoteAnnotationStroke[];
  textNotes: NoteAnnotationTextNote[];
  updatedAt: number;
};

type CompactStrokeV2 = {
  i: string;
  p: string;
  c: string;
  w: number;
  a: number;
};

type CompactTextNoteV2 = {
  i: string;
  x: number;
  y: number;
  n: string;
  a: number;
};

type CompactPayloadV2 = {
  v: 2;
  s: CompactStrokeV2[];
  t: CompactTextNoteV2[];
  u: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const quantizeCoord = (value: number) => Math.round(clamp01(value) * COORD_SCALE);
const dequantizeCoord = (value: number) => clamp01(value / COORD_SCALE);
const roundCoord = (value: number) => dequantizeCoord(quantizeCoord(value));

export const stripInlineAnnotationMetadata = (markdown: string) =>
  markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !INLINE_ANNOTATION_LINE_RE.test(line.trim()))
    .join("\n");

const readInlineAnnotationScalar = (markdown: string): string | null => {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(INLINE_ANNOTATION_CAPTURE_RE);
  return match && match[1] ? match[1] : null;
};

const fallbackAnnotations = (): NoteAnnotationsPayload => ({
  version: 1,
  strokes: [],
  textNotes: [],
  updatedAt: Date.now(),
});

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
            createdAt,
          } satisfies NoteAnnotationStroke;
        })
        .filter((entry): entry is NoteAnnotationStroke => entry !== null)
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
            x,
            y,
            text: candidate.text.trim(),
            createdAt,
          } satisfies NoteAnnotationTextNote;
        })
        .filter((entry): entry is NoteAnnotationTextNote => entry !== null)
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

const decodePayload = (encodedValue: string): NoteAnnotationsPayload | null => {
  try {
    const bytes = fromBase64(encodedValue);
    const json = decoder.decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    const decodedCompact = decodeCompactPayload(parsed);
    if (decodedCompact) {
      return decodedCompact;
    }
    return sanitizePayload(parsed);
  } catch {
    return null;
  }
};

const encodePoints = (points: NoteAnnotationPoint[]) =>
  points
    .map((point) => `${quantizeCoord(point.x).toString(36)}.${quantizeCoord(point.y).toString(36)}`)
    .join(",");

const decodePoints = (value: string): NoteAnnotationPoint[] => {
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
      x: dequantizeCoord(qx),
      y: dequantizeCoord(qy),
    });
  });
  return points;
};

const toCompactPayload = (payload: NoteAnnotationsPayload): CompactPayloadV2 => ({
  v: 2,
  s: payload.strokes.map((stroke) => ({
    i: stroke.id,
    p: encodePoints(stroke.points),
    c: stroke.color,
    w: Math.round(Math.min(2.4, Math.max(0.1, stroke.width)) * 100),
    a: stroke.createdAt,
  })),
  t: payload.textNotes.map((note) => ({
    i: note.id,
    x: quantizeCoord(note.x),
    y: quantizeCoord(note.y),
    n: note.text,
    a: note.createdAt,
  })),
  u: payload.updatedAt,
});

const decodeCompactPayload = (value: unknown): NoteAnnotationsPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<CompactPayloadV2>;
  if (candidate.v !== 2) {
    return null;
  }

  const strokes = Array.isArray(candidate.s)
    ? candidate.s
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const item = entry as Partial<CompactStrokeV2>;
          if (typeof item.i !== "string" || typeof item.p !== "string") {
            return null;
          }
          const points = decodePoints(item.p);
          if (points.length < 2) {
            return null;
          }
          const widthRaw = typeof item.w === "number" && Number.isFinite(item.w) ? item.w : 40;
          return {
            id: item.i,
            points,
            color: typeof item.c === "string" && item.c.trim() ? item.c : "#2b6ff0",
            width: Math.min(2.4, Math.max(0.1, widthRaw / 100)),
            createdAt:
              typeof item.a === "number" && Number.isFinite(item.a) ? item.a : Date.now(),
          } satisfies NoteAnnotationStroke;
        })
        .filter((entry): entry is NoteAnnotationStroke => entry !== null)
    : [];

  const textNotes = Array.isArray(candidate.t)
    ? candidate.t
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const item = entry as Partial<CompactTextNoteV2>;
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
            x: dequantizeCoord(item.x),
            y: dequantizeCoord(item.y),
            text: item.n.trim(),
            createdAt:
              typeof item.a === "number" && Number.isFinite(item.a) ? item.a : Date.now(),
          } satisfies NoteAnnotationTextNote;
        })
        .filter((entry): entry is NoteAnnotationTextNote => entry !== null)
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

const encodePayload = (payload: NoteAnnotationsPayload) => {
  const json = JSON.stringify(toCompactPayload(sanitizePayload(payload)));
  return toBase64(encoder.encode(json));
};

export const parseNoteAnnotations = (markdown: string): NoteAnnotationsPayload => {
  const encodedValue =
    readFrontmatterScalar(markdown, NOTE_ANNOTATIONS_KEY) ||
    readInlineAnnotationScalar(markdown);
  if (!encodedValue) {
    return fallbackAnnotations();
  }
  return decodePayload(encodedValue) || fallbackAnnotations();
};

export const withNoteAnnotations = (
  markdown: string,
  payload: NoteAnnotationsPayload
) => {
  const normalizedMarkdown = stripInlineAnnotationMetadata(markdown);
  const normalizedPayload = sanitizePayload(payload);
  const encodedValue = encodePayload(normalizedPayload);
  return upsertFrontmatterScalar(normalizedMarkdown, NOTE_ANNOTATIONS_KEY, encodedValue);
};
