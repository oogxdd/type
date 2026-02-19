import type { RecordingListItem } from "../types";

export type NotePreview = {
  title: string;
  dateLabel: string;
  secondLine: string;
  updatedMs: number | null;
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
  return value.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
};

export const parseNotePreview = (
  noteName: string,
  content: string,
  updatedMs: number | null
): NotePreview => {
  const stripMarkdown = (line: string) =>
    line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[>\-+*]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const lines = content.split(/\r?\n/);
  const fallbackTitle = noteName.replace(/\.md$/i, "");
  const title = stripMarkdown(lines[0] || "") || fallbackTitle;
  const secondLine = stripMarkdown(lines[1] || "");
  return { title, dateLabel: formatNoteDateLabel(updatedMs), secondLine, updatedMs };
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
  if (lower.includes("not initialized")) {
    return "Repository is not connected yet.";
  }
  return "Sync failed. Verify settings and retry.";
};
