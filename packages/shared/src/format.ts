import type {
  HandwritingOcrListItem,
  NoteMeta,
  RecordingListItem,
} from "./types";
import { stripFrontmatter } from "./frontmatter";
import { stripInlineAnnotationMetadata } from "./annotation-metadata";

const RECORDING_NOTE_TYPE = "audio_recording";
const HANDWRITING_NOTE_TYPE = "handwriting_attachment";

const stripMarkdownLine = (line: string) =>
  line
    .replace(/\\+_/g, "_")
    .replace(/NV_EMPTY_LINE_TOKEN_[A-Za-z0-9]+/gi, " ")
    .replace(/NV[\s_]+EMPTY[\s_]+LINE[\s_]+TOKEN(?:[\s_]+[A-Za-z0-9]+)?/gi, " ")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[>\-+*]\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isRecordingNoiseLine = (line: string) =>
  /^recording$/i.test(line) ||
  /^transcript$/i.test(line) ||
  /^<!--\s*recording-transcript:(start|end)\s*-->$/i.test(line) ||
  /^\(transcription(?:\s+\w+)*\.\)$/i.test(line) ||
  /^error:\s*/i.test(line);

export const isRecordingNoteType = (
  noteType: string | null | undefined,
  recordingAudioPath: string | null | undefined
) =>
  noteType === RECORDING_NOTE_TYPE || Boolean(recordingAudioPath && recordingAudioPath.trim());

export const isHandwritingNoteType = (
  noteType: string | null | undefined,
  handwritingAttachmentPath: string | null | undefined
) =>
  noteType === HANDWRITING_NOTE_TYPE ||
  Boolean(handwritingAttachmentPath && handwritingAttachmentPath.trim());

export const isRecordingTranscriptionCompleted = (
  status: string | null | undefined
) => (status || "").trim().toLowerCase() === "completed";

export const isHandwritingOcrCompleted = (status: string | null | undefined) =>
  (status || "").trim().toLowerCase() === "completed";

export const sanitizeRecordingEditorContent = (
  content: string,
  transcriptionStatus: string | null | undefined
) => {
  if (isRecordingTranscriptionCompleted(transcriptionStatus)) {
    return content;
  }
  const filteredLines = content
    .split(/\r?\n/)
    .filter((line) => !isRecordingNoiseLine(stripMarkdownLine(line)));
  return filteredLines.join("\n").replace(/\n{3,}/g, "\n\n");
};

export const formatRecordingStatusLabel = (status: string | null | undefined) => {
  const normalized = (status || "").trim().toLowerCase();
  if (!normalized) {
    return "Unknown";
  }
  if (normalized === "pending") {
    return "Pending";
  }
  if (normalized === "queued") {
    return "Queued";
  }
  if (normalized === "processing") {
    return "Processing";
  }
  if (normalized === "completed") {
    return "Completed";
  }
  if (normalized === "failed") {
    return "Failed";
  }
  return normalized[0].toUpperCase() + normalized.slice(1);
};

export type NotePreview = {
  title: string;
  dateLabel: string;
  secondLine: string;
  createdMs: number | null;
  updatedMs: number | null;
  archivedMs: number | null;
  reviewedMs: number | null;
  isArchived: boolean;
  isReviewed: boolean;
  isRecording: boolean;
  isHandwriting: boolean;
  recordingAudioPath: string | null;
  handwritingAttachmentPath: string | null;
  transcriptionStatus: string | null;
  ocrStatus: string | null;
};

