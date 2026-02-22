import { fromBase64, toBase64 } from "./notes";
import { readFrontmatterScalar, upsertFrontmatterScalar } from "./frontmatter";

const NOTE_ANNOTATIONS_KEY = "type_annotations_b64";
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

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
    x: clamp01(candidate.x),
    y: clamp01(candidate.y),
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
    return sanitizePayload(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
};

const encodePayload = (payload: NoteAnnotationsPayload) => {
  const json = JSON.stringify(sanitizePayload(payload));
  return toBase64(encoder.encode(json));
};

export const parseNoteAnnotations = (markdown: string): NoteAnnotationsPayload => {
  const encodedValue = readFrontmatterScalar(markdown, NOTE_ANNOTATIONS_KEY);
  if (!encodedValue) {
    return fallbackAnnotations();
  }
  return decodePayload(encodedValue) || fallbackAnnotations();
};

export const withNoteAnnotations = (
  markdown: string,
  payload: NoteAnnotationsPayload
) => {
  const normalizedPayload = sanitizePayload(payload);
  const encodedValue = encodePayload(normalizedPayload);
  return upsertFrontmatterScalar(markdown, NOTE_ANNOTATIONS_KEY, encodedValue);
};