export const formatNoteDateLabel = (timestamp: number | null) => {
  if (!timestamp) {
    return "";
  }
  const value = new Date(timestamp);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemStart = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  );
  const diffDays = Math.floor(
    (todayStart.getTime() - itemStart.getTime()) / 86_400_000
  );
  if (diffDays <= 0) {
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  if (diffDays < 7) {
    return value.toLocaleDateString([], { weekday: "long" }).toLowerCase();
  }
  if (value.getFullYear() === now.getFullYear()) {
    return value.toLocaleDateString([], {
      day: "numeric",
      month: "short",
    });
  }
  return value.toLocaleDateString([], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export const parseNotePreview = (
  content: string,
  updatedMs: number | null,
  noteMeta?: Pick<
    NoteMeta,
    | "created_ms"
    | "note_type"
    | "archived_ms"
    | "reviewed_ms"
    | "recording_audio_path"
    | "handwriting_attachment_path"
    | "transcription_status"
    | "ocr_status"
  >
): NotePreview => {
  const isRecording = isRecordingNoteType(
    noteMeta?.note_type,
    noteMeta?.recording_audio_path
  );
  const isHandwriting = isHandwritingNoteType(
    noteMeta?.note_type,
    noteMeta?.handwriting_attachment_path
  );
  const transcriptionStatus = noteMeta?.transcription_status || null;
  const ocrStatus = noteMeta?.ocr_status || null;
  const isTranscribed = isRecordingTranscriptionCompleted(transcriptionStatus);
  const isOcrComplete = isHandwritingOcrCompleted(ocrStatus);
  const contentWithoutFrontmatter = stripInlineAnnotationMetadata(
    stripFrontmatter(content)
  );
  const createdMs = noteMeta?.created_ms ?? null;
  const archivedMs = noteMeta?.archived_ms ?? null;
  const reviewedMs = noteMeta?.reviewed_ms ?? null;

  const previewLines: string[] = [];
  const sourceContent =
    isRecording && !isTranscribed
      ? sanitizeRecordingEditorContent(contentWithoutFrontmatter, transcriptionStatus)
      : contentWithoutFrontmatter;
  for (const rawLine of sourceContent.split(/\r?\n/)) {
    const line = stripMarkdownLine(rawLine);
    if (!line || isRecordingNoiseLine(line)) {
      continue;
    }
    previewLines.push(line);
    if (previewLines.length >= 2) {
      break;
    }
  }

  const useVoiceRecordingPlaceholder =
    isRecording && !isTranscribed && previewLines.length === 0;
  const useHandwritingPlaceholder =
    isHandwriting && !isOcrComplete && previewLines.length === 0;
  const title =
    useVoiceRecordingPlaceholder
      ? "Voice recording"
      : useHandwritingPlaceholder
        ? "Handwriting note"
        : previewLines[0] || "";
  const secondLine = useVoiceRecordingPlaceholder ? "" : previewLines[1] || "";
  return {
    title,
    dateLabel: formatNoteDateLabel(updatedMs),
    secondLine,
    createdMs,
    updatedMs,
    archivedMs,
    reviewedMs,
    isArchived: Boolean(archivedMs),
    isReviewed: Boolean(reviewedMs),
    isRecording,
    isHandwriting,
    recordingAudioPath: noteMeta?.recording_audio_path || null,
    handwritingAttachmentPath: noteMeta?.handwriting_attachment_path || null,
    transcriptionStatus,
    ocrStatus,
  };
};

export const getNextNoteFileName = (existingNames: string[]) => {
  const used = new Set(existingNames.map((name) => name.toLowerCase()));
  let index = 1;
  while (true) {
    const candidate = index === 1 ? "New note.md" : `New note ${index}.md`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }
};

export const formatRecordingStatus = (item: RecordingListItem) => {
  if (item.is_processing) {
    return "processing";
  }
  if (item.is_queued) {
    return "queued";
  }
  return item.status;
};

export const formatHandwritingStatus = (item: HandwritingOcrListItem) => {
  if (item.is_processing) {
    return "processing";
  }
  if (item.is_queued) {
    return "queued";
  }
  return item.status;
};

export const formatUpdatedAt = (updatedMs: number | null) => {
  if (!updatedMs) {
    return "never";
  }
  const date = new Date(updatedMs);
  if (Number.isNaN(date.getTime())) {
    return "never";
  }
  return date.toLocaleString();
};

export const formatHistoryTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

export const formatGitCommitTime = (value: number | null) => {
  if (!value) {
    return "Unknown time";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }
  return parsed.toLocaleString();
};

export const formatGitCommitStateLabel = (state: "synced" | "local") =>
  state === "synced" ? "Synced" : "Local only";

export const formatCommitSummaryForApp = (summary: string) => {
  const normalized = summary.trim();
  if (!normalized) {
    return "No commit message";
  }
  if (normalized.toLowerCase() === "sync notes") {
    return "Synced notes";
  }
  return normalized;
};

export const getSyncHint = (error: string | null): string | null => {
  if (!error) {
    return null;
  }
  const lower = error.toLowerCase();
  if (lower.includes("local changes detected")) {
    return "Pull blocked. Push local changes first.";
  }
  if (lower.includes("merge commit")) {
    return "Diverged history. Resolve on desktop, then pull on mobile.";
  }
  if (lower.includes("merge conflicts")) {
    return "Merge conflict detected. Resolve on desktop, then sync again.";
  }
  if (lower.includes("non-fast-forward")) {
    return "Remote is newer. Pull first, then push again.";
  }
  if (lower.includes("credentials")) {
    return "Authentication failed. Verify username and token.";
  }
  if (
    lower.includes("timed out") ||
    lower.includes("connection refused") ||
    lower.includes("no route to host") ||
    lower.includes("network is unreachable") ||
    lower.includes("is unreachable")
  ) {
    if (lower.includes("local network") || lower.includes("same wi-fi") || lower.includes("hotspot")) {
      return "The computer was not reachable. Keep Type open on the desktop, stay on the same Wi-Fi or hotspot, and allow Local Network access in iOS Settings.";
    }
    return "The remote was not reachable. Check the network connection and remote URL.";
  }
  if (
    lower.includes("host key changed") ||
    lower.includes("host key could not be verified") ||
    // libgit2's wording when a host is neither pinned nor in known_hosts.
    lower.includes("unknown remote ssh hostkey")
  ) {
    return "The desktop identity could not be verified. Restart the desktop sync server and scan the new QR code.";
  }
  if (lower.includes("old git:// local sync")) {
    return "This connection is from an older app version. Scan the new QR code in desktop Settings → Sync.";
  }
  if (lower.includes("rejected this device's key")) {
    return "Pairing needed. Scan the QR code in desktop Settings → Sync.";
  }
  if (lower.includes("not initialized")) {
    return "Repository is not connected yet.";
  }
  return "Sync failed. Verify settings and retry.";
};
